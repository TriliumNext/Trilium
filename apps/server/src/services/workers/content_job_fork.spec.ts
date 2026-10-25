import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_TASK_STATES, type TaskStateDef } from "@triliumnext/commons";
import type { ContentJobEnv } from "@triliumnext/core/src/services/content_jobs/env.js";
import { type ContentJob, runContentJob } from "@triliumnext/core/src/services/content_jobs/jobs.js";
import { initLog } from "@triliumnext/core/src/services/log.js";
import { afterAll, beforeAll, describe, expect, it, type MockInstance, vi } from "vitest";

import { createPooledContentJobExecutor, type PooledContentJobExecutor } from "./content_job_executor.js";

// Counts the conversions run in this process; the worker processes load the real module.
vi.mock("@triliumnext/core/src/services/content_jobs/jobs.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core/src/services/content_jobs/jobs.js")>();

    return { ...actual, runContentJob: vi.fn(actual.runContentJob) };
});

/**
 * Every kind of content job through real forked workers, compared with the same job run in this
 * process. This is the proof that nothing is lost or altered crossing the process boundary: the
 * spec beside this one pins the executor's semantics through a fake spawner, which a changed
 * message shape or a value structured clone cannot carry would pass.
 */
let executor: PooledContentJobExecutor;
let previousNodeOptions: string | undefined;
let infoSpy: MockInstance<typeof console.info>;
const logged: string[] = [];
const inProcessRuns = vi.mocked(runContentJob);

beforeAll(() => {
    initLog();
    infoSpy = vi.spyOn(console, "info").mockImplementation((line: unknown) => {
        logged.push(String(line));
    });

    // The child is plain Node and the worker entry here is TypeScript, so the loader reaches it
    // through the environment.
    previousNodeOptions = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = [ previousNodeOptions, "--import tsx" ].filter(Boolean).join(" ");

    executor = createPooledContentJobExecutor({ inProcessMaxChars: 0 });
});

afterAll(async () => {
    const started = logged.filter((line) => line.startsWith("Content Jobs: starting a worker")).length;

    executor.shutdown();
    await vi.waitFor(() => {
        expect(logged.filter((line) => / stopped$/.test(line))).toHaveLength(started);
    }, { timeout: 10000 });
    infoSpy.mockRestore();

    if (previousNodeOptions === undefined) {
        delete process.env.NODE_OPTIONS;
    } else {
        process.env.NODE_OPTIONS = previousNodeOptions;
    }
});

describe("content job fork round-trip", () => {
    it("gives every job kind the same result in a real worker as in this process", { timeout: 120000 }, async () => {
        const jobs = buildJobs();
        const kinds = new Set(jobs.map(({ job }) => job.kind));

        expect([ ...kinds ].sort()).toEqual([
            "enexNoteContent", "htmlToMarkdown", "markdownToHtml", "officeToHtml",
            "prepareNoteText", "prettyPrintHtml", "sanitizeHtml"
        ]);

        inProcessRuns.mockClear();

        const offThread = await Promise.all(jobs.map(({ job }) => executor.run(job)));

        // Every result came from a worker; none of the jobs fell back to this process.
        expect(inProcessRuns).not.toHaveBeenCalled();
        expect(logged.some((line) => line.startsWith("Content Jobs: starting a worker"))).toBe(true);

        for (const [ index, { label, job } ] of jobs.entries()) {
            const inProcess = await runContentJob(job);

            expect(offThread[index], label).toEqual(inProcess);

            if (typeof inProcess === "string") {
                expect(inProcess.length, `${label} produced no output`).toBeGreaterThan(0);
            }
        }
    });

    it("rejects with the conversion's own message when a job fails in the worker", { timeout: 60000 }, async () => {
        const job: ContentJob = { kind: "officeToHtml", bytes: new Uint8Array(8), mime: "text/plain", options: {} };
        const inProcess = await runContentJob(job).then(() => "", (error: Error) => error.message);

        expect(inProcess).toMatch(/not a supported office format/);
        inProcessRuns.mockClear();
        await expect(executor.run(job).then(() => "", (error: Error) => error.message)).resolves.toBe(inProcess);
        expect(inProcessRuns).not.toHaveBeenCalled();
    });
});

