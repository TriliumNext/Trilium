import { sanitizeNoteContentHtml } from "./sanitize_content.js";
import server from "./server.js";

/**
 * Fetches the server-rendered HTML preview of an office document (DOCX/XLSX/PPTX,
 * ODT/ODS/ODP and RTF) and sanitizes it before it ever touches the DOM. The conversion
 * itself happens server-side (officeparser) via the office-preview route.
 *
 * Throws if the document is too large, unsupported, or conversion fails — callers should
 * catch and fall back to the usual download / open-externally affordance.
 */
export async function renderOfficeToHtml(entityType: "notes" | "attachments", entityId: string): Promise<string> {
    const { html } = await server.get<{ html: string }>(`${entityType}/${entityId}/office-preview`);

    return sanitizeNoteContentHtml(html);
}
