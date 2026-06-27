/**
 * Post-processes a Notion page's body HTML into Trilium/CKEditor-friendly markup.
 *
 * Notion's export HTML carries its own block conventions (to-do lists, callouts, toggles, …) that don't
 * match what CKEditor expects. This module applies a pipeline of transforms to bridge the two. It runs
 * before sanitization, so it may emit any markup the sanitizer subsequently allows.
 *
 * Each feature is a small, independently-tested transform; {@link convertNotionHtml} chains them. The
 * transforms below are ordered to match that pipeline, each grouped in its own `#region`.
 */

import { getMimeTypeFromMarkdownName, MIME_TYPE_AUTO, normalizeMimeTypeForCKEditor } from "@triliumnext/commons";
import { HTMLElement, parse } from "node-html-parser";

import { getNotionId } from "./notion_id.js";

export function convertNotionHtml(html: string): string {
    const root = parse(html);
    convertMath(root);
    stripDatePrefixes(root);
    convertTodoLists(root);
    convertToggles(root);
    convertToggleHeadings(root);
    dropTableOfContents(root);
    unwrapDisplayContents(root);
    convertInlineDatabases(root);
    mergeFragmentedLists(root);
    convertColumns(root);
    convertTables(root);
    convertImages(root);
    convertAttachments(root);
    convertCodeBlocks(root);
    convertCallouts(root);
    convertBookmarks(root);
    convertColors(root);
    convertLinkToPage(root);
    return root.toString();
}

// #region Math
/**
 * Notion renders each equation with KaTeX, preceded (or, for block equations, wrapped) by a
 * `<style>@import …katex…</style>` whose text would otherwise survive sanitization as visible junk. Drop
 * those style blocks, then recover the original LaTeX from each equation's KaTeX
 * `<annotation encoding="application/x-tex">` and emit Trilium's math markup:
 *  - inline equations (`span.notion-text-equation-token`) → inline math span, `\(…\)`;
 *  - block equations (`figure.equation`) → a `<figure>` wrapping a display math span, `\[…\]`.
 */
function convertMath(root: HTMLElement) {
    for (const style of root.querySelectorAll("style")) {
        style.remove();
    }

    for (const token of root.querySelectorAll("span.notion-text-equation-token")) {
        const latex = extractLatex(token);
        if (!latex) {
            continue;
        }
        token.insertAdjacentHTML("beforebegin", `<span class="math-tex">\\(${latex}\\)</span>`);
        token.remove();
    }

    for (const figure of root.querySelectorAll("figure.equation")) {
        const latex = extractLatex(figure);
        if (!latex) {
            continue;
        }
        figure.insertAdjacentHTML("beforebegin", `<figure><span class="math-tex">\\[${latex}\\]</span></figure>`);
        figure.remove();
    }
}

/** Recovers the original LaTeX from a KaTeX subtree via its `<annotation encoding="application/x-tex">`. */
function extractLatex(el: HTMLElement): string | undefined {
    const annotations = el.querySelectorAll("annotation");
    return (annotations.find((a) => a.getAttribute("encoding") === "application/x-tex") ?? annotations[0])?.textContent?.trim();
}
// #endregion

// #region Date mentions
/**
 * Notion prefixes its inline date mentions with "@" (e.g. `<time>@June 21, 2026</time>`). Strip it so the
 * imported text reads naturally, mirroring how the importer already handles property-row date metadata.
 */
function stripDatePrefixes(root: HTMLElement) {
    for (const time of root.querySelectorAll("time")) {
        const text = time.textContent;
        if (text?.includes("@")) {
            time.set_content(text.replace(/@/g, ""));
        }
    }
}
// #endregion

// #region To-do lists
/**
 * Notion renders every to-do item as its own `<ul class="to-do-list">` (each wrapped in a
 * `display:contents` `<div>`), whose `<li>` holds a `<div class="checkbox checkbox-on|off">`, a
 * `<span class="to-do-children-…">` label and a `<div class="indented">` carrying any sub-items.
 *
 * Rewrite each maximal run of adjacent to-do items within `container` into a single CKEditor
 * `<ul class="todo-list">`, mapping checkbox-on to a checked input. Sub-items are converted recursively
 * and emitted as a nested `<ul class="todo-list">` inside the parent `<li>`. Runs broken by other
 * content stay separate lists.
 */
