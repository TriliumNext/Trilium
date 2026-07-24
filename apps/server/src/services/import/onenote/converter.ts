/**
 * Converts a OneNote page (a full HTML document returned by the Graph API) into the HTML body that
 * Trilium stores for a text note: structural normalization followed by sanitization.
 *
 * Background on the normalization: OneNote's content model is paragraph-based (each Enter is a new
 * <p>), but paragraphs render with zero spacing, and OneNote leans on bare <br> elements — including
 * at the BLOCK level, as siblings of <p>/<ol>/<ul> — to create vertical gaps. CKEditor has no place
 * for a block-level <br> (a soft break only lives inside a block) and provides its own inter-block
 * spacing, so importing OneNote's <br>-based spacing verbatim produces doubled gaps and stray empty
 * bullets. We therefore drop block-level <br> spacing and empty list items while preserving genuine
 * in-paragraph soft breaks.
 *
 * Still a first pass: images/attachments (served from authenticated Graph URLs) are not downloaded
 * yet, so embedded media will not render. See the summary for follow-up work.
 *
 * Known unrecoverable loss: paragraph indentation is not preserved. `margin-left`/`text-indent`/
 * `padding-left` are not in the OneNote API's supported output-style set (only background-color,
 * color, font-family, font-size, font-style, font-weight, text-decoration and text-align survive —
 * see https://learn.microsoft.com/en-us/graph/onenote-input-output-html), so Graph emits every
 * paragraph with identical `margin-top:0pt;margin-bottom:0pt` and the indent level never reaches us.
 * No fetch option recovers it; the only indentation Graph keeps is list nesting (ol/ul/li).
 */

import { sanitize, utils } from "@triliumnext/core";
import { HTMLElement, parse } from "node-html-parser";

/**
 * The marker class the importer keys on to find OneNote file attachments (see importer.ts). The href
 * carries the Graph resource URL (a placeholder the importer swaps for a local attachment link) and
 * `data-mime` the original content type.
 */
export const ONENOTE_ATTACHMENT_CLASS = "onenote-attachment";

/** Block containers whose direct <br> children are spacing artifacts rather than soft breaks. */
const BLOCK_CONTAINERS = new Set(["body", "div", "section", "article", "blockquote", "td", "th", "ol", "ul", "dl"]);

/** OneNote uses the CSS alpha keywords; CKEditor (and the sanitizer) use the latin equivalents. */
const LIST_STYLE_MAP = new Map<string, string>([["lower-alpha", "lower-latin"], ["upper-alpha", "upper-latin"]]);

/**
 * OneNote's checkbox-style note tags — the ones it renders with a tick box and that carry a
 * `:completed` status (see https://learn.microsoft.com/en-us/graph/onenote-note-tags). Each becomes a
 * CKEditor task-list item, checked when its status is `completed`. The ones that mean more than a bare
 * to-do (priorities, discussions, meetings, requests) also keep an inner emoji from TAG_EMOJI.
 */
const CHECKBOX_TAGS = new Set<string>([
    "to-do",
    "to-do-priority-1",
    "to-do-priority-2",
    "discuss-with-person-a",
    "discuss-with-person-b",
    "discuss-with-manager",
    "schedule-meeting",
    "call-back",
    "client-request"
]);

/**
 * OneNote's note tags mapped to a representative emoji, keyed on the tag *shape* (the part before any
 * `:status`). Decorative tags render as the emoji alone; checkbox tags (CHECKBOX_TAGS) render as a task
 * item with the emoji prefixed inside it — except plain `to-do`, which is a bare checkbox with no
 * emoji. A shape not listed here (e.g. a user's custom tag) simply renders with no prefix.
 */
