import { becca, cls, getConfig, note_service as noteService } from "@triliumnext/core";
import type { Application } from "express";
import type { AddressInfo } from "net";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import config from "../services/config.js";
import sql from "../services/sql.js";

let app: Application;

/** What a handler script reports back, via a global the script and the spec share. */
interface ScriptProbe {
    noteId?: string;
    error?: string;
}

function readProbe(key: string): ScriptProbe {
    return (globalThis as unknown as Record<string, ScriptProbe | undefined>)[key] ?? {};
}

/** A handler script that writes a note from a `res` listener and reports the id it created. */
function listenerHandlerScript(probeName: string, title: string, respond: string) {
    return `
const probe = globalThis.${probeName} = {};
api.res.on("close", () => {
    try {
        probe.noteId = api.createTextNote(api.currentNote.noteId, "${title}", "x").note.noteId;
    } catch (e) {
        probe.error = e.message;
    }
});
${respond}`;
}

describe("Custom request/resource handlers", () => {
    // Custom request handlers run backend scripts, gated by the backendScriptingEnabled toggle at
    // two layers: the /custom route checks the server config, while execution (executeBundle) checks
    // core's config. The test setup never injects the server config into core, so they are distinct
    // objects and both must be enabled.
    const coreConfig = getConfig();
    const originalServerScripting = config.Security.backendScriptingEnabled;
    const originalCoreScripting = coreConfig.Security.backendScriptingEnabled;

    beforeAll(async () => {
        config.Security.backendScriptingEnabled = true;
        coreConfig.Security.backendScriptingEnabled = true;
        app = await (await import("../app.js")).default();

        cls.init(() => {
            // A backend script note that handles a custom request.
            const handler = noteService.createNewNote({
                parentNoteId: "root",
                title: "Custom handler",
                type: "code",
                mime: "application/javascript;env=backend",
                content: `api.res.status(200).send("handled:" + api.pathParams[0]);`
            }).note;
            handler.setLabel("customRequestHandler", "greet/([a-z]+)");

            // A script note that throws, to exercise the error branch.
            const thrower = noteService.createNewNote({
                parentNoteId: "root",
                title: "Throwing handler",
                type: "code",
                mime: "application/javascript;env=backend",
                content: `throw new Error("boom in handler");`
            }).note;
            thrower.setLabel("customRequestHandler", "explode");

            // A resource note served directly.
            const resource = noteService.createNewNote({
                parentNoteId: "root",
                title: "Custom resource",
                type: "text",
                content: "<p>resource body</p>"
            }).note;
            resource.setLabel("customResourceProvider", "resource");

            // `api.res` is a plain Express response and the User Guide points users at Express's
            // own documentation, so a handler registering listeners on it is supported surface.
            // These two write a note from the listener, which needs the request's CLS context:
            // putEntityChange() writes the new entity change id into it.
            const onClose = noteService.createNewNote({
                parentNoteId: "root",
                title: "Close listener handler",
                type: "code",
                mime: "application/javascript;env=backend",
                content: listenerHandlerScript(
                    "__clsCloseProbe",
                    "from-close",
                    `api.res.status(200).send("closing");`
                )
            }).note;
            onClose.setLabel("customRequestHandler", "on-close");

            // Same, but the response is left open so the listener fires from the client's abort —
            // an emit that originates outside the handler's async context entirely.
            const onAbort = noteService.createNewNote({
                parentNoteId: "root",
                title: "Abort listener handler",
                type: "code",
                mime: "application/javascript;env=backend",
                content: listenerHandlerScript(
                    "__clsAbortProbe",
                    "from-abort",
                    `api.res.writeHead(200, { "Content-Type": "text/plain" });
api.res.write("streaming");`
                )
            }).note;
            onAbort.setLabel("customRequestHandler", "abortable");

            // Empty value → skipped; invalid regex → caught and skipped. Both are
            // exercised by the "no handler matches" request below.
            noteService.createNewNote({ parentNoteId: "root", title: "Empty handler", type: "text", content: "x" })
                .note.setLabel("customRequestHandler", "   ");
            noteService.createNewNote({ parentNoteId: "root", title: "Bad regex handler", type: "text", content: "x" })
                .note.setLabel("customRequestHandler", "([unclosed");
        });
    });

    afterAll(() => {
        config.Security.backendScriptingEnabled = originalServerScripting;
        coreConfig.Security.backendScriptingEnabled = originalCoreScripting;
    });

    it("runs a custom request handler with captured path params", async () => {
        const res = await supertest(app).get("/custom/greet/world").expect(200);
        expect(res.text).toBe("handled:world");
    });

    it("returns 500 when the custom handler throws", async () => {
        const res = await supertest(app).get("/custom/explode").expect(500);
        expect(res.text).toContain("boom in handler");
    });

    it("serves a custom resource provider note", async () => {
        const res = await supertest(app).get("/custom/resource").expect(200);
        expect(res.text).toContain("resource body");
    });

    it("returns 404 when no handler matches", async () => {
        const res = await supertest(app).get("/custom/no-such-path").expect(404);
        expect(res.text).toContain("No handler matched");
    });

    // A resource provider executes no code — it only serves a note's static content. It should
    // therefore remain accessible even when backend scripting (code execution) is disabled, unlike
    // customRequestHandler. Currently the /custom route gates the whole surface behind the scripting
    // toggle, so this fails until the resource provider is decoupled from backendScriptingEnabled.
    it("serves a custom resource provider note even when backend scripting is disabled", async () => {
        config.Security.backendScriptingEnabled = false;

        try {
            const res = await supertest(app).get("/custom/resource").expect(200);
            expect(res.text).toContain("resource body");
        } finally {
            config.Security.backendScriptingEnabled = true;
        }
    });

    // The flip side of the decoupling: a request handler executes code, so it must stay gated.
    it("rejects a custom request handler when backend scripting is disabled", async () => {
        config.Security.backendScriptingEnabled = false;

        try {
            const res = await supertest(app).get("/custom/greet/world").expect(403);
            expect(res.text).toContain("Backend script execution is disabled");
        } finally {
            config.Security.backendScriptingEnabled = true;
        }
    });
    // A handler script that keeps working after it has responded relies on the response emitter
    // carrying the request's CLS context: without it the write below has nowhere to record its
    // entity change, so it either throws or is silently dropped from the sync queue.
    it("runs a handler's res listener in the request's context after responding", async () => {
        const res = await supertest(app).get("/custom/on-close").expect(200);
        expect(res.text).toBe("closing");

        await vi.waitFor(() => {
            const probe = readProbe("__clsCloseProbe");
            expect(probe.noteId ?? probe.error).toBeDefined();
        });

        const probe = readProbe("__clsCloseProbe");
        expect(probe.error).toBeUndefined();
        const noteId = probe.noteId ?? "";
        expect(becca.getNote(noteId)?.title).toBe("from-close");
        const changeCount = sql.getValue<number>(
            "SELECT COUNT(1) FROM entity_changes WHERE entityId = ?", [noteId]
        );
        expect(changeCount).toBeGreaterThan(0);
    });

    it("runs a handler's res listener in context when the client aborts", async () => {
        const server = app.listen(0);

        try {
            const { port } = server.address() as AddressInfo;
            const controller = new AbortController();
            const response = await fetch(`http://127.0.0.1:${port}/custom/abortable`, {
                signal: controller.signal
            });
            expect(response.status).toBe(200);

            controller.abort();

            await vi.waitFor(() => {
                const probe = readProbe("__clsAbortProbe");
                expect(probe.noteId ?? probe.error).toBeDefined();
            });

            const probe = readProbe("__clsAbortProbe");
            expect(probe.error).toBeUndefined();
            const noteId = probe.noteId ?? "";
            expect(becca.getNote(noteId)?.title).toBe("from-abort");
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });
});
