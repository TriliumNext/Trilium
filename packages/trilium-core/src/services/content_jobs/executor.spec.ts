import { strToU8, zipSync } from "fflate";
import { PassThrough } from "stream";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import becca from "../../becca/becca.js";
import type BNote from "../../becca/entities/bnote.js";
import type { ExportFormat } from "../../meta.js";
import { CoreApiTester } from "../../test/api_tester.js";
import { getContext } from "../context.js";
import singleExport from "../export/single.js";
import zipExport from "../export/zip.js";
import enex from "../import/enex.js";
import singleImport from "../import/single.js";
import zipImport from "../import/zip.js";
import noteService from "../notes.js";
import sql_init from "../sql_init.js";
import TaskContext from "../task_context.js";
import { captureContentJobEnv } from "./env.js";
import { type ContentJobExecutor, getContentJobExecutor, initContentJobExecutor } from "./executor.js";
import { type ContentJob, runContentJob } from "./jobs.js";

describe("content job executor", () => {
    beforeAll(async () => {
        sql_init.initializeDb();
        await sql_init.dbReady;
    });

    afterEach(() => initContentJobExecutor());

    it("runs jobs in this thread by default and switches to an injected executor and back", async () => {
        const job: ContentJob = { kind: "markdownToHtml", markdown: "*hi*", title: "", env: captureContentJobEnv() };
        expect(await getContentJobExecutor().run(job)).toBe(await runContentJob(job));

        const executor = recordingExecutor();
        initContentJobExecutor(executor);
        expect(getContentJobExecutor()).toBe(executor);
        await getContentJobExecutor().run(job);
        expect(executor.calls).toEqual([ job ]);

        initContentJobExecutor();
        expect(getContentJobExecutor()).not.toBe(executor);
    });

    it("receives the conversions of import, export and the office preview, each run with one captured env", async () => {
        const executor = recordingExecutor();
        initContentJobExecutor(executor);
        const env = captureContentJobEnv();

        const kindsOf = async (run: () => Promise<unknown>) => {
            executor.calls.length = 0;
            await run();
            const envs = new Set(executor.calls.flatMap((job) => ("env" in job ? [ job.env ] : [])));
            expect(envs.size).toBeLessThanOrEqual(1);
            for (const capturedEnv of envs) {
                expect(capturedEnv).toEqual(env);
            }
            return new Set(executor.calls.map((job) => job.kind));
        };

        const source = createNote("<p>Exported <strong>body</strong></p>");
        createNote("<p>child</p>", source.noteId);
        createNote("<p>second child</p>", source.noteId);
        expect(await kindsOf(() => exportZip(source, "markdown"))).toEqual(new Set([ "htmlToMarkdown" ]));
        expect(await kindsOf(() => exportZip(source, "html"))).toEqual(new Set([ "prettyPrintHtml" ]));
        expect(await kindsOf(() => exportSingle(source, "markdown"))).toEqual(new Set([ "htmlToMarkdown" ]));
        expect(await kindsOf(() => exportSingle(source, "html"))).toEqual(new Set([ "prettyPrintHtml" ]));

        const safe = { textImportedAsText: true, safeImport: true };
        expect(await kindsOf(() => importSingle("Note.md", "# Note\n\nBody", safe))).toEqual(new Set([ "markdownToHtml", "sanitizeHtml" ]));
        expect(await kindsOf(() => importSingle("Page.html", "<p>page</p>", safe))).toEqual(new Set([ "sanitizeHtml" ]));
        expect(await kindsOf(() => importZipBuffer(SMALL_ZIP(), safe))).toEqual(new Set([ "prepareNoteText" ]));
        expect(await kindsOf(() => importEnex(SMALL_ENEX))).toEqual(new Set([ "enexNoteContent" ]));

        const api = CoreApiTester.build();
        const created = await api.post<{ note: { noteId: string } }>("/api/notes/root/children", {
            query: { target: "into" },
            body: { title: "document.rtf", type: "file", mime: "application/rtf", content: String.raw`{\rtf1\ansi Hello}` }
        });
        expect(await kindsOf(async () => {
            const res = await api.get(`/api/notes/${created.body.note.noteId}/office-preview`);
            expect(res.status).toBe(200);
        })).toEqual(new Set([ "officeToHtml" ]));
    });

    it("fails an import or export cleanly when the executor rejects, leaving nothing half saved", async () => {
        initContentJobExecutor({ run: async () => { throw new Error("worker died"); } });
        const parent = createNote("");

        await expect(importZipBuffer(SMALL_ZIP(), { textImportedAsText: true }, parent)).rejects.toThrow("worker died");
        expect(parent.getChildNotes()).toEqual([]);

        await expect(importSingle("Note.md", "# Note", { textImportedAsText: true }, parent)).rejects.toThrow("worker died");
        expect(parent.getChildNotes()).toEqual([]);

        await expect(importEnex(SMALL_ENEX, parent)).rejects.toThrow("worker died");
        // The ENEX root note is created before the first note is parsed, as without an executor.
        expect(parent.getChildNotes().map((note) => note.getChildNotes().length)).toEqual([ 0 ]);

        const source = createNote("<p>body</p>");
        await expect(exportZip(source, "markdown")).rejects.toThrow("worker died");
        await expect(exportSingle(source, "html")).rejects.toThrow("worker died");
    });
});

