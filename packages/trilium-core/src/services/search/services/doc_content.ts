import type BNote from "../../../becca/entities/bnote.js";
import { getDocContent } from "../../in_app_help.js";
import preprocessContent from "../expressions/note_content_fulltext_preprocessor.js";

/**
 * Cache of doc (in-app help) note plain text, keyed by noteId. Help content ships with the app as
 * static HTML files (not blobs), so it never changes within a running process — the only
 * invalidation needed is on UI language change (see {@link clearDocSearchTextCache}). A cached
 * value of `null` records that the note has no locally available content (e.g. standalone).
 */
const docTextCache = new Map<string, string | null>();

/**
 * Returns the searchable plain text of a doc (in-app help) note, with HTML stripped, or `null`
 * when the note is not a doc note, has no `docName`, or its content is unavailable locally.
 *
 * Doc notes are invisible to the blob-based content search because their content lives in static
 * files; this lets both the content-fulltext expression and snippet extraction read them.
 */
export function getDocSearchText(note: BNote): string | null {
    if (note.type !== "doc") {
        return null;
    }

    const cached = docTextCache.get(note.noteId);
    if (cached !== undefined) {
        return cached;
    }

    const docName = note.getLabelValue("docName");
    const html = docName ? getDocContent(docName) : null;
    const text = html ? preprocessContent(html, "text", "text/html", false) : null;

    docTextCache.set(note.noteId, text);
    return text;
}

export function clearDocSearchTextCache() {
    docTextCache.clear();
}
