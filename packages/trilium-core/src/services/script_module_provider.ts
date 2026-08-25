import { ValidationError } from "../errors.js";
import request from "./request.js";
import { decodeUtf8 } from "./utils/binary.js";

/** One ES module of a resolved package. */
export interface ScriptModuleFile {
    /** Name the artifact's other files import this one by. */
    name: string;
    /** URL it came from, kept so an install can be checked against its source later. */
    url: string;
    source: string;
}

/**
 * A package resolved to a set of ES modules that import only each other.
 *
 * Self-contained on purpose: the files are stored and executed long after the provider that built
 * them was reachable, so nothing in them may point back at the network.
 */
export interface ScriptModuleArtifact {
    /** {@link ScriptModuleProvider.id} of the provider that produced this. */
    providerId: string;
    /** The package the caller asked for, normalized. */
    spec: PackageSpec;
    files: ScriptModuleFile[];
    /** Name of the file in {@link files} to import. */
    entry: string;
}

/** An npm package name, an optional version, and an optional path inside the package. */
export interface PackageSpec {
    /** Package name, `@scope/name` included. */
    name: string;
    /** Exact version, range or dist-tag. Absent means whatever the provider considers current. */
    version?: string;
    /** Path inside the package, leading slash included. */
    subpath?: string;
}

/** Turns a package into ES modules. One implementation per source of builds. */
export interface ScriptModuleProvider {
    readonly id: string;
    resolve(spec: PackageSpec): Promise<ScriptModuleArtifact>;
}

/** What a resolve is allowed to cost, since a package's graph is a third party's to decide. */
export interface ScriptModuleLimits {
    /** Modules in one artifact. */
    maxFiles: number;
    /** Bytes in one module. */
    maxFileBytes: number;
    /** Bytes in the whole artifact. */
    maxTotalBytes: number;
}

export const DEFAULT_LIMITS: ScriptModuleLimits = {
    maxFiles: 64,
    maxFileBytes: 4 * 1024 * 1024,
    maxTotalBytes: 12 * 1024 * 1024
};

export const ESM_SH_ORIGIN = "https://esm.sh";

export interface EsmShOptions {
    /** Where to fetch builds from. Point it at a self-hosted esm.sh to depend on no third party. */
    origin?: string;
    /** ECMAScript target esm.sh compiles down to. */
    target?: string;
    limits?: ScriptModuleLimits;
}

/**
 * Builds packages through esm.sh, which compiles npm packages to ES modules and polyfills the Node
 * built-ins they reach for.
 *
 * `?bundle` folds a package's own dependencies into one module, but the answer is still a small
 * graph rather than a single file — esm.sh serves an entry that re-exports the bundle, and pulls
 * its Node polyfills in separately. So the resolve crawls what it is given.
 */
export function createEsmShProvider(options: EsmShOptions = {}): ScriptModuleProvider {
    const origin = (options.origin ?? ESM_SH_ORIGIN).replace(/\/+$/, "");
    const target = options.target ?? "es2022";
    const limits = options.limits ?? DEFAULT_LIMITS;

    return {
        id: "esm.sh",
        async resolve(spec: PackageSpec): Promise<ScriptModuleArtifact> {
            const version = spec.version ? `@${encodeURIComponent(spec.version)}` : "";
            const path = `${spec.name}${version}${spec.subpath ?? ""}`;
            const entryUrl = `${origin}/${path}?bundle&target=${encodeURIComponent(target)}`;

            const { files, entry } = await fetchModuleGraph(entryUrl, limits);
            return { providerId: "esm.sh", spec, files, entry };
        }
    };
}

/**
 * Parses `cheerio`, `cheerio@1.1.2`, `@scope/pkg@1.1.2` or `cheerio@1.1.2/lib/static` into its
 * parts, refusing anything that would not survive being put back into a URL.
 */
