import { MULTICOLUMN_COLUMN_CLASS, MULTICOLUMN_LAYOUT_CLASS } from "@triliumnext/commons";
import { PassThrough } from "stream";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import becca from "../../becca/becca.js";
import BNote from "../../becca/entities/bnote.js";
import type { ExportFormat } from "../../meta.js";
import { shuffledExecutor } from "../../test/shuffled_executor.js";
import cloningService from "../cloning.js";
import { type ContentJobExecutor, initContentJobExecutor } from "../content_jobs/executor.js";
import { getContext } from "../context.js";
import noteService from "../notes.js";
import sql_init from "../sql_init.js";
import TaskContext from "../task_context.js";
import { md5 } from "../utils/index.js";
import { getZipProvider } from "../zip_provider.js";
import zip from "./zip.js";
import {
    getZipExportProviderFactory,
    initZipExportProviderFactory
} from "./zip_export_provider_factory.js";

const FORMATS: ExportFormat[] = [ "html", "markdown" ];

describe("export with conversions that finish out of order", () => {
    beforeAll(async () => {
        sql_init.initializeDb();
        await sql_init.dbReady;
        getContext().init(() => buildFixture());
    });

    afterEach(() => {
        initContentJobExecutor();
        vi.useRealTimers();
    });

    for (const format of FORMATS) {
        it(`writes the same ${format} entries as converting one note at a time`, async () => {
            // The entries that belong to no note (the meta file, navigation, index, style) are dated
            // when they are written, so both exports read the same clock.
            vi.useFakeTimers({ toFake: [ "Date" ], now: new Date("2026-06-01T12:00:00Z") });

            const sequential = shuffledExecutor({ delays: false });
            initContentJobExecutor(sequential);
            const expected = await withoutConcurrentPrepare(() => exportEntries(format));

            const shuffled = shuffledExecutor();
            initContentJobExecutor(shuffled);
            const actual = await exportEntries(format);

            expect(actual).toEqual(expected);
            expect(sequential.maxInFlight).toBe(1);
            // The comparison only means something if the conversions really overlapped and
            // finished in a different order from the one they were started in.
            expect(shuffled.calls.length).toBeGreaterThan(20);
            expect(shuffled.maxInFlight).toBeGreaterThan(1);
            expect(shuffled.finished).not.toEqual(shuffled.calls.map((_, index) => index));
            // Siblings carry distinct dates, so a date written with another note's shows. The
            // standalone reader cannot read entry dates.
            if (actual.some((entry) => entry.lastModified !== undefined)) {
                expect(new Set(actual.map((entry) => entry.lastModified)).size).toBeGreaterThan(20);
            }
        });
    }

    it("loads a note that needs no conversion only when its turn comes", async () => {
        initContentJobExecutor(shuffledExecutor());
        const fileIds = new Set(FILE_IDS);
        const loaded: string[] = [];
        // The metadata pass reads content too; only the writing pass after `!!!meta.json` counts.
        let writing = false;
        const getContent = BNote.prototype.getContent;
        vi.spyOn(BNote.prototype, "getContent").mockImplementation(function (this: BNote) {
            if (writing && fileIds.has(this.noteId)) {
                loaded.push(this.noteId);
            }
            return getContent.call(this);
        });
        try {
            const entries = await exportEntries("markdown", (name) => {
                writing ||= name === "!!!meta.json";
                // Every file note loaded so far has its entry written, except the one loaded last.
                const written = loaded.slice(0, -1);
                expect(written.every((noteId) => writtenFiles.has(noteId))).toBe(true);
            });
            const fileEntries = entries.filter((entry) => entry.name.includes("/Files/file "));
            expect(fileEntries).toHaveLength(FILE_IDS.length);
            expect(loaded).toEqual(FILE_IDS);
        } finally {
            vi.restoreAllMocks();
        }
    });

    it("rejects with a later sibling's failed conversion and closes the destination", async () => {
        const shuffled = shuffledExecutor();
        const fail = () => new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("child 5 failed")), 1);
        });
        const failing: ContentJobExecutor = {
            run: (job) => ("html" in job && job.html.includes("child 5<")
                ? fail()
                : shuffled.run(job))
        };
        initContentJobExecutor(failing);
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => unhandled.push(reason);
        process.on("unhandledRejection", onUnhandled);
        try {
            const destination = new PassThrough();
            destination.resume();
            await expect(exportTo("markdown", destination)).rejects.toThrow("child 5 failed");
            expect(destination.destroyed).toBe(true);

            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(unhandled).toEqual([]);
            // Siblings after the failed one were already converting when it failed.
            const laterSibling = shuffled.calls
                .find((job) => "html" in job && job.html.includes("child 6<"));
            expect(laterSibling).toBeDefined();
        } finally {
            process.off("unhandledRejection", onUnhandled);
        }
    });
});

/** File note IDs whose entries have been appended, filled by `exportEntries()`'s archive hook. */
const writtenFiles = new Set<string>();

/** Runs `run` with providers that prepare each note only after the note before it is written. */
async function withoutConcurrentPrepare<T>(run: () => Promise<T>) {
    const factory = getZipExportProviderFactory();
    initZipExportProviderFactory(async (format, data) =>
        Object.defineProperty(await factory(format, data), "concurrentPrepare", { value: false }));
    try {
        return await run();
    } finally {
        initZipExportProviderFactory(factory);
    }
}

/**
 * The archive's entries in order: names, dates, lengths and hashes of the decompressed content.
 * `onAppend` runs before each entry is appended.
 */
