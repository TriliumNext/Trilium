import { PassThrough } from "node:stream";

import {
    becca,
    type BNote,
    getContext,
    initContentJobExecutor,
    note_service as noteService,
    TaskContext,
    zipExportService,
    zipImportService
} from "@triliumnext/core";
import { type ContentJob, runContentJob } from "@triliumnext/core/src/services/content_jobs/jobs.js";
import { md5 } from "@triliumnext/core/src/services/utils/index.js";
import { strToU8, unzipSync, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
    createPooledContentJobExecutor,
    IN_PROCESS_MAX_CHARS,
    type PooledContentJobExecutor
} from "./content_job_executor.js";

// Counts the conversions run in this process; the worker processes load the real module.
vi.mock("@triliumnext/core/src/services/content_jobs/jobs.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core/src/services/content_jobs/jobs.js")>();

    return { ...actual, runContentJob: vi.fn(actual.runContentJob) };
});

/**
 * A sizeable ZIP import and its Markdown and HTML exports, run once with core's in-process executor
 * and once with real worker processes, must leave identical notes and identical archives.
 */
let executor: PooledContentJobExecutor;
let previousNodeOptions: string | undefined;
const inProcessRuns = vi.mocked(runContentJob);

beforeAll(() => {
    // The child is plain Node and the worker entry here is TypeScript, so the loader reaches it
    // through the environment.
    previousNodeOptions = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = [ previousNodeOptions, "--import tsx" ].filter(Boolean).join(" ");
    executor = createPooledContentJobExecutor();
});

afterAll(() => {
    initContentJobExecutor();
    executor.shutdown();

    if (previousNodeOptions === undefined) {
        delete process.env.NODE_OPTIONS;
    } else {
        process.env.NODE_OPTIONS = previousNodeOptions;
    }
});

describe("content jobs in worker processes", () => {
    it("import and export the same notes and archives as in this process", { timeout: 180000 }, async () => {
        const archive = buildArchive(NOTE_COUNT);

        for (const safeImport of [ true, false ]) {
            initContentJobExecutor();
            const inProcessRoot = await importArchive(archive, safeImport);
            const expected = await describeRun(inProcessRoot);

            const submitted: ContentJob[] = [];

            inProcessRuns.mockClear();
            initContentJobExecutor({
                concurrency: executor.concurrency,
                run: (job) => {
                    submitted.push(job);
                    return executor.run(job);
                }
            });
            const pooledRoot = await importArchive(archive, safeImport);
            const actual = await describeRun(pooledRoot);
            initContentJobExecutor();

            // Only the inputs under the size threshold ran here; every other job went to a worker.
            const ranHere = inProcessRuns.mock.calls.map(([ job ]) => job);

            expect(ranHere.every((job) => inputLength(job) < IN_PROCESS_MAX_CHARS)).toBe(true);
            expect(submitted.filter((job) => inputLength(job) >= IN_PROCESS_MAX_CHARS).length)
                .toBe(submitted.length - ranHere.length);
            expect(submitted.length - ranHere.length).toBeGreaterThan(NOTE_COUNT);

            // The notes, their folders, the image and the parent the archive was imported under.
            expect(countNotes(expected.tree)).toBe(NOTE_COUNT + FOLDER_COUNT + 2);
            expect(actual.tree).toEqual(expected.tree);
            expect(actual.markdown.length).toBeGreaterThan(NOTE_COUNT);
            expect(actual.markdown).toEqual(expected.markdown);
            expect(actual.html).toEqual(expected.html);
        }
    });
});

const NOTE_COUNT = 300;

function inputLength(job: ContentJob): number {
    switch (job.kind) {
        case "markdownToHtml":
            return job.markdown.length;
        case "enexNoteContent":
            return job.content.length;
        case "prepareNoteText":
            return job.input.content.length;
        case "officeToHtml":
            return job.bytes.length;
        default:
            return job.html.length;
    }
}
const FOLDERS = [ "Projects/Alpha", "Projects/Beta/Deep", "Journal/2026", "Reference", "Reference/Recipes" ];
const FOLDER_COUNT = 9;

/** Imports the archive under a new parent note and returns that note. */
async function importArchive(archive: Uint8Array, safeImport: boolean): Promise<BNote> {
    importCounter++;
    const taskContext = TaskContext.getInstance(`content-job-integrity-${importCounter}`, "importNotes", {
        textImportedAsText: true,
        safeImport
    });

    return getContext().init(async () => {
        // A container per run, so the exported parent sits at the same position every time.
        const { note: container } = noteService.createNewNote({
            parentNoteId: "root",
            title: `run ${importCounter}`,
            content: "",
            type: "text"
        });
        const { note: parent } = noteService.createNewNote({
            parentNoteId: container.noteId,
            title: "integrity",
            content: "",
            type: "text"
        });

        await zipImportService.importZip(taskContext, archive, parent);

        return parent;
    });
}

let importCounter = 0;

/** The imported tree and both exports of it, with every generated ID replaced by its tree path. */
async function describeRun(root: BNote) {
    const labels = labelTree(root);
    const dangling = new Map<string, string>();
    const normalize = (text: string) => {
        for (const [ id, label ] of labels) {
            text = text.split(id).join(`<${label}>`);
        }
        // A link to a path the archive lacks gets an ID no note carries, generated afresh per import.
        text = text.replace(/(#root\/)([A-Za-z0-9_]{12})(?![A-Za-z0-9_])/g, (_match, prefix: string, id: string) => {
            const label = dangling.get(id) ?? `<dangling-${dangling.size}>`;
            dangling.set(id, label);
            return `${prefix}${label}`;
        });
        return text.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{4})/g, "<date>");
    };

    return {
        tree: describeNote(root, normalize, labels),
        markdown: await exportEntries(root, "markdown", normalize),
        html: await exportEntries(root, "html", normalize)
    };
}