const TAG_EMOJI = new Map<string, string>([
    ["important", "⭐"],
    ["critical", "❗"],
    ["question", "❓"],
    ["highlight", "🖍️"],
    ["definition", "📖"],
    ["remember-for-later", "📌"],
    ["remember-for-blog", "✍️"],
    ["idea", "💡"],
    ["password", "🔑"],
    ["contact", "👤"],
    ["address", "🏠"],
    ["phone-number", "📞"],
    ["web-site-to-visit", "🌐"],
    ["source-for-article", "📰"],
    ["send-in-email", "📧"],
    ["movie-to-see", "🎬"],
    ["book-to-read", "📚"],
    ["music-to-listen-to", "🎵"],
    ["project-a", "🅰️"],
    ["project-b", "🅱️"],
    // Checkbox tags that carry meaning beyond a bare to-do; `to-do` itself stays emoji-less.
    ["to-do-priority-1", "1️⃣"],
    ["to-do-priority-2", "2️⃣"],
    ["discuss-with-person-a", "💬"],
    ["discuss-with-person-b", "💬"],
    ["discuss-with-manager", "🗣️"],
    ["schedule-meeting", "📅"],
    ["call-back", "📲"],
    ["client-request", "📋"]
]);

/** OneNote's highlight/font palette uses the 16 basic CSS color names; map them to hex (see below). */
const NAMED_COLORS = new Map<string, string>([
    ["yellow", "#ffff00"], ["lime", "#00ff00"], ["aqua", "#00ffff"], ["fuchsia", "#ff00ff"],
    ["blue", "#0000ff"], ["red", "#ff0000"], ["navy", "#000080"], ["teal", "#008080"],
    ["green", "#008000"], ["purple", "#800080"], ["maroon", "#800000"], ["olive", "#808000"],
    ["gray", "#808080"], ["silver", "#c0c0c0"], ["black", "#000000"], ["white", "#ffffff"]
]);

export function convertPageHtml(rawHtml: string): string {
    const root = parse(rawHtml);
    const scope = root.querySelector("body") ?? root;

    sortPositionedOutlines(scope);
    convertResourceReferences(scope);
    wrapFloatingImages(scope);
    convertTags(scope);
    convertInlineFormatting(scope);
    normalizeNamedColors(scope);
    removeDefaultTextColor(scope);
    unwrapListItemParagraphs(scope);
    normalizeListMarkers(scope);
    normalizeTableBorders(scope);
    correctTableShadingColors(scope);
    removeEmptyListItems(scope);
    removeBlockLevelBreaks(scope);
    resizeTables(scope);

    return sanitize.sanitizeHtml(scope.innerHTML);
}

/**
 * A OneNote page is a free-form canvas of absolutely-positioned text boxes (the top-level outline
 * <div>s). Their document order need not match their visual order, so reorder them top-to-bottom then
 * left-to-right to linearize the page into a sensible reading order. A no-op for the common
 * single-outline page.
 */
function sortPositionedOutlines(scope: HTMLElement) {
    const outlines = scope.childNodes.filter(
        (node): node is HTMLElement =>
            node instanceof HTMLElement && node.tagName?.toLowerCase() === "div" && parseStyle(node.getAttribute("style") ?? "").has("position")
    );
    if (outlines.length < 2) {
        return;
    }

    const coord = (el: HTMLElement, property: string) => parseFloat(parseStyle(el.getAttribute("style") ?? "").get(property) ?? "") || 0;
    const sorted = [...outlines].sort((a, b) => coord(a, "top") - coord(b, "top") || coord(a, "left") - coord(b, "left"));

    for (const outline of sorted) {
        outline.remove();
        scope.appendChild(outline);
    }
}

/**
 * OneNote references binary resources by authenticated Graph URLs that Trilium can't load directly
 * (e.g. `…/onenote/resources/{id}/$value`). Normalize them into a form the importer can recognize and
 * rewrite once the bytes are downloaded:
 *  - file attachments arrive as `<object data-attachment="name" type="mime" data="url">`, a tag the
 *    sanitizer drops entirely; turn each into an `<a class="onenote-attachment">` carrying the URL
 *    (href), mime (data-mime) and filename (text);
 *  - images keep their (display-resolution) `src` but shed OneNote's extra `data-*` URLs — chiefly the
 *    full-resolution variant, a second authenticated URL that would never load.
 * The importer downloads each URL and swaps in a local attachment reference (see importer.ts).
 */
