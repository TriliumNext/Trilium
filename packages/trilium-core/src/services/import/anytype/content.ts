/**
 * Anytype block tree → Trilium/CKEditor HTML rendering.
 *
 * An object's `snapshot.data.blocks` is a flat list joined into a tree by each block's `childrenIds`.
 * {@link extractContent} walks that tree from the root in document order and converts each block to HTML —
 * headings (`<h2>`/`<h3>`/`<h4>`), bullet/numbered/task lists (grouped and nested), toggles, callouts,
 * quotes, dividers, tables ({@link renderTable}), Mermaid diagrams / LaTeX math ({@link renderLatexBlock})
 * and cross-page reference links — applying inline marks ({@link renderInlineText}) and rendering code
 * blocks ({@link renderCodeBlock}). It returns the HTML plus the Trilium ids of every linked-to page (for
 * the `internalLink` relations). The structure importer (importer.ts) owns object selection and the note
 * tree; it calls into here. Mirrors the Notion importer's `converter.ts`.
 */

import { getMimeTypeFromMarkdownName, MIME_TYPE_AUTO, normalizeMimeTypeForCKEditor } from "@triliumnext/commons/src/lib/mime_type.js";

import { escapeHtml } from "../../utils/index.js";
import type { AnytypeBlock, AnytypeMark, LinkResolver } from "./model.js";

/**
 * Converts the page's block tree to HTML. A sequence of sibling blocks is rendered in document order, with
 * consecutive list items of the same kind grouped into a single `<ul>`/`<ol>`/todo-list and a list item's
 * children nested inside its `<li>`. Other blocks become a code block, a heading (`<h2>`/`<h3>`/`<h4>`), a
 * cross-page reference link or a `<p>`, with inline marks applied. The `header` subtree
 * (title/description/featuredRelations chrome) is skipped, as are the structural Title and Description
 * styles wherever they appear. The de-duplicated Trilium ids of every linked-to page are returned
 * alongside the HTML so the caller can record the `internalLink` relations.
 */
