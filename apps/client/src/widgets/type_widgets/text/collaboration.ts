import type { CKTextEditor } from "@triliumnext/ckeditor5";
import type FNote from "../../../entities/fnote";
import { randomString } from "../../../services/utils";
import { sendCollaborationMessage, subscribeToConnection, subscribeToMessages } from "../../../services/ws";

/** The editors that are in a session, which the messages of the server are handed to. */
const editors = new Set<CKTextEditor>();
let isListening = false;

/**
 * Puts the editor in the collaborative editing session of the note it shows, on an instance with
 * several users. In a session the content comes from the other editors of the note, and only the
 * editor the server picks saves it (see `isSavedByAnotherEditor()`).
 */
export function startCollaboration(editor: CKTextEditor, note: FNote, onBecomeSaver: () => void) {
    if (!window.glob.currentUser || note.isProtected) {
        return;
    }
    listen();
    editors.add(editor);
    editor.once("destroy", () => editors.delete(editor));
    editor.plugins.get("Collaboration").start({
        noteId: note.noteId,
        memberId: randomString(10),
        send: sendCollaborationMessage,
        onSaverChange(isSaver) {
            if (isSaver) {
                onBecomeSaver();
            }
        }
    });
}

export function stopCollaboration(editor: CKTextEditor) {
    editors.delete(editor);
    editor.plugins.get("Collaboration").stop();
}

/** Whether the editor is in the session of the note, whose content then replaces the saved one. */
export function isCollaboratingOn(editor: CKTextEditor, noteId: string) {
    const collaboration = editor.plugins.get("Collaboration");
    return collaboration.isActive && collaboration.noteId === noteId;
}

/** Whether another editor of the session saves the note, so this one must not. */
export function isSavedByAnotherEditor(editor: CKTextEditor) {
    const collaboration = editor.plugins.get("Collaboration");
    return collaboration.isActive && !collaboration.isSaver;
}

function listen() {
    if (isListening) {
        return;
    }
    isListening = true;

    subscribeToMessages((message) => {
        if (message.type.startsWith("collab-")) {
            for (const editor of editors) {
                editor.plugins.get("Collaboration").receive(message as never);
            }
        }
    });
    // The server forgets an editor when its connection closes, and a join sent before the
    // connection opened never arrived.
    subscribeToConnection(() => {
        for (const editor of editors) {
            editor.plugins.get("Collaboration").rejoin();
        }
    });
}
