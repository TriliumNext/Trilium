import { beforeEach, describe, expect, it } from "vitest";

import { fakeRequestProvider } from "../test/request_provider.js";
import { initRequest } from "./request.js";
import { createEsmShProvider, parsePackageSpec, type ScriptModuleArtifact } from "./script_module_provider.js";
import { encodeUtf8 } from "./utils/binary.js";

/** URLs the fake provider answers, and the URLs it was asked for in order. */
let served: Map<string, { source: string; status?: number; contentType?: string }>;
let requested: string[];

beforeEach(() => {
    served = new Map();
    requested = [];

    initRequest(fakeRequestProvider({
        fetchResource: async (url) => {
            requested.push(url);
            const entry = served.get(url);
            if (!entry) {
                return { status: 404, ok: false, contentType: "text/plain", bytes: encodeUtf8("not found") };
            }
            const status = entry.status ?? 200;
            return {
                status,
                ok: status >= 200 && status < 300,
                contentType: entry.contentType ?? "application/javascript; charset=utf-8",
                bytes: encodeUtf8(entry.source)
            };
        }
    }));
});

function serve(url: string, source: string, extra: { status?: number; contentType?: string } = {}) {
    served.set(url, { source, ...extra });
}

function fileNamed(artifact: ScriptModuleArtifact, name: string) {
    const file = artifact.files.find((f) => f.name === name);
    if (!file) {
        throw new Error(`No file named '${name}' in ${artifact.files.map((f) => f.name).join(", ")}`);
    }
    return file;
}

describe("parsePackageSpec", () => {
    it("splits name, version and subpath", () => {
        expect(parsePackageSpec("cheerio")).toEqual({ name: "cheerio" });
        expect(parsePackageSpec("  cheerio@1.1.2  ")).toEqual({ name: "cheerio", version: "1.1.2" });
        expect(parsePackageSpec("cheerio@latest")).toEqual({ name: "cheerio", version: "latest" });
        expect(parsePackageSpec("cheerio@^1.0.0")).toEqual({ name: "cheerio", version: "^1.0.0" });
        expect(parsePackageSpec("cheerio@1.1.2/lib/static")).toEqual({ name: "cheerio", version: "1.1.2", subpath: "/lib/static" });
        expect(parsePackageSpec("cheerio/lib/static")).toEqual({ name: "cheerio", subpath: "/lib/static" });
    });

    it("keeps the scope with the name", () => {
        expect(parsePackageSpec("@scope/pkg")).toEqual({ name: "@scope/pkg" });
        expect(parsePackageSpec("@scope/pkg@2.0.0")).toEqual({ name: "@scope/pkg", version: "2.0.0" });
        expect(parsePackageSpec("@scope/pkg@2.0.0/sub")).toEqual({ name: "@scope/pkg", version: "2.0.0", subpath: "/sub" });
        expect(parsePackageSpec("@scope/pkg/sub")).toEqual({ name: "@scope/pkg", subpath: "/sub" });
    });

    it("refuses anything that would not survive being put into a URL", () => {
        for (const bad of ["", "   ", "pkg name", "pkg?query", "pkg#frag", "../etc/passwd", "pkg@1.0.0/../..", "pkg@>=1 <2", "@scope"]) {
            expect(() => parsePackageSpec(bad), bad).toThrow();
        }
    });
});