const CUSTOM_TASK_STATES: TaskStateDef[] = [
    ...DEFAULT_TASK_STATES,
    { id: "_waiting", name: "waiting", title: "Waiting", markdownSymbol: "w", isCompleted: false, color: "#123456", icon: "bx bx-time" },
    { id: "_dropped", name: "dropped", title: "Dropped", markdownSymbol: "~", isCompleted: true, color: "#654321", icon: "bx bx-x" }
];

const ENV: ContentJobEnv = {
    allowedHtmlTags: [ "p", "h2", "h3", "h4", "strong", "em", "s", "u", "sup", "sub", "ul", "ol", "li", "a", "table", "thead",
        "tbody", "tr", "th", "td", "figure", "figcaption", "pre", "code", "details", "summary", "aside", "div", "input", "label",
        "span", "img", "blockquote", "br", "hr", "section" ],
    taskStates: CUSTOM_TASK_STATES
};

const NARROW_ENV: ContentJobEnv = { allowedHtmlTags: [ "p", "a", "ul", "li" ], taskStates: DEFAULT_TASK_STATES };

const SAMPLES_DIR = join(__dirname, "..", "ocr", "processors", "samples");

function buildJobs(): { label: string; job: ContentJob }[] {
    const markdown = bigMarkdown();
    const html = bigHtml();
    const jobs: { label: string; job: ContentJob }[] = [];

    for (const [ envName, env ] of [ [ "wide", ENV ], [ "narrow", NARROW_ENV ] ] as const) {
        jobs.push(
            { label: `markdownToHtml ${envName}`, job: { kind: "markdownToHtml", markdown, title: "Section 0", env } },
            { label: `markdownToHtml obsidian ${envName}`, job: { kind: "markdownToHtml", markdown: `${markdown}\n[[Wiki link]] ==highlight== ![[embed.png]]\n`, title: "T", obsidian: true, env } },
            { label: `sanitizeHtml ${envName}`, job: { kind: "sanitizeHtml", html, env } },
            { label: `enexNoteContent ${envName}`, job: { kind: "enexNoteContent", content: bigEnex(), tasks: ENEX_TASKS, env } },
            { label: `prepareNoteText markdown ${envName}`, job: { kind: "prepareNoteText", env, input: {
                content: `---\ntitle: Imported\ntags: [alpha, beta]\nrating: 4\n---\n${markdown}`,
                title: "Section 0", extractFrontmatter: true, renderMarkdown: true, isTextLike: true, safeImport: true
            } } },
            { label: `prepareNoteText html ${envName}`, job: { kind: "prepareNoteText", env, input: {
                content: `<html><head><title data-trilium-title>T</title></head><body><h1 data-trilium-h1>T</h1><div class="ck-content"><h1>T</h1><h1>Other</h1>${html}</div></body></html>`,
                title: "T", extractFrontmatter: false, renderMarkdown: false, isTextLike: true, safeImport: false
            } } }
        );
    }

    for (const headerlessTables of [ undefined, "emptyHeader" as const ]) {
        jobs.push({ label: `htmlToMarkdown ${headerlessTables}`, job: { kind: "htmlToMarkdown", html, headerlessTables, env: ENV } });
    }

    jobs.push({ label: "prettyPrintHtml", job: { kind: "prettyPrintHtml", html } });

    for (const [ file, mime ] of OFFICE_SAMPLES) {
        const bytes = new Uint8Array(readFileSync(join(SAMPLES_DIR, file)));

        jobs.push({ label: `officeToHtml ${file}`, job: { kind: "officeToHtml", bytes, mime, options: {} } });
    }

    jobs.push(
        { label: "officeToHtml demo.xlsx trimmed", job: {
            kind: "officeToHtml", bytes: new Uint8Array(readFileSync(join(SAMPLES_DIR, "demo.xlsx"))), mime: XLSX_MIME, options: { trim: true }
        } },
        { label: "officeToHtml rtf", job: {
            kind: "officeToHtml", bytes: new TextEncoder().encode(String.raw`{\rtf1\ansi Hello {\b World} \par Second}`), mime: "application/rtf", options: {}
        } }
    );

    return jobs;
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const OFFICE_SAMPLES: [ string, string ][] = [
    [ "demo.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ],
    [ "demo.xlsx", XLSX_MIME ],
    [ "demo.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation" ],
    [ "demo.odt", "application/vnd.oasis.opendocument.text" ],
    [ "embedded_image.odt", "application/vnd.oasis.opendocument.text" ]
];

const ENEX_TASKS = [
    { title: "Buy milk", status: "completed", groupId: "g1" },
    { title: "Call <Bob> & \"Alice\"", status: "open", groupId: "g1" },
    { title: "Ungrouped", status: "open" },
    { title: "Second group", status: "completed", groupId: "g2" }
];

function bigMarkdown(): string {
    const sections: string[] = [];

    for (let index = 0; index < 120; index++) {
        sections.push(`# Section ${index}

Paragraph with **bold**, *italic*, ~~strike~~, \`code\`, a [link](https://example.com/${index}) and a footnote[^n${index}].

| Name | Value | Notes |
|:-----|------:|:-----:|
| row ${index} | ${index * 3} | ünïcödé ✓ |
| pipe \\| escaped | 2 | <br> |

- [ ] open task ${index}
- [x] done task
- [w] waiting on someone
- [~] dropped
- [/] in progress
  - nested item
    1. deep ordered
    2. second

> [!${[ "NOTE", "TIP", "WARNING", "CAUTION", "IMPORTANT" ][index % 5]}]
> Admonition body ${index}

\`\`\`javascript
const x${index} = () => "<script>";
\`\`\`

$E = mc^${index}$ and ![image](images/pic${index}.png "title")

[^n${index}]: Footnote text ${index}.
`);
    }

    return sections.join("\n");
}

function bigHtml(): string {
    const parts: string[] = [];

    for (let index = 0; index < 150; index++) {
        parts.push(`<h2 style="color:red" onclick="steal()">Heading ${index}</h2>
<p class="lead">Text <strong>bold</strong> <em>em</em> <a href="https://example.com/${index}" target="_blank">link</a>
<a href="javascript:alert(${index})">bad</a> <img src="api/images/x${index}/pic.png" onerror="alert(1)" width="20"></p>
<ul><li>one<ul><li>two<ol><li>three</li></ol></li></ul></li><li>four</li></ul>
<ul class="todo-list"><li data-trilium-task-state="waiting" title="Waiting"><label class="todo-list__label"><input type="checkbox" disabled="disabled"><span class="todo-list__label__description">wait ${index}</span></label></li>
<li><label class="todo-list__label"><input type="checkbox" checked="checked" disabled="disabled"><span class="todo-list__label__description">done</span></label></li></ul>
<figure class="table"><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>${index}</td><td>x &amp; y</td></tr></tbody></table></figure>
<figure class="table"><table><tbody><tr><td>headerless ${index}</td></tr></tbody></table></figure>
<pre><code class="language-text-x-python">def f():\n    return "${index}" &lt; 3</code></pre>
<details class="trilium-collapsible"><summary>More</summary><p>hidden ${index}</p></details>
<aside class="admonition warning"><p>Careful ${index}</p></aside>
<script>alert(${index})</script><iframe src="https://evil.example"></iframe><style>p{}</style><marquee>old</marquee>
<blockquote><p>quote &#x2603; ✓</p></blockquote><hr>`);
    }

    return parts.join("\n");
}

function bigEnex(): string {
    const blocks: string[] = [];

    for (let index = 0; index < 120; index++) {
        blocks.push(`<div>Line ${index} <b>bold</b> <span style="font-weight:bold">styled</span></div>
<ul><ul><li>double nested ${index}</li></ul></ul>
<div style="--en-codeblock:true"><div>code line ${index}</div><div>second &lt;tag&gt;</div></div>
<en-media hash="a1b2c3d4e5f6${index}" type="image/png" width="100"/>
<en-todo checked="${index % 2 === 0}"/>todo ${index}<br/>
<table><tr><td>cell ${index}</td></tr></table>`);
    }

    return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note>${blocks.join("\n")}
<div style="--en-task-group:true;--en-id:g1"></div><div style="--en-task-group:true;--en-id:g2"></div></en-note>`;
}
