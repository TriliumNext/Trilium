import { sanitizeNoteContentHtml } from "./sanitize_content.js";
import server from "./server.js";

/**
 * Fetches the server-rendered HTML preview of an office document (DOCX/XLSX/PPTX,
 * ODT/ODS/ODP, RTF and EPUB) and sanitizes it before it ever touches the DOM. The conversion
 * itself happens server-side (officeparser) via the office-preview route.
 *
 * The route sends the fragment as the response body, so it is fetched as text rather than
 * through a JSON envelope.
 *
 * A spreadsheet fragment starts with a `<style>` holding the cell styling, which the sanitizer
 * would strip. It is split off first and returned separately so the caller can attach it as an
 * element rather than as markup, keeping it clear of the sanitizer without reaching the DOM as
 * text. Every rule it carries is scoped under `.spreadsheet-table` by the renderer.
 *
 * Throws if the document is too large, unsupported, or conversion fails — callers should
 * catch and fall back to the usual download / open-externally affordance.
 */
export async function renderOfficeToHtml(
    entityType: "notes" | "attachments",
    entityId: string,
    { trim }: { trim?: boolean } = {}
): Promise<OfficePreview> {
    // `raw` keeps the response a plain string; the route sends the fragment as the body.
    const url = `${entityType}/${entityId}/office-preview${trim ? "?trim=1" : ""}`;
    const body = await server.get<string>(url, undefined, true);
    const { css, html } = splitStylesheet(body);
    const sanitized = sanitizeNoteContentHtml(html);

    // stripLinkColors parses and re-serializes the whole fragment, which on a spreadsheet is
    // megabytes, so it only runs where it can find something. A stylesheet marks the native
    // spreadsheet renderer, the only pipeline that emits one and one that writes anchors with no
    // styling at all; and a fragment holding no anchor has nothing to strip either way.
    const strippable = !css && /<a[\s>]/.test(sanitized);

    return { css, html: strippable ? stripLinkColors(sanitized) : sanitized };
}

export interface OfficePreview {
    /** The rules the fragment's classes refer to, or "" when it carries none. */
    css: string;
    /** The sanitized markup. */
    html: string;
}

/**
 * Splits a leading `<style>` off the fragment. The renderer always emits it first, so this reads
 * a bounded prefix instead of parsing the document — which for a spreadsheet runs to megabytes.
 */
function splitStylesheet(body: string): OfficePreview {
    if (!body.startsWith("<style>")) {
        return { css: "", html: body };
    }

    const end = body.indexOf("</style>");
    if (end < 0) {
        return { css: "", html: body };
    }

    return {
        css: body.slice("<style>".length, end).trim(),
        html: body.slice(end + "</style>".length).trimStart()
    };
}

/**
 * Removes the inline `color` from hyperlinks (and the styled runs inside them) when it is a
 * word processor's default hyperlink color rather than an author's choice. The conversion
 * reproduces the document's hyperlink character style (e.g. LibreOffice's navy "Internet
 * Link"), which would override the theme's link color and can be unreadable on a dark theme —
 * while a link the author deliberately colored keeps its color, matching how colored links
 * behave in text notes. Other run styling (underline, fonts, colors outside links) is kept.
 */
function stripLinkColors(html: string): string {
    const template = document.createElement("template");
    template.innerHTML = html;

    for (const el of template.content.querySelectorAll<HTMLElement>("a[style], a [style]")) {
        const color = el.style.getPropertyValue("color").toLowerCase().replaceAll(" ", "");
        if (!DEFAULT_HYPERLINK_COLORS.has(color)) {
            continue;
        }

        el.style.removeProperty("color");
        if (!el.getAttribute("style")) {
            el.removeAttribute("style");
        }
    }

    return template.innerHTML;
}

/** Each default in both hex and the rgb() form CSSStyleDeclaration may serialize it to. */
const DEFAULT_HYPERLINK_COLORS = new Set([
    "#000080", "rgb(0,0,128)", // LibreOffice "Internet Link"
    "#0563c1", "rgb(5,99,193)", // Word (Office theme)
    "#0000ff", "rgb(0,0,255)", // classic hyperlink blue
    "#0000ee", "rgb(0,0,238)" // HTML user-agent default
]);