function convertResourceReferences(scope: HTMLElement) {
    for (const object of scope.querySelectorAll("object[data-attachment]")) {
        const url = object.getAttribute("data") ?? "";
        const name = object.getAttribute("data-attachment") || "attachment";
        const mime = object.getAttribute("type") || "application/octet-stream";
        object.insertAdjacentHTML(
            "beforebegin",
            `<a class="${ONENOTE_ATTACHMENT_CLASS}" data-mime="${utils.escapeHtml(mime)}" href="${utils.escapeHtml(url)}">${utils.escapeHtml(name)}</a>`
        );
        object.remove();
    }

    for (const img of scope.querySelectorAll("img")) {
        for (const attr of Object.keys(img.attributes)) {
            if (attr.startsWith("data-")) {
                img.removeAttribute(attr);
            }
        }
    }
}

/** Block contexts whose direct <img> children are standalone (block) images, not inline runs. */
const FLOATING_IMAGE_PARENTS = new Set(["body", "div", "section", "article"]);

/**
 * OneNote lays a standalone image out as a bare <img> floating in the outline <div>, frequently
 * trailed — across OneNote's block-level <br> spacing — by a <cite> caption (e.g. a screen clipping's
 * "Screen clipping taken: …"). Left verbatim the caption renders as loose body text beside the image.
 *
 * CKEditor represents a block image as `<figure class="image">`, with any caption as its
 * `<figcaption>`, so wrap each floating image in a figure, carry its width/height into an
 * `aspect-ratio` (the form CKEditor stores so the image reserves space and resizes proportionally),
 * and pull a trailing <cite> in as the caption. Inline images (inside a <p>/<a>/<span>) are left alone.
 */
function wrapFloatingImages(scope: HTMLElement) {
    for (const img of scope.querySelectorAll("img")) {
        const parent = img.parentNode;
        if (!(parent instanceof HTMLElement) || !FLOATING_IMAGE_PARENTS.has(parent.tagName?.toLowerCase() ?? "")) {
            continue;
        }

        const width = img.getAttribute("width");
        const height = img.getAttribute("height");
        const style = parseStyle(img.getAttribute("style") ?? "");
        if (width && height && !style.has("aspect-ratio") && /^\d+(\.\d+)?$/.test(width) && /^\d+(\.\d+)?$/.test(height)) {
            style.set("aspect-ratio", `${width}/${height}`);
            img.setAttribute("style", serializeStyle(style));
        }

        const caption = takeTrailingCaption(img);
        const figcaption = caption ? `<figcaption>${caption}</figcaption>` : "";
        img.insertAdjacentHTML("beforebegin", `<figure class="image">${img.toString()}${figcaption}</figure>`);
        img.remove();
    }
}

/**
 * Consumes the <cite> caption that trails a floating image (OneNote separates the two with block-level
 * <br>s), returning the markup for the image's <figcaption> and removing the cite and the intervening
 * breaks from the document. The caption's text is placed in a fresh <cite>, wrapped in its font-size
 * class (e.g. text-small) — OneNote's inline caption styling (its grey chrome colour, point size and
 * zero margins) is dropped so the caption inherits the theme foreground. Returns null when the image
 * has no trailing cite. Runs before convertInlineFormatting so the fresh cite's content is still
 * formatted (a caption's own bold/italic runs survive).
 */
