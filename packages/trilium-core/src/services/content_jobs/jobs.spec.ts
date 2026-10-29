import { DEFAULT_TASK_STATES, MULTICOLUMN_COLUMN_CLASS, MULTICOLUMN_LAYOUT_CLASS, type TaskStateDef } from "@triliumnext/commons";
import fs from "fs";
import html from "html";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";

import becca from "../../becca/becca.js";
import markdownExportService from "../export/markdown.js";
import { extractEnexNoteContent } from "../import/enex_converter.js";
import markdownImportService from "../import/markdown.js";
import { prepareNoteText } from "../import/note_text.js";
import { convertOfficeToHtml } from "../office_preview.js";
import { sanitizeHtml } from "../sanitizer.js";
import { getSql } from "../sql/index.js";
import { type ContentJobEnv, setContentJobEnvProvider } from "./env.js";
import { initContentJobExecutor } from "./executor.js";
import { type ContentJob, runContentJob } from "./jobs.js";

const CUSTOM_TASK_STATES: TaskStateDef[] = [
    ...DEFAULT_TASK_STATES,
    { id: "_custom", name: "waiting", title: "Waiting", markdownSymbol: "w", isCompleted: false, color: "#123456", icon: "bx bx-time" }
];

const ENV: ContentJobEnv = {
    allowedHtmlTags: [ "p", "h2", "h3", "strong", "em", "ul", "ol", "li", "a", "table", "thead", "tbody", "tr", "th", "td", "figure",
        "pre", "code", "details", "summary", "aside", "div", "input", "label", "span", "img", "blockquote" ],
    taskStates: CUSTOM_TASK_STATES
};

const RICH_HTML = `<h2>Title</h2>
<figure class="table"><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></figure>
<figure class="table"><table><tbody><tr><td>headerless</td></tr></tbody></table></figure>
<ul class="todo-list"><li data-trilium-task-state="waiting" title="Waiting"><label class="todo-list__label"><input type="checkbox" disabled="disabled"><span class="todo-list__label__description">wait</span></label></li></ul>
<details class="trilium-collapsible"><summary>S</summary><p>hidden</p></details>
<div class="${MULTICOLUMN_LAYOUT_CLASS}"><div class="${MULTICOLUMN_COLUMN_CLASS}"><p>a</p></div><div class="${MULTICOLUMN_COLUMN_CLASS}"><p>b</p></div></div>
<pre><code class="language-text-x-python">print(1)</code></pre>
<aside class="admonition tip"><p>Tip</p></aside>`;

const RICH_MARKDOWN = `# Title

| A | B |
|---|---|
| 1 | 2 |

- [w] waiting
- [/] doing
- [x] done

> [!TIP]
> Admonition

\`\`\`python
print(1)
\`\`\`

<details><summary>S</summary>

hidden

</details>
`;

const MALICIOUS_HTML = `<p onclick="x()">a</p><script>alert(1)</script><img src="x" onerror="y()"><iframe src="https://e"></iframe>
<a href="javascript:alert(1)">l</a><h1>H</h1><marquee>m</marquee>`;

const ENEX_CONTENT = `<?xml version="1.0"?><!DOCTYPE en-note><en-note><div>Body</div><ul><ul><li>n</li></ul></ul>
<div style="--en-codeblock:true"><div>code</div></div><div style="--en-task-group:true;--en-id:g1"></div></en-note>`;