function convertTodoLists(container: HTMLElement) {
    for (const run of collectTodoRuns(container)) {
        const items = run.flatMap(({ ul }) => directChildren(ul, "li").map((li) => buildTodoItem(li)));
        run[0].block.insertAdjacentHTML("beforebegin", `<ul class="todo-list">${items.join("")}</ul>`);
        for (const { block } of run) {
            block.remove();
        }
    }

    // To-do lists can also sit inside other blocks — a toggle's <details>, a callout, a list item, a
    // table cell — which the run pass above (limited to `container`'s direct children) doesn't reach.
    // Recurse into the remaining element children so those are converted in place too. The just-built
    // `todo-list`s are visited harmlessly: they hold no `to-do-list` markup for the run pass to match.
    for (const child of container.childNodes) {
        if (child instanceof HTMLElement) {
            convertTodoLists(child);
        }
    }
}

interface TodoBlock {
    /** The container's direct child to replace — the wrapping `display:contents` div, or the `ul` itself. */
    block: HTMLElement;
    ul: HTMLElement;
}

/** Groups a container's direct children into maximal runs of adjacent to-do blocks (ignoring whitespace). */
function collectTodoRuns(container: HTMLElement): TodoBlock[][] {
    const runs: TodoBlock[][] = [];
    let current: TodoBlock[] | null = null;

    for (const node of container.childNodes) {
        if (node instanceof HTMLElement) {
            const ul = todoUl(node);
            if (ul) {
                if (!current) {
                    current = [];
                    runs.push(current);
                }
                current.push({ block: node, ul });
                continue;
            }
            current = null;
        } else if (node.toString().trim() !== "") {
            // A non-whitespace text/comment node breaks the run; whitespace between wrappers does not, so
            // that Notion's one-item-per-list wrappers still merge.
            current = null;
        }
    }

    return runs;
}

function buildTodoItem(li: HTMLElement): string {
    const checked = directChild(li, (n) => n.classList.contains("checkbox"))?.classList.contains("checkbox-on") ?? false;
    const label = directChild(li, (n) => isTag(n, "span")
        && (n.classList.contains("to-do-children-checked") || n.classList.contains("to-do-children-unchecked")));
    const description = label?.innerHTML ?? "";

    // A to-do item's sub-items live in its `.indented`; convert them in place and nest the result inside
    // this `<li>` (CKEditor's nested-list shape). Empty when there are none.
    const indented = directChild(li, (n) => n.classList.contains("indented"));
    let nested = "";
    if (indented) {
        convertTodoLists(indented);
        nested = indented.innerHTML.trim();
    }

    // Match the canonical CKEditor data serialization (checked before disabled) so a freshly imported
    // note already equals what the editor would re-emit on its first save.
    const attributes = checked ? ` checked="checked" disabled="disabled"` : ` disabled="disabled"`;
    return `<li><label class="todo-list__label"><input type="checkbox"${attributes}><span class="todo-list__label__description">${description}</span></label>${nested}</li>`;
}

/** Returns the to-do `<ul>` a container child represents — the node itself, or the one `display:contents` wraps. */
function todoUl(node: HTMLElement): HTMLElement | null {
    if (isTodoUl(node)) {
        return node;
    }
    if (isDisplayContents(node)) {
        const elements = node.childNodes.filter((child): child is HTMLElement => child instanceof HTMLElement);
        if (elements.length === 1 && isTodoUl(elements[0])) {
            return elements[0];
        }
    }
    return null;
}

function isTodoUl(node: HTMLElement): boolean {
    return isTag(node, "ul") && node.classList.contains("to-do-list");
}
// #endregion

// #region Toggles
/**
 * Trilium has no list-based toggle; its collapsible block is a bare `<details>`
 * (data view `<details class="trilium-collapsible">`). Notion exports each toggle as
 * `<ul class="toggle"><li><details>…</details></li></ul>`, so drop the list wrapper, hoisting the
 * `<details>` in its place and tagging it with Trilium's collapsible class. Only the toggle's own
 * top-level `<details>` is hoisted; a nested toggle is handled when the loop reaches its own `ul.toggle`,
 * which keeps it nested. Notion's native `open` attribute is preserved so the published/share view
 * reflects the exported expanded/collapsed state (the in-app editor always loads toggles collapsed, and
 * the sanitizer is configured to keep `open` on `details`).
 */
