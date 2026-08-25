import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getContext } from "../context.js";
import hiddenSubtreeService from "../hidden_subtree.js";
import noteService from "../notes.js";
import ScriptContext from "../script_context.js";
import { clearScriptModuleCache, requireScriptModule, selectInstalledModule } from "./loader.js";
import type { ScriptModuleArtifact } from "./provider.js";
import { deleteScriptModule, storeScriptModule } from "./storage.js";

type SourceFile = { name: string; source: string };

function store(spec: string, files: SourceFile[]) {
    return storeFor("portable", spec, files);
}

function storeFor(target: "portable" | "node", spec: string, files: SourceFile[]) {
    const [name, version] = spec.split("@");
    const artifact: ScriptModuleArtifact = {
        providerId: "esm.sh",
        spec: { name, version, target },
        entry: files[0].name,
        files: files.map((file) => ({ ...file, url: `https://esm.sh/${file.name}` }))
    };

    return getContext().init(() => storeScriptModule(artifact));
}

function exportsOf(moduleName: string): Record<string, any> {
    const loaded = requireScriptModule(moduleName);
    expect(loaded, `'${moduleName}' is installed`).toBeDefined();
    return (loaded?.exports ?? {}) as Record<string, any>;
}

describe("script module loader (real DB)", () => {
    beforeAll(() => {
        getContext().init(() => hiddenSubtreeService.checkHiddenSubtree());
    });

    beforeEach(() => {
        clearScriptModuleCache();
    });

    it("answers undefined for a package that is not installed", () => {
        expect(requireScriptModule("not-installed-anywhere")).toBeUndefined();
    });

    it("evaluates a package and resolves the imports between its files", () => {
        store("pkg-graph@1.0.0", [
            {
                name: "entry.mjs",
                source: `import { dep } from "./dep.mjs";\nexport const value = dep + 1;`
            },
            { name: "dep.mjs", source: "export const dep = 41;" }
        ]);

        expect(exportsOf("pkg-graph").value).toBe(42);
    });

    it("rewrites module syntax without lowering the rest of the language", () => {
        // A class field beside a `super()` inside a comma expression, which is what esm.sh's Node
        // `buffer` polyfill compiles to. Lowering the field as well moves an initializer between
        // the two halves of that expression and emits `;,` — cheerio would not load at all.
        store("pkg-syntax@1.0.0", [{
            name: "entry.mjs",
            source: [
                "class Base { constructor(v) { this.v = v; } }",
                "class Thrower extends Base {",
                "    field = 7;",
                "    constructor(...args) { throw super(...args), new Error('nope'); }",
                "}",
                "export const built = new Base(1).v;",
                "export const Thrown = Thrower;"
            ].join("\n")
        }]);

        expect(exportsOf("pkg-syntax").built).toBe(1);
    });

    it("lets a file assign __esModule itself", () => {
        // A bundle carrying CommonJS assigns the flag the compiled prologue has already defined.
        // Defining it with a value alone leaves it read-only, and the assignment then throws under
        // the "use strict" the prologue also emits — cheerio's jsDelivr build does exactly this.
        store("pkg-interop@1.0.0", [{
            name: "entry.mjs",
            source: [
                "exports.__esModule = true;",
                "export const ok = true;"
            ].join("\n")
        }]);

        expect(exportsOf("pkg-interop").ok).toBe(true);
    });

    it("keeps the two builds of one version apart and prefers the one for this runtime", () => {
        const portable = store("pkg-both@1.0.0", [{ name: "entry.mjs", source: "export const from = 'portable';" }]);
        const node = storeFor("node", "pkg-both@1.0.0", [{ name: "entry.mjs", source: "export const from = 'node';" }]);

        // Two notes, so installing one does not replace the other.
        expect(node.noteId).not.toBe(portable.noteId);

        // Under Node both run and the Node build wins; a bare name is not ambiguous between builds.
        expect(exportsOf("pkg-both").from).toBe("node");
        expect(exportsOf("pkg-both@1.0.0").from).toBe("node");
    });

    it("reads only the files the entry reaches", () => {
        // The file the entry never imports is not JavaScript, so a load that read it would fail.
        store("pkg-lazy@1.0.0", [
            { name: "entry.mjs", source: "export const ok = true;" },
            { name: "unused.mjs", source: "this is (not javascript at all" }
        ]);

        expect(exportsOf("pkg-lazy").ok).toBe(true);
    });

    it("keeps a package loaded until what is stored changes", () => {
        store("pkg-cache@1.0.0", [{ name: "entry.mjs", source: "export const v = 1;" }]);

        const first = exportsOf("pkg-cache");
        expect(first.v).toBe(1);
        expect(exportsOf("pkg-cache")).toBe(first);

        // A rebuild to the same bytes is the same content, so what is loaded still stands.
        store("pkg-cache@1.0.0", [{ name: "entry.mjs", source: "export const v = 1;" }]);
        expect(exportsOf("pkg-cache")).toBe(first);

        store("pkg-cache@1.0.0", [{ name: "entry.mjs", source: "export const v = 2;" }]);
        const rebuilt = exportsOf("pkg-cache");
        expect(rebuilt).not.toBe(first);
        expect(rebuilt.v).toBe(2);
    });

    it("resolves a cycle between two files", () => {
        store("pkg-cycle@1.0.0", [
            {
                name: "a.mjs",
                source: `import { b } from "./b.mjs";\n`
                    + `export const a = "a";\nexport const both = () => a + b;`
            },
            { name: "b.mjs", source: `import { a } from "./a.mjs";\nexport const b = "b";` }
        ]);

        const exports = exportsOf("pkg-cycle");
        expect(exports.a).toBe("a");
        expect(exports.both()).toBe("ab");
    });

    it("hands a package the URL its file was built from", () => {
        const source = "export const u = import.meta.url;";
        store("pkg-meta@1.0.0", [{ name: "entry.mjs", source }]);

        expect(exportsOf("pkg-meta").u).toBe("https://esm.sh/entry.mjs");
    });

    it("refuses an import the install does not hold", () => {
        store("pkg-broken@1.0.0", [
            { name: "entry.mjs", source: `import { x } from "./gone.mjs";\nexport const v = x;` }
        ]);

        expect(() => requireScriptModule("pkg-broken")).toThrow(/does not hold/);
    });

    it("refuses a package the built-in a script could not ask for itself", () => {
        store("pkg-nosy@1.0.0", [
            { name: "entry.mjs", source: `import fs from "node:fs";\nexport const f = fs;` }
        ]);

        expect(() => requireScriptModule("pkg-nosy")).toThrow(/blocked/);
    });

    it("takes a version when one is named, and refuses a name installed twice", () => {
        store("pkg-multi@1.0.0", [{ name: "entry.mjs", source: "export const v = 1;" }]);
        store("pkg-multi@2.0.0", [{ name: "entry.mjs", source: "export const v = 2;" }]);

        expect(exportsOf("pkg-multi@2.0.0").v).toBe(2);
        expect(() => requireScriptModule("pkg-multi")).toThrow(/installed more than once/);

        getContext().init(() => deleteScriptModule({ name: "pkg-multi", version: "1.0.0", target: "portable" as const }));
        expect(exportsOf("pkg-multi").v).toBe(2);
    });
});