describe("content jobs", () => {
    afterEach(() => {
        initContentJobExecutor();
        vi.restoreAllMocks();
    });

    it("each job gives what the direct call gives, and its input and result survive structuredClone", async () => {
        const rtf = new TextEncoder().encode(String.raw`{\rtf1\ansi Hello {\b World}}`);
        const cases: [ ContentJob, () => unknown ][] = [];
        for (const env of [ ENV, { ...ENV, allowedHtmlTags: [ "p" ] } ]) {
            for (const markdown of [ RICH_MARKDOWN, "plain *text*", "" ]) {
                cases.push([
                    { kind: "markdownToHtml", markdown, title: "Title", env },
                    () => markdownImportService.renderToHtml(markdown, "Title", { taskStates: env.taskStates, allowedTags: env.allowedHtmlTags })
                ]);
            }
            cases.push([
                { kind: "markdownToHtml", markdown: "[[Link]] and ==mark==", title: "T", obsidian: true, env },
                () => markdownImportService.renderToHtml("[[Link]] and ==mark==", "T", { obsidian: true, taskStates: env.taskStates, allowedTags: env.allowedHtmlTags })
            ]);
            for (const source of [ MALICIOUS_HTML, RICH_HTML ]) {
                cases.push([
                    { kind: "sanitizeHtml", html: source, env },
                    () => sanitizeHtml(source, env.allowedHtmlTags)
                ]);
            }
            cases.push([
                { kind: "enexNoteContent", content: ENEX_CONTENT, tasks: [ { title: "Task", status: "completed", groupId: "g1" } ], env },
                () => extractEnexNoteContent(ENEX_CONTENT, [ { title: "Task", status: "completed", groupId: "g1" } ], env.allowedHtmlTags)
            ]);
            for (const input of [
                { content: `---\ntags: [a]\n---\n${RICH_MARKDOWN}`, title: "Title", extractFrontmatter: true, renderMarkdown: true, isTextLike: true, safeImport: true },
                { content: `<html><body><h1 data-trilium-h1>T</h1><h1>T</h1><h1>U</h1>${MALICIOUS_HTML}</body></html>`, title: "T", extractFrontmatter: false, renderMarkdown: false, isTextLike: true, safeImport: false },
                { content: MALICIOUS_HTML, title: "T", extractFrontmatter: false, renderMarkdown: false, isTextLike: true, safeImport: true }
            ]) {
                cases.push([ { kind: "prepareNoteText", input, env }, () => prepareNoteText(input, env) ]);
            }
        }
        for (const headerlessTables of [ undefined, "emptyHeader" as const ]) {
            cases.push([
                { kind: "htmlToMarkdown", html: RICH_HTML, headerlessTables, env: ENV },
                () => markdownExportService.toMarkdown(RICH_HTML, { headerlessTables, taskStates: ENV.taskStates })
            ]);
        }
        cases.push([ { kind: "prettyPrintHtml", html: RICH_HTML }, () => html.prettyPrint(RICH_HTML, { indent_size: 2 }) ]);
        cases.push([
            { kind: "officeToHtml", bytes: rtf, mime: "application/rtf", options: {} },
            () => convertOfficeToHtml(rtf, "application/rtf", {})
        ]);

        for (const [ job, direct ] of cases) {
            const cloned = structuredClone(job);
            expect(cloned).toEqual(job);
            const result = await runContentJob(cloned);
            expect(result).toEqual(await direct());
            expect(structuredClone(result)).toEqual(result);
        }
    });

    it("honors the custom task states and allowed tags carried by the job", async () => {
        const html = await runContentJob({ kind: "markdownToHtml", markdown: "- [w] waiting", title: "", env: ENV });
        expect(html).toContain(`data-trilium-task-state="waiting"`);
        const markdown = await runContentJob({ kind: "htmlToMarkdown", html: RICH_HTML, env: ENV });
        expect(markdown).toContain("- [w] wait");
        const sanitized = await runContentJob({ kind: "sanitizeHtml", html: "<p>p</p><h3>h</h3>", env: { ...ENV, allowedHtmlTags: [ "p" ] } });
        expect(sanitized).toBe("<p>p</p>h");
    });

    it("reads nothing from becca, SQL or the options while it runs", async () => {
        setContentJobEnvProvider({
            allowedHtmlTags: () => { throw new Error("read the allowedHtmlTags option"); },
            taskStates: () => { throw new Error("read the task states"); }
        });
        const forbidden = (name: string) => new Proxy({}, { get: () => { throw new Error(`read becca.${name}`); } });
        const notes = becca.notes;
        const options = becca.options;
        const sql = getSql();
        for (const method of [ "getRows", "getRow", "getRowOrNull", "getValue", "getColumn", "execute", "transactional" ] as const) {
            vi.spyOn(sql, method).mockImplementation(() => { throw new Error(`called getSql().${method}()`); });
        }
        Object.assign(becca, { notes: forbidden("notes"), options: forbidden("options") });
        try {
            await runContentJob({ kind: "markdownToHtml", markdown: RICH_MARKDOWN, title: "Title", env: ENV });
            await runContentJob({ kind: "htmlToMarkdown", html: RICH_HTML, env: ENV });
            await runContentJob({ kind: "prettyPrintHtml", html: RICH_HTML });
            await runContentJob({ kind: "sanitizeHtml", html: MALICIOUS_HTML, env: ENV });
            await runContentJob({ kind: "enexNoteContent", content: ENEX_CONTENT, tasks: [], env: ENV });
            await runContentJob({ kind: "prepareNoteText", input: { content: RICH_MARKDOWN, title: "T", extractFrontmatter: true, renderMarkdown: true, isTextLike: true, safeImport: true }, env: ENV });
            await runContentJob({ kind: "officeToHtml", bytes: new TextEncoder().encode(String.raw`{\rtf1 x}`), mime: "application/rtf", options: {} });
        } finally {
            Object.assign(becca, { notes, options });
        }
    });

    it("imports nothing that reaches becca, SQL or the options", () => {
        const visited = collectStaticImports(path.join(path.dirname(fileURLToPath(import.meta.url)), "jobs.ts"));
        const reached = [ ...visited ].map((file) => file.split(path.sep).join("/"));
        expect(reached.filter((file) => /\/becca\/|\/sql\/|\/options\.ts$|\/task_states\.ts$|\/notes\.ts$/.test(file))).toEqual([]);
        expect(reached.some((file) => file.endsWith("/sanitizer.ts"))).toBe(true);
    });
});

/** Follows the relative value imports (static and dynamic) of a module, the way a bundle would. */
function collectStaticImports(entry: string, visited = new Set<string>()) {
    if (visited.has(entry)) {
        return visited;
    }
    visited.add(entry);
    const source = fs.readFileSync(entry, "utf8");
    const specifiers = [
        ...source.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+"(\.[^"]+)"/gms),
        ...source.matchAll(/import\(\s*"(\.[^"]+)"\s*\)/g)
    ].map((match) => match[1]);
    for (const specifier of specifiers) {
        const base = path.resolve(path.dirname(entry), specifier);
        const resolved = [ base, base.replace(/\.js$/, ".ts"), `${base}.ts`, path.join(base, "index.ts") ]
            .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        if (resolved) {
            collectStaticImports(resolved, visited);
        }
    }
    return visited;
}
