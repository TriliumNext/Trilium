import type { CollabEditor, CollabPeer } from "@triliumnext/commons";

import type FNote from "../entities/fnote";
import { randomString } from "./utils";
import { sendCollaborationMessage, subscribeToConnection, subscribeToMessages } from "./ws";

interface CollaborationCallbacks {
    /** The editor now saves the note, and holds changes the previous saver may not have saved. */
    onBecomeSaver(): void;
    /** An editor joined or left the session; `peers` are the others in it. */
    onPeersChange(peers: CollabPeer[]): void;
}

/** The editors that are in a session, which the messages of the server are handed to. */
const editors = new Set<CollabEditor>();
let isListening = false;

/**
 * Puts an editor in the collaborative editing session of the note it shows, on an instance with
 * several users. In a session the content comes from the other editors of the note, and only the
 * editor the server picks saves it (see `isSavedByAnotherEditor()`).
 *
 * `editor` is the collaboration side of a text or a code editor: the `Collaboration` plugin of
 * CKEditor, or a `CodeCollaboration` of CodeMirror.
 */
export function startCollaboration(
    editor: CollabEditor,
    note: FNote,
    { onBecomeSaver, onPeersChange }: CollaborationCallbacks
) {
    if (!window.glob.currentUser || note.isProtected) {
        return;
    }
    listen();
    editors.add(editor);
    editor.start({
        noteId: note.noteId,
        memberId: randomString(10),
        send: sendCollaborationMessage,
        onSaverChange(isSaver) {
            if (isSaver) {
                onBecomeSaver();
            }
        },
        onPeersChange
    });
}

export function stopCollaboration(editor: CollabEditor) {
    editors.delete(editor);
    editor.stop();
}

/** Whether the editor is in the session of the note, whose content then replaces the saved one. */
export function isCollaboratingOn(editor: CollabEditor, noteId: string) {
    return editor.isActive && editor.noteId === noteId;
}

/** Whether another editor of the session saves the note, so this one must not. */
export function isSavedByAnotherEditor(editor: CollabEditor) {
    return editor.isActive && !editor.isSaver;
}

function listen() {
    if (isListening) {
        return;
    }
    isListening = true;

    subscribeToMessages((message) => {
        if (message.type.startsWith("collab-")) {
            for (const editor of activeEditors()) {
                editor.receive(message as never);
            }
        }
    });
    // The server forgets an editor when its connection closes, and a join sent before the
    // connection opened never arrived.
    subscribeToConnection(() => {
        for (const editor of activeEditors()) {
            editor.rejoin();
        }
    });
}

/** The editors still in a session. One that was destroyed or turned down has left on its own. */
function activeEditors() {
    for (const editor of editors) {
        if (!editor.isActive) {
            editors.delete(editor);
        }
    }
    return [ ...editors ];
}
