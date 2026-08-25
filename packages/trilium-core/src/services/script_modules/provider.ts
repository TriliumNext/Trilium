import { ValidationError } from "../../errors.js";
import { getLog } from "../log.js";
import request from "../request.js";
import { decodeUtf8 } from "../utils/binary.js";

/** One ES module of a resolved package. */
export interface ScriptModuleFile {
    /** Name the artifact's other files import this one by. */
    name: string;
    /** URL it came from, kept so an install can be checked against its source later. */
    url: string;
    source: string;
}

/**
 * The TypeScript declarations a package is typed by, resolved the same way its modules are.
 *
 * Nothing runs them: they exist so the script editor can say what a `require()` of this package
 * returns. A package that publishes none is installed without them and completes as `any`, which is
 * what every package did before this.
 */
export interface ScriptModuleDeclarations {
    files: ScriptModuleFile[];
    /** Name of the file in {@link files} the package is typed by. */
    entry: string;
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
    /** What the package is typed by, where it publishes declarations. */
    types?: ScriptModuleDeclarations;
}

/**
 * Which runtime a build is made for.
 *
 * `portable` is compiled for a browser, with the Node built-ins it reaches for polyfilled, so it
 * runs wherever core runs — the server, the desktop app, and the browser-hosted builds that have no
 * Node at all. `node` leaves those built-ins to the host, so it is the real package but only runs
 * where Node does.
 */
export type ModuleTarget = "portable" | "node";

/** An npm package name, an optional version, a path inside it, and the build wanted. */
export interface PackageSpec {
    /** Package name, `@scope/name` included. */
    name: string;
    /** Exact version, range or dist-tag. Absent means whatever the provider considers current. */
    version?: string;
    /** Path inside the package, leading slash included. */
    subpath?: string;
    /** Which build. The same package and version can be installed once for each. */
    target: ModuleTarget;
}

/** Turns a package into ES modules. One implementation per source of builds. */
export interface ScriptModuleProvider {
    readonly id: string;
    /** The builds this provider can make. */
    readonly targets: readonly ModuleTarget[];
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

/**
 * What a declaration crawl is allowed to cost.
 *
 * More files than a build and fewer bytes: a build service bundles a package's modules into a
 * handful, while its declarations stay one per source module and carry no implementation.
 */
export const DEFAULT_DECLARATION_LIMITS: ScriptModuleLimits = {
    maxFiles: 256,
    maxFileBytes: 2 * 1024 * 1024,
    maxTotalBytes: 8 * 1024 * 1024
};

export const ESM_SH_ORIGIN = "https://esm.sh";
export const JSDELIVR_ORIGIN = "https://cdn.jsdelivr.net";

export interface ProviderOptions {
    /**
     * Where to fetch builds from. Point it at a self-hosted build service to depend on no third
     * party.
     */
    origin?: string;
    limits?: ScriptModuleLimits;
    /** What the package's declarations are allowed to cost, which is a separate budget. */
    declarationLimits?: ScriptModuleLimits;
}

export interface EsmShOptions extends ProviderOptions {
    /** ECMAScript target esm.sh compiles down to. */
    target?: string;
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
    const browserTarget = options.target ?? "es2022";

