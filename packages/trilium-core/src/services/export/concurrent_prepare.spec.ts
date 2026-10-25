import { MULTICOLUMN_COLUMN_CLASS, MULTICOLUMN_LAYOUT_CLASS } from "@triliumnext/commons";
import { PassThrough } from "stream";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import becca from "../../becca/becca.js";
import type { ExportFormat } from "../../meta.js";
import cloningService from "../cloning.js";
import type { ContentJobExecutor } from "../content_jobs/executor.js";
import { initContentJobExecutor } from "../content_jobs/executor.js";
import { type ContentJob, runContentJob } from "../content_jobs/jobs.js";
import { getContext } from "../context.js";
import noteService from "../notes.js";
import sql_init from "../sql_init.js";
import TaskContext from "../task_context.js";
import { md5 } from "../utils/index.js";
import { getZipProvider } from "../zip_provider.js";
import zip from "./zip.js";

const FORMATS: ExportFormat[] = [ "html", "markdown" ];

describe("export with conversions that finish out of order", () => {
    beforeAll(async () => {
        sql_init.initializeDb();
        await sql_init.dbReady;
        getContext().init(() => buildFixture());
    });

    afterEach(() => initContentJobExecutor());

    for (const format of FORMATS) {
        it(`writes the same ${format} archive as converting one note at a time`, async () => {
            initContentJobExecutor();
            const expected = await exportEntries(format);

            const executor = new ShuffledExecutor(Array.from(format).reduce((seed, char) => seed + char.charCodeAt(0), 7));
            initContentJobExecutor(executor);
            const actual = await exportEntries(format);

            expect(actual).toEqual(expected);
            // The comparison only means something if the conversions really overlapped and
            // finished in a different order from the one they were started in.
            expect(executor.started.length).toBeGreaterThan(20);
            expect(executor.maxInFlight).toBeGreaterThan(1);
            expect(executor.finished).not.toEqual(executor.started);
        });
    }
});

/** Runs each job after a seeded random delay, so later jobs regularly finish first. */
class ShuffledExecutor implements ContentJobExecutor {
    started: number[] = [];
    finished: number[] = [];
    maxInFlight = 0;
    private inFlight = 0;
    private nextId = 0;

    constructor(private seed: number) {}

    async run<J extends ContentJob>(job: J) {
        const id = this.nextId++;
        this.started.push(id);
        this.inFlight++;
        this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
        try {
            await new Promise((resolve) => setTimeout(resolve, this.random() * 4));
            return await runContentJob(job);
        } finally {
            this.inFlight--;
            this.finished.push(id);
        }
    }

    private random() {
        this.seed = (this.seed * 1103515245 + 12345) % 2147483648;
        return this.seed / 2147483648;
    }
}

/** The archive's entries in order: names and content hashes. */
async function exportEntries(format: ExportFormat) {
    const branch = becca.getNoteOrThrow(FIXTURE_ROOT_ID).getParentBranches()[0];
    const taskContext = new TaskContext("no-progress-reporting", "export", null);
    const destination = new PassThrough();
    const chunks: Buffer[] = [];
    destination.on("data", (chunk: Buffer) => chunks.push(chunk));
    const ended = new Promise<void>((resolve, reject) => {
        destination.on("end", () => resolve());
        destination.on("error", reject);
    });

    await zip.exportToZip(taskContext, branch, format, destination, false);
    await ended;

    const entries: { name: string; length: number; md5: string }[] = [];
    await getZipProvider().readZipFile(Buffer.concat(chunks), async (entry, readContent) => {
        const bytes = await readContent();
        entries.push({ name: entry.fileName, length: bytes.length, md5: md5(bytes) });
    });
    return entries;
}

const FIXTURE_ROOT_ID = "cpexRoot0001";

const PNG_BYTES = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
    0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
]);

/**
 * Builds a subtree with fixed note IDs: rich text in many shapes, a Markdown code note, a note too
 * large to pretty-print, a clone, an image attachment, and a wide level whose children have
 * children of their own and distinct content, so a note written with a sibling's conversion shows.
 */
function buildFixture() {
    const create = (noteId: string, parentNoteId: string, title: string, content: string, type: "text" | "code" = "text", mime?: string) =>
        noteService.createNewNote({ noteId, parentNoteId, title, content, type, mime }).note;

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
        create(childId, wide.noteId, `Child ${i}`, `<p>child ${i}</p><h2>Section ${i}</h2><ul><li>item ${i}</li></ul>`);
        for (let j = 0; j < i % 3; j++) {
            create(`cpexWG${String(i).padStart(3, "0")}_${j}0`, childId, `Grandchild ${i}.${j}`, `<p>grandchild ${i}.${j}</p>`);
        }
    }

    cloningService.cloneNoteToParentNote("cpexRich0001", "cpexWide0001");
}
