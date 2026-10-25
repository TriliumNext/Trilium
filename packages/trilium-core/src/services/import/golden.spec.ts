import { strToU8, zipSync } from "fflate";
import fs from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type BNote from "../../becca/entities/bnote.js";
import { captureContentJobEnv } from "../content_jobs/env.js";
import { type ContentJobExecutor, initContentJobExecutor } from "../content_jobs/executor.js";
import { type ContentJob, runContentJob } from "../content_jobs/jobs.js";
import { getContext } from "../context.js";
import noteService from "../notes.js";
import { getSql } from "../sql/index.js";
import sql_init from "../sql_init.js";
import TaskContext from "../task_context.js";
import { md5 } from "../utils/index.js";
import enex from "./enex.js";
import single from "./single.js";
import zip from "./zip.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const samplesDir = join(scriptDir, "samples");

describe("import golden output", () => {
    beforeAll(async () => {
        sql_init.initializeDb();
        await sql_init.dbReady;
    });

    for (const safeImport of [ false, true ]) {
        describe(`safeImport=${safeImport}`, () => {
            for (const [ name, build ] of Object.entries(ZIP_FIXTURES)) {
                it(`zip: ${name}`, async () => {
                    const result = await importZipFixture(build(), { textImportedAsText: true, safeImport });
                    expect(result).toMatchSnapshot();
                });
            }

            for (const fileName of listSamples(".zip")) {
                it(`zip sample: ${fileName}`, async () => {
                    const result = await importZipFixture(readSample(fileName), { textImportedAsText: true, safeImport });
                    expect(result).toMatchSnapshot();
                });
            }

            for (const [ fileName, buffer ] of singleFixtures()) {
                it(`single: ${fileName}`, async () => {
                    const result = await importSingleFixture(fileName, buffer, { textImportedAsText: true, safeImport });
                    expect(result).toMatchSnapshot();
                });
            }
        });
    }

    for (const fileName of listSamples(".enex")) {
        it(`enex sample: ${fileName}`, async () => {
            expect(await importEnexFixture(fileName, readSample(fileName))).toMatchSnapshot();
        });
    }

    describe("with a content job executor in another process", () => {
        afterEach(() => {
            initContentJobExecutor();
            vi.restoreAllMocks();
        });

        it("zip: converts out of order but saves the golden tree, never inside a transaction", async () => {
            const fixtures = [ ...Object.values(ZIP_FIXTURES).map((build) => build()), readSample("silverbullet.zip") ];
            const transactionDepth = trackTransactionDepth();
            for (const safeImport of [ false, true ]) {
                for (const buffer of fixtures) {
                    const taskData = { textImportedAsText: true, safeImport };
                    const expected = await importZipFixture(buffer, taskData);

                    const executor = shuffledExecutor();
                    initContentJobExecutor(executor);
                    const actual = await importZipFixture(buffer, taskData);
                    initContentJobExecutor();

                    expect(withoutParent(actual)).toEqual(withoutParent(expected));
                    expect(executor.calls.filter((job) => job.kind === "prepareNoteText").length).toBeGreaterThan(0);
                    expect(executor.calls.every((job) => !("env" in job) || isEqualEnv(job.env))).toBe(true);
                    expect(executor.depthsAtCall.concat(executor.depthsAtResult).every((depth) => depth === 0)).toBe(true);
                    expect(transactionDepth.max).toBeGreaterThan(0);
                }
            }
        });

        it("enex: pauses the parser while the queue is above the high-water mark", async () => {
            const notes = Array.from({ length: 40 }, (_, index) => `Note ${index}`);
            const buffer = strToU8(enexOf(notes));
            const expected = await importEnexFixture("Many.enex", buffer);

            const sax = (await import("sax")).default;
            let parsed = 0;
            let saved = 0;
            let maxQueue = 0;
            const executor = shuffledExecutor(1);
            const createNewNote = noteService.createNewNote;
            vi.spyOn(noteService, "createNewNote").mockImplementation((params) => {
                if (notes.includes(params.title)) {
                    saved++;
                }
                return createNewNote(params);
            });
            const write = sax.SAXParser.prototype.write;
            vi.spyOn(sax.SAXParser.prototype, "write").mockImplementation(function (this: InstanceType<typeof sax.SAXParser>, ...args: unknown[]) {
                const chunk = typeof args[0] === "string" ? args[0] : null;
                const result = write.call(this, chunk);
                parsed += (chunk ?? "").split("</note>").length - 1;
                maxQueue = Math.max(maxQueue, parsed - saved);
                return result;
            });
            initContentJobExecutor(executor);
            const actual = await importEnexFixture("Many.enex", buffer);

            expect(withoutParent(actual)).toEqual(withoutParent(expected));
            expect(executor.calls.filter((job) => job.kind === "enexNoteContent")).toHaveLength(notes.length);
            // A concurrency of 1 gives a high-water mark of 4. The count also includes the note just
            // parsed and the one whose save waits for its content job.
            expect(maxQueue).toBeGreaterThanOrEqual(4);
            expect(maxQueue).toBeLessThanOrEqual(6);
        });
    });
});