export function parsePackageSpec(raw: string): PackageSpec {
    const trimmed = raw.trim();
    if (!trimmed) {
        throw new ValidationError("Package specifier is empty.");
    }

    const scoped = trimmed.startsWith("@");
    const versionAt = trimmed.indexOf("@", scoped ? 1 : 0);

    let name: string;
    let version: string | undefined;
    let rest: string;

    if (versionAt >= 0) {
        name = trimmed.slice(0, versionAt);
        const afterVersion = trimmed.slice(versionAt + 1);
        const subpathAt = afterVersion.indexOf("/");
        version = subpathAt >= 0 ? afterVersion.slice(0, subpathAt) : afterVersion;
        rest = subpathAt >= 0 ? afterVersion.slice(subpathAt) : "";
    } else {
        // No version, so the name runs to the end of its segments and the rest is a subpath.
        const segments = trimmed.split("/");
        const nameSegments = scoped ? 2 : 1;
        name = segments.slice(0, nameSegments).join("/");
        rest = segments.length > nameSegments ? `/${segments.slice(nameSegments).join("/")}` : "";
    }

    if (!PACKAGE_NAME.test(name)) {
        throw new ValidationError(`'${name}' is not a valid package name.`);
    }
    if (version !== undefined && !VERSION.test(version)) {
        throw new ValidationError(`'${version}' is not a valid version, range or tag.`);
    }
    const walksOut = rest.split("/").some((segment) => segment === "." || segment === "..");
    if (rest && (!SUBPATH.test(rest) || walksOut)) {
        throw new ValidationError(`'${rest}' is not a valid path inside a package.`);
    }

    return { name, ...(version ? { version } : {}), ...(rest ? { subpath: rest } : {}) };
}

const PACKAGE_NAME = /^(@[a-z0-9~][a-z0-9._~-]*\/)?[a-z0-9~][a-z0-9._~-]*$/i;
/** Exact versions, ranges and dist-tags. Without spaces or `||`, which a URL path cannot carry. */
const VERSION = /^[a-z0-9.~^*+-]+$/i;
const SUBPATH = /^(\/[a-z0-9._~-]+)+$/i;

