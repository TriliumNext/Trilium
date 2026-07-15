import { Application } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { login } from "./utils.js";
import config from "../../src/services/config.js";
import { becca } from "@triliumnext/core";
import { readFileSync } from "fs";
import { join } from "path";

let app: Application;
let token: string;

const USER = "etapi";

describe("etapi/import", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await (import("../../src/app.js"))).default;
        app = await buildApp();
        token = await login(app);
    });

    it("demo zip (a whole-database export) imports under root as a 'root' wrapper note", async () => {
        const buffer = readFileSync(join(__dirname, "../../src/assets/db/demo.zip"));
        const response = await supertest(app)
            .post("/etapi/notes/root/import")
            .auth(USER, token, { "type": "basic"})
            .set("Content-Type", "application/octet-stream")
            .set("Content-Transfer-Encoding", "binary")
            .send(buffer)
            .expect(201);

        // A Trilium root-export (its top note is "root") imported into root is nested under a "root"
        // wrapper note rather than being remapped onto / merged into the system root - that would
        // create a self-referential root->root branch that breaks loading. (Whole-database *restore*,
        // which maps the archive's root onto the destination root, is an internal-only option used by
        // the demo-content seed - it is deliberately not exposed over ETAPI. See import/zip.spec.ts.)
        expect(response.body.note.title).toStrictEqual("root");
        expect(response.body.branch.parentNoteId).toStrictEqual("root");

        // the demo's top-level notes live under that wrapper, and no corrupt root->root branch exists
        const wrapper = becca.getNote(response.body.note.noteId);
        expect(wrapper?.getChildNotes().map((n) => n.title)).toEqual(expect.arrayContaining(["Journal", "Trilium Demo", "Miscellaneous"]));
        expect(becca.getBranchFromChildAndParent("root", "root")).toBeFalsy();
    });
});