function takeTrailingCaption(img: HTMLElement): string | null {
    const breaks: HTMLElement[] = [];
    let sibling = img.nextElementSibling;
    while (sibling && sibling.tagName?.toLowerCase() === "br") {
        breaks.push(sibling);
        sibling = sibling.nextElementSibling;
    }
    if (!sibling || sibling.tagName?.toLowerCase() !== "cite") {
        return null;
    }

    const sizeClass = fontSizeClass(parseStyle(sibling.getAttribute("style") ?? "").get("font-size"), sibling);
    const cite = `<cite>${sibling.innerHTML}</cite>`;
    const caption = sizeClass ? `<span class="${sizeClass}">${cite}</span>` : cite;

    breaks.forEach((br) => br.remove());
    sibling.remove();
    return caption;
}

/**
 * OneNote represents note tags as a `data-tag` attribute on a <p> — a comma-separated list of
 * `shape[:status]` values (e.g. `to-do:completed`, `important`, `movie-to-see,book-to-read`).
 *
 * Checkbox-style tags (CHECKBOX_TAGS — `to-do` and its priority/discussion/meeting siblings) become a
 * CKEditor task list, checked when their status is `completed`; runs of consecutive ones collapse into
 * one list, matching the structure Trilium's TodoList plugin produces. The emoji prefix (TAG_EMOJI) is
 * orthogonal: it applies to decorative tags and to the meaningful checkbox tags alike, so e.g. a
 * `discuss-with-manager` paragraph becomes a task item reading "🗣️ …" while bare `to-do` stays a plain
 * checkbox. A paragraph can carry several comma-separated tags (e.g. `to-do,important`), in which case
 * its emojis stack and a single checkbox tag still turns it into a task item.
 */
function convertTags(scope: HTMLElement) {
    const tagged = scope.querySelectorAll("p[data-tag]");

    // Prefix each tagged paragraph's emoji in place, and record whether it is a checkbox paragraph
    // (and if so, whether it's completed) so adjacent ones can be grouped.
    const completedByCheckbox = new Map<HTMLElement, boolean>();
    for (const p of tagged) {
        const tags = (p.getAttribute("data-tag") ?? "").split(",").map((entry) => {
            const [shape, status] = entry.trim().split(":");
            return { shape, status };
        });
        p.removeAttribute("data-tag");

        const emojis = tags.map((tag) => TAG_EMOJI.get(tag.shape)).filter((emoji): emoji is string => Boolean(emoji));
        if (emojis.length > 0) {
            p.set_content(`${emojis.join("")} ${p.innerHTML}`);
        }

        const checkbox = tags.find((tag) => CHECKBOX_TAGS.has(tag.shape));
        if (checkbox) {
            completedByCheckbox.set(p, checkbox.status === "completed");
        }
    }

    // Collect adjacent checkbox paragraphs so each run becomes one list.
    const runs: HTMLElement[][] = [];
    for (const p of tagged) {
        if (!completedByCheckbox.has(p)) {
            continue;
        }
        const currentRun = runs[runs.length - 1];
        if (currentRun && currentRun[currentRun.length - 1].nextElementSibling === p) {
            currentRun.push(p);
        } else {
            runs.push([p]);
        }
    }

    for (const run of runs) {
        const items = run.map((p) => {
            const checked = completedByCheckbox.get(p) ? ` checked="checked"` : "";
            return `<li><label class="todo-list__label"><input type="checkbox"${checked}><span class="todo-list__label__description">${p.innerHTML}</span></label></li>`;
        });
        run[0].insertAdjacentHTML("beforebegin", `<ul class="todo-list">${items.join("")}</ul>`);
        run.forEach((p) => p.remove());
    }
}

/**
 * OneNote carries bold/italic/underline/strikethrough as inline styles (`font-weight:bold`,
 * `font-style:italic`, `text-decoration:underline`/`line-through`), which the sanitizer strips. Wrap
 * the styled element's content in the equivalent semantic tags (which survive sanitization) so the
 * formatting is preserved.
 */