export function extractContent(blocks: AnytypeBlock[], rootId: string, resolveLink: LinkResolver): { html: string; linkTargetIds: string[]; fileTargetIds: string[] } {
    const byId = new Map<string, AnytypeBlock>();
    for (const block of blocks) {
        byId.set(block.id, block);
    }

    const root = (rootId ? byId.get(rootId) : undefined) ?? blocks[0];
    if (!root) {
        return { html: "", linkTargetIds: [], fileTargetIds: [] };
    }

    const visited = new Set<string>();
    const linkTargetIds = new Set<string>();
    const addLink = (noteId: string) => linkTargetIds.add(noteId);
    // The FileObject ids the body embeds inline (image/file blocks), so the importer can tell which exported
    // files a page already references — and, for a collection-scoped export, which are unreferenced members.
    const fileTargetIds = new Set<string>();

    // Renders a run of sibling ids, grouping consecutive same-kind list items into one list. The header
    // chrome and already-visited blocks (a node reachable twice) are skipped.
    function renderSequence(ids: string[]): string {
        const parts: string[] = [];
        let i = 0;
        while (i < ids.length) {
            const id = ids[i];
            const block = id === "header" || visited.has(id) ? undefined : byId.get(id);
            if (!block) {
                i++;
                continue;
            }

            const kind = listKind(block);
            if (kind) {
                const run: AnytypeBlock[] = [];
                while (i < ids.length) {
                    const candidate = visited.has(ids[i]) ? undefined : byId.get(ids[i]);
                    if (!candidate || listKind(candidate) !== kind) {
                        break;
                    }
                    visited.add(ids[i]);
                    run.push(candidate);
                    i++;
                }
                parts.push(renderList(kind, run));
            } else {
                visited.add(id);
                parts.push(renderLeaf(block));
                i++;
            }
        }
        return parts.join("");
    }

    function renderList(kind: ListKind, items: AnytypeBlock[]): string {
        const body = items.map((item) => renderItem(kind, item)).join("");
        if (kind === "task") {
            return `<ul class="todo-list">${body}</ul>`;
        }
        return kind === "ol" ? `<ol>${body}</ol>` : `<ul>${body}</ul>`;
    }

    function renderItem(kind: ListKind, item: AnytypeBlock): string {
        const text = renderInlineText(item.text?.text ?? "", item.text?.marks?.marks ?? [], resolveLink, addLink);
        const nested = renderSequence(item.childrenIds ?? []);
        if (kind === "task") {
            // CKEditor's read-only todo-list markup (matches the markdown importer's checkbox output).
            const checkbox = `<input type="checkbox"${item.text?.checked ? 'checked="checked" ' : ""}disabled="disabled">`;
            return `<li><label class="todo-list__label">${checkbox}<span class="todo-list__label__description">${text}</span></label>${nested}</li>`;
        }
        return `<li>${text}${nested}</li>`;
    }

    function renderLeaf(block: AnytypeBlock): string {
        // A divider block (Line or Dots) — both become a horizontal rule.
        if (block.div) {
            return "<hr>";
        }

        // A block-level "link to object" → a reference link to the imported target note. An unresolved
        // target (a set, or an object missing from the export) is dropped, along with its relation.
        if (block.link) {
            const target = block.link.targetBlockId ? resolveLink(block.link.targetBlockId) : undefined;
            if (!target) {
                return "";
            }
            linkTargetIds.add(target.noteId);
            return `<p><a class="reference-link" href="#root/${target.noteId}">${escapeHtml(target.title)}</a></p>`;
        }

        // A file/media block — an embedded image or attached file (PDF, audio, …). The placeholder carries
        // the linked FileObject's id in the `src`/`href`; the importer resolves it to a saved attachment
        // once the note (and thus the attachment) exists — an inline image for an Image, a reference link
        // for any other file type. A block with no target (still uploading, or a broken reference) is dropped.
        if (block.file) {
            const targetId = block.file.targetObjectId;
            if (!targetId) {
                return "";
            }
            fileTargetIds.add(targetId);
            if (block.file.type === "Image") {
                return `<figure class="image"><img src="${escapeHtml(targetId)}"></figure>`;
            }
            const name = (block.file.name ?? "").trim() || targetId;
            return `<p><a class="anytype-file" href="${escapeHtml(targetId)}">${escapeHtml(name)}</a></p>`;
        }

        // A LaTeX block — a Mermaid diagram or LaTeX math.
        if (block.latex) {
            return renderLatexBlock(block.latex.text ?? "", block.latex.processor);
        }

        // A table block: render its columns/rows/cells subtree directly. Returning here skips the generic
        // child walk below, which would otherwise emit every cell's text as a stray paragraph after the table.
        if (block.table) {
            return renderTable(block, byId, resolveLink, addLink);
        }

        // Use the raw text (not trimmed) so mark offsets stay aligned; only the emptiness test trims.
        const rawText = block.text?.text ?? "";
        const style = block.text?.style;
        const marks = block.text?.marks?.marks ?? [];

        if (style === "Toggle") {
            // A normal toggle becomes a Trilium collapsible block: its label is the summary, its children
            // the collapsed body. (Toggle *headings* fall through to a normal heading below, via tagForStyle.)
            return `<details class="trilium-collapsible"><summary>${renderInlineText(rawText, marks, resolveLink, addLink)}</summary>${renderSequence(block.childrenIds ?? [])}</details>`;
        }

        if (style === "Quote") {
            // Anytype's Highlight block (internal style "Quote") → a blockquote; its background tint is dropped.
            const firstPara = rawText.trim() ? `<p>${renderInlineText(rawText, marks, resolveLink, addLink)}</p>` : "";
            return `<blockquote>${firstPara}${renderSequence(block.childrenIds ?? [])}</blockquote>`;
        }

        if (style === "Callout") {
            // A callout becomes a Trilium admonition. Following the Notion importer: the default icon (no
            // custom emoji) maps to a "tip" with the icon dropped; any custom emoji maps to a "note" with
            // the emoji kept at the start of the body (admonitions have no per-block icon).
            const emoji = block.text?.iconEmoji ?? "";
            const type = emoji ? "note" : "tip";
            // Escape the emoji like every other piece of user text here — it's interpolated raw into the
            // markup, so an export carrying markup in this field would otherwise inject it.
            const lead = [escapeHtml(emoji), renderInlineText(rawText, marks, resolveLink, addLink)].filter(Boolean).join(" ");
            const firstPara = lead ? `<p>${lead}</p>` : "";
            return `<aside class="admonition ${type}">${firstPara}${renderSequence(block.childrenIds ?? [])}</aside>`;
        }

        let html = "";
        if (rawText.trim() && style !== "Title" && style !== "Description") {
            if (style === "Code") {
                // A code block is literal: no inline marks, and its language is preserved as the MIME.
                html = renderCodeBlock(rawText, block.fields?.lang);
            } else {
                const tag = tagForStyle(style);
                html = `<${tag}>${renderInlineText(rawText, marks, resolveLink, addLink)}</${tag}>`;
            }
        }
        // A non-list block's children (e.g. a toggle heading's collapsed content) follow as flattened siblings.
        return html + renderSequence(block.childrenIds ?? []);
    }

    // The root block is the page container and carries no text of its own — start from its children.
    const html = renderSequence(root.childrenIds ?? []);
    return { html, linkTargetIds: [...linkTargetIds], fileTargetIds: [...fileTargetIds] };
}