/**
 * An executor that answers every job after a pseudo-random delay, so that jobs started in one order
 * finish in another. It records the depth of `getSql().transactional()` when a job starts and ends.
 */
function shuffledExecutor(concurrency?: number) {
    let seed = 42;
    const nextDelay = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed % 5;
    };
    const calls: ContentJob[] = [];
    const depthsAtCall: number[] = [];
    const depthsAtResult: number[] = [];
    const executor: ContentJobExecutor = {
        concurrency,
        async run(job) {
            calls.push(job);
            depthsAtCall.push(currentTransactionDepth);
            await new Promise((resolve) => setTimeout(resolve, nextDelay()));
            const result = await runContentJob(structuredClone(job));
            depthsAtResult.push(currentTransactionDepth);
            return structuredClone(result);
        }
    };
    return Object.assign(executor, { calls, depthsAtCall, depthsAtResult });
}

let currentTransactionDepth = 0;

/** The import's outcome without the parent note, whose title differs per import. */
function withoutParent(result: Awaited<ReturnType<typeof importZipFixture>>) {
    return { error: result.error, children: result.tree.children };
}

function trackTransactionDepth() {
    const sql = getSql();
    const transactional = sql.transactional.bind(sql);
    const stats = { max: 0 };
    vi.spyOn(sql, "transactional").mockImplementation((func) => {
        currentTransactionDepth++;
        stats.max = Math.max(stats.max, currentTransactionDepth);
        try {
            return transactional(func);
        } finally {
            currentTransactionDepth--;
        }
    });
    return stats;
}

function isEqualEnv(env: unknown) {
    return JSON.stringify(env) === JSON.stringify(captureContentJobEnv());
}