function convertToggles(root: HTMLElement) {
    for (const ul of root.querySelectorAll("ul.toggle")) {
        const detailsList = directChildren(ul, "li").flatMap((li) => directChildren(li, "details"));
        for (const details of detailsList) {
            const existing = details.getAttribute("class");
            details.setAttribute("class", existing ? `${existing} trilium-collapsible` : "trilium-collapsible");
        }
        ul.replaceWith(...detailsList);
    }
}
// #endregion

// #region Toggle headings
/**
 * A Notion *toggle heading* is a collapsible whose title is a heading. Unlike a list toggle it exports as a
 * bare `<details>` (no `ul.toggle` wrapper) whose `<summary>` carries the heading's font-size — the only
 * signal of its level. Trilium's collapsible can't hold a heading in its summary, so flatten each toggle
 * heading into a plain heading: emit an `<hN>` from the summary, then hoist the toggle's body in its place
 * (dropping the `.indented` wrapper Notion nests it in). The level is shifted down one to match how Notion
 * exports ordinary headings — its content "Heading 1" is `<h2>` because the page title takes `<h1>` — so a
 * toggle heading lands at the same level as the equivalent plain heading.
 */
function convertToggleHeadings(root: HTMLElement) {
    for (const details of root.querySelectorAll("details")) {
        const summary = directChild(details, (node) => isTag(node, "summary"));
        const tag = summary ? toggleHeadingTag(summary) : undefined;
        if (!summary || !tag) {
            continue;
        }

        // Unwrap the `.indented` body wrapper so the toggle's content lands at the heading's level, not nested.
        for (const child of [...details.childNodes]) {
            if (child instanceof HTMLElement && child.classList.contains("indented")) {
                child.replaceWith(...child.childNodes);
            }
        }
        details.insertAdjacentHTML("beforebegin", `<${tag}>${summary.innerHTML.trim()}</${tag}>`);
        summary.remove();
        details.replaceWith(...details.childNodes);
    }
}

/** Notion toggle-heading summary font-sizes, mapped to the Trilium heading tag (shifted to match plain headings). */
const TOGGLE_HEADING_TAGS: Record<string, string> = {
    "1.875em": "h2",
    "1.5em": "h3",
    "1.25em": "h4",
    "1.125em": "h5"
};

/** The heading tag a toggle heading's summary encodes via its font-size, or undefined if it isn't a heading. */
function toggleHeadingTag(summary: HTMLElement): string | undefined {
    const fontSize = summary.getAttribute("style")?.match(/font-size:\s*([\d.]+em)/)?.[1];
    return fontSize ? TOGGLE_HEADING_TAGS[fontSize] : undefined;
}
// #endregion

// #region Table of contents
/**
 * Drops Notion's table-of-contents block (`<nav class="table_of_contents">`). It's a generated artifact, not
 * authored content, and Trilium renders its own table of contents from the note's headings — in both the app
 * and the shared view — so the imported one would only be a stale, duplicate list whose `#block-id` anchor
 * links don't resolve in Trilium anyway.
 */
function dropTableOfContents(root: HTMLElement) {
    for (const nav of root.querySelectorAll("nav.table_of_contents")) {
        nav.remove();
    }
}
// #endregion

// #region display:contents wrappers
/**
 * Notion wraps almost every block in a `<div style="display:contents">`, a layout no-op that survives
 * sanitization and would otherwise leave the imported note littered with meaningless block wrappers.
 * Hoist each such div's children in its place; nested wrappers flatten too (querySelectorAll visits the
 * outer first, and the inner stays a live, reparented node). Other divs (callouts, `.indented`, …) are
 * left untouched.
 */
function unwrapDisplayContents(root: HTMLElement) {
    for (const div of root.querySelectorAll("div")) {
        if (isDisplayContents(div)) {
            div.replaceWith(...div.childNodes);
        }
    }
}
// #endregion

// #region Inline databases (collections)
/**
 * Notion renders an inline database as `<div class="collection-content" id="<db-id>">` — holding either a
 * rendered `<table class="collection-content">` (a partial export) or a bare link to the separately-exported
 * CSV (a full/workspace export). Either way the database is imported as its own collection note, so replace
 * the whole block with a Trilium include-note placeholder carrying the database's Notion id. The id is read
 * from the div's `id` (which the sanitizer later strips), and the importer resolves `data-notion-id` to the
 * collection note's id once every note exists; the `data-notion-id`/`data-box-size` attributes and the
 * `section` survive sanitization. A block without a resolvable id is left untouched.
 */
