import { becca, cls } from "@triliumnext/core";
import type { Application } from "express";
import supertest from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

import buildApp from "../../src/app.js";
import sql from "../../src/services/sql.js";
import { createNote, login } from "./utils.js";

let app: Application;
let token: string;

/**
 * ETAPI opens a CLS context per request and stamps it with the "etapi" componentId. That stamp
 * lands on every entity change the request produces, which is how the frontend update message
 * tells an external write apart from one the client made itself.
 */
describe("etapi/cls-context", () => {
    beforeAll(async () => {
        app = await buildApp();
        token = await login(app);
    });

    it("stamps every entity change of an ETAPI write with the etapi componentId", async () => {
        const noteId = await createNote(app, token);

        const componentIds = sql.getColumn<string>(
            `SELECT DISTINCT componentId FROM entity_changes
             WHERE (entityName = 'notes' AND entityId = ?)
                OR (entityName = 'branches' AND entityId LIKE ?)`,
            [noteId, `%${noteId}`]
        );

        expect(componentIds).toEqual(["etapi"]);
    });

    it("acts for the instance, since a token is not tied to a user", async () => {
        const seen: boolean[] = [];
        const getNote = becca.getNote.bind(becca);
        const spy = vi.spyOn(becca, "getNote").mockImplementation((noteId) => {
            seen.push(cls.isSystem());
            return getNote(noteId);
        });

        try {
            await supertest(app).get("/etapi/notes/root").auth("etapi", token, { type: "basic" }).expect(200);
        } finally {
            spy.mockRestore();
        }

        expect(seen.length).toBeGreaterThan(0);
        expect(seen.every(Boolean)).toBe(true);
    });

    it("does not carry a context over from a request that failed", async () => {
        const failed = await supertest(app)
            .post("/etapi/create-note")
            .auth("etapi", token, { type: "basic" })
            .send({ parentNoteId: "root", title: "Bad", type: "text" });
        expect(failed.status).toBeGreaterThanOrEqual(400);

        // The next write still gets its own context, rather than the failed one or none at all.
        const noteId = await createNote(app, token);
        const componentId = sql.getValue<string>(
            "SELECT componentId FROM entity_changes WHERE entityName = 'notes' AND entityId = ?",
            [noteId]
        );

        expect(componentId).toBe("etapi");
    });
});
