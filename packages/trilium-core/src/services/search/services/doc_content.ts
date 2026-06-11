import type BNote from "../../../becca/entities/bnote.js";
import { getDocContent } from "../../in_app_help.js";

/**
 * Returns the searchable plain text of a doc (in-app help) note, or `null` when the note is not a
 * doc note, has no `docName`, or its content is unavailable on this platform.
 *
 * Doc notes carry no blob — their content ships as static help files that are indexed to plain text
 * at build time — so this lets the content-fulltext expression and snippet extraction read them via
 * the in-app help provider (which sources the index from the filesystem on the server and from a
 * bundled asset in the web-based standalone worker).
 */
export function getDocSearchText(note: BNote): string | null {
    if (note.type !== "doc") {
        return null;
    }

    const docName = note.getLabelValue("docName");
    return docName ? getDocContent(docName) : null;
}