function convertInlineDatabases(root: HTMLElement) {
    for (const block of root.querySelectorAll("div.collection-content")) {
        const notionId = getNotionId(block.getAttribute("id") ?? "");
        if (!notionId) {
            continue;
        }
        block.insertAdjacentHTML("beforebegin", `<section class="include-note" data-notion-id="${notionId}" data-box-size="medium">&nbsp;</section>`);
        block.remove();
    }
}
// #endregion

// #region List fragmentation
/**
 * Notion exports each list item as its own single-item `<ul>`/`<ol>` (so a three-item list is three lists),
 * and fragments nested lists the same way. Merge each fragment into its previous sibling of the same kind —
 * `bulleted-list` with `bulleted-list`, `numbered-list` with `numbered-list` — so a run of fragments becomes
 * one list; document order makes the first fragment accumulate the rest, and nested fragments merge once the
 * outer merge has reparented them. Any other element between two lists keeps them apart (so a paragraph splits
 * a run), and a list never merges across types. The surviving lists are then stripped of Notion's list class
 * and the `start`/`type`/`id` fragmentation artifacts, leaving clean `<ul>`/`<ol>`.
 */
function mergeFragmentedLists(root: HTMLElement) {
    for (const list of root.querySelectorAll("ul.bulleted-list, ol.numbered-list")) {
        const prev = list.previousElementSibling;
        if (prev && prev.tagName === list.tagName && isMergeableList(prev)) {
            for (const item of [...list.childNodes]) {
                prev.appendChild(item);
            }
            list.remove();
        }
    }
    for (const list of root.querySelectorAll("ul.bulleted-list, ol.numbered-list")) {
        for (const attr of ["class", "start", "type", "id"]) {
            list.removeAttribute(attr);
        }
    }
}

/** A Notion bulleted/numbered list — the kinds Notion fragments one item per list, to be merged back together. */
function isMergeableList(el: HTMLElement): boolean {
    return (isTag(el, "ul") && el.classList.contains("bulleted-list"))
        || (isTag(el, "ol") && el.classList.contains("numbered-list"));
}
// #endregion

// #region Columns
/**
 * Notion column layouts (`<div class="column-list">` of `<div class="column" style="width:N%">`) have no
 * Trilium/CKEditor equivalent, so render each as a single-row borderless table — one `<td>` per column,
 * carrying that column's width. Both the table and every cell get `border-color:transparent` so the result
 * reads as side-by-side content rather than a grid, and the width is rounded to two decimals to match
 * CKEditor's column widths. A column that is just a wrapper around a nested column list is flattened (its
 * inner columns join the same row, scaled by the wrapper's share); a column that mixes loose content with a
 * nested list stays one cell, the inner list becoming a nested table inside it so no content is lost.
 */
function convertColumns(root: HTMLElement) {
    for (const columnList of root.querySelectorAll("div.column-list")) {
        if (!columnList.parentNode) {
            continue; // a nested list, already rendered as part of its parent
        }
        columnList.insertAdjacentHTML("beforebegin", columnListToFigure(columnList));
        columnList.remove();
    }
}

/** Renders a column list as the borderless single-row table figure CKEditor stores tables in. */
function columnListToFigure(columnList: HTMLElement): string {
    const cells = flattenColumns(columnList, 100)
        .map(({ width, content }) => `<td style="border-color:transparent;width:${round2(width)}%;">${content}</td>`)
        .join("");
    return `<figure class="table"><table style="border-color:transparent;"><tbody><tr>${cells}</tr></tbody></table></figure>`;
}

/**
 * Flattens a column list into the leaf cells of one row. Each column takes its share of `parentWidth` in
 * proportion to its width among its siblings; a pure wrapper column ({@link pureWrapperList}) contributes its
 * nested list's columns instead — scaled by the wrapper's share — so nested columns collapse into the same
 * row. Every other column is one cell ({@link cellContent}).
 */