function convertInlineFormatting(scope: HTMLElement) {
    for (const el of scope.querySelectorAll("[style]")) {
        const style = parseStyle(el.getAttribute("style") ?? "");
        const weight = style.get("font-weight");
        const decorations = (style.get("text-decoration") ?? "").split(/\s+/);

        const open: string[] = [];
        const close: string[] = [];
        const wrap = (tag: string) => {
            open.push(`<${tag}>`);
            close.unshift(`</${tag}>`);
        };

        if (weight === "bold" || Number(weight) >= 600) {
            wrap("strong");
        }
        if (style.get("font-style") === "italic") {
            wrap("em");
        }
        if (decorations.includes("underline")) {
            wrap("u");
        }
        // Trilium's editor represents strikethrough as <del> (see ckeditor5 StrikethroughAsDel), not <s>.
        if (decorations.includes("line-through")) {
            wrap("del");
        }
        // OneNote's "Code" style is just a Consolas font; map it to an inline <code> element.
        if ((style.get("font-family") ?? "").includes("consolas")) {
            wrap("code");
        }
        // OneNote carries explicit point sizes; map them onto CKEditor's tiny/small/big/huge scale.
        const sizeClass = fontSizeClass(style.get("font-size"), el);
        if (sizeClass) {
            open.push(`<span class="${sizeClass}">`);
            close.unshift("</span>");
        }

        if (open.length > 0) {
            el.set_content(`${open.join("")}${el.innerHTML}${close.join("")}`);
        }
    }
}

/**
 * Maps an OneNote font-size onto CKEditor's named size scale, relative to the 11pt OneNote base:
 * ≤8pt → tiny, 9-10pt → small, 11-16pt → base (null), 18-26pt → big, ≥28pt → huge. Headings are
 * skipped — their level already conveys size. Returns null for the base band and unparseable values.
 */
function fontSizeClass(value: string | undefined, el: HTMLElement): string | null {
    if (!value || /^h[1-6]$/.test(el.tagName?.toLowerCase() ?? "")) {
        return null;
    }
    const match = value.match(/^([\d.]+)\s*(pt|px)?$/);
    if (!match) {
        return null;
    }
    const points = match[2] === "px" ? parseFloat(match[1]) * 0.75 : parseFloat(match[1]);
    if (points < 9) {
        return "text-tiny";
    }
    if (points < 11) {
        return "text-small";
    }
    if (points < 18) {
        return null;
    }
    return points < 28 ? "text-big" : "text-huge";
}

/** Parses an inline `style` attribute into a property→value map (both lowercased). */
function parseStyle(style: string): Map<string, string> {
    const declarations = new Map<string, string>();
    for (const declaration of style.split(";")) {
        const separator = declaration.indexOf(":");
        if (separator > 0) {
            const property = declaration.slice(0, separator).trim().toLowerCase();
            const value = declaration.slice(separator + 1).trim().toLowerCase();
            declarations.set(property, value);
        }
    }
    return declarations;
}

/**
 * Rewrites CSS named color/background-color values (e.g. `yellow`) to hex so they pass the sanitizer's
 * color allowlist (which only permits hex/rgb/hsl). The styles stay as <span style="color|
 * background-color"> — the representation Trilium's FontColor / FontBackgroundColor editor plugins use.
 */
function normalizeNamedColors(scope: HTMLElement) {
    for (const el of scope.querySelectorAll("[style]")) {
        const style = parseStyle(el.getAttribute("style") ?? "");
        let changed = false;
        for (const property of ["color", "background-color"]) {
            const hex = NAMED_COLORS.get(style.get(property) ?? "");
            if (hex) {
                style.set(property, hex);
                changed = true;
            }
        }
        if (changed) {
            el.setAttribute("style", serializeStyle(style));
        }
    }
}

function serializeStyle(style: Map<string, string>): string {
    return [...style].map(([property, value]) => `${property}:${value}`).join(";");
}

/** OneNote's automatic/default text color in the forms it can reach us in (named black already mapped to hex). */
const DEFAULT_TEXT_COLORS = new Set(["#000000", "#000", "black"]);