function enexOf(titles: string[]) {
    const notes = titles.map((title) => `<note><title>${title}</title><created>20200101T000000Z</created>
<content><![CDATA[<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note><div>${title}</div><ul><ul><li>nested</li></ul></ul><script>x()</script></en-note>]]></content>
</note>`).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<en-export export-date="20260101T000000Z" application="Evernote" version="11">
${notes}
</en-export>`;
}

async function importZipFixture(buffer: Uint8Array, taskData: Record<string, unknown>) {
    return importUnderFreshParent(async (taskContext, parent) => {
        await zip.importZip(taskContext, buffer, parent);
    }, taskData);
}

async function importEnexFixture(fileName: string, buffer: Uint8Array | string) {
    return importUnderFreshParent(async (taskContext, parent) => {
        await enex.importEnex(taskContext, { originalname: fileName, mimetype: "application/enex+xml", buffer }, parent);
        // `importEnex` starts `asyncPostProcessContent` without awaiting it.
        await new Promise((resolve) => setTimeout(resolve, 10));
    }, {});
}

async function importSingleFixture(fileName: string, buffer: Uint8Array, taskData: Record<string, unknown>) {
    return importUnderFreshParent(async (taskContext, parent) => {
        await single.importSingleFile(taskContext, { originalname: fileName, mimetype: "application/octet-stream", buffer }, parent);
    }, taskData);
}

/**
 * Imports under a new parent note and returns the parent's subtree with every generated note and
 * attachment ID replaced by the path it was given in the tree. An import that throws records the
 * message alongside the partial tree it left behind.
 */
async function importUnderFreshParent(
    run: (taskContext: TaskContext<"importNotes">, parent: BNote) => Promise<void>,
    taskData: Record<string, unknown>
) {
    taskCounter++;
    const taskContext = TaskContext.getInstance(`golden-import-${taskCounter}`, "importNotes", taskData);
    return getContext().init(async () => {
        const { note: parent } = noteService.createNewNote({
            parentNoteId: "root",
            title: `golden-${taskCounter}`,
            content: "",
            type: "text"
        });
        let error: string | undefined;
        try {
            await run(taskContext, parent);
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        }
        return { error, tree: snapshotSubtree(parent) };
    });
}

let taskCounter = 0;

/** A deterministic description of a note subtree: generated IDs become paths in the tree. */
function snapshotSubtree(root: BNote) {
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
    assignLabels(root, "R");

    const dangling = new Map<string, string>();
    const normalize = (text: string) => {
        for (const [ id, label ] of labels) {
            text = text.split(id).join(`<${label}>`);
        }
        // Links to a path the archive lacks point at an ID no note carries.
        return text.replace(/(#root\/|api\/images\/|api\/attachments\/|data-note-id=")([A-Za-z0-9_]{12})(?![A-Za-z0-9_])/g, (_match, prefix: string, id: string) => {
            let label = dangling.get(id);
            if (!label) {
                label = `<dangling-${dangling.size}>`;
                dangling.set(id, label);
            }
            return `${prefix}${label}`;
        });
    };
    const describeContent = (content: string | Uint8Array | null) => {
        if (content === null) {
            return null;
        }
        return typeof content === "string" ? normalize(content) : `binary:${content.length}:${md5(content)}`;
    };

    const visited = new Set<string>();
    const describeNote = (note: BNote, label: string): Record<string, unknown> => {
        const branch = note.getParentBranches().find((b) => labels.get(b.parentNoteId) === label.replace(/\/\d+$/, ""));
        const base = {
            path: label,
            title: normalize(note.title),
            prefix: branch?.prefix ?? null,
            notePosition: branch?.notePosition,
            isExpanded: branch?.isExpanded
        };
        if (visited.has(note.noteId)) {
            return { ...base, cloneOf: `<${labels.get(note.noteId)}>` };
        }
        visited.add(note.noteId);
        return {
            ...base,
            type: note.type,
            mime: note.mime,
            isProtected: note.isProtected,
            content: describeContent(note.getContent()),
            attributes: note.getOwnedAttributes().map((attr) => ({
                type: attr.type,
                name: normalize(attr.name),
                value: normalize(attr.value),
                isInheritable: attr.isInheritable,
                position: attr.position
            })),
            attachments: note.getAttachments().map((attachment) => ({
                role: attachment.role,
                mime: attachment.mime,
                title: normalize(attachment.title),
                position: attachment.position,
                content: describeContent(attachment.getContent())
            })),
            children: note.getChildNotes().map((child, index) => describeNote(child, `${label}/${index}`))
        };
    };
    return describeNote(root, "R");
}

function listSamples(extension: string) {
    return fs.readdirSync(samplesDir).filter((name) => name.endsWith(extension)).sort();
}

function readSample(fileName: string) {
    return new Uint8Array(fs.readFileSync(join(samplesDir, fileName)));
}

function zipOf(files: Record<string, string | Uint8Array>) {
    const entries: Record<string, Uint8Array> = {};
    for (const [ name, content ] of Object.entries(files)) {
        entries[name] = typeof content === "string" ? strToU8(content) : content;
    }
    return zipSync(entries);
}

const PNG_BYTES = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
    0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
]);

const RICH_MARKDOWN = `# Child B

A paragraph with **bold**, _italic_ and \`code\`.

| Name | Value |
| ---- | ----- |
| a    | 1     |
| b    | 2     |

- [x] done item
- [ ] open item
- [/] doing item
- [?] maybe item

> [!NOTE]
> An admonition.

\`\`\`javascript
const x = 1;
\`\`\`

<details><summary>More</summary>

Hidden text.

</details>

See [Child A](Child%20A.html) and [external](https://example.com).

<script>alert("md")</script>
`;

const CHILD_A_HTML = `<html><head><title data-trilium-title>Child A</title></head><body>
<div class="content"><h1 data-trilium-h1>Child A</h1><div class="ck-content">
<h1>Child A</h1><h1>Other heading</h1>
<p>Link to <a href="Child%20B.md">B</a>, <a href="https://example.com">external</a> and <a href="#root/abc">path</a>.</p>
<p><img src="Child%20A_image.png"></p>
<script>alert(1)</script><p onclick="steal()">clickable</p>
<figure class="table"><table><tbody><tr><td>1</td><td>2</td></tr></tbody></table></figure>
<ul class="todo-list"><li><label class="todo-list__label"><input type="checkbox" checked="checked" disabled="disabled"><span class="todo-list__label__description">done</span></label></li></ul>
<details class="trilium-collapsible"><summary>Sum</summary><p>Body</p></details>
<section class="include-note" data-note-id="childA000001" data-box-size="medium">&nbsp;</section>
<pre><code class="language-text-x-python">print("hi")</code></pre>
</div></div></body></html>`;

const ZIP_FIXTURES: Record<string, () => Uint8Array> = {
    "Trilium export with meta": () => zipOf({
        "!!!meta.json": JSON.stringify({
            formatVersion: 2,
            appVersion: "0.0.0",
            files: [ {
                noteId: "rootNote0001",
                notePath: [ "rootNote0001" ],
                title: "Root Note",
                notePosition: 10,
                prefix: null,
                isExpanded: true,
                type: "text",
                mime: "text/html",
                format: "html",
                dataFileName: "Root Note.html",
                dirFileName: "Root Note",
                attributes: [
                    { type: "label", name: "foo", value: "bar<b>x</b>", isInheritable: false, position: 10 },
                    { type: "label", name: "run", value: "frontendStartup", isInheritable: false, position: 20 },
                    { type: "relation", name: "template", value: "bookNote0001", isInheritable: false, position: 30 },
                    { type: "relation", name: "includeNoteLink", value: "childA000001", isInheritable: false, position: 40 }
                ],
                attachments: [],
                children: [
                    {
                        noteId: "childA000001",
                        notePath: [ "rootNote0001", "childA000001" ],
                        title: "Child A",
                        notePosition: 10,
                        type: "text",
                        mime: "text/html",
                        format: "html",
                        dataFileName: "Child A.html",
                        attributes: [ { type: "relation", name: "includeNoteLink", value: "childA000001", isInheritable: false, position: 10 } ],
                        attachments: [ {
                            attachmentId: "attImage0001",
                            title: "image.png",
                            role: "image",
                            mime: "image/png",
                            position: 10,
                            dataFileName: "Child A_image.png"
                        } ]
                    },
                    {
                        noteId: "childB000001",
                        notePath: [ "rootNote0001", "childB000001" ],
                        title: "Child B",
                        notePosition: 20,
                        type: "text",
                        mime: "text/markdown",
                        format: "markdown",
                        dataFileName: "Child B.md",
                        attributes: [],
                        attachments: []
                    },
                    {
                        noteId: "bookNote0001",
                        notePath: [ "rootNote0001", "bookNote0001" ],
                        title: "Book",
                        notePosition: 30,
                        type: "book",
                        mime: "",
                        format: "html",
                        dataFileName: "Book.html",
                        attributes: [],
                        attachments: []
                    },
                    {
                        noteId: "codeNote0001",
                        notePath: [ "rootNote0001", "codeNote0001" ],
                        title: "Code",
                        notePosition: 40,
                        type: "code",
                        mime: "application/javascript;env=frontend",
                        dataFileName: "Code.js",
                        attributes: [],
                        attachments: []
                    },
                    {
                        noteId: "childA000001",
                        notePath: [ "rootNote0001", "childA000001" ],
                        isClone: true,
                        title: "Child A",
                        notePosition: 50,
                        prefix: "clone",
                        dataFileName: "Child A.clone.html"
                    }
                ]
            } ]
        }),
        "Root Note.html": "<p>Root body</p><section class=\"include-note\" data-note-id=\"childA000001\">&nbsp;</section>",
        "Root Note/Child A.html": CHILD_A_HTML,
        "Root Note/Child A_image.png": PNG_BYTES,
        "Root Note/Child B.md": RICH_MARKDOWN,
        "Root Note/Book.html": "<p>book <img src=x onerror=alert(1)></p><h1>Book</h1>",
        "Root Note/Code.js": "console.log('<b>not html</b>');",
        "Root Note/Child A.clone.html": "<p>clone</p>"
    }),
    "folder of Markdown with front matter": () => zipOf({
        "Folder/Note.md": "---\ntitle: Ignored\ntags:\n  - one\n  - two\nauthor: Someone\n---\n# Note\n\nBody with [deep](sub/Deep.md).\n",
        "Folder/Plain.html": "<html><body><h1>Plain</h1><h1>Second</h1><p>text</p><iframe src=\"https://evil\"></iframe></body></html>",
        "Folder/sub/Deep.md": "Deep body linking [up](../Note.md) and ![pic](../Pic.png)\n\n- [x] task\n",
        "Folder/data.json": "{\"a\": 1}",
        "Folder/Pic.png": PNG_BYTES,
        "Folder/notes.txt": "plain <text>"
    }),
    "Obsidian vault without a fallback": () => zipOf({
        "Vault/.obsidian/app.json": "{}",
        "Vault/Vault Note.md": "Links to [[Other]] and ![[image.png]]\n\n> [!warning] Careful\n> Text\n",
        "Vault/Other.md": "---\naliases: [o]\n---\nOther body\n",
        "Vault/image.png": PNG_BYTES
    })
};

function singleFixtures(): [ string, Uint8Array ][] {
    return [
        [ "Rich.md", strToU8(RICH_MARKDOWN) ],
        [ "Front matter.md", strToU8("---\ntags: [a, b]\nstatus: draft\n---\n# Front matter\n\nBody\n") ],
        [ "Page.html", strToU8(CHILD_A_HTML) ],
        [ "Text Note.mdx", readSample("Text Note.mdx") ],
        [ "UTF-16LE Text Note.md", readSample("UTF-16LE Text Note.md") ],
        [ "IREN Reports Q2 FY25 Results.htm", readSample("IREN Reports Q2 FY25 Results.htm") ]
    ];
}