function labelTree(root: BNote) {
    const labels = new Map<string, string>();
    const visit = (note: BNote, label: string) => {
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
            visit(child, `${label}/${index}`);
        }
    };

    visit(root, "R");

    return labels;
}

function describeNote(note: BNote, normalize: (text: string) => string, labels: Map<string, string>): Record<string, unknown> {
    const describeContent = (content: string | Uint8Array | null) => {
        if (content === null) {
            return null;
        }
        return typeof content === "string" ? normalize(content) : `binary:${content.length}:${md5(content)}`;
    };

    return {
        path: labels.get(note.noteId),
        title: note.title,
        type: note.type,
        mime: note.mime,
        content: describeContent(note.getContent()),
        attributes: note.getOwnedAttributes().map((attr) => ({
            type: attr.type,
            name: attr.name,
            value: normalize(attr.value),
            isInheritable: attr.isInheritable,
            position: attr.position
        })),
        attachments: note.getAttachments().map((attachment) => ({
            role: attachment.role,
            mime: attachment.mime,
            title: attachment.title,
            content: describeContent(attachment.getContent())
        })),
        children: note.getChildNotes().map((child) => describeNote(child, normalize, labels))
    };
}

function countNotes(tree: Record<string, unknown>): number {
    const children = tree.children as Record<string, unknown>[];

    return 1 + children.reduce((total, child) => total + countNotes(child), 0);
}

async function exportEntries(root: BNote, format: "markdown" | "html", normalize: (text: string) => string) {
    const branch = root.getParentBranches()[0];
    const taskContext = new TaskContext("no-progress-reporting", "export", null);
    const destination = new PassThrough();
    const chunks: Buffer[] = [];
    const ended = new Promise<void>((resolve, reject) => {
        destination.on("end", () => resolve());
        destination.on("error", reject);
    });

    destination.on("data", (chunk: Buffer) => chunks.push(chunk));
    await zipExportService.exportToZip(taskContext, branch, format, destination, false);
    await ended;

    return Object.entries(unzipSync(new Uint8Array(Buffer.concat(chunks)))).map(([ name, bytes ]) => {
        const text = new TextDecoder("utf-8").decode(bytes);

        return {
            name: normalize(name),
            content: text.includes("�") ? `binary:${bytes.length}:${md5(bytes)}` : normalize(text)
        };
    });
}

/**
 * Markdown and HTML notes spread over nested folders, with front matter, tables, task lists in
 * custom states, admonitions, footnotes, code, links between notes and an image they reference.
 * About one note in ten is short enough to convert in this process.
 */
function buildArchive(count: number): Uint8Array {
    const files: Record<string, Uint8Array> = {
        "Import/Reference/pixel.png": PNG_BYTES
    };

    for (let index = 0; index < count; index++) {
        const folder = FOLDERS[index % FOLDERS.length];
        const depth = folder.split("/").length;
        const up = "../".repeat(depth);
        const short = index % 10 === 0;

        if (index % 3 === 2) {
            files[`Import/${folder}/Page ${index}.html`] = strToU8(htmlNote(index, up, short));
        } else {
            files[`Import/${folder}/Note ${index}.md`] = strToU8(markdownNote(index, up, short));
        }
    }

    return zipSync(files);
}

function markdownNote(index: number, up: string, short: boolean): string {
    const frontmatter = `---\ntitle: Note ${index}\ntags: [batch, n${index % 7}]\npriority: ${index % 4}\n---\n`;

    if (short) {
        return `${frontmatter}Short note ${index} with **bold**.\n`;
    }

    const body = `# Note ${index}

Intro with **bold**, *italic*, \`code\`, ünïcödé ✓ and a [link to note 1](${up}Projects/Beta/Deep/Note 1.md).

![pixel](${up}Reference/pixel.png)

| Item | Qty | Note |
|:-----|----:|:----:|
| apples | ${index} | fresh |
| pipe \\| cell | 2 | <br> |

- [ ] open
- [x] done
- [/] doing
  - nested
    1. ordered

> [!WARNING]
> Admonition ${index}

Footnote reference[^f${index}].

\`\`\`python
print("${index}" < "<script>")
\`\`\`

<p onclick="x()">raw html</p><script>alert(${index})</script>

[^f${index}]: The footnote.
`;

    return frontmatter + body.repeat(2);
}

function htmlNote(index: number, up: string, short: boolean): string {
    if (short) {
        return `<html><body><p>Short page ${index}</p></body></html>`;
    }

    const body = `<h1>Page ${index}</h1><h2 style="color:red">Section</h2>
<p>Text <strong>bold</strong> <a href="${up}Reference/Note 3.md">to note 3</a> <a href="javascript:alert(1)">bad</a>
<img src="${up}Reference/pixel.png" onerror="alert(1)"></p>
<ul><li>one<ul><li>two</li></ul></li></ul>
<figure class="table"><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>${index}</td></tr></tbody></table></figure>
<pre><code class="language-text-x-python">x = ${index}</code></pre>
<details class="trilium-collapsible"><summary>More</summary><p>hidden</p></details>
<iframe src="https://evil.example"></iframe><script>alert(${index})</script>`;

    return `<html><head><title>Page ${index}</title></head><body>${body}${body}</body></html>`;
}

const PNG_BYTES = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
    0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
]);