/** The kind of list a block belongs to (bullet/ordered/task), or null when it isn't a list item. */
type ListKind = "ul" | "ol" | "task";
function listKind(block: AnytypeBlock): ListKind | null {
    switch (block.text?.style) {
        case "Marked":
            return "ul";
        case "Numbered":
            return "ol";
        case "Checkbox":
            return "task";
        default:
            return null;
    }
}

/**
 * Maps an Anytype text-block style to the Trilium tag it becomes. Anytype's three in-body heading levels
 * (UI-labelled Title / Heading / Subheading) map to Trilium's top three heading levels: Trilium reserves
 * `<h1>` for the note title, so its body headings start at `<h2>`. Toggle headings collapse to the same
 * plain headings (their toggle nature is dropped). Every other non-list style (paragraphs, quotes,
 * callouts, …) is flattened to a paragraph for now.
 */
function tagForStyle(style: string | undefined): string {
    switch (style) {
        case "Header1":
        case "ToggleHeader1":
            return "h2";
        case "Header2":
        case "ToggleHeader2":
            return "h3";
        case "Header3":
        case "ToggleHeader3":
            return "h4";
        default:
            return "p";
    }
}

// #region Inline marks
const MARK_TAGS: Record<string, string> = {
    Bold: "strong",
    Italic: "em",
    Underscored: "u",
    Strikethrough: "s",
    Keyboard: "code"
};

// Anytype's system colour palette (`--color-tag-*` / `--color-bg-tag-*`); marks carry the name in `param`.
// Backgrounds are already opaque, so no flatten-over-white step is needed (unlike Notion's translucent set).
const TEXT_COLORS: Record<string, string> = {
    grey: "#8c9ea5", yellow: "#b2a616", orange: "#d3720d", red: "#e2400c", pink: "#ca1b8e",
    purple: "#9e30c4", blue: "#3e58eb", ice: "#1c8bca", teal: "#0caaa3", lime: "#64b90f"
};
const BG_COLORS: Record<string, string> = {
    grey: "#e3e3e3", yellow: "#f4eb91", orange: "#fcdc9c", red: "#fcd1c3", pink: "#f8c2e5",
    purple: "#e8d0f1", blue: "#cbd2fa", ice: "#b2dff9", teal: "#a9ebe6", lime: "#c5efa3"
};

// Anytype's default (light-theme) text colour. A highlight (background) without an explicit text colour is
// paired with this so the text stays readable on the pale highlight regardless of the Trilium theme —
// otherwise a dark theme's default white text would be invisible on it.
const DEFAULT_TEXT_COLOR = "#252525";

// Outer-to-inner nesting order for the structural marks that cover the same segment — fixed so output is
// deterministic. Colours are handled separately (folded into a single inner span).
const MARK_ORDER = ["Bold", "Italic", "Underscored", "Strikethrough", "Keyboard"];

interface AppliedMark {
    type: string;
    param: string;
    from: number;
    to: number;
    /** For a resolved `Mention`, the reference-link href (`#root/<noteId>`) its span wraps. */
    href?: string;
}

