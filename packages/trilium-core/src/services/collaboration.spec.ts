import type { CollabClientMessage, WebSocketMessage } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { initCollaboration } from "./collaboration.js";
import * as cls from "./context.js";
import type { MessagingProvider } from "./messaging/types.js";
import noteService from "./notes.js";
import permissionService from "./permission_service.js";
import userService from "./user_service.js";

describe("collaboration over the messaging provider", () => {
    /** A provider whose connections are named after their user. */
    function buildProvider() {
        const sent: { clientId: string; message: WebSocketMessage }[] = [];
        const disconnectHandlers: ((clientId: string) => void)[] = [];
        const provider = {
            sendMessageToClient(clientId: string, message: WebSocketMessage) {
                sent.push({ clientId, message });
                return true;
            },
            getClientUserId: (clientId: string) => (clientId === "anonymous" ? undefined : clientId),
            onClientDisconnected: (handler: (clientId: string) => void) => void disconnectHandlers.push(handler)
        } as unknown as MessagingProvider;
        return { provider, sent, disconnect: (clientId: string) => disconnectHandlers.map((handler) => handler(clientId)) };
    }

    const join = (noteId: string): CollabClientMessage => ({ type: "collab-join", noteId, memberId: "m" });

    it("lets a user join the session of a text note they can see, with their right to write", () => {
        const adminId = cls.init(() => userService.getAdminUserId());
        const ownerId = cls.init(() => userService.createUser("collab-owner-spec", null, false));
        const readerId = cls.init(() => userService.createUser("collab-reader-spec", null, false));
        const strangerId = cls.init(() => userService.createUser("collab-stranger-spec", null, false));
        const createNote = (type: "text" | "code", isProtected = false) => cls.init(() => noteService.createNewNote({
            parentNoteId: "root", ownerId, title: "shared", content: "", type, isProtected
        }).note.noteId);
        const noteId = createNote("text");
        cls.init(() => permissionService.setUserAccess(noteId, readerId, false));

        const { provider, sent, disconnect } = buildProvider();
        const handle = initCollaboration(provider);
        const joined = (clientId: string, joinedNoteId = noteId) => {
            sent.length = 0;
            handle(clientId, join(joinedNoteId));
            return sent.map(({ clientId: target, message }) => [ target, message.type, "canWrite" in message && message.canWrite ]);
        };

        expect(joined(ownerId)).toEqual([ [ ownerId, "collab-joined", true ], [ ownerId, "collab-saver", false ] ]);
        // The owner is asked for its content on behalf of each editor that joins after it.
        expect(joined(readerId)).toEqual([ [ ownerId, "collab-snapshot-request", false ] ]);
        expect(joined(adminId)).toEqual([ [ ownerId, "collab-snapshot-request", false ] ]);

        expect(joined(strangerId)).toEqual([ [ strangerId, "collab-denied", false ] ]);
        expect(joined("anonymous")).toEqual([ [ "anonymous", "collab-denied", false ] ]);
        expect(joined(ownerId, "missing-note")).toEqual([ [ ownerId, "collab-denied", false ] ]);
        expect(joined(ownerId, createNote("code"))).toEqual([ [ ownerId, "collab-denied", false ] ]);

        // Once the writers are gone, the reader that waited for their content joins without it.
        disconnect(adminId);
        sent.length = 0;
        disconnect(ownerId);
        expect(sent.map(({ clientId, message }) => [ clientId, message.type, "canWrite" in message && message.canWrite ]))
            .toEqual([ [ readerId, "collab-joined", false ] ]);
    });

    it("turns down every editor on a provider that does not know the user of a connection", () => {
        const { provider, sent } = buildProvider();
        const handle = initCollaboration({ ...provider, getClientUserId: undefined });

        handle("client", join("root"));
        handle("client", { type: "collab-leave", noteId: "root", memberId: "m" });
        expect(sent).toEqual([ { clientId: "client", message: { type: "collab-denied", noteId: "root", memberId: "m" } } ]);
    });
});
