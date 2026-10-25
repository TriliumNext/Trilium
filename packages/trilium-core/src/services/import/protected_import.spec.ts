import { strToU8, zipSync } from "fflate";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type BNote from "../../becca/entities/bnote.js";
import { type ContentJobExecutor, initContentJobExecutor } from "../content_jobs/executor.js";
import { runContentJob } from "../content_jobs/jobs.js";
import { getContext } from "../context.js";
import noteService from "../notes.js";
import protectedSessionService from "../protected_session.js";
import sql_init from "../sql_init.js";
import TaskContext from "../task_context.js";
import { encodeUtf8 } from "../utils/binary.js";
import enex from "./enex.js";
import obsidianImporter from "./obsidian/importer.js";
import single from "./single.js";
import zip from "./zip.js";

type Importer = (taskContext: TaskContext<"importNotes">, parentNote: BNote) => Promise<unknown>;

const MARKDOWN = "# Secret\n\nThe **secret** text.";

const IMPORTERS: Record<string, Importer> = {
    markdown: (taskContext, parentNote) => single.importSingleFile(taskContext, {
        originalname: "Secret.md", mimetype: "text/markdown", buffer: MARKDOWN
    }, parentNote),
    html: (taskContext, parentNote) => single.importSingleFile(taskContext, {
        originalname: "Secret.html", mimetype: "text/html", buffer: "<p>The <b>secret</b> text.</p>"
    }, parentNote),
    enex: (taskContext, parentNote) => enex.importEnex(taskContext, {
        originalname: "Secret.enex",
        mimetype: "application/enex+xml",
        buffer: `<?xml version="1.0" encoding="UTF-8"?><en-export><note><title>Secret</title>`
            + `<content><![CDATA[<en-note><div>The secret text.</div></en-note>]]></content></note></en-export>`
    }, parentNote),
    zip: (taskContext, parentNote) => zip.importZip(taskContext, zipOf({ "Secret.md": MARKDOWN }), parentNote),
    obsidian: (taskContext, parentNote) => obsidianImporter.importObsidian(
        taskContext, zipOf({ "Secret.md": MARKDOWN }), parentNote, "Vault.zip"
    )
};

beforeAll(async () => {
    sql_init.initializeDb();
    await sql_init.dbReady;
});

afterEach(() => {
    initContentJobExecutor();
    protectedSessionService.resetDataKey();
});

describe("an import into a protected note", () => {
    for (const [ name, importNotes ] of Object.entries(IMPORTERS)) {
        it(`never stores ${name} content unprotected when the session locks during conversion`, async () => {
            protectedSessionService.setDataKey(encodeUtf8("0123456789abcdef"));
            const parentNote = getContext().init(() => noteService.createNewNote({
                parentNoteId: "root",
                title: `protected ${name} target`,
                content: "",
                type: "text",
                mime: "text/html",
                isProtected: true
            }).note);
            const taskContext = TaskContext.getInstance(`protected-${name}`, "importNotes", {
                textImportedAsText: true,
                safeImport: true
            });
            let conversions = 0;

            initContentJobExecutor({
                run(job) {
                    conversions++;
                    protectedSessionService.resetDataKey();
                    return runContentJob(job);
                }
            } satisfies ContentJobExecutor);

            await getContext().init(() => importNotes(taskContext, parentNote)).catch(() => {});

            expect(conversions, name).toBeGreaterThan(0);
            expect(parentNote.getSubtree().notes.filter((note) => !note.isProtected).map((note) => note.title))
                .toEqual([]);
        });
    }
});

function zipOf(files: Record<string, string>): Uint8Array {
    return zipSync(Object.fromEntries(Object.entries(files).map(([ name, text ]) => [ name, strToU8(text) ])));
}
