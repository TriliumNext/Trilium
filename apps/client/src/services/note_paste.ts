import type FNote from "../entities/fnote.js";
import type { MenuCommandItem } from "../menus/context_menu.js";
import clipboard from "./clipboard.js";
import froca from "./froca.js";
import { t } from "./i18n.js";
import { parseNavigationStateFromUrl } from "./link.js";
import { isMac } from "./utils.js";

/**
 * Pastes notes into a view that shows notes, such as a relation map, and returns the IDs of the
 * pasted notes, which the view then shows. Empty when the clipboard holds no notes.
 *
 * The notes come from the links on the system clipboard (the tree's Copy puts reference links
 * there, and so does copying a link to a note), read from `data`, a paste event's
 * `clipboardData`, or from `navigator.clipboard` without one. When the system clipboard links to
 * no note, they come from Trilium's own clipboard: cut notes move under `parentNote`, as the
 * tree's Paste into does, while copied notes stay where they are.
 */
export async function pasteNotes(parentNote: FNote, data?: DataTransfer | null): Promise<string[]> {
    const { html, text } = data
        ? { html: data.getData("text/html"), text: data.getData("text/plain") }
        : await readSystemClipboard();
    const linkedNotes = await froca.getNotes(linkedNoteIds(html, text), true);
    if (linkedNotes.length) {
        return linkedNotes.map((note) => note.noteId);
    }

    const contents = clipboard.getContents();
    if (!contents) return [];

    const parentBranchId = parentNote.getParentBranchIds()[0];
    if (contents.mode === "cut" && parentBranchId) {
        await clipboard.pasteInto(parentBranchId);
    }
    return contents.noteIds;
}

/** The context menu row of a view that calls {@link pasteNotes} from its context menu. */
export function pasteNotesMenuItem<T>(handler: () => void): MenuCommandItem<T> {
    return {
        title: t("clipboard.paste_notes"),
        uiIcon: "bx bx-paste",
        shortcut: `${isMac() ? "Meta" : "Ctrl"}+V`,
        handler
    };
}

/** The IDs of the notes linked from `html`, or else from the URLs in `text`, once each. */
function linkedNoteIds(html: string, text: string) {
    const hrefs = html
        ? [ ...new DOMParser().parseFromString(html, "text/html").querySelectorAll("a[href]") ]
            .map((link) => link.getAttribute("href") ?? "")
        : text.split(/[\s,]+/);

    const noteIds = new Set<string>();
    for (const href of hrefs) {
        const { noteId } = parseNavigationStateFromUrl(href);
        if (noteId) noteIds.add(noteId);
    }
    return [ ...noteIds ];
}

/**
 * The `text/html` and `text/plain` flavors on the system clipboard, empty when they are absent or
 * the clipboard cannot be read: `navigator.clipboard.read()` requires a secure context, and the
 * browser can refuse the permission.
 */
async function readSystemClipboard() {
    let html = "";
    let text = "";
    try {
        for (const item of await navigator.clipboard?.read?.() ?? []) {
            if (!html && item.types.includes("text/html")) {
                html = await (await item.getType("text/html")).text();
            }
            if (!text && item.types.includes("text/plain")) {
                text = await (await item.getType("text/plain")).text();
            }
        }
    } catch (error) {
        console.warn("Failed to read the clipboard:", error);
    }
    return { html, text };
}