function recordingExecutor() {
    const calls: ContentJob[] = [];
    const executor: ContentJobExecutor = {
        run: async (job) => {
            calls.push(job);
            return runContentJob(job);
        }
    };
    return Object.assign(executor, { calls });
}

let counter = 0;

function createNote(content: string, parentNoteId = "root"): BNote {
    counter++;
    return getContext().init(() => noteService.createNewNote({ parentNoteId, title: `executor-${counter}`, content, type: "text" }).note);
}

function taskContext(data: Record<string, unknown>) {
    counter++;
    return TaskContext.getInstance(`executor-spec-${counter}`, "importNotes", data);
}

async function exportZip(note: BNote, format: ExportFormat) {
    const destination = new PassThrough();
    destination.resume();
    await zipExport.exportToZip(new TaskContext("no-progress-reporting", "export", null), note.getParentBranches()[0], format, destination, false);
}

async function exportSingle(note: BNote, format: ExportFormat) {
    const response = { setHeader: () => response, send: () => response };
    await singleExport.exportSingleNote(new TaskContext("no-progress-reporting", "export", null), note.getParentBranches()[0], format,
        response as unknown as Parameters<typeof singleExport.exportSingleNote>[3]);
}

function importSingle(fileName: string, content: string, data: Record<string, unknown>, parent = becca.getNoteOrThrow("root")) {
    return getContext().init(() => singleImport.importSingleFile(taskContext(data), {
        originalname: fileName, mimetype: "application/octet-stream", buffer: strToU8(content)
    }, parent));
}

function importZipBuffer(buffer: Uint8Array, data: Record<string, unknown>, parent = becca.getNoteOrThrow("root")) {
    return getContext().init(() => zipImport.importZip(taskContext(data), buffer, parent));
}

function importEnex(content: string, parent = becca.getNoteOrThrow("root")) {
    return getContext().init(() => enex.importEnex(taskContext({}), {
        originalname: "Small.enex", mimetype: "application/enex+xml", buffer: content
    }, parent));
}

const SMALL_ZIP = () => zipSync({
    "Folder/Note.md": strToU8("---\ntag: x\n---\n# Note\n\nbody"),
    "Folder/Page.html": strToU8("<h1>Page</h1><p>text</p>")
});

const SMALL_ENEX = `<?xml version="1.0" encoding="UTF-8"?>
<en-export><note><title>One</title><content><![CDATA[<en-note><div>one</div></en-note>]]></content></note>
<note><title>Two</title><content><![CDATA[<en-note><div>two</div></en-note>]]></content></note></en-export>`;
