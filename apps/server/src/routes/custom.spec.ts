import { cls, getConfig, note_service as noteService } from "@triliumnext/core";
import type { Application } from "express";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import config from "../services/config.js";

let app: Application;

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
});
