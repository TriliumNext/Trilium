import type { FrontendScriptModule } from "@triliumnext/commons";
import { beforeEach, describe, expect, it } from "vitest";

import { clearScriptModuleCache, createScriptModuleRequire } from "./script_modules.js";

/** Builds a module the way the bundle delivers one: already compiled to CommonJS. */
function compiled(noteId: string, specifiers: string[], files: { name: string; code: string }[]): FrontendScriptModule {
    return {
        noteId,
        specifiers,
        entry: files[0].name,
        fingerprint: `${noteId}-v1`,
        files: files.map((file) => ({ ...file, url: `https://esm.sh/${file.name}` }))
    };
}

describe("createScriptModuleRequire", () => {
    beforeEach(clearScriptModuleCache);

    it("evaluates a package and resolves the requires between its files", () => {
        const require = createScriptModuleRequire([ compiled("m1", [ "alpha" ], [
            { name: "entry.mjs", code: `const d = require("./dep.mjs"); exports.value = d.dep + 1;` },
            { name: "dep.mjs", code: `exports.dep = 41;` }
        ]) ]);

        expect((require("alpha")?.exports as { value: number }).value).toBe(42);
    });

    it("answers undefined for a name the bundle did not carry", () => {
        expect(createScriptModuleRequire()("nothing")).toBeUndefined();
    });

    it("evaluates a package once and reuses it until its files change", () => {
        const files = [ { name: "entry.mjs", code: `exports.n = (globalThis.__evals = (globalThis.__evals ?? 0) + 1);` } ];
        const first = createScriptModuleRequire([ compiled("m2", [ "beta" ], files) ]);

        expect((first("beta")?.exports as { n: number }).n).toBe(1);
        expect((first("beta")?.exports as { n: number }).n).toBe(1);

        // A rebuild to different bytes is a different fingerprint, so it is evaluated again.
        const rebuilt = { ...compiled("m2", [ "beta" ], files), fingerprint: "m2-v2" };
        expect((createScriptModuleRequire([ rebuilt ])("beta")?.exports as { n: number }).n).toBe(2);
        delete (globalThis as { __evals?: number }).__evals;
    });

    it("lets a file assign __esModule itself", () => {
        const require = createScriptModuleRequire([ compiled("m3", [ "gamma" ], [ {
            name: "entry.mjs",
            code: `"use strict";Object.defineProperty(exports, "__esModule", {value: true});exports.__esModule = true;exports.ok = true;`
        } ]) ]);

        expect((require("gamma")?.exports as { ok: boolean }).ok).toBe(true);
    });

    it("reports a package the bundle could not carry, with the reason it was given", () => {
        const require = createScriptModuleRequire([], [
            { specifier: "delta", reason: "'delta' is installed only as a Node.js build." }
        ]);

        expect(() => require("delta")).toThrow(/only as a Node.js build/);
    });

    it("refuses an import the browser cannot answer", () => {
        const require = createScriptModuleRequire([ compiled("m4", [ "eps" ], [
            { name: "entry.mjs", code: `require("node:fs");` }
        ]) ]);

        expect(() => require("eps")).toThrow(/the browser cannot provide/);
    });
});
