/**
 * Shared helpers for the structured-import path (Notion, Anytype, …): turning a database/collection's column
 * and property data into the Trilium markup and attributes the editor expects. Each importer parses its own
 * source format; these produce the common *output* — attribute names, promoted-attribute definitions,
 * reference links and file attachments — so those formats stay consistent across importers.
 */

import type BNote from "../../becca/entities/bnote.js";
import { escapeHtml } from "../utils/index.js";
import mimeService from "./mime.js";

/**
 * Converts a column/property name to a camelCase Trilium attribute name (e.g. `Last edited by` →
 * `lastEditedBy`, `URL` → `url`, `Multi-select` → `multiSelect`). The name is split into alphanumeric words;
 * the first is lower-cased and the rest title-cased, so the result is always a valid attribute name. A name
 * with no alphanumeric content falls back to `unnamed`. The original name is usually kept as the promoted
 * alias (see {@link buildPromotedDefinition}) so its spacing and casing still show in the UI.
 */
export function toAttributeName(name: string): string {
    const words = name.match(/[\p{L}\p{N}]+/gu);
    if (!words) {
        return "unnamed";
    }
    return words.map((word, index) => (index === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())).join("");
}

/**
 * Builds a promoted-attribute definition for a database/collection column (e.g. `promoted,single,url,alias=URL`,
 * or `promoted,multi,text,alias=Multi-select`). The alias keeps the original (pretty) name in the UI while
 * the attribute name stays sanitized; commas, equals and control characters are neutralized so they can't
 * corrupt the single-line, comma/`=`-delimited definition. A relation column carries no value type, so
 * `labelType` is omitted (e.g. `promoted,multi,alias=Related`).
 */
export function buildPromotedDefinition({ alias, labelType, multiplicity }: { alias: string; labelType?: string; multiplicity: "single" | "multi" }): string {
    const safeAlias = alias.replace(/[\x00-\x1f,=]/g, " ").trim();
    const type = labelType ? `${labelType},` : "";
    return `promoted,${multiplicity},${type}alias=${safeAlias}`;
}

/** A Trilium attachment reference-link (the chip CKEditor renders) pointing at a note's attachment. */
export function attachmentReferenceLink(noteId: string, attachmentId: string, title: string): string {
    return `<a class="reference-link" href="#root/${noteId}?viewMode=attachments&attachmentId=${attachmentId}">${escapeHtml(title)}</a>`;
}

/** Gives a value a clickable scheme (`mailto:` for an email, `tel:` for a phone) unless it already carries it. */
export function applyUrlScheme(value: string, scheme: string): string {
    return value.startsWith(scheme) ? value : `${scheme}${value}`;
}

/** Saves bytes as a `role:"file"` attachment on `note`, defaulting the MIME from the title (or octet-stream). */
export function saveFileAttachment(note: BNote, title: string, content: Uint8Array, mime?: string) {
    return note.saveAttachment({
        role: "file",
        mime: mime || mimeService.getMime(title) || "application/octet-stream",
        title,
        content
    });
}
