import type { CKTextEditor } from "@triliumnext/ckeditor5";
import type { WebSocketMessage } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";

type Collaboration = typeof import("./collaboration");

describe("collaboration of the text editor", () => {
    let collaboration: Collaboration;
    let messageHandlers: ((message: WebSocketMessage) => void)[];
    let connectionHandlers: (() => void)[];
    const sendCollaborationMessage = vi.fn();
    const note = (isProtected = false) => ({ noteId: "note", isProtected }) as FNote;

    function buildEditor() {
        const plugin = {
            isActive: false,
            isSaver: false,
            noteId: undefined as string | undefined,
            start: vi.fn((session: { noteId: string }) => {
                plugin.isActive = true;
                plugin.noteId = session.noteId;
            }),
            stop: vi.fn(() => {
                plugin.isActive = false;
            }),
            receive: vi.fn(),
            rejoin: vi.fn()
        };
        const destroyHandlers: (() => void)[] = [];
        const editor = {
            plugins: { get: () => plugin },
            once: (_event: string, handler: () => void) => void destroyHandlers.push(handler)
        } as unknown as CKTextEditor;
        return { editor, plugin, destroy: () => destroyHandlers.map((handler) => handler()) };
    }

    beforeEach(async () => {
        vi.resetModules();
        messageHandlers = [];
        connectionHandlers = [];
        vi.doMock("../../../services/ws", () => ({
            sendCollaborationMessage,
            subscribeToMessages: (handler: (message: WebSocketMessage) => void) => messageHandlers.push(handler),
            subscribeToConnection: (handler: () => void) => connectionHandlers.push(handler)
        }));
        collaboration = await import("./collaboration");
        window.glob.currentUser = { userId: "user", username: "user", isAdmin: false, avatarHue: 0 };
    });

    afterEach(() => {
        window.glob.currentUser = undefined;
        vi.doUnmock("../../../services/ws");
    });

    it("joins the session of the note on an instance with users, unless the note is protected", () => {
        const { editor, plugin } = buildEditor();
        const onBecomeSaver = vi.fn();
        const onPeersChange = vi.fn();
        const callbacks = { onBecomeSaver, onPeersChange };

        collaboration.startCollaboration(editor, note(true), callbacks);
        window.glob.currentUser = undefined;
        collaboration.startCollaboration(editor, note(), callbacks);
        expect(plugin.start).not.toHaveBeenCalled();
        expect(collaboration.isCollaboratingOn(editor, "note")).toBe(false);
        expect(collaboration.isSavedByAnotherEditor(editor)).toBe(false);

        window.glob.currentUser = { userId: "user", username: "user", isAdmin: false, avatarHue: 0 };
        collaboration.startCollaboration(editor, note(), callbacks);
        const session = plugin.start.mock.calls[0]?.[0] as unknown as {
            noteId: string; memberId: string; send: unknown; onSaverChange(isSaver: boolean): void;
        };
        expect(session).toMatchObject({ noteId: "note", send: sendCollaborationMessage, onPeersChange });
        expect(session.memberId).toHaveLength(10);
        expect(collaboration.isCollaboratingOn(editor, "note")).toBe(true);
        expect(collaboration.isCollaboratingOn(editor, "other")).toBe(false);

        // Until the server makes this editor the saver, another one saves the note.
        expect(collaboration.isSavedByAnotherEditor(editor)).toBe(true);
        session.onSaverChange(false);
        expect(onBecomeSaver).not.toHaveBeenCalled();
        plugin.isSaver = true;
        session.onSaverChange(true);
        expect(onBecomeSaver).toHaveBeenCalledOnce();
        expect(collaboration.isSavedByAnotherEditor(editor)).toBe(false);
    });

    it("hands the messages of the server and each new connection to the editors in a session", () => {
        const first = buildEditor();
        const second = buildEditor();
        const third = buildEditor();
        for (const { editor } of [ first, second, third ]) {
            collaboration.startCollaboration(editor, note(), { onBecomeSaver: vi.fn(), onPeersChange: vi.fn() });
        }
        expect(messageHandlers).toHaveLength(1);
        expect(connectionHandlers).toHaveLength(1);

        collaboration.stopCollaboration(second.editor);
        expect(second.plugin.stop).toHaveBeenCalledOnce();
        third.destroy();

        const message = { type: "collab-saver", noteId: "note", memberId: "m", isSaver: true } as const;
        messageHandlers[0]?.(message);
        messageHandlers[0]?.({ type: "ping" });
        connectionHandlers[0]?.();
        expect(first.plugin.receive).toHaveBeenCalledExactlyOnceWith(message);
        expect(first.plugin.rejoin).toHaveBeenCalledOnce();
        expect(second.plugin.receive).not.toHaveBeenCalled();
        expect(third.plugin.rejoin).not.toHaveBeenCalled();
    });
});