/**
 * OneNote treats a page as a white canvas, so it stamps an explicit `color:#000000` (its automatic
 * text color) on essentially every run of body text. Preserved verbatim, that hard black overrides the
 * note's theme-inherited foreground and renders as unreadable black-on-dark under a dark theme. Treat
 * default black as "automatic" and strip it so the text inherits the theme color — identical under a
 * light theme, where the default already is black. A span left with no other styling is unwrapped so we
 * don't leave bare `<span>` noise behind; deliberately colored non-black text and background-colors
 * (e.g. highlights) are untouched. Runs after normalizeNamedColors so `color:black` has become hex.
 */
function removeDefaultTextColor(scope: HTMLElement) {
    for (const el of scope.querySelectorAll("[style]")) {
        const style = parseStyle(el.getAttribute("style") ?? "");
        if (!DEFAULT_TEXT_COLORS.has(style.get("color") ?? "")) {
            continue;
        }
        style.delete("color");

        if (style.size > 0) {
            el.setAttribute("style", serializeStyle(style));
            continue;
        }

        el.removeAttribute("style");
        if (el.tagName?.toLowerCase() === "span") {
            el.insertAdjacentHTML("beforebegin", el.innerHTML);
            el.remove();
        }
    }
}

/** Unwraps OneNote's margin-0 <p> wrappers inside <li> so item text sits directly in the <li>. */
function unwrapListItemParagraphs(scope: HTMLElement) {
    for (const li of scope.querySelectorAll("li")) {
        for (const child of [...li.childNodes]) {
            if (child instanceof HTMLElement && child.tagName?.toLowerCase() === "p") {
                child.insertAdjacentHTML("beforebegin", child.innerHTML);
                child.remove();
            }
        }
    }
}

/**
 * OneNote puts the list marker type on every <li> (e.g. list-style-type:circle / lower-alpha). CKEditor
 * instead carries it once on the <ul>/<ol>, so move the first item's marker onto the (top-level) list,
 * mapping lower-alpha/upper-alpha to CKEditor's lower-latin/upper-latin, and strip it from all items.
 * Nested lists keep the default marker.
 */
function normalizeListMarkers(scope: HTMLElement) {
    for (const list of scope.querySelectorAll("ul, ol")) {
        const parent = list.parentNode;
        const nested = parent instanceof HTMLElement && parent.tagName?.toLowerCase() === "li";
        if (nested) {
            continue;
        }
        const firstItem = list.childNodes.find((node): node is HTMLElement => node instanceof HTMLElement && node.tagName?.toLowerCase() === "li");
        const marker = firstItem && parseStyle(firstItem.getAttribute("style") ?? "").get("list-style-type");
        if (marker) {
            list.setAttribute("style", `list-style-type:${LIST_STYLE_MAP.get(marker) ?? marker};`);
        }
    }

    for (const li of scope.querySelectorAll("li")) {
        const style = parseStyle(li.getAttribute("style") ?? "");
        if (style.delete("list-style-type")) {
            if (style.size === 0) {
                li.removeAttribute("style");
            } else {
                li.setAttribute("style", serializeStyle(style));
            }
        }
    }
}

/**
 * OneNote carries cell/table borders as a `border` shorthand and `border-collapse`, which the
 * sanitizer drops. Visible borders are left to CKEditor's default table styling, but a zero-width /
 * none border must be made explicit, so map `border:0px` to `border-color:transparent` (the CKEditor
 * representation of a hidden border), keeping any background-color.
 */
function normalizeTableBorders(scope: HTMLElement) {
    for (const el of scope.querySelectorAll("table, td, th")) {
        const style = parseStyle(el.getAttribute("style") ?? "");
        const border = style.get("border");
        style.delete("border");
        style.delete("border-collapse");

        if (border !== undefined && /^0(px|pt|em)?$|\bnone\b|\bhidden\b/.test(border)) {
            style.set("border-color", "transparent");
            if (el.tagName?.toLowerCase() === "table") {
                style.set("border-style", "solid");
            }
        }

        if (style.size === 0) {
            el.removeAttribute("style");
        } else {
            el.setAttribute("style", serializeStyle(style));
        }
    }
}

