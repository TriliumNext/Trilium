import type { CollabClientMessage, CollabServerMessage } from "@triliumnext/commons";
import { beforeEach, describe, expect, it } from "vitest";

import { CollaborationSessions } from "./collaboration_sessions.js";

type Sent = CollabServerMessage & { clientId: string };

describe("CollaborationSessions", () => {
    let sent: Sent[];
    let sessions: CollaborationSessions;
    /** The access of each user; a user that is not listed cannot join. */
    let access: Record<string, { canWrite: boolean }>;

    beforeEach(() => {
        sent = [];
        access = { writer: { canWrite: true }, other: { canWrite: true }, reader: { canWrite: false } };
        sessions = new CollaborationSessions({
            send: (clientId, message) => sent.push({ ...message, clientId }),
            getAccess: (_noteId, userId) => (userId ? access[userId] ?? null : null)
        });
    });

    /** Sends a message of the client, whose user has the same name, and returns what it caused. */
    function send(clientId: string, message: Record<string, unknown> & { type: CollabClientMessage["type"] }) {
        const before = sent.length;
        const userId = clientId.replace(/\d+$/, "");
        sessions.handleMessage(clientId, userId, { noteId: "note", memberId: "m", ...message } as CollabClientMessage);
        return sent.slice(before).map(({ noteId: _noteId, memberId: _memberId, ...rest }) => rest);
    }

    const snapshot = { main: [ { name: "paragraph" } ], graveyard: [ { data: "x" } ] };

    /** Puts `writer` and `other` in the session, the latter from the snapshot of the former. */
    function joinTwoWriters() {
        send("writer", { type: "collab-join" });
        send("other", { type: "collab-join" });
        send("writer", { type: "collab-snapshot", epoch: 1, version: 0, authoritative: false, snapshot });
    }

    it("lets the first editor keep its content and makes it the saver", () => {
        expect(send("writer", { type: "collab-join" })).toEqual([
            { clientId: "writer", type: "collab-joined", epoch: 1, version: 0, batches: [], canWrite: true },
            { clientId: "writer", type: "collab-saver", isSaver: true }
        ]);
        expect(send("stranger", { type: "collab-join" })).toEqual([ { clientId: "stranger", type: "collab-denied" } ]);
        expect(sent.every((message) => message.noteId === "note" && message.memberId === "m")).toBe(true);
    });

    it("joins a later editor from a snapshot and the batches accepted after it", () => {
        send("writer", { type: "collab-join" });
        expect(send("other", { type: "collab-join" })).toEqual([
            { clientId: "writer", type: "collab-snapshot-request", epoch: 1, authoritative: false }
        ]);

        // A batch accepted between the snapshot and its arrival reaches the new editor with it.
        send("writer", { type: "collab-ops", epoch: 1, baseVersion: 0, ops: [ "a" ] });
        expect(send("writer", { type: "collab-snapshot", epoch: 1, version: 0, authoritative: false, snapshot })).toEqual([
            { clientId: "other", type: "collab-joined", epoch: 1, version: 1, snapshot, batches: [ [ "a" ] ], canWrite: true }
        ]);

        // A snapshot from a reader is refused, since its model would become the content of others.
        send("reader", { type: "collab-join" });
        send("writer", { type: "collab-snapshot", epoch: 1, version: 1, authoritative: false, snapshot });
        send("stranger", { type: "collab-join" });
        const forged = { main: [ "forged" ], graveyard: [] };
        send("reader", { type: "collab-snapshot", epoch: 1, version: 1, authoritative: false, snapshot: forged });
        send("another1", { type: "collab-join" });
        expect(sent.some((message) => "snapshot" in message && message.snapshot === forged)).toBe(false);
    });

    it("orders the batches, rejects a stale one and ignores a reader and an old epoch", () => {
        joinTwoWriters();
        send("reader", { type: "collab-join" });
        send("writer", { type: "collab-snapshot", epoch: 1, version: 0, authoritative: false, snapshot });

        expect(send("writer", { type: "collab-ops", epoch: 1, baseVersion: 0, ops: [ "a" ] })).toEqual([
            { clientId: "writer", type: "collab-ops", epoch: 1, version: 1, isOwn: true, ops: [ "a" ] },
            { clientId: "other", type: "collab-ops", epoch: 1, version: 1, isOwn: false, ops: [ "a" ] },
            { clientId: "reader", type: "collab-ops", epoch: 1, version: 1, isOwn: false, ops: [ "a" ] }
        ]);
        expect(send("other", { type: "collab-ops", epoch: 1, baseVersion: 0, ops: [ "b" ] })).toEqual([
            { clientId: "other", type: "collab-rejected", epoch: 1 }
        ]);
        expect(send("reader", { type: "collab-ops", epoch: 1, baseVersion: 1, ops: [ "c" ] })).toEqual([]);
        expect(send("other", { type: "collab-ops", epoch: 0, baseVersion: 1, ops: [ "d" ] })).toEqual([]);
    });

    it("resets the session from the saver when the hashes differ or an editor fails", () => {
        joinTwoWriters();
        send("writer", { type: "collab-ops", epoch: 1, baseVersion: 0, ops: [ "a" ] });

        expect(send("writer", { type: "collab-hash", epoch: 1, version: 1, hash: "one" })).toEqual([]);
        expect(send("other", { type: "collab-hash", epoch: 1, version: 1, hash: "one" })).toEqual([]);
        expect(send("other", { type: "collab-hash", epoch: 1, version: 1, hash: "two" })).toEqual([
            { clientId: "writer", type: "collab-snapshot-request", epoch: 1, authoritative: true }
        ]);

        // Until the saver answers, nothing is accepted, and only its answer counts.
        expect(send("other", { type: "collab-ops", epoch: 1, baseVersion: 1, ops: [ "b" ] })).toEqual([]);
        expect(send("other", { type: "collab-snapshot", epoch: 1, version: 1, authoritative: true, snapshot })).toEqual([]);
        expect(send("writer", { type: "collab-snapshot", epoch: 1, version: 1, authoritative: true, snapshot })).toEqual([
            { clientId: "writer", type: "collab-reset", epoch: 2 },
            { clientId: "other", type: "collab-reset", epoch: 2, snapshot: { main: snapshot.main, graveyard: [] } }
        ]);
        expect(send("other", { type: "collab-ops", epoch: 2, baseVersion: 0, ops: [ "c" ] })).toHaveLength(2);

        expect(send("other", { type: "collab-error", epoch: 2 })).toEqual([
            { clientId: "writer", type: "collab-snapshot-request", epoch: 2, authoritative: true }
        ]);
    });

    it("passes the saving on when the saver leaves, and asks the next one for a pending reset", () => {
        joinTwoWriters();
        send("other", { type: "collab-error", epoch: 1 });

        const before = sent.length;
        sessions.handleDisconnect("writer");
        expect(sent.slice(before).map(({ clientId, type }) => ({ clientId, type }))).toEqual([
            { clientId: "other", type: "collab-saver" },
            { clientId: "other", type: "collab-snapshot-request" }
        ]);

        // The session ends with its last editor, so the next one starts a new one.
        send("other", { type: "collab-leave" });
        expect(send("writer", { type: "collab-join" })[0]).toMatchObject({ type: "collab-joined", epoch: 1, version: 0 });
    });

    it("takes the content of a writer that joins readers, and of the saved note once the writers left", () => {
        send("reader", { type: "collab-join" });
        expect(send("writer", { type: "collab-join" })).toEqual([
            { clientId: "writer", type: "collab-joined", epoch: 1, version: 0, batches: [], canWrite: true },
            { clientId: "writer", type: "collab-saver", isSaver: true },
            { clientId: "writer", type: "collab-snapshot-request", epoch: 1, authoritative: true }
        ]);

        // An editor that waits for the snapshot of a writer that left joins without one.
        send("other", { type: "collab-join" });
        const before = sent.length;
        sessions.handleDisconnect("writer");
        expect(sent.slice(before).map(({ clientId, type }) => ({ clientId, type }))).toEqual([
            { clientId: "other", type: "collab-joined" },
            { clientId: "other", type: "collab-saver" },
            { clientId: "other", type: "collab-snapshot-request" }
        ]);
    });
});