/**
 * Converts a text block's inline marks into HTML. Anytype encodes formatting as a flat list of marks, each
 * a `[from, to)` character range (UTF-16 offsets) with a type — and marks may overlap freely. We turn that
 * into valid nested HTML by splitting the text at every mark boundary, so no segment straddles a mark edge,
 * then wrapping each segment in the tags whose range fully covers it. Adjacent segments always differ in
 * their active set (a boundary is only created where a mark starts or ends), so output is clean without a
 * merge pass. An inline `Mention` (a link to another object, its target id in `param`) becomes a Trilium
 * reference link around its span when `resolveLink` maps the target to an imported note — and the note id is
 * surfaced via `onLink` so the caller records the `internalLink` relation; an unresolved mention (or no
 * resolver — parsing in isolation) leaves the text plain. Emoji are ignored, leaving their text as plain
 * (escaped) content.
 *
 * Inline math is handled first: Anytype stores an inline formula as literal `$…$` (or display `$$…$$`) text
 * with no mark, so {@link splitInlineFormulas} peels those runs out and emits them as CKEditor math spans —
 * the surrounding text (and any marks over it) is rendered normally around them.
 */
export function renderInlineText(text: string, marks: AnytypeMark[], resolveLink?: LinkResolver, onLink?: (noteId: string) => void): string {
    const formulas = splitInlineFormulas(text);
    if (formulas.length === 0) {
        return renderMarkedText(text, marks, resolveLink, onLink);
    }

    // Render the non-formula slices (with their marks, offset back to local coordinates) interleaved with the
    // math spans, in document order.
    let html = "";
    let cursor = 0;
    const renderSlice = (start: number, end: number) => {
        if (end <= start) {
            return;
        }
        const sliceMarks = marks
            .map((m) => ({ ...m, range: { from: (m.range?.from ?? 0) - start, to: (m.range?.to ?? 0) - start } }))
            .filter((m) => m.range.to > 0 && m.range.from < end - start);
        html += renderMarkedText(text.slice(start, end), sliceMarks, resolveLink, onLink);
    };
    for (const formula of formulas) {
        renderSlice(cursor, formula.from);
        html += renderInlineFormula(formula.body, formula.display);
        cursor = formula.to;
    }
    renderSlice(cursor, text.length);
    return html;
}

/** Renders a text run's inline marks to HTML (no formula handling — {@link renderInlineText} peels those off first). */
function renderMarkedText(text: string, marks: AnytypeMark[], resolveLink?: LinkResolver, onLink?: (noteId: string) => void): string {
    const length = text.length;

    // Keep only marks we render (known structural kind, a known colour name, or a resolvable mention link),
    // with offsets clamped to the text and empty/reversed ranges dropped.
    const applicable: AppliedMark[] = [];
    for (const mark of marks) {
        const param = mark.param ?? "";
        const from = Math.max(0, Math.min(length, mark.range?.from ?? 0));
        const to = Math.max(0, Math.min(length, mark.range?.to ?? 0));
        if (from >= to) {
            continue;
        }
        if (mark.type === "Mention") {
            // An inline link to another object → a reference link, when its target was imported.
            const target = param && resolveLink ? resolveLink(param) : undefined;
            if (target) {
                applicable.push({ type: "Mention", param, from, to, href: `#root/${target.noteId}` });
                onLink?.(target.noteId);
            }
            continue;
        }
        if (mark.type === undefined || !isRenderable(mark.type, param)) {
            continue;
        }
        applicable.push({ type: mark.type, param, from, to });
    }

    if (applicable.length === 0) {
        return escapeHtml(text);
    }

    // Split at every mark boundary so each segment is uniformly covered (or not) by each mark.
    const boundaries = new Set<number>([0, length]);
    for (const mark of applicable) {
        boundaries.add(mark.from);
        boundaries.add(mark.to);
    }
    const points = [...boundaries].sort((a, b) => a - b);

    let html = "";
    for (let i = 0; i < points.length - 1; i++) {
        const start = points[i];
        const end = points[i + 1];
        const covering = applicable.filter((mark) => mark.from <= start && mark.to >= end);
        html += wrapSegment(escapeHtml(text.slice(start, end)), covering);
    }

    return html;
}

/** Whether a mark is rendered: a known structural kind, or a colour with a known palette name. */
function isRenderable(type: string, param: string): boolean {
    if (type in MARK_TAGS) {
        return true;
    }
    if (type === "TextColor") {
        return param in TEXT_COLORS;
    }
    if (type === "BackgroundColor") {
        return param in BG_COLORS;
    }
    return false;
}