/**
 * OneNote carries a resized column's width as a bare pixel `width` on every cell of that column
 * (e.g. `<td style="width:150;…">`), a per-cell form the sanitizer drops — so column widths are lost.
 * CKEditor instead stores column widths as percentages in a <colgroup> on a `ck-table-resized` table
 * wrapped in `<figure class="table" style="width:100%;">`. When every column carries an explicit width,
 * translate OneNote's pixel widths into that representation: emit a <colgroup> of proportional
 * percentages (summing to 100), strip the now-redundant per-cell widths, tag the table resized and wrap
 * it in a table figure. Tables that don't width every column, or that merge cells (colspan/rowspan,
 * which this flat column model can't represent), are left untouched.
 */
function resizeTables(scope: HTMLElement) {
    for (const table of scope.querySelectorAll("table")) {
        const cellRows = table.querySelectorAll("tr").map((row) => row.querySelectorAll("td, th"));
        const columnCount = Math.max(0, ...cellRows.map((cells) => cells.length));
        if (columnCount === 0 || cellRows.some((cells) => cells.some(hasCellSpan))) {
            continue;
        }

        // A resized column repeats its width on every cell; take the first one seen per column. Bail
        // unless every column has one — a partial set can't be faithfully turned into a full colgroup.
        const widths: number[] = [];
        for (let column = 0; column < columnCount; column++) {
            const width = cellRows.map((cells) => columnWidth(cells[column])).find((value) => value !== undefined);
            if (width === undefined) {
                break;
            }
            widths.push(width);
        }
        if (widths.length !== columnCount) {
            continue;
        }

        for (const cells of cellRows) {
            for (const cell of cells) {
                const style = parseStyle(cell.getAttribute("style") ?? "");
                if (style.delete("width")) {
                    if (style.size === 0) {
                        cell.removeAttribute("style");
                    } else {
                        cell.setAttribute("style", serializeStyle(style));
                    }
                }
            }
        }

        const colgroup = `<colgroup>${columnPercentages(widths).map((percent) => `<col style="width:${percent}%;">`).join("")}</colgroup>`;
        const existingClass = table.getAttribute("class");
        table.setAttribute("class", existingClass ? `${existingClass} ck-table-resized` : "ck-table-resized");
        table.set_content(`${colgroup}<tbody>${table.innerHTML}</tbody>`);
        table.insertAdjacentHTML("beforebegin", `<figure class="table" style="width:100%;">${table.toString()}</figure>`);
        table.remove();
    }
}

/** Whether a cell spans multiple rows/columns, which the flat column model in resizeTables can't map. */
function hasCellSpan(cell: HTMLElement): boolean {
    return cell.getAttribute("colspan") != null || cell.getAttribute("rowspan") != null;
}

/** A cell's positive pixel `width` (OneNote writes it unit-less, e.g. `width:150`), or undefined. */
function columnWidth(cell: HTMLElement | undefined): number | undefined {
    const value = cell && parseStyle(cell.getAttribute("style") ?? "").get("width");
    const pixels = value ? parseFloat(value) : NaN;
    return Number.isFinite(pixels) && pixels > 0 ? pixels : undefined;
}

/**
 * Turns pixel column widths into percentages of their total, rounded to two decimals. The last column
 * takes the remainder so the set sums to exactly 100% (matching CKEditor's normalized colgroup) rather
 * than drifting a hundredth off through independent rounding.
 */
function columnPercentages(widths: number[]): number[] {
    const total = widths.reduce((sum, width) => sum + width, 0);
    let allocated = 0;
    return widths.map((width, index) => {
        if (index === widths.length - 1) {
            return Math.round((100 - allocated) * 100) / 100;
        }
        const percent = Math.round((width / total) * 10000) / 100;
        allocated += percent;
        return percent;
    });
}

