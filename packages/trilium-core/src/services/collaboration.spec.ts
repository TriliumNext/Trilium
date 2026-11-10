import type { CollabClientMessage, WebSocketMessage } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import becca from "../becca/becca.js";
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

    const join = (noteId: string, kind: "text" | "code" = "text"): CollabClientMessage =>
        ({ type: "collab-join", noteId, memberId: "m", kind });

    it("lets a user join the session of a text note they can see, with their right to write", () => {
        const adminId = cls.init(() => userService.getAdminUserId());
        const ownerId = cls.init(() => userService.createUser("collab-owner-spec", null, false));
        const readerId = cls.init(() => userService.createUser("collab-reader-spec", null, false));
        const strangerId = cls.init(() => userService.createUser("collab-stranger-spec", null, false));
        const createNote = (type: "text" | "code" | "mermaid" | "canvas") => cls.init(() => noteService.createNewNote({
            parentNoteId: "root", ownerId, title: "shared", content: "", type
        }).note.noteId);
        const noteId = createNote("text");
        cls.init(() => permissionService.setUserAccess(noteId, readerId, false));

        const { provider, sent, disconnect } = buildProvider();
        const collaboration = initCollaboration(provider);
        const handle = collaboration.handleMessage;
        const joined = (clientId: string, joinedNoteId = noteId) => {
            sent.length = 0;
            handle(clientId, join(joinedNoteId));
            return summarize();
        };
        /** What was sent, without the lists of peers that follow every join and leave. */
        const summarize = () => sent
            .filter(({ message }) => message.type !== "collab-peers")
            .map(({ clientId, message }) => [ clientId, message.type, "canWrite" in message && message.canWrite ]);

        expect(joined(ownerId)).toEqual([ [ ownerId, "collab-joined", true ], [ ownerId, "collab-saver", false ] ]);
        // The owner is asked for its content once, on behalf of the editors that join after it.
        expect(joined(readerId)).toEqual([ [ ownerId, "collab-snapshot-request", false ] ]);
        expect(joined(adminId)).toEqual([]);

        expect(joined(strangerId)).toEqual([ [ strangerId, "collab-denied", false ] ]);
        expect(joined("anonymous")).toEqual([ [ "anonymous", "collab-denied", false ] ]);
        expect(joined(ownerId, "missing-note")).toEqual([ [ ownerId, "collab-denied", false ] ]);
        // A code note is edited with the code editor, and a note of another type with none.
        const codeNoteId = createNote("code");
        expect(joined(ownerId, codeNoteId)).toEqual([ [ ownerId, "collab-denied", false ] ]);
        sent.length = 0;
        handle(ownerId, join(codeNoteId, "code"));
        expect(summarize()).toEqual([ [ ownerId, "collab-joined", true ], [ ownerId, "collab-saver", false ] ]);
        sent.length = 0;
        handle(ownerId, join(noteId, "code"));
        expect(summarize()).toEqual([ [ ownerId, "collab-denied", false ] ]);
        // The source of a Mermaid diagram is edited in the code editor too.
        sent.length = 0;
        handle(ownerId, join(createNote("mermaid"), "code"));
        handle(ownerId, join(createNote("canvas"), "code"));
        expect(summarize()).toEqual([
            [ ownerId, "collab-joined", true ], [ ownerId, "collab-saver", false ], [ ownerId, "collab-denied", false ]
        ]);

        // Once the writers are gone, the reader that waited for their content joins without it.
        disconnect(adminId);
        sent.length = 0;
        disconnect(ownerId);
        expect(summarize()).toEqual([ [ readerId, "collab-joined", false ] ]);

        // The reader that follows the owner sees them by name, in the color of their avatar.
        handle(ownerId, join(noteId));
        const peers = sent.findLast(({ clientId, message }) => clientId === readerId && message.type === "collab-peers");
        expect(peers?.message).toMatchObject({
            peers: [ { userId: ownerId, username: "collab-owner-spec", avatarHue: expect.any(Number) } ]
        });

        // A reader who is given the right to write joins again to take it up, and one whose
        // access is removed is turned out of the session.
        sent.length = 0;
        collaboration.recheckUser(readerId);
        expect(summarize()).toEqual([]);
        cls.init(() => permissionService.setUserAccess(noteId, readerId, true));
        collaboration.recheckUser(readerId);
        expect(summarize()).toEqual([ [ readerId, "collab-rejoin", false ] ]);

        handle(readerId, join(noteId));
        sent.length = 0;
        cls.init(() => permissionService.revokeUserAccess(noteId, readerId));
        collaboration.recheckUser(readerId);
        expect(summarize()).toEqual([ [ readerId, "collab-denied", false ] ]);

        // A protected note has no session, and neither has a user who was deleted since they
        // signed in, even for a note they own.
        const protectedNoteId = createNote("text");
        becca.getNoteOrThrow(protectedNoteId).isProtected = true;
        expect(joined(ownerId, protectedNoteId)).toEqual([ [ ownerId, "collab-denied", false ] ]);
        cls.init(() => userService.deleteUser(ownerId));
        expect(joined(ownerId)).toEqual([ [ ownerId, "collab-denied", false ] ]);
    });

    it("turns down every editor on a provider that does not know the user of a connection", () => {
        const { provider, sent } = buildProvider();
        const collaboration = initCollaboration({ ...provider, getClientUserId: undefined });
        const handle = collaboration.handleMessage;
        collaboration.recheckUser("anyone");

        handle("client", join("root"));
        handle("client", { type: "collab-leave", noteId: "root", memberId: "m" });
        expect(sent).toEqual([ { clientId: "client", message: { type: "collab-denied", noteId: "root", memberId: "m" } } ]);
    });
});