/**
 * Wraps one segment in the tags of the marks that fully cover it. Text and background colour fold into a
 * single innermost `<span>` (a highlight without a text colour gets the default dark text); the structural
 * marks then nest around it, Bold outermost per {@link MARK_ORDER}; a covering mention link wraps the whole
 * thing as the outermost reference-link anchor.
 */
function wrapSegment(segment: string, covering: AppliedMark[]): string {
    const textColor = paletteValue(covering, "TextColor", TEXT_COLORS);
    const bgColor = paletteValue(covering, "BackgroundColor", BG_COLORS);

    const styleParts: string[] = [];
    if (textColor) {
        styleParts.push(`color:${textColor}`);
    } else if (bgColor) {
        styleParts.push(`color:${DEFAULT_TEXT_COLOR}`);
    }
    if (bgColor) {
        styleParts.push(`background-color:${bgColor}`);
    }
    let html = styleParts.length > 0 ? `<span style="${styleParts.join(";")}">${segment}</span>` : segment;

    const structural = covering.filter((mark) => mark.type in MARK_TAGS).sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
    for (let i = structural.length - 1; i >= 0; i--) {
        const tag = MARK_TAGS[structural[i].type];
        html = `<${tag}>${html}</${tag}>`;
    }

    const mention = covering.find((mark) => mark.type === "Mention");
    if (mention?.href) {
        html = `<a class="reference-link" href="${mention.href}">${html}</a>`;
    }

    return html;
}

/** The palette value for the segment's mark of the given colour type, or undefined if none covers it. */
function paletteValue(covering: AppliedMark[], type: string, palette: Record<string, string>): string | undefined {
    const mark = covering.find((candidate) => candidate.type === type);
    return mark ? palette[mark.param] : undefined;
}
// #endregion

// #region Code blocks
// PrismJS language ids Anytype uses that don't line up with a Trilium markdown language code. Most ids
// (javascript, python, go, rust, …) match directly; only the mismatches need listing here. `clike` is
// PrismJS's generic C-family base, mapped to plain C as the closest concrete language.
const LANGUAGE_ALIASES: Record<string, string> = {
    clike: "c"
};

/**
 * Renders an Anytype `Code`-style block as a Trilium/CKEditor code block. Anytype tags the block with a
 * PrismJS language id in `fields.lang`; we map that to a Trilium MIME and emit it as the CKEditor
 * code-block language class (`language-<normalized-mime>`), the same shape the markdown importer produces.
 * Quotes are left literal (matching the markdown importer), and an unknown language falls back to
 * auto-detect.
 */
export function renderCodeBlock(text: string, lang: string | undefined): string {
    return `<pre><code class="language-${codeLanguage(lang)}">${escapeHtml(text).replace(/&quot;/g, '"')}</code></pre>`;
}

/** The CKEditor code-block language class value for an Anytype language id, or auto-detect when unknown. */
function codeLanguage(lang: string | undefined): string {
    if (lang) {
        const mimeDefinition = getMimeTypeFromMarkdownName(LANGUAGE_ALIASES[lang] ?? lang);
        if (mimeDefinition) {
            return normalizeMimeTypeForCKEditor(mimeDefinition.mime);
        }
    }
    return MIME_TYPE_AUTO;
}
// #endregion

// #region LaTeX & Mermaid
/**
 * Renders an Anytype `latex` block. With the `Mermaid` processor it becomes a `language-mermaid` code block —
 * Trilium's mermaid rendering keys off that class (the same convention the Notion importer uses), and the
 * browser decodes the escaped diagram text back when reading it. Any other processor is treated as LaTeX
 * math, emitted as a CKEditor display-math span (`<span class="math-tex">\[ … \]</span>`). Empty text is dropped.
 */
export function renderLatexBlock(text: string, processor: string | undefined): string {
    if (!text.trim()) {
        return "";
    }
    const escaped = escapeHtml(text).replace(/&quot;/g, '"');
    if (processor === "Mermaid") {
        return `<pre><code class="language-mermaid">${escaped}</code></pre>`;
    }
    return `<span class="math-tex">\\[ ${escaped} \\]</span>`;
}