function flattenColumns(columnList: HTMLElement, parentWidth: number): { width: number; content: string }[] {
    const columns = directChildren(columnList, "div").filter((column) => column.classList.contains("column"));
    const widths = columns.map((column) => columnWidthValue(column) ?? 100 / columns.length);
    const total = widths.reduce((sum, width) => sum + width, 0) || 1;

    const leaves: { width: number; content: string }[] = [];
    for (const [index, column] of columns.entries()) {
        const share = parentWidth * ((widths[index] ?? 0) / total);
        const wrapped = pureWrapperList(column);
        if (wrapped) {
            leaves.push(...flattenColumns(wrapped, share));
        } else {
            leaves.push({ width: share, content: cellContent(column) });
        }
    }
    return leaves;
}

/** The nested column list a column merely wraps (its sole child apart from empty spacer paragraphs), else null. */
function pureWrapperList(column: HTMLElement): HTMLElement | null {
    const meaningful = column.childNodes.filter((node): node is HTMLElement => node instanceof HTMLElement && !isEmptyParagraph(node));
    const [only] = meaningful;
    return meaningful.length === 1 && only && only.classList.contains("column-list") ? only : null;
}

/** A Notion column's numeric width (`style="width:N%"` → `N`), or undefined when it has none. */
function columnWidthValue(column: HTMLElement): number | undefined {
    const raw = column.getAttribute("style")?.match(/width:\s*([\d.]+)%/)?.[1];
    return raw !== undefined ? parseFloat(raw) : undefined;
}

/** Rounds to at most two decimals (`16.6667` → `16.67`, `50` → `50`). */
function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

/** True for an empty `<p>` (Notion's layout spacers), which shouldn't count as a column's real content. */
function isEmptyParagraph(node: HTMLElement): boolean {
    return isTag(node, "p") && (node.textContent ?? "").trim() === "";
}

/**
 * A column's cell content: a sole `<p>` is unwrapped (so a one-paragraph column is a plain cell); otherwise
 * the column's content is kept as-is, except a nested column list is turned into a nested table so a mixed
 * column (loose content plus a nested list) keeps both.
 */
function cellContent(column: HTMLElement): string {
    const elements = column.childNodes.filter((node): node is HTMLElement => node instanceof HTMLElement);
    const [only] = elements;
    if (elements.length === 1 && only && isTag(only, "p")) {
        return only.innerHTML;
    }
    return column.childNodes
        .map((node) => (node instanceof HTMLElement && node.classList.contains("column-list") ? columnListToFigure(node) : node.toString()))
        .join("");
}
// #endregion

// #region Tables
/**
 * Notion tables are `<table class="simple-table">` with Notion-specific classes, ids and pixel widths on
 * every element, and the `<tr>`s wrapped in `display:contents` divs (already removed by the time this
 * runs). Rewrite each into Trilium's canonical form: strip the Notion attributes, mark header cells with
 * `scope` (col in the head, row in the body), and wrap the table in `<figure class="table">`.
 */
function convertTables(root: HTMLElement) {
    for (const table of root.querySelectorAll("table.simple-table")) {
        stripTableAttributes(table);
        for (const th of table.querySelectorAll("thead th")) {
            th.setAttribute("scope", "col");
        }
        for (const th of table.querySelectorAll("tbody th")) {
            th.setAttribute("scope", "row");
        }
        table.insertAdjacentHTML("beforebegin", `<figure class="table">${table.toString()}</figure>`);
        table.remove();
    }
}

/** Removes Notion's class/id/style from the table and every cell/row/section, keeping colspan/rowspan. */
function stripTableAttributes(table: HTMLElement) {
    const strip = (el: HTMLElement) => {
        el.removeAttribute("class");
        el.removeAttribute("id");
        el.removeAttribute("style");
    };
    strip(table);
    for (const tag of ["thead", "tbody", "tr", "th", "td"]) {
        for (const el of table.querySelectorAll(tag)) {
            strip(el);
        }
    }
}
// #endregion

// #region Images
/**
 * Notion image blocks are `<figure class="image"><a href="…"><img src="…"></a></figure>`, where the
 * `<a>` is a self-link to the file and the `<img>` carries an inline pixel width. Reduce each to Trilium's
 * canonical `<figure class="image"><img src="…"></figure>` (unwrap the link, drop the sizing and the
 * Notion id). The `src` still points at the zip-relative path; the importer rewrites it to an attachment.
 */