describe("ScriptContext.require of an installed package", () => {
    beforeAll(() => {
        getContext().init(() => hiddenSubtreeService.checkHiddenSubtree());
        store("pkg-required@1.0.0", [
            { name: "entry.mjs", source: `export const from = "package";` }
        ]);
    });

    beforeEach(() => {
        clearScriptModuleCache();
    });

    it("resolves a package a script asks for by name", () => {
        const ctx = new ScriptContext([], {});

        const required = ctx.require([])("pkg-required") as { from?: string };
        expect(required.from).toBe("package");
    });

    it("prefers a child note over a package of the same name", () => {
        const { note } = getContext().init(() => noteService.createNewNote({
            title: "pkg-required",
            parentNoteId: "root",
            type: "code",
            mime: "application/javascript",
            content: "module.exports = {};"
        }));

        const ctx = new ScriptContext([note], {});
        ctx.modules[note.noteId] = { exports: ["from the note"] };

        expect(ctx.require([note.noteId])("pkg-required")).toEqual(["from the note"]);
    });
});

describe("selectInstalledModule", () => {
    const at = (spec: string, target: "portable" | "node") => {
        const [name, version] = spec.split("@");
        return { noteId: `${name}-${version}-${target}`, spec: { name, version, target } } as never;
    };

    it("prefers the Node build where Node can run it, and the portable one where it cannot", () => {
        const installs = [ at("pkg@1.0.0", "portable"), at("pkg@1.0.0", "node") ];

        expect(selectInstalledModule(installs, "pkg", true)?.noteId).toBe("pkg-1.0.0-node");
        expect(selectInstalledModule(installs, "pkg", false)?.noteId).toBe("pkg-1.0.0-portable");
        expect(selectInstalledModule(installs, "pkg@1.0.0", true)?.noteId).toBe("pkg-1.0.0-node");
    });

    it("says so when the only build installed cannot run here", () => {
        const installs = [ at("pkg@1.0.0", "node") ];

        expect(selectInstalledModule(installs, "pkg", true)?.noteId).toBe("pkg-1.0.0-node");
        expect(() => selectInstalledModule(installs, "pkg", false)).toThrow(/only as a Node.js build/);
    });

    it("still refuses to choose between two versions", () => {
        const installs = [ at("pkg@1.0.0", "portable"), at("pkg@2.0.0", "node") ];

        expect(() => selectInstalledModule(installs, "pkg", true)).toThrow(/installed more than once/);
        // Only one of them runs here, so there is nothing to choose between.
        expect(selectInstalledModule(installs, "pkg", false)?.noteId).toBe("pkg-1.0.0-portable");
    });

    it("answers nothing for a package that is not installed", () => {
        expect(selectInstalledModule([], "pkg", true)).toBeUndefined();
    });
});
