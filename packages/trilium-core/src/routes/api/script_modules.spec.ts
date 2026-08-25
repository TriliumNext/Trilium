import type { ScriptModuleSummary } from "@triliumnext/commons";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import config from "../../services/config";
import { getContext } from "../../services/context";
import hiddenSubtreeService from "../../services/hidden_subtree";
import { initRequest } from "../../services/request";
import { encodeUtf8 } from "../../services/utils/binary";
import { CoreApiTester } from "../../test/api_tester";
import { fakeRequestProvider } from "../../test/request_provider";

let api: CoreApiTester;

/** What the fake esm.sh answers with, keyed by URL. */
let served: Map<string, string>;

function serveEsmSh(name: string, version: string) {
    const entry = `https://esm.sh/${name}@${version}?bundle&target=es2022`;
    served.set(entry, `export * from "/${name}@${version}/es2022/${name}.mjs";`);
    served.set(`https://esm.sh/${name}@${version}/es2022/${name}.mjs`, `export const ${name} = 1;`);
}

describe("Script modules API (core)", () => {
    const originalScriptingEnabled = config.Security.backendScriptingEnabled;

    beforeAll(() => {
        config.Security.backendScriptingEnabled = true;
        api = CoreApiTester.build();
        // Installs write under _scriptModules, which the subtree check materialises at startup.
        getContext().init(() => hiddenSubtreeService.checkHiddenSubtree());
    });

    afterAll(() => {
        config.Security.backendScriptingEnabled = originalScriptingEnabled;
    });

    beforeEach(() => {
        served = new Map();
        initRequest(fakeRequestProvider({
            fetchResource: async (url) => {
                const source = served.get(url);
                return source === undefined
                    ? { status: 404, ok: false, contentType: "text/plain", bytes: encodeUtf8("no") }
                    : { status: 200, ok: true, contentType: "application/javascript", bytes: encodeUtf8(source) };
            }
        }));
    });

    it("installs a package, lists it, and removes it", async () => {
        serveEsmSh("alpha", "1.0.0");

        const installed = await api.post<ScriptModuleSummary>("/api/script-modules", { body: { spec: "alpha@1.0.0" } });
        expect(installed.status).toBe(200);
        expect(installed.body.spec).toBe("alpha@1.0.0");
        expect(installed.body.providerId).toBe("esm.sh");
        expect(installed.body.fileCount).toBe(2);
        expect(installed.body.size).toBeGreaterThan(0);

        const listed = await api.get<ScriptModuleSummary[]>("/api/script-modules");
        expect(listed.status).toBe(200);
        expect(listed.body.map((module) => module.spec)).toContain("alpha@1.0.0");

        const removed = await api.delete(`/api/script-modules/${installed.body.noteId}`);
        expect(removed.status).toBe(204);

        const afterRemoval = await api.get<ScriptModuleSummary[]>("/api/script-modules");
        expect(afterRemoval.body.map((module) => module.spec)).not.toContain("alpha@1.0.0");
    });

    it("re-installing a version replaces it rather than adding a second copy", async () => {
        serveEsmSh("beta", "2.0.0");

        const first = await api.post<ScriptModuleSummary>("/api/script-modules", { body: { spec: "beta@2.0.0" } });
        const second = await api.post<ScriptModuleSummary>("/api/script-modules", { body: { spec: "beta@2.0.0" } });

        expect(second.body.noteId).toBe(first.body.noteId);
        const listed = await api.get<ScriptModuleSummary[]>("/api/script-modules");
        expect(listed.body.filter((module) => module.spec === "beta@2.0.0")).toHaveLength(1);
    });

    it("refuses a package it cannot name or cannot fetch", async () => {
        expect((await api.post("/api/script-modules", { body: {} })).status).toBe(400);
        expect((await api.post("/api/script-modules", { body: { spec: "pkg name" } })).status).toBe(400);
        expect((await api.post("/api/script-modules", { body: { spec: "gone@1.0.0" } })).status).toBe(400);
    });

    it("404s when removing something that is not installed", async () => {
        expect((await api.delete("/api/script-modules/smNoSuchThing")).status).toBe(404);
    });

    it("refuses to install or remove while backend scripting is off", async () => {
        serveEsmSh("gamma", "1.0.0");
        const installed = await api.post<ScriptModuleSummary>("/api/script-modules", { body: { spec: "gamma@1.0.0" } });
        expect(installed.status).toBe(200);

        config.Security.backendScriptingEnabled = false;
        try {
            expect((await api.post("/api/script-modules", { body: { spec: "gamma@1.0.0" } })).status).toBe(500);
            expect((await api.delete(`/api/script-modules/${installed.body.noteId}`)).status).toBe(500);
            // Listing stays available, so a pane can show what is there and say why it is inert.
            expect((await api.get("/api/script-modules")).status).toBe(200);
        } finally {
            config.Security.backendScriptingEnabled = true;
        }
    });
});