/** `from "x"`, `import "x"` and the `from` of `export * from "x"`. */
const STATIC_SPECIFIER = /(\b(?:from|import)\s*)(["'])([^"'\n]+)\2/g;
/** `import("x")`, which the static form skips because of the parenthesis. */
const DYNAMIC_SPECIFIER = /(\bimport\s*\(\s*)(["'])([^"'\n]+)\2(\s*\))/g;

/**
 * Fetches everything reachable from `entryUrl` and rewrites the links between them to local names.
 *
 * Only same-origin URLs are followed: a build service names its own files, and a specifier pointing
 * anywhere else is left as it stands rather than pulled in. Specifiers resolve against the URL that
 * was requested, so a provider must serve its modules without redirecting.
 *
 * Specifiers are found by pattern rather than by parsing, so text that merely reads as a
 * same-origin import — inside a string, inside a comment — is fetched too, and fails the resolve if
 * the URL it names does not exist. Failing loudly is the point: a build whose real imports 404 is
 * exactly what an install must not accept, and esm.sh does ship such builds.
 */
async function fetchModuleGraph(entryUrl: string, limits: ScriptModuleLimits) {
    const origin = new URL(entryUrl).origin;
    const sources = new Map<string, string>();
    const queue = [entryUrl];
    let totalBytes = 0;

    while (queue.length > 0) {
        const url = queue.shift();
        if (url === undefined || sources.has(url)) {
            continue;
        }
        if (sources.size >= limits.maxFiles) {
            throw new ValidationError(
                `Package needs more than the ${limits.maxFiles} modules an install may hold.`);
        }

        const response = await request.fetchResource(url, { maxBytes: limits.maxFileBytes });
        if (!response.ok) {
            throw new ValidationError(`Fetching '${url}' answered HTTP ${response.status}.`);
        }
        if (!response.contentType.includes("javascript")) {
            throw new ValidationError(
                `'${url}' was served as '${response.contentType}' rather than JavaScript.`);
        }

        totalBytes += response.bytes.length;
        if (totalBytes > limits.maxTotalBytes) {
            throw new ValidationError(
                `Package is larger than the ${limits.maxTotalBytes} bytes an install may hold.`);
        }

        const source = decodeUtf8(response.bytes);
        sources.set(url, source);

        for (const specifier of readSpecifiers(source)) {
            const resolved = resolveSpecifier(specifier, url);
            if (resolved && resolved.startsWith(`${origin}/`) && !sources.has(resolved)) {
                queue.push(resolved);
            }
        }
    }

    const names = new Map<string, string>();
    for (const url of sources.keys()) {
        names.set(url, fileNameFor(url, new Set(names.values())));
    }

    const files: ScriptModuleFile[] = [];
    for (const [url, source] of sources) {
        const rewritten = stripSourceMapLinks(rewriteSpecifiers(source, url, names));
        files.push({ name: names.get(url) ?? "", url, source: rewritten });
    }

    return { files, entry: names.get(entryUrl) ?? "" };
}

/** Drops the link to a source map, which is not fetched and so names a file that is never there. */
function stripSourceMapLinks(source: string): string {
    return source.replace(/^[ \t]*\/\/[#@] sourceMappingURL=.*$\n?/gm, "");
}

function* readSpecifiers(source: string): Generator<string> {
    for (const match of source.matchAll(STATIC_SPECIFIER)) {
        yield match[3];
    }
    for (const match of source.matchAll(DYNAMIC_SPECIFIER)) {
        yield match[3];
    }
}

/**
 * Points every specifier that names a fetched module at that module's local name.
 *
 * Only a specifier naming a module that was fetched is rewritten, so bare specifiers and other
 * origins are left as they stand.
 */
function rewriteSpecifiers(source: string, baseUrl: string, names: Map<string, string>): string {
    const localName = (specifier: string) => {
        const resolved = resolveSpecifier(specifier, baseUrl);
        return resolved ? names.get(resolved) : undefined;
    };

    return source
        .replace(STATIC_SPECIFIER, (whole, keyword, quote, specifier) => {
            const name = localName(specifier);
            return name ? `${keyword}${quote}./${name}${quote}` : whole;
        })
        .replace(DYNAMIC_SPECIFIER, (whole, opening, quote, specifier, closing) => {
            const name = localName(specifier);
            return name ? `${opening}${quote}./${name}${quote}${closing}` : whole;
        });
}

/**
 * Resolves a specifier the way a module loader does, which is not what `new URL` alone does: a bare
 * specifier is a package name, not a relative path, so `"react"` must not become `<origin>/react`.
 */
function resolveSpecifier(specifier: string, baseUrl: string): string | undefined {
    const relative = specifier.startsWith("/") || specifier.startsWith("./")
        || specifier.startsWith("../");
    if (!relative && !HAS_SCHEME.test(specifier)) {
        return undefined;
    }

    try {
        return new URL(specifier, baseUrl).href;
    } catch {
        return undefined;
    }
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Names a module after the URL it came from, so a stored artifact can be read back against its
 * source. The query is part of the name because a build service varies its answer by query.
 */
function fileNameFor(url: string, taken: Set<string>): string {
    const parsed = new URL(url);
    const slug = `${parsed.pathname}${parsed.search}`
        .replace(/^\/+/, "")
        .replace(/[^a-z0-9._@-]+/gi, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 100) || "module";

    const base = slug.endsWith(".mjs") ? slug : `${slug}.mjs`;
    if (!taken.has(base)) {
        return base;
    }

    for (let suffix = 2; ; suffix++) {
        const candidate = base.replace(/\.mjs$/, `-${suffix}.mjs`);
        if (!taken.has(candidate)) {
            return candidate;
        }
    }
}