    // The portable build folds a package's dependencies in; the Node one does not. Bundling a Node
    // build inlines source in which text reads as an import, which the crawl then chases.
    return createGraphProvider("esm.sh", [ "portable", "node" ], options, ESM_SH_ORIGIN,
        (origin, path, target) => target === "node"
            ? `${origin}/${path}?target=node`
            : `${origin}/${path}?bundle&target=${encodeURIComponent(browserTarget)}`);
}

/**
 * Builds packages through jsDelivr, whose `/+esm` compiles one package and points at its
 * dependencies as sibling `/+esm` URLs rather than folding them in. So its graph is a module per
 * package — more files and roughly twice the bytes of the same package from esm.sh.
 *
 * Worth that as a second answer: the two are independent operators building independently, and
 * esm.sh ships versions it cannot build (cheerio's have failed repeatedly), where a package that
 * resolves nowhere is a package nobody can install.
 */
export function createJsDelivrProvider(options: ProviderOptions = {}): ScriptModuleProvider {
    // `/+esm` is compiled for a browser and jsDelivr offers nothing else, so it answers for the
    // portable build alone.
    return createGraphProvider("jsdelivr", [ "portable" ], options, JSDELIVR_ORIGIN,
        (origin, path) => `${origin}/npm/${path}/+esm`);
}

/** The providers an install tries, in the order it tries them. */
export function defaultScriptModuleProviders(): ScriptModuleProvider[] {
    return [ createEsmShProvider(), createJsDelivrProvider() ];
}

/**
 * Resolves a package through the first provider that can build it.
 *
 * A build service failing on one version of one package is ordinary rather than exceptional, so a
 * refusal from the first is not the answer — it is a reason to ask the next. Only a package no
 * provider can build fails the install, and the error then says what each of them answered.
 */
export async function resolveScriptModule(
    spec: PackageSpec,
    providers: ScriptModuleProvider[] = defaultScriptModuleProviders()
): Promise<ScriptModuleArtifact> {
    const refusals: string[] = [];

    for (const provider of providers) {
        if (!provider.targets.includes(spec.target)) {
            continue;
        }
        try {
            return await provider.resolve(spec);
        } catch (e) {
            refusals.push(`${provider.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    throw new ValidationError(`No provider could build this package. ${refusals.join(" ")}`);
}

/**
 * A provider that fetches one entry URL and crawls what it links to. Both build services answer
 * that shape; all that differs is how a package's name and version become that URL.
 */
function createGraphProvider(
    id: string,
    targets: readonly ModuleTarget[],
    options: ProviderOptions,
    defaultOrigin: string,
    buildEntryUrl: (origin: string, path: string, target: ModuleTarget) => string
): ScriptModuleProvider {
    const origin = (options.origin ?? defaultOrigin).replace(/\/+$/, "");
    const limits = options.limits ?? DEFAULT_LIMITS;
    const declarationLimits = options.declarationLimits ?? DEFAULT_DECLARATION_LIMITS;

    return {
        id,
        targets,
        async resolve(spec: PackageSpec): Promise<ScriptModuleArtifact> {
            if (!targets.includes(spec.target)) {
                throw new ValidationError(`${id} does not build for '${spec.target}'.`);
            }

            const version = spec.version ? `@${encodeURIComponent(spec.version)}` : "";
            const path = `${spec.name}${version}${spec.subpath ?? ""}`;
            const entryUrl = buildEntryUrl(origin, path, spec.target);

            const { files, entry, entryHeaders } = await fetchModuleGraph(entryUrl, limits);
            const types = await fetchDeclarations(entryHeaders[TYPES_HEADER], declarationLimits);

            return { providerId: id, spec, files, entry, ...(types ? { types } : {}) };
        }
    };
}

/**
 * Header a build service answers with to say where a package's declarations are. esm.sh sets it;
 * jsDelivr does not, so a package built there is installed untyped.
 */
const TYPES_HEADER = "x-typescript-types";

/**
 * Crawls the declarations at `typesUrl`, or answers nothing where there are none to crawl.
 *
 * A failure here is not a failed install. Declarations are what the editor completes from, and a
 * package that arrives without them still runs — so a service that 404s them, or a graph past its
 * budget, costs the completions rather than the package.
 */
async function fetchDeclarations(
    typesUrl: string | undefined,
    limits: ScriptModuleLimits
): Promise<ScriptModuleDeclarations | undefined> {
    if (!typesUrl) {
        return undefined;
    }

    try {
        const { files, entry } = await fetchModuleGraph(typesUrl, limits, DECLARATION_GRAPH);
        return { files, entry };
    } catch (e) {
        getLog().info(`Script module declarations at '${typesUrl}' could not be read: `
            + `${e instanceof Error ? e.message : String(e)}`);
        return undefined;
    }
}

/**
 * Parses `cheerio`, `cheerio@1.1.2`, `@scope/pkg@1.1.2` or `cheerio@1.1.2/lib/static` into its
 * parts, refusing anything that would not survive being put back into a URL.
 */
export function parsePackageSpec(raw: string, target: ModuleTarget = "portable"): PackageSpec {
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

    return { name, ...(version ? { version } : {}), ...(rest ? { subpath: rest } : {}), target };
}

const PACKAGE_NAME = /^(@[a-z0-9~][a-z0-9._~-]*\/)?[a-z0-9~][a-z0-9._~-]*$/i;
/** Exact versions, ranges and dist-tags. Without spaces or `||`, which a URL path cannot carry. */
const VERSION = /^[a-z0-9.~^*+-]+$/i;
const SUBPATH = /^(\/[a-z0-9._~-]+)+$/i;

/** `from "x"`, `import "x"` and the `from` of `export * from "x"`. */
const STATIC_SPECIFIER = /(\b(?:from|import)\s*)(["'])([^"'\n]+)\2/g;
/** `import("x")`, which the static form skips because of the parenthesis. */
const DYNAMIC_SPECIFIER = /(\bimport\s*\(\s*)(["'])([^"'\n]+)\2(\s*\))/g;
/** `/// <reference path="x" />`, which is how declarations name the ones beside them. */
const REFERENCE_SPECIFIER = /(\/\/\/\s*<reference\s+(?:path|types)\s*=\s*)(["'])([^"'\n]+)\2/g;

/** What a crawl is fetching: the modules a package runs as, or the declarations it is typed by. */
interface GraphKind {
    /** Media type the service must answer with, so an error page is never stored as source. */
    mediaType: string;
    /** Extension the stored files are named with, which is what tells TypeScript what they are. */
    extension: string;
}

const MODULE_GRAPH: GraphKind = { mediaType: "javascript", extension: ".mjs" };
const DECLARATION_GRAPH: GraphKind = { mediaType: "typescript", extension: ".d.ts" };

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
async function fetchModuleGraph(
    entryUrl: string,
    limits: ScriptModuleLimits,
    kind: GraphKind = MODULE_GRAPH
) {
    const origin = new URL(entryUrl).origin;
    const sources = new Map<string, string>();
    /** Same-origin URLs naming a host built-in rather than a file, and what to call it instead. */
    const builtins = new Map<string, string>();
    const queue = [entryUrl];
    let entryHeaders: Readonly<Record<string, string>> = {};
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
        if (!response.contentType.includes(kind.mediaType)) {
            throw new ValidationError(
                `'${url}' was served as '${response.contentType}' rather than ${kind.mediaType}.`);
        }
        if (url === entryUrl) {
            entryHeaders = response.headers ?? {};
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
            if (!resolved || !resolved.startsWith(`${origin}/`) || sources.has(resolved)) {
                continue;
            }

            const builtin = builtinNamedByUrl(resolved);
            if (builtin) {
                builtins.set(resolved, builtin);
            } else {
                queue.push(resolved);
            }
        }
    }

    const names = new Map<string, string>();
    for (const url of sources.keys()) {
        names.set(url, fileNameFor(url, new Set(names.values()), kind.extension));
    }

    const files: ScriptModuleFile[] = [];
    for (const [url, source] of sources) {
        const rewritten = stripSourceMapLinks(rewriteSpecifiers(source, url, names, builtins));
        files.push({ name: names.get(url) ?? "", url, source: rewritten });
    }

    return { files, entry: names.get(entryUrl) ?? "", entryHeaders };
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
    for (const match of source.matchAll(REFERENCE_SPECIFIER)) {
        yield match[3];
    }
}

/**
 * Points every specifier that names a fetched module at that module's local name.
 *
 * Only a specifier naming a module that was fetched is rewritten, so bare specifiers and other
 * origins are left as they stand.
 */
function rewriteSpecifiers(
    source: string,
    baseUrl: string,
    names: Map<string, string>,
    builtins: Map<string, string>
): string {
    const replacement = (specifier: string) => {
        const resolved = resolveSpecifier(specifier, baseUrl);
        if (!resolved) {
            return undefined;
        }

        const name = names.get(resolved);
        return name ? `./${name}` : builtins.get(resolved);
    };

    const replaceQuoted = (whole: string, prefix: string, quote: string, specifier: string) => {
        const target = replacement(specifier);
        return target ? `${prefix}${quote}${target}${quote}` : whole;
    };

    return source
        .replace(STATIC_SPECIFIER, replaceQuoted)
        .replace(REFERENCE_SPECIFIER, replaceQuoted)
        .replace(DYNAMIC_SPECIFIER, (whole, opening, quote, specifier, closing) => {
            const target = replacement(specifier);
            return target ? `${opening}${quote}${target}${quote}${closing}` : whole;
        });
}

/**
 * The Node built-in a same-origin URL stands for, or `undefined` where it names a file.
 *
 * A Node build leaves the built-ins to the host, and esm.sh writes them as paths of its own —
 * `/node:sqlite?target=node` — which it then refuses to serve. They are the host's to answer, so
 * the crawl does not follow them and the specifier becomes the built-in's own name.
 */
function builtinNamedByUrl(url: string): string | undefined {
    const path = new URL(url).pathname.replace(/^\/+/, "");
    return path.startsWith("node:") ? path : undefined;
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
function fileNameFor(url: string, taken: Set<string>, extension: string): string {
    const parsed = new URL(url);
    const slug = `${parsed.pathname}${parsed.search}`
        .replace(/^\/+/, "")
        .replace(/[^a-z0-9._@-]+/gi, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 100) || "module";

    const base = slug.endsWith(extension) ? slug : `${slug}${extension}`;
    if (!taken.has(base)) {
        return base;
    }

    const stem = base.slice(0, base.length - extension.length);
    for (let suffix = 2; ; suffix++) {
        const candidate = `${stem}-${suffix}${extension}`;
        if (!taken.has(candidate)) {
            return candidate;
        }
    }
}
