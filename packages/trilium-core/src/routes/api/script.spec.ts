import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import attributeService from "../../services/attributes";
import config from "../../services/config";
import scriptService from "../../services/script";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

let api: CoreApiTester;

interface ExecResponse {
    success: boolean;
    executionResult?: unknown;
    error?: string;
}

async function createCodeNote(content: string): Promise<string> {
    const res = await api.post<{ note: { noteId: string } }>(
        "/api/notes/root/children?target=into",
        { body: { title: "Code note", type: "code", mime: "application/javascript;env=frontend", content } }
    );
    return res.body.note.noteId;
}

describe("Script API (core)", () => {
    // Script execution enforces the backendScriptingEnabled security toggle (default false).
    const originalScriptingEnabled = config.Security.backendScriptingEnabled;

    beforeAll(() => {
        config.Security.backendScriptingEnabled = true;
        api = CoreApiTester.build();
    });

    afterAll(() => {
        config.Security.backendScriptingEnabled = originalScriptingEnabled;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("exec", () => {
        // exec overrides the note's content with the script body, but still needs a
        // real currentNote/startNote to resolve a script bundle.
        let scriptNoteId: string;

        beforeAll(async () => {
            scriptNoteId = await createCodeNote("return 0;");
        });

        it("executes a trivial script (non-transactional)", async () => {
            const res = await api.post<ExecResponse>("/api/script/exec", {
                body: {
                    script: "() => 1+1",
                    params: [],
                    startNoteId: scriptNoteId,
                    currentNoteId: scriptNoteId,
                    transactional: false
                }
            });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.executionResult).toBe(2);
        });

        it("executes a trivial script (transactional)", async () => {
            const res = await api.post<ExecResponse>("/api/script/exec", {
                body: {
                    script: "() => 3*3",
                    params: [],
                    startNoteId: scriptNoteId,
                    currentNoteId: scriptNoteId,
                    transactional: true
                }
            });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.executionResult).toBe(9);
        });

        it("returns success:false when the script throws", async () => {
            const res = await api.post<ExecResponse>("/api/script/exec", {
                body: {
                    script: "() => { throw new Error('boom'); }",
                    params: [],
                    startNoteId: scriptNoteId,
                    currentNoteId: scriptNoteId,
                    transactional: false
                }
            });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toBeTruthy();
        });
    });

    describe("run", () => {
        it("runs a code note via executeNote", async () => {
            const noteId = await createCodeNote("return 42;");
            const spy = vi.spyOn(scriptService, "executeNote").mockReturnValue(123 as any);

            const res = await api.post<{ executionResult: unknown }>(`/api/script/run/${noteId}`);
            expect(res.status).toBe(200);
            expect(res.body.executionResult).toBe(123);
            expect(spy).toHaveBeenCalledOnce();
        });
    });

    describe("startup bundles", () => {
        it("returns frontend startup bundles (desktop)", async () => {
            const note = (await createTextNote(api)).noteId;
            vi.spyOn(attributeService, "getNotesWithLabel").mockReturnValue([{ noteId: note } as any]);
            vi.spyOn(scriptService, "getScriptBundleForFrontend").mockReturnValue({ script: "x" } as any);

            const res = await api.get<unknown[]>("/api/script/startup");
            expect(res.status).toBe(200);
            expect(res.body).toEqual([{ script: "x" }]);
        });

        it("returns mobile startup bundles, filtering out empty bundles", async () => {
            vi.spyOn(attributeService, "getNotesWithLabel").mockReturnValue([
                { noteId: "a" } as any,
                { noteId: "b" } as any
            ]);
            vi.spyOn(scriptService, "getScriptBundleForFrontend").mockImplementation(
                (n: any) => (n.noteId === "a" ? ({ script: "a" } as any) : undefined)
            );

            const res = await api.get<unknown[]>("/api/script/startup", { query: { mobile: "true" } });
            expect(res.status).toBe(200);
            expect(res.body).toEqual([{ script: "a" }]);
        });

        it("returns no bundles in safe mode", async () => {
            vi.stubEnv("TRILIUM_SAFE_MODE", "1");
            try {
                const res = await api.get<unknown[]>("/api/script/startup");
                expect(res.status).toBe(200);
                expect(res.body).toEqual([]);
            } finally {
                vi.unstubAllEnvs();
            }
        });
    });

    describe("widget bundles", () => {
        it("returns widget bundles when not in safe mode", async () => {
            vi.spyOn(attributeService, "getNotesWithLabel").mockReturnValue([{ noteId: "w" } as any]);
            vi.spyOn(scriptService, "getScriptBundleForFrontend").mockReturnValue({ script: "w" } as any);

            const res = await api.get<unknown[]>("/api/script/widgets");
            expect(res.status).toBe(200);
            expect(res.body).toEqual([{ script: "w" }]);
        });

        it("returns no widget bundles in safe mode", async () => {
            vi.stubEnv("TRILIUM_SAFE_MODE", "1");
            try {
                const res = await api.get<unknown[]>("/api/script/widgets");
                expect(res.status).toBe(200);
                expect(res.body).toEqual([]);
            } finally {
                vi.unstubAllEnvs();
            }
        });
    });

    describe("relation bundles", () => {
        it("collects frontend-JS relation targets and skips others", async () => {
            const frontendTarget = await createCodeNote("return 1;");
            const { noteId: textTarget } = await createTextNote(api);
            const { noteId: hostId } = await createTextNote(api);

            // Two relations: one to a frontend-JS note, one to a plain text note (filtered out).
            await api.post(`/api/notes/${hostId}/attributes`, {
                body: { type: "relation", name: "runOnInstance", value: frontendTarget }
            });
            await api.post(`/api/notes/${hostId}/attributes`, {
                body: { type: "relation", name: "runOnInstance", value: textTarget }
            });

            vi.spyOn(scriptService, "getScriptBundleForFrontend").mockReturnValue({ script: "rel" } as any);

            const res = await api.get<unknown[]>(`/api/script/relation/${hostId}/runOnInstance`);
            expect(res.status).toBe(200);
            // Only the frontend-JS target yields a bundle.
            expect(res.body).toEqual([{ script: "rel" }]);
        });
    });

    describe("getBundle", () => {
        it("returns a bundle for a code note without body override", async () => {
            const noteId = await createCodeNote("return 1;");
            vi.spyOn(scriptService, "getScriptBundleForFrontend").mockReturnValue({ script: "b" } as any);

            const res = await api.post<unknown>(`/api/script/bundle/${noteId}`);
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ script: "b" });
            expect(scriptService.getScriptBundleForFrontend).toHaveBeenCalledWith(
                expect.anything(),
                undefined,
                undefined
            );
        });

        it("returns a bundle using the script/params from the body", async () => {
            const noteId = await createCodeNote("return 1;");
            const spy = vi
                .spyOn(scriptService, "getScriptBundleForFrontend")
                .mockReturnValue({ script: "override" } as any);

            const res = await api.post<unknown>(`/api/script/bundle/${noteId}`, {
                body: { script: "() => 5", params: [1, 2] }
            });
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ script: "override" });
            expect(spy).toHaveBeenCalledWith(expect.anything(), "() => 5", [1, 2]);
        });
    });
});