/**
 * OneNote's Graph API exports table cell shading as a dark *shade* of the colour OneNote actually
 * displays: it keeps the hue and saturation but inverts the lightness (e.g. a cell shown as #b6d9a1
 * comes back as #375623). Left as-is the cell imports far too dark — commonly dark-on-dark and
 * unreadable. So for a cell whose background is dark, reflect its lightness (L → 1 − L, hue/saturation
 * untouched) to recover the displayed light tint; light backgrounds (plausible shading as-is, and the
 * form correctly-exported colours arrive in) are left alone. Runs after normalizeNamedColors, so a
 * named background has already become the hex this keys on.
 */
function correctTableShadingColors(scope: HTMLElement) {
    for (const cell of scope.querySelectorAll("td, th")) {
        const style = parseStyle(cell.getAttribute("style") ?? "");
        const rgb = parseHexColor(style.get("background-color") ?? "");
        if (!rgb) {
            continue;
        }
        const [hue, saturation, lightness] = rgbToHsl(rgb);
        if (lightness >= 0.5) {
            continue;
        }
        style.set("background-color", hslToHex(hue, saturation, 1 - lightness));
        cell.setAttribute("style", serializeStyle(style));
    }
}

/** Parses a `#rgb` or `#rrggbb` colour to [r, g, b] (0-255), or null if it isn't a hex colour. */
function parseHexColor(value: string): [number, number, number] | null {
    const match = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!match) {
        return null;
    }
    const hex = match[1].length === 3 ? match[1].replace(/(.)/g, "$1$1") : match[1];
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

/** Converts an [r, g, b] (0-255) colour to [h, s, l], each in [0, 1]. */
function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    const delta = max - min;
    if (delta === 0) {
        return [0, 0, lightness];
    }
    const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    let hue: number;
    switch (max) {
        case r:
            hue = (g - b) / delta + (g < b ? 6 : 0);
            break;
        case g:
            hue = (b - r) / delta + 2;
            break;
        default:
            hue = (r - g) / delta + 4;
            break;
    }
    return [hue / 6, saturation, lightness];
}

/** Converts [h, s, l] (each in [0, 1]) back to a `#rrggbb` hex colour. */
function hslToHex(h: number, s: number, l: number): string {
    const channel = (value: number) => Math.round(value * 255).toString(16).padStart(2, "0");
    if (s === 0) {
        return `#${channel(l).repeat(3)}`;
    }
    /* v8 ignore next -- only called from correctTableShadingColors with l strictly above 0.5 */
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const component = (t: number) => {
        if (t < 0) {
            t += 1;
        }
        if (t > 1) {
            t -= 1;
        }
        if (t < 1 / 6) {
            return p + (q - p) * 6 * t;
        }
        if (t < 1 / 2) {
            return q;
        }
        if (t < 2 / 3) {
            return p + (q - p) * (2 / 3 - t) * 6;
        }
        return p;
    };
    return `#${channel(component(h + 1 / 3))}${channel(component(h))}${channel(component(h - 1 / 3))}`;
}

/** Drops list items that hold nothing but whitespace/<br> (OneNote's "exited the list" remnant). */
function removeEmptyListItems(scope: HTMLElement) {
    for (const li of scope.querySelectorAll("li")) {
        const hasText = li.textContent.trim().length > 0;
        const hasNonBreakElement = li.querySelectorAll("*").some((el) => el.tagName?.toLowerCase() !== "br");
        if (!hasText && !hasNonBreakElement) {
            li.remove();
        }
    }
}

/** Removes <br> elements used as block-level spacing; soft breaks inside <p>/<span>/etc. are kept. */
function removeBlockLevelBreaks(scope: HTMLElement) {
    for (const br of scope.querySelectorAll("br")) {
        const parent = br.parentNode;
        if (parent instanceof HTMLElement && BLOCK_CONTAINERS.has(parent.tagName?.toLowerCase() ?? "")) {
            br.remove();
        }
    }
}

export default { convertPageHtml };
