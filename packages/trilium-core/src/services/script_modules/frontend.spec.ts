import { beforeAll, describe, expect, it } from "vitest";

import { getContext } from "../context.js";
import hiddenSubtreeService from "../hidden_subtree.js";
import { collectFrontendModules, readRequiredSpecifiers } from "./frontend.js";
import type { ScriptModuleArtifact } from "./provider.js";
import { storeScriptModule } from "./storage.js";

function store(spec: string, target: "portable" | "node", files: { name: string; source: string }[]) {
    const [ name, version ] = spec.split("@");
    const artifact: ScriptModuleArtifact = {
        providerId: "esm.sh",
        spec: { name, version, target },
        entry: files[0].name,
        files: files.map((file) => ({ ...file, url: `https://esm.sh/${file.name}` }))
    };

    return getContext().init(() => storeScriptModule(artifact));
}

describe("readRequiredSpecifiers", () => {
    it("finds each literal name once, whatever the spacing", () => {
        const script = [
            `const a = require("alpha");`,
            `const b = require( 'beta' );`,
            `const c = require("alpha");`,
            `const d = require(name);`
        ].join("\n");

        expect(readRequiredSpecifiers(script).sort()).toEqual([ "alpha", "beta" ]);
    });

    it("finds nothing in a script that requires nothing", () => {
        expect(readRequiredSpecifiers("const x = 1;")).toEqual([]);
    });
});

describe("collectFrontendModules (real DB)", () => {
    beforeAll(() => {
        getContext().init(() => hiddenSubtreeService.checkHiddenSubtree());
    });

    it("compiles what the script requires and leaves the rest alone", () => {
        store("front-a@1.0.0", "portable", [
            { name: "entry.mjs", source: `export * from "./dep.mjs";` },
            { name: "dep.mjs", source: "export const dep = 1;" }
        ]);
        store("front-unused@1.0.0", "portable", [{ name: "entry.mjs", source: "export const x = 1;" }]);

        const { modules, unavailable } = collectFrontendModules(
            `const a = require("front-a"); const missing = require("no-such-package");`);

        expect(unavailable).toEqual([]);
        expect(modules).toHaveLength(1);
        expect(modules[0].specifiers).toEqual([ "front-a" ]);
        expect(modules[0].entry).toBe("entry.mjs");
        expect(modules[0].fingerprint).toContain("entry.mjs@");
        // Compiled, so the browser needs no compiler of its own.
        expect(modules[0].files.map((file) => file.name).sort()).toEqual([ "dep.mjs", "entry.mjs" ]);
        expect(modules[0].files[0].code).toContain("exports");
        expect(modules[0].files[0].code).not.toContain("export * from");
    });

    it("gathers one entry for a package named twice", () => {
        store("front-twice@2.0.0", "portable", [{ name: "entry.mjs", source: "export const x = 1;" }]);

        const { modules } = collectFrontendModules(
            `require("front-twice"); require("front-twice@2.0.0");`);

        expect(modules).toHaveLength(1);
        expect(modules[0].specifiers.sort()).toEqual([ "front-twice", "front-twice@2.0.0" ]);
    });

    it("says why a package installed only for Node cannot be sent", () => {
        store("front-node@1.0.0", "node", [{ name: "entry.mjs", source: "export const x = 1;" }]);

        const { modules, unavailable } = collectFrontendModules(`require("front-node");`);

        expect(modules).toEqual([]);
        expect(unavailable).toEqual([
            { specifier: "front-node", reason: expect.stringMatching(/only as a Node.js build/) }
        ]);
    });
});
