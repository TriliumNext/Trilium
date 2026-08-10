import { sanitizeNoteContentHtml } from "./sanitize_content.js";
import server from "./server.js";

/**
 * Fetches the server-rendered HTML preview of an office document (DOCX/XLSX/PPTX,
 * ODT/ODS/ODP, RTF and EPUB) and sanitizes it before it ever touches the DOM. The conversion
 * itself happens server-side (officeparser) via the office-preview route.
 *
 * Throws if the document is too large, unsupported, or conversion fails — callers should
 * catch and fall back to the usual download / open-externally affordance.
 */
export async function renderOfficeToHtml(entityType: "notes" | "attachments", entityId: string): Promise<string> {
    const { html } = await server.get<{ html: string }>(`${entityType}/${entityId}/office-preview`);

    return stripLinkColors(sanitizeNoteContentHtml(html));
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