function convertImages(root: HTMLElement) {
    for (const figure of root.querySelectorAll("figure.image")) {
        const img = figure.querySelector("img");
        if (!img) {
            continue;
        }
        img.removeAttribute("style");
        figure.removeAttribute("id");
        figure.set_content(img.toString());
    }
}
// #endregion

// #region Attachments
/**
 * Notion file blocks are `<figure><div class="source"><a href="…file">name</a></div></figure>`, where the
 * href is a zip-relative path to the bundled file. Reduce each to a paragraph holding a marked anchor
 * (`<a class="notion-attachment" href="…">`); the importer resolves that file from the zip, saves it as a
 * `role:"file"` attachment on the note and rewrites the anchor into a Trilium attachment reference-link.
 * The marker distinguishes it from page links and bookmarks (whose `source` class sits on the `<a>` itself).
 */
function convertAttachments(root: HTMLElement) {
    for (const figure of root.querySelectorAll("figure")) {
        const anchor = figure.querySelector("div.source a");
        if (!anchor) {
            continue;
        }
        anchor.setAttribute("class", "notion-attachment");
        figure.insertAdjacentHTML("beforebegin", `<p>${anchor.toString()}</p>`);
        figure.remove();
    }
}
// #endregion

// #region Code blocks
/**
 * Notion code blocks ship as `<pre class="code"><code class="language-<prism>">…</code></pre>`, preceded
 * by Prism `<script>`/`<link>` CDN includes. Drop the includes and reduce each block to Trilium's
 * canonical `<pre><code class="language-<mime>">`. The Prism language id is mapped to Trilium's
 * mime-based class via the shared dictionary; unknown or unlabelled languages fall back to auto-detection.
 */
function convertCodeBlocks(root: HTMLElement) {
    for (const tag of ["script", "link"]) {
        for (const el of root.querySelectorAll(tag)) {
            el.remove();
        }
    }

    for (const pre of root.querySelectorAll("pre")) {
        // node-html-parser treats a <pre>'s content as raw text, so re-parse it to reach the <code>.
        const inner = parse(pre.innerHTML);
        const code = inner.querySelector("code");
        if (!code) {
            continue;
        }
        const prismLanguage = (code.getAttribute("class") ?? "").match(/language-(\S+)/)?.[1];

        code.removeAttribute("style");
        code.setAttribute("class", `language-${resolveCodeLanguage(prismLanguage)}`);
        pre.removeAttribute("id");
        pre.removeAttribute("class");
        pre.set_content(inner.toString());
    }
}

/** Resolves a Notion/Prism language id to the class Trilium expects on a code block. */
function resolveCodeLanguage(prismLanguage: string | undefined): string {
    // Mermaid isn't in the MIME dictionary, but Trilium's mermaid rendering keys off `language-mermaid`,
    // so preserve it verbatim (mirroring the shared markdown renderer). Everything else maps to its CKEditor
    // mime class, falling back to auto-detection when the language is unknown or absent.
    if (prismLanguage === "mermaid") {
        return "mermaid";
    }
    const mime = prismLanguage ? getMimeTypeFromMarkdownName(prismLanguage) : undefined;
    return mime ? normalizeMimeTypeForCKEditor(mime.mime) : MIME_TYPE_AUTO;
}
// #endregion

// #region Callouts
/** Notion's default callout icon; it maps 1:1 to a "tip" admonition, so the emoji itself is redundant. */
const DEFAULT_CALLOUT_EMOJI = "💡";

/**
 * Notion callouts are `<figure class="callout">` with an icon div (`<span class="icon">…</span>`) and a
 * content div. Trilium has admonitions, so rewrite each into `<aside class="admonition <type>">`. The
 * default light-bulb maps to a "tip" (the icon is implied, so it's dropped); any other emoji maps to a
 * neutral "note" with the emoji preserved at the start of the content so the information isn't lost.
 *
 * Runs after wrapper-stripping so the content is already clean, and in reverse document order so a nested
 * callout is converted before the callout that contains it.
 */