/**
 * Finds the inline-math runs in a text block. Anytype carries an inline formula as literal `$…$` (inline) or
 * `$$…$$` (display) text with no mark. The delimiter rules mirror Trilium's markdown renderer: a delimiter
 * `$`/`$$` may not sit next to another `$` (so `${VAR}` and mismatched `$$x$` stay literal) and the body may
 * not contain a `$` or a blank line. Ranges are returned in document order with their original offsets.
 */
function splitInlineFormulas(text: string): { from: number; to: number; body: string; display: boolean }[] {
    const pattern = /(?<![\\$])\$\$(?!\$)((?:(?!\n{2,})[^$])+?)\$\$(?!\$)|(?<![\\$])\$(?!\$)([^$\n]+?)\$(?!\$)/g;
    const formulas: { from: number; to: number; body: string; display: boolean }[] = [];
    for (const match of text.matchAll(pattern)) {
        const display = match[1] !== undefined;
        formulas.push({ from: match.index, to: match.index + match[0].length, body: display ? match[1] : match[2], display });
    }
    return formulas;
}

/** Renders one inline formula as a CKEditor math span (display `\[ … \]` or inline `\( … \)`), body escaped. */
function renderInlineFormula(body: string, display: boolean): string {
    const escaped = escapeHtml(body).replace(/&quot;/g, '"');
    return display ? `<span class="math-tex">\\[ ${escaped} \\]</span>` : `<span class="math-tex">\\( ${escaped} \\)</span>`;
}
// #endregion

// #region Tables
/**
 * Renders an Anytype table block to Trilium/CKEditor table HTML. An Anytype table's two children are a
 * `TableColumns` layout (its ordered column ids) and a `TableRows` layout (its rows); each row's cells are
 * text blocks whose id is `${rowId}-${columnId}`, and a row omits its empty cells. We walk the columns in
 * order and, for each row, place that column's cell (blank when absent) so the grid stays aligned. A row
 * flagged `isHeader` becomes `<th scope="col">` in a `<thead>`; the rest are `<td>` in the `<tbody>`. The
 * table is wrapped in `<figure class="table">`, the shape CKEditor stores (mirroring the Notion importer).
 * `resolveLink`/`onLink` are passed through to cell text so an inline mention in a cell becomes a reference
 * link (and records its `internalLink`), like anywhere else.
 */
export function renderTable(table: AnytypeBlock, byId: Map<string, AnytypeBlock>, resolveLink?: LinkResolver, onLink?: (noteId: string) => void): string {
    const [colsLayoutId, rowsLayoutId] = table.childrenIds ?? [];
    const columnIds = (colsLayoutId ? byId.get(colsLayoutId)?.childrenIds : undefined) ?? [];
    const rowIds = (rowsLayoutId ? byId.get(rowsLayoutId)?.childrenIds : undefined) ?? [];
    if (columnIds.length === 0 || rowIds.length === 0) {
        return "";
    }

    const headRows: string[] = [];
    const bodyRows: string[] = [];
    for (const rowId of rowIds) {
        const row = byId.get(rowId);
        if (!row) {
            continue;
        }
        const isHeader = !!row.tableRow?.isHeader;
        // Index this row's cells by their column-id suffix (cell id = `${rowId}-${columnId}`).
        const cellByColumn = new Map<string, AnytypeBlock>();
        for (const cellId of row.childrenIds ?? []) {
            const cell = byId.get(cellId);
            if (cell && cellId.startsWith(`${rowId}-`)) {
                cellByColumn.set(cellId.slice(rowId.length + 1), cell);
            }
        }
        const tag = isHeader ? "th" : "td";
        const scope = isHeader ? ' scope="col"' : "";
        const cells = columnIds
            .map((columnId) => {
                const cell = cellByColumn.get(columnId);
                const content = cell ? renderInlineText(cell.text?.text ?? "", cell.text?.marks?.marks ?? [], resolveLink, onLink) : "";
                return `<${tag}${scope}>${content}</${tag}>`;
            })
            .join("");
        (isHeader ? headRows : bodyRows).push(`<tr>${cells}</tr>`);
    }

    const thead = headRows.length > 0 ? `<thead>${headRows.join("")}</thead>` : "";
    const tbody = bodyRows.length > 0 ? `<tbody>${bodyRows.join("")}</tbody>` : "";
    return `<figure class="table"><table>${thead}${tbody}</table></figure>`;
}
// #endregion
