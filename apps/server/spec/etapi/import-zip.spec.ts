import { Application } from "express";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { login, outOfOrderContentJobs } from "./utils.js";
import config from "../../src/services/config.js";
import { becca, type BNote, initContentJobExecutor } from "@triliumnext/core";
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

    describe("with conversions that finish out of order", () => {
        afterEach(() => initContentJobExecutor());

        it("imports the same notes as converting one entry at a time", async () => {
            const expected = describeTree(await importDemo());

            const { executor, stats } = outOfOrderContentJobs();
            initContentJobExecutor(executor);
            const actual = describeTree(await importDemo());

            expect(actual).toEqual(expected);
            expect(stats.started.length).toBeGreaterThan(20);
            expect(stats.maxInFlight).toBeGreaterThan(1);
            expect(stats.finished).not.toEqual(stats.started);
        });
    });
});

async function importDemo() {
    const response = await supertest(app)
        .post("/etapi/notes/root/import")
        .auth(USER, token, { "type": "basic"})
        .set("Content-Type", "application/octet-stream")
        .set("Content-Transfer-Encoding", "binary")
        .send(readFileSync(join(__dirname, "../../src/assets/db/demo.zip")))
        .expect(201);
    return becca.getNoteOrThrow(response.body.note.noteId);
}

/**
 * The imported subtree with every note and attachment ID replaced by its position in the tree, since
 * each import generates new ones.
 */
function describeTree(importRoot: BNote) {
    const labels = new Map<string, string>();
    const assignLabels = (note: BNote, label: string) => {
        if (labels.has(note.noteId)) {
            return;
        }
        labels.set(note.noteId, label);
        for (const [ index, { attachmentId } ] of note.getAttachments().entries()) {
            if (attachmentId) {
                labels.set(attachmentId, `${label}@${index}`);
            }
        }
        for (const [ index, child ] of note.getChildNotes().entries()) {
            assignLabels(child, `${label}/${index}`);
        }
    };
    assignLabels(importRoot, "import");

    const relabel = (text: string) => {
        for (const [ id, label ] of labels) {
            text = text.split(id).join(label);
        }
        return text;
    };
    const describeNote = (note: BNote): unknown => {
        const content = note.getContent();
        return {
            title: note.title,
            type: note.type,
            mime: note.mime,
            content: typeof content === "string" ? relabel(content) : `${content.length} bytes`,
            attributes: note.getOwnedAttributes().map((attr) => `${attr.type}:${attr.name}=${relabel(attr.value)}`),
            attachments: note.getAttachments().map((attachment) => `${attachment.title} ${attachment.mime}`),
            // A clone is described where it was first reached and named everywhere else.
            children: note.getChildBranches().map((branch, index) => {
                const childLabel = labels.get(branch.noteId);
                return {
                    prefix: branch.prefix,
                    note: childLabel === `${labels.get(note.noteId)}/${index}`
                        ? describeNote(becca.getNoteOrThrow(branch.noteId))
                        : `clone of ${childLabel}`
                };
            })
        };
    };
    return describeNote(importRoot);
}