describe("esm.sh provider", () => {
    it("asks for a bundled build of the requested package", async () => {
        serve("https://esm.sh/cheerio@1.1.2?bundle&target=es2022", "export const load = 1;");

        const artifact = await createEsmShProvider().resolve(parsePackageSpec("cheerio@1.1.2"));

        expect(requested).toEqual(["https://esm.sh/cheerio@1.1.2?bundle&target=es2022"]);
        expect(artifact.providerId).toBe("esm.sh");
        expect(artifact.spec).toEqual({ name: "cheerio", version: "1.1.2" });
        expect(artifact.files).toHaveLength(1);
        expect(fileNamed(artifact, artifact.entry).source).toBe("export const load = 1;");
    });

    it("honours a self-hosted origin, a target and a subpath, and encodes the version", async () => {
        serve("https://esm.example/cheerio@%5E1.0.0/lib/static?bundle&target=es2020", "export default 1;");

        const artifact = await createEsmShProvider({ origin: "https://esm.example/", target: "es2020" })
            .resolve(parsePackageSpec("cheerio@^1.0.0/lib/static"));

        expect(requested).toEqual(["https://esm.example/cheerio@%5E1.0.0/lib/static?bundle&target=es2020"]);
        expect(artifact.files).toHaveLength(1);
    });

    it("crawls the graph and rewrites every link between its files", async () => {
        serve("https://esm.sh/cheerio@1.1.2?bundle&target=es2022", [
            `import "/node/buffer.mjs";`,
            `export * from "/cheerio@1.1.2/es2022/cheerio.bundle.mjs";`
        ].join("\n"));
        serve("https://esm.sh/node/buffer.mjs", "export const Buffer = 1;");
        serve("https://esm.sh/cheerio@1.1.2/es2022/cheerio.bundle.mjs", [
            `import {Buffer} from "/node/buffer.mjs";`,
            `const lazy = () => import("./helper.mjs");`,
            `export {Buffer, lazy};`
        ].join("\n"));
        serve("https://esm.sh/cheerio@1.1.2/es2022/helper.mjs", "export const helper = 1;");

        const artifact = await createEsmShProvider().resolve(parsePackageSpec("cheerio@1.1.2"));

        expect(artifact.files).toHaveLength(4);
        expect(artifact.entry).toBe("cheerio@1.1.2_bundle_target_es2022.mjs");

        const entry = fileNamed(artifact, artifact.entry);
        expect(entry.source).toBe([
            `import "./node_buffer.mjs";`,
            `export * from "./cheerio@1.1.2_es2022_cheerio.bundle.mjs";`
        ].join("\n"));

        // Static and dynamic specifiers alike, and the URL each file came from is kept.
        const bundle = fileNamed(artifact, "cheerio@1.1.2_es2022_cheerio.bundle.mjs");
        expect(bundle.source).toContain(`import {Buffer} from "./node_buffer.mjs";`);
        expect(bundle.source).toContain(`import("./cheerio@1.1.2_es2022_helper.mjs")`);
        expect(bundle.url).toBe("https://esm.sh/cheerio@1.1.2/es2022/cheerio.bundle.mjs");

        // Nothing in the artifact still points at the network.
        for (const file of artifact.files) {
            expect(file.source, file.name).not.toContain("https://");
        }
    });

    it("fetches a shared module once and survives a cycle", async () => {
        serve("https://esm.sh/a@1?bundle&target=es2022", `import "/b.mjs";\nimport "/c.mjs";`);
        serve("https://esm.sh/b.mjs", `import "/c.mjs";\nimport "/a@1?bundle&target=es2022";`);
        serve("https://esm.sh/c.mjs", "export const c = 1;");

        const artifact = await createEsmShProvider().resolve(parsePackageSpec("a@1"));

        expect(artifact.files).toHaveLength(3);
        expect(requested).toHaveLength(3);
        expect(fileNamed(artifact, "b.mjs").source).toContain(`import "./a@1_bundle_target_es2022.mjs";`);
    });

    it("leaves bare specifiers and other origins alone", async () => {
        serve("https://esm.sh/a@1?bundle&target=es2022", [
            `import "node:buffer";`,
            `import "react";`,
            `import "https://cdn.example/x.mjs";`,
            `export const a = 1;`
        ].join("\n"));

        const artifact = await createEsmShProvider().resolve(parsePackageSpec("a@1"));

        // A bare specifier is a package name, not a path, so none of these name a module to fetch.
        expect(requested).toEqual(["https://esm.sh/a@1?bundle&target=es2022"]);
        expect(fileNamed(artifact, artifact.entry).source).toBe([
            `import "node:buffer";`,
            `import "react";`,
            `import "https://cdn.example/x.mjs";`,
            `export const a = 1;`
        ].join("\n"));
    });

    it("follows anything that reads as a same-origin specifier, string literals included", async () => {
        // Discovery is by pattern, not by parsing. This pins that cost: the resolve fetches what a
        // string only looks like, and fails if it names nothing — which is what makes a build whose
        // real imports 404 fail the install rather than land broken.
        serve("https://esm.sh/a@1?bundle&target=es2022", `const s = 'from "/b.mjs"';\nexport {s};`);
        await expect(createEsmShProvider().resolve(parsePackageSpec("a@1"))).rejects.toThrow(/b\.mjs.*HTTP 404/);

        serve("https://esm.sh/b.mjs", "export const b = 1;");
        const artifact = await createEsmShProvider().resolve(parsePackageSpec("a@1"));
        expect(artifact.files).toHaveLength(2);
    });

    it("drops the link to a source map it did not fetch", async () => {
        serve("https://esm.sh/a@1?bundle&target=es2022", [
            `export const a = 1;`,
            `//# sourceMappingURL=a.mjs.map`
        ].join("\n"));

        const artifact = await createEsmShProvider().resolve(parsePackageSpec("a@1"));

        expect(requested).toHaveLength(1);
        expect(fileNamed(artifact, artifact.entry).source).toBe("export const a = 1;\n");
    });

    it("gives distinct names to URLs that slugify the same", async () => {
        serve("https://esm.sh/a@1?bundle&target=es2022", `import "/x/y.mjs";\nimport "/x_y.mjs";`);
        serve("https://esm.sh/x/y.mjs", "export const a = 1;");
        serve("https://esm.sh/x_y.mjs", "export const b = 1;");

        const artifact = await createEsmShProvider().resolve(parsePackageSpec("a@1"));

        const names = artifact.files.map((f) => f.name);
        expect(new Set(names).size).toBe(names.length);
        expect(names).toContain("x_y.mjs");
        expect(names).toContain("x_y-2.mjs");
    });

    it("refuses an answer that is not a module it can store", async () => {
        const provider = createEsmShProvider();

        await expect(provider.resolve(parsePackageSpec("missing@1"))).rejects.toThrow(/HTTP 404/);

        serve("https://esm.sh/gone@1?bundle&target=es2022", "boom", { status: 500 });
        await expect(provider.resolve(parsePackageSpec("gone@1"))).rejects.toThrow(/HTTP 500/);

        serve("https://esm.sh/page@1?bundle&target=es2022", "<!doctype html>", { contentType: "text/html" });
        await expect(provider.resolve(parsePackageSpec("page@1"))).rejects.toThrow(/text\/html/);
    });

    it("stops a package that is too many modules or too many bytes", async () => {
        serve("https://esm.sh/many@1?bundle&target=es2022", `import "/a.mjs";\nimport "/b.mjs";`);
        serve("https://esm.sh/a.mjs", "export const a = 1;");
        serve("https://esm.sh/b.mjs", "export const b = 1;");

        const limits = { maxFiles: 2, maxFileBytes: 1024, maxTotalBytes: 1024 };
        await expect(createEsmShProvider({ limits }).resolve(parsePackageSpec("many@1")))
            .rejects.toThrow(/more than the 2 modules/);

        const byBytes = { maxFiles: 64, maxFileBytes: 1024, maxTotalBytes: 30 };
        await expect(createEsmShProvider({ limits: byBytes }).resolve(parsePackageSpec("many@1")))
            .rejects.toThrow(/larger than the 30 bytes/);
    });
});
