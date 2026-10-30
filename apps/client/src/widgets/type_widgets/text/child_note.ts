import type { ChildNoteHost } from "@triliumnext/ckeditor5";

import appContext from "../../../components/app_context";
import note_create from "../../../services/note_create";
import { POPUP_EDITOR_NTX_ID } from "../../react/react_utils";

/** The note a text editor is open on, which the child notes created from the editor go under. */
export interface ChildNoteParent {
    notePath: string;
    isProtected: boolean;
    /** The note context the editor is in, which decides the popup a new child note opens in. */
    ntxId: string | null | undefined;
}

/**
 * The host of the editor's `childNote` command: creates an empty child note of the note
 * `getParent()` names, and opens it in Quick edit with its title selected.
 */
export function buildChildNoteHost(getParent: () => ChildNoteParent | undefined): ChildNoteHost {
    return {
        async create() {
            const parent = getParent();
            return parent && await createChildNote(parent);
        },
        open(notePath) {
            openChildNote(notePath, getParent()?.ntxId, { selectTitle: true });
        }
    };
}

/** Creates a child note of `parent` titled `title`, or untitled, and returns the path to it. */
export async function createChildNote({ notePath, isProtected }: ChildNoteParent, title?: string) {
    const { note } = await note_create.createNote(notePath, {
        title, activate: false, isProtected
    });
    return note ? `${notePath}/${note.noteId}` : undefined;
}

/**
 * Opens a note made by `createChildNote()` in Quick edit, which offers the note types to turn the
 * empty note into. An editor already in Quick edit, in the context `ntxId`, opens it in the nested
 * popup.
 */
export function openChildNote(
    notePath: string, ntxId: string | null | undefined, { selectTitle }: { selectTitle: boolean }
) {
    const command = ntxId?.startsWith(POPUP_EDITOR_NTX_ID) ? "openInNestedPopup" : "openInPopup";
    void appContext.triggerCommand(command, {
        noteIdOrPath: notePath, showNoteTypeSwitcher: true, selectTitle
    });
}