function convertCallouts(root: HTMLElement) {
    for (const figure of [...root.querySelectorAll("figure.callout")].reverse()) {
        const divs = directChildren(figure, "div");
        const iconDiv = divs.find((div) => (div.getAttribute("style") ?? "").includes("font-size"));
        const contentDiv = divs.find((div) => (div.getAttribute("style") ?? "").replace(/\s/g, "").includes("width:100%")) ?? divs[divs.length - 1];

        const emoji = iconDiv?.querySelector("span.icon")?.textContent?.trim() ?? "";
        const type = emoji === DEFAULT_CALLOUT_EMOJI ? "tip" : "note";
        if (type === "note" && emoji && contentDiv) {
            prependEmoji(contentDiv, emoji);
        }

        figure.insertAdjacentHTML("beforebegin", `<aside class="admonition ${type}">${contentDiv?.innerHTML ?? ""}</aside>`);
        figure.remove();
    }
}

/** Block-level tags a callout's content may open with; an emoji can't be merged inline into these. */
const CALLOUT_BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "blockquote", "pre", "figure", "table", "aside", "details"]);

/**
 * Prepends the callout's emoji to its content. Notion's callout body is usually a run of inline content
 * (raw text, `<strong>`, `<br>`…) with no wrapping paragraph, so the emoji is merged inline so it shares
 * the first line. When the body instead opens with a paragraph the emoji goes inside it; when it opens
 * with another block element (e.g. a heading) the emoji becomes its own leading paragraph.
 */
function prependEmoji(contentDiv: HTMLElement, emoji: string) {
    const firstEl = contentDiv.childNodes[0] instanceof HTMLElement ? contentDiv.childNodes[0] : null;
    if (firstEl && isTag(firstEl, "p")) {
        firstEl.set_content(`${emoji} ${firstEl.innerHTML}`);
    } else if (firstEl && CALLOUT_BLOCK_TAGS.has(firstEl.tagName?.toLowerCase())) {
        contentDiv.insertAdjacentHTML("afterbegin", `<p>${emoji}</p>`);
    } else {
        contentDiv.insertAdjacentHTML("afterbegin", `${emoji} `);
    }
}
// #endregion

// #region Bookmarks
/**
 * Notion bookmark cards are `<figure><a class="bookmark source" href="…"><div class="bookmark-info">…`,
 * carrying a title, description and favicon. Trilium has the equivalent link-embed, so rewrite each into
 * `<section class="link-embed" data-…>` (an open-graph embed). Optional fields are only emitted when the
 * bookmark provides them.
 */
function convertBookmarks(root: HTMLElement) {
    for (const figure of root.querySelectorAll("figure")) {
        const url = figure.querySelector("a.bookmark")?.getAttribute("href");
        if (!url) {
            continue;
        }

        const section = parse(`<section></section>`).querySelector("section");
        /* v8 ignore next 3 -- defensive: parsing a literal "<section>" always yields a matching element */
        if (!section) {
            continue;
        }
        section.setAttribute("class", "link-embed");
        section.setAttribute("data-url", url);
        section.setAttribute("data-embed-type", "opengraph");

        const optional: Record<string, string | undefined> = {
            "data-title": figure.querySelector(".bookmark-title")?.textContent?.trim(),
            "data-description": figure.querySelector(".bookmark-description")?.textContent?.trim(),
            "data-favicon": figure.querySelector("img.bookmark-icon")?.getAttribute("src"),
            "data-image": figure.querySelector("img.bookmark-image")?.getAttribute("src")
        };
        for (const [key, value] of Object.entries(optional)) {
            if (value) {
                section.setAttribute(key, value);
            }
        }

        figure.replaceWith(section);
    }
}
// #endregion

// #region Colors
/**
 * Notion's fixed text/background palette, taken verbatim from the export's stylesheet (the `<style>` block
 * isn't passed to this converter, so the values are inlined here). Text colors are opaque; background
 * colors are translucent overlays that {@link flattenOverWhite} resolves to solid, sanitizer-safe colors.
 */
