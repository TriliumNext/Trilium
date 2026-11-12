import type { CollabEditor, CollabEditorSession, WebSocketMessage } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../entities/fnote";

type Collaboration = typeof import("./collaboration");

describe("collaboration of the editors", () => {
    let collaboration: Collaboration;
    let messageHandlers: ((message: WebSocketMessage) => void)[];
    let connectionHandlers: (() => void)[];
    const sendCollaborationMessage = vi.fn();
    const note = (isProtected = false) => ({ noteId: "note", isProtected }) as FNote;
    const user = { userId: "user", username: "user", isAdmin: false, avatarHue: 0 };

    function buildEditor() {
        const editor = {
            isActive: false,
            isSaver: false,
            noteId: undefined as string | undefined,
            start: vi.fn((session: CollabEditorSession) => {
                editor.isActive = true;
                editor.noteId = session.noteId;
            }),
            stop: vi.fn(() => {
                editor.isActive = false;
            }),
            receive: vi.fn(),
            rejoin: vi.fn()
        };
        return editor satisfies CollabEditor;
    }

    beforeEach(async () => {
        vi.resetModules();
        messageHandlers = [];
        connectionHandlers = [];
        vi.doMock("./ws", () => ({
            sendCollaborationMessage,
            subscribeToMessages: (handler: (message: WebSocketMessage) => void) => messageHandlers.push(handler),
            subscribeToConnection: (handler: () => void) => connectionHandlers.push(handler)
        }));
        collaboration = await import("./collaboration");
        window.glob.currentUser = user;
    });

    afterEach(() => {
        window.glob.currentUser = undefined;
        vi.doUnmock("./ws");
    });

    it("joins the session of the note on an instance with users, unless the note is protected", () => {
        const editor = buildEditor();
        const onBecomeSaver = vi.fn();
        const onPeersChange = vi.fn();
        const callbacks = { onBecomeSaver, onPeersChange };

        collaboration.startCollaboration(editor, note(true), callbacks);
        window.glob.currentUser = undefined;
        collaboration.startCollaboration(editor, note(), callbacks);
        expect(editor.start).not.toHaveBeenCalled();
        expect(collaboration.isCollaboratingOn(editor, "note")).toBe(false);
        expect(collaboration.isSavedByAnotherEditor(editor)).toBe(false);

        window.glob.currentUser = user;
        collaboration.startCollaboration(editor, note(), callbacks);
        const session = editor.start.mock.calls[0]?.[0];
        expect(session).toMatchObject({ noteId: "note", send: sendCollaborationMessage, onPeersChange });
        expect(session?.memberId).toHaveLength(10);
        expect(collaboration.isCollaboratingOn(editor, "note")).toBe(true);
        expect(collaboration.isCollaboratingOn(editor, "other")).toBe(false);

        // Until the server makes this editor the saver, another one saves the note.
        expect(collaboration.isSavedByAnotherEditor(editor)).toBe(true);
        session?.onSaverChange?.(false);
        expect(onBecomeSaver).not.toHaveBeenCalled();
        editor.isSaver = true;
        session?.onSaverChange?.(true);
        expect(onBecomeSaver).toHaveBeenCalledOnce();
        expect(collaboration.isSavedByAnotherEditor(editor)).toBe(false);
    });

    it("hands the messages of the server and each new connection to the editors in a session", () => {
        const first = buildEditor();
        const second = buildEditor();
        const third = buildEditor();
        for (const editor of [ first, second, third ]) {
            collaboration.startCollaboration(editor, note(), { onBecomeSaver: vi.fn(), onPeersChange: vi.fn() });
        }
        expect(messageHandlers).toHaveLength(1);
        expect(connectionHandlers).toHaveLength(1);

        collaboration.stopCollaboration(second);
        expect(second.stop).toHaveBeenCalledOnce();
        // An editor that was destroyed, or that the server turned down, left by itself.
        third.isActive = false;

        const message = { type: "collab-saver", noteId: "note", memberId: "m", isSaver: true } as const;
        messageHandlers[0]?.(message);
        messageHandlers[0]?.({ type: "ping" });
        connectionHandlers[0]?.();
        expect(first.receive).toHaveBeenCalledExactlyOnceWith(message);
        expect(first.rejoin).toHaveBeenCalledOnce();
        expect(second.receive).not.toHaveBeenCalled();
        expect(third.receive).not.toHaveBeenCalled();
        expect(third.rejoin).not.toHaveBeenCalled();
    });
});
