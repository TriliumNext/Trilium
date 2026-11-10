import { type CollabClientMessage, type CollabEditorKind, getAvatarHues } from "@triliumnext/commons";
import { CollaborationSessions } from "@triliumnext/commons/src/lib/collaboration_sessions";

import becca from "../becca/becca.js";

import type { MessagingProvider } from "./messaging/types.js";
import permissionService from "./permission_service.js";
import userService from "./user_service.js";

/** What the instance does with the sessions it runs. */
export interface Collaboration {
    handleMessage(clientId: string, message: CollabClientMessage): void;
    /** Reads again what a user can do in their sessions, after their access to notes changed. */
    recheckUser(userId: string): void;
}

/**
 * Runs the sessions over the messaging provider. Only a provider that knows the user of each
 * connection can carry them, which leaves out the desktop window and the standalone app: there,
 * an editor that asks to join is turned down.
 */
export function initCollaboration(provider: MessagingProvider): Collaboration {
    if (!provider.getClientUserId || !provider.onClientDisconnected) {
        return {
            handleMessage(clientId, message) {
                if (message.type === "collab-join") {
                    const { noteId, memberId } = message;
                    provider.sendMessageToClient(clientId, { type: "collab-denied", noteId, memberId });
                }
            },
            recheckUser() {}
        };
    }

    const sessions = new CollaborationSessions({
        send: (clientId, message) => provider.sendMessageToClient(clientId, message),
        getAccess: getNoteAccess
    });
    provider.onClientDisconnected((clientId) => sessions.handleDisconnect(clientId));
    return {
        handleMessage: (clientId, message) =>
            sessions.handleMessage(clientId, provider.getClientUserId?.(clientId), message),
        recheckUser: (userId) => sessions.recheckUser(userId)
    };
}

/** The kind of editor that edits the notes of a type together. */
const EDITOR_KINDS: Partial<Record<string, CollabEditorKind>> = {
    text: "text",
    code: "code",
    mermaid: "code"
};

/**
 * A user joins the session of a note they can read with the editor of its type, unless the note
 * is protected.
 */
function getNoteAccess(noteId: string, userId: string | undefined, kind: CollabEditorKind) {
    const note = becca.allNotes[noteId];
    if (!userId || !note || EDITOR_KINDS[note.type] !== kind || note.isProtected) {
        return null;
    }
    // The connection has no scope of its own, so the rights are read for the user by name.
    if (!permissionService.canUserAccessNote(noteId, userId)) {
        return null;
    }
    const users = userService.listUsers();
    const user = users.find((candidate) => candidate.userId === userId);
    if (!user) {
        return null;
    }
    return {
        canWrite: permissionService.canUserWriteNote(noteId, userId),
        user: { userId, username: user.username, avatarHue: getAvatarHues(users).get(userId) ?? 0 }
    };
}