const NOTION_TEXT_COLORS: Record<string, string> = {
    gray: "rgba(125, 122, 117, 1)",
    brown: "rgba(159, 118, 90, 1)",
    orange: "rgba(210, 123, 45, 1)",
    yellow: "rgba(203, 148, 52, 1)",
    teal: "rgba(80, 148, 110, 1)",
    blue: "rgba(56, 125, 201, 1)",
    purple: "rgba(154, 107, 180, 1)",
    pink: "rgba(193, 76, 138, 1)",
    red: "rgba(207, 81, 72, 1)"
};
const NOTION_BG_COLORS: Record<string, string> = {
    gray: "rgba(42, 28, 0, 0.07)",
    brown: "rgba(139, 46, 0, 0.086)",
    orange: "rgba(224, 101, 1, 0.129)",
    yellow: "rgba(211, 168, 0, 0.137)",
    teal: "rgba(0, 100, 45, 0.09)",
    blue: "rgba(0, 124, 215, 0.094)",
    purple: "rgba(102, 0, 178, 0.078)",
    pink: "rgba(197, 0, 93, 0.086)",
    red: "rgba(223, 22, 0, 0.094)"
};

/**
 * Notion encodes both text and background color as `<mark class="highlight-<color>[_background]">`. Those
 * class names are meaningless to CKEditor (so every colored run collapses to the same default highlight),
 * and `<mark>` itself is CKEditor's highlight marker. Rewrite each into a `<span>` carrying an inline
 * `color`/`background-color` style — CKEditor's font-color form — dropping the wrapper for the `default`
 * (uncolored) variants. Runs in reverse document order so nested marks are resolved innermost-first.
 */
function convertColors(root: HTMLElement) {
    for (const mark of [...root.querySelectorAll("mark")].reverse()) {
        const style = markStyle(mark.getAttribute("class") ?? "");
        mark.insertAdjacentHTML("beforebegin", style ? `<span style="${style}">${mark.innerHTML}</span>` : mark.innerHTML);
        mark.remove();
    }
}

/** Maps a Notion `highlight-*` class to a CKEditor inline color style, or undefined for default/unknown. */
function markStyle(className: string): string | undefined {
    const match = className.match(/highlight-([a-z]+)(_background)?\b/);
    if (!match || match[1] === "default") {
        return undefined;
    }
    const [, name, isBackground] = match;
    const rgba = isBackground ? NOTION_BG_COLORS[name] : NOTION_TEXT_COLORS[name];
    return rgba ? `${isBackground ? "background-color" : "color"}:${flattenOverWhite(rgba)}` : undefined;
}

/** Blends an `rgba(r, g, b, a)` color over a white page into an opaque `rgb(r, g, b)` the sanitizer accepts. */
function flattenOverWhite(rgba: string): string {
    const match = rgba.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
    /* v8 ignore next 3 -- unreachable: only fed well-formed rgba() values from the inlined Notion palette */
    if (!match) {
        return rgba;
    }
    /* v8 ignore next -- the Notion palette always specifies an alpha, so the no-alpha branch is unreachable */
    const alpha = match[4] === undefined ? 1 : Number(match[4]);
    const blend = (channel: string) => Math.round(Number(channel) * alpha + 255 * (1 - alpha));
    return `rgb(${blend(match[1])}, ${blend(match[2])}, ${blend(match[3])})`;
}
// #endregion

// #region Link-to-page blocks
/**
 * Notion's "link to page" block is `<figure class="link-to-page"><a href="…page.html">Title</a></figure>`.
 * Reduce it to a paragraph holding the link; the href still points at the target page's exported file,
 * which the importer resolves to a Trilium internal/reference link once every page has a note.
 */
function convertLinkToPage(root: HTMLElement) {
    for (const figure of root.querySelectorAll("figure.link-to-page")) {
        const anchor = figure.querySelector("a");
        if (!anchor) {
            continue;
        }
        figure.insertAdjacentHTML("beforebegin", `<p>${anchor.toString()}</p>`);
        figure.remove();
    }
}
// #endregion

// #region Shared helpers
function isDisplayContents(node: HTMLElement): boolean {
    return isTag(node, "div") && (node.getAttribute("style") ?? "").replace(/\s/g, "").includes("display:contents");
}

function isTag(node: HTMLElement, tag: string): boolean {
    return node.tagName?.toLowerCase() === tag;
}

function directChild(parent: HTMLElement, predicate: (node: HTMLElement) => boolean): HTMLElement | null {
    for (const node of parent.childNodes) {
        if (node instanceof HTMLElement && predicate(node)) {
            return node;
        }
    }
    return null;
}

function directChildren(parent: HTMLElement, tag: string): HTMLElement[] {
    return parent.childNodes.filter((node): node is HTMLElement => node instanceof HTMLElement && isTag(node, tag));
}
// #endregion