async function exportEntries(format: ExportFormat, onAppend?: (name: string) => void) {
    const provider = getZipProvider();
    const createZipArchive = provider.createZipArchive.bind(provider);
    vi.spyOn(provider, "createZipArchive").mockImplementation(() => {
        const archive = createZipArchive();
        const append = archive.append.bind(archive);
        archive.append = (content, options) => {
            onAppend?.(options.name);
            const fileId = FILE_IDS.find((noteId) => options.name.includes(`file ${noteId}`));
            if (fileId) {
                writtenFiles.add(fileId);
            }
            append(content, options);
        };
        return archive;
    });
    writtenFiles.clear();

    const destination = new PassThrough();
    const chunks: Buffer[] = [];
    destination.on("data", (chunk: Buffer) => chunks.push(chunk));
    const ended = new Promise<void>((resolve, reject) => {
        destination.on("end", () => resolve());
        destination.on("error", reject);
    });

    try {
        await exportTo(format, destination);
    } finally {
        vi.mocked(provider.createZipArchive).mockRestore();
    }
    await ended;

    const entries: { name: string; lastModified?: number; length: number; md5: string }[] = [];
    await provider.readZipFile(Buffer.concat(chunks), async (entry, readContent) => {
        const bytes = await readContent();
        entries.push({
            name: entry.fileName,
            lastModified: entry.lastModified?.getTime(),
            length: bytes.length,
            md5: md5(bytes)
        });
    });
    return entries;
}

function exportTo(format: ExportFormat, destination: PassThrough) {
    const branch = becca.getNoteOrThrow(FIXTURE_ROOT_ID).getParentBranches()[0];
    const taskContext = new TaskContext("no-progress-reporting", "export", null);
    return zip.exportToZip(taskContext, branch, format, destination, false);
}

const FIXTURE_ROOT_ID = "cpexRoot0001";
const FILE_IDS = Array.from({ length: 10 }, (_, i) => `cpexFile${String(i).padStart(4, "0")}`);

const PNG_BYTES = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
    0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
]);

/**
 * Builds a subtree with fixed note IDs: rich text in many shapes, a Markdown code note, a note too
 * large to pretty-print, a clone, an image attachment, file notes, and a wide level whose children
 * have children of their own and distinct content and dates, so a note written with a sibling's
 * conversion or date shows.
 */
function buildFixture() {
    const create = (
        noteId: string, parentNoteId: string, title: string, content: string | Uint8Array,
        type: "text" | "code" | "file" = "text", mime?: string
    ) => noteService.createNewNote({ noteId, parentNoteId, title, content, type, mime }).note;

    create(FIXTURE_ROOT_ID, "root", "Concurrent Root", `<p>Root <strong>body</strong> linking <a class="reference-link" href="#root/${FIXTURE_ROOT_ID}/cpexRich0001">Rich</a>.</p>`);

    const rich = create("cpexRich0001", FIXTURE_ROOT_ID, "Rich", "");
    const image = rich.saveAttachment({ role: "image", mime: "image/png", title: "pixel.png", content: PNG_BYTES });
    rich.setContent(`<h2>Heading</h2>
<p>Text with <em>emphasis</em>, <code>code</code> and a <a href="https://example.com">link</a>.</p>
<figure class="table"><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></figure>
<ul class="todo-list"><li><label class="todo-list__label"><input type="checkbox" checked="checked" disabled="disabled"><span class="todo-list__label__description">done</span></label></li><li data-trilium-task-state="doing" title="Doing"><label class="todo-list__label"><input type="checkbox" disabled="disabled"><span class="todo-list__label__description">doing</span></label></li></ul>
<details class="trilium-collapsible"><summary>Summary</summary><p>Hidden</p></details>
<div class="${MULTICOLUMN_LAYOUT_CLASS}"><div class="${MULTICOLUMN_COLUMN_CLASS}"><p>left</p></div><div class="${MULTICOLUMN_COLUMN_CLASS}"><p>right</p></div></div>
<pre><code class="language-text-x-python">def f():\n    return 1</code></pre>
<p><img src="api/attachments/${image.attachmentId}/image/pixel.png"></p>`);

    create("cpexMdCode01", FIXTURE_ROOT_ID, "Markdown code", `# Title\n\n[Rich](#root/${FIXTURE_ROOT_ID}/cpexRich0001)\n`, "code", "text/x-markdown");
    create("cpexLarge001", FIXTURE_ROOT_ID, "Large", `<p>${"long paragraph text ".repeat(6000)}</p>`);

    const wide = create("cpexWide0001", FIXTURE_ROOT_ID, "Wide", "<p>wide parent</p>");
    for (let i = 0; i < 20; i++) {
        const childId = `cpexWideC${String(i).padStart(3, "0")}`;
        const content = `<p>child ${i}</p><h2>Section ${i}</h2><ul><li>item ${i}</li></ul>`;
        const child = create(childId, wide.noteId, `Child ${i}`, content);
        // Two seconds apart, the resolution of a ZIP entry's date.
        const modified = new Date(Date.UTC(2020, 0, 1, 0, 0, i * 2));
        child.utcDateModified = modified.toISOString().replace("T", " ");
        for (let j = 0; j < i % 3; j++) {
            create(`cpexWG${String(i).padStart(3, "0")}_${j}0`, childId, `Grandchild ${i}.${j}`, `<p>grandchild ${i}.${j}</p>`);
        }
    }

    const files = create("cpexFiles001", FIXTURE_ROOT_ID, "Files", "<p>files</p>");
    for (const [ i, noteId ] of FILE_IDS.entries()) {
        const bytes = new Uint8Array([ i, 1, 2, 3 ]);
        create(noteId, files.noteId, `file ${noteId}`, bytes, "file", "application/octet-stream");
    }

    cloningService.cloneNoteToParentNote("cpexRich0001", "cpexWide0001");
}
