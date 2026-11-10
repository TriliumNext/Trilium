import type {
    CollabClientMessage, CollabEditorKind, CollabPeer, CollabServerMessage
} from "./collaboration.js";

/** What a session needs from the instance, so the sessions can run without a transport. */
export interface CollaborationHost {
    send(clientId: string, message: CollabServerMessage): void;
    /**
     * Who the user is and what they can do in a session of the note, or `null` when they cannot
     * join one with an editor of this kind.
     */
    getAccess(noteId: string, userId: string | undefined, kind: CollabEditorKind): CollaborationAccess | null;
}

export interface CollaborationAccess {
    canWrite: boolean;
    user: Omit<CollabPeer, "peerId">;
}

/** The number of versions whose content hash a session keeps to compare the editors. */
const KEPT_HASHES = 20;

interface Member {
    key: string;
    clientId: string;
    memberId: string;
    canWrite: boolean;
    /** How the other editors of the session see this one. */
    peer: CollabPeer;
}

interface Session {
    noteId: string;
    kind: CollabEditorKind;
    epoch: number;
    version: number;
    /** The accepted batches after version `logStart`, oldest first. */
    log: unknown[][];
    logStart: number;
    /** The newest model an editor reported, which an editor that joins starts from. */
    snapshot?: { version: number; snapshot: unknown };
    /** The editors in the session, in the order they joined. */
    members: Map<string, Member>;
    /** The editors that wait for a snapshot to join. */
    waiting: Map<string, Member>;
    hashes: Map<number, string>;
    /** The member whose model the pending reset takes. Nothing is accepted until it answers. */
    resetAuthority?: string;
    saver?: string;
    /** The number of editors that have joined, which names the next one. */
    peerCount: number;
}

/**
 * The collaborative editing sessions of the notes, one per note that is open in an editor. A
 * session orders the operation batches of its editors and relays them; it never reads them. The
 * editors transform their own operations (`Collaboration` in `packages/ckeditor5`,
 * `CodeCollaboration` in `packages/codemirror`), and the note is saved by one of them through
 * the regular route.
 *
 * The server runs it (`collaboration.ts` in `@triliumnext/core`). It lives here, outside the
 * barrel of this package, so that the specs of the editors run against it.
 */
export class CollaborationSessions {

    private sessions = new Map<string, Session>();

    constructor(private host: CollaborationHost) {}

    handleMessage(clientId: string, userId: string | undefined, message: CollabClientMessage) {
        if (typeof message.noteId !== "string" || typeof message.memberId !== "string") {
            return;
        }
        const key = `${clientId}:${message.memberId}`;

        if (message.type === "collab-join") {
            this.join(clientId, userId, message.noteId, message.memberId, message.kind);
            return;
        }

        const session = this.sessions.get(message.noteId);
        if (!session) {
            return;
        }
        if (message.type === "collab-leave") {
            this.remove(session, [ key ]);
            return;
        }

        const member = session.members.get(key);
        if (!member || message.epoch !== session.epoch) {
            return;
        }
        if (message.type === "collab-snapshot") {
            this.receiveSnapshot(session, member, message);
        } else if (session.resetAuthority) {
            // The reset discards whatever the editors sent before it.
        } else if (message.type === "collab-ops") {
            this.receiveOps(session, member, message.baseVersion, message.ops);
        } else if (message.type === "collab-hash") {
            this.receiveHash(session, message.version, message.hash);
        } else if (message.type === "collab-selection") {
            this.receiveSelection(session, member, message.version, message.selection);
        } else if (message.type === "collab-error") {
            this.startReset(session);
        }
    }

    /** Removes the editors of a closed connection from their sessions. */
    handleDisconnect(clientId: string) {
        for (const session of [ ...this.sessions.values() ]) {
            const keys = [ ...session.members.values(), ...session.waiting.values() ]
                .filter((member) => member.clientId === clientId)
                .map((member) => member.key);
            if (keys.length) {
                this.remove(session, keys);
            }
        }
    }

    private join(
        clientId: string, userId: string | undefined, noteId: string, memberId: string, kind: CollabEditorKind
    ) {
        const access = this.host.getAccess(noteId, userId, kind);
        // An editor of another kind would not understand the operations of the session.
        if (!access || (this.sessions.get(noteId)?.kind ?? kind) !== kind) {
            this.host.send(clientId, { type: "collab-denied", noteId, memberId });
            return;
        }

        let session = this.sessions.get(noteId);
        if (!session) {
            session = {
                noteId, kind, epoch: 1, version: 0, log: [], logStart: 0,
                members: new Map(), waiting: new Map(), hashes: new Map(), peerCount: 0
            };
            this.sessions.set(noteId, session);
        }

        const member: Member = {
            key: `${clientId}:${memberId}`,
            clientId,
            memberId,
            canWrite: access.canWrite,
            peer: { ...access.user, peerId: String(++session.peerCount) }
        };
        session.members.delete(member.key);
        session.waiting.delete(member.key);
        this.admit(session, member);
    }

    private admit(session: Session, member: Member) {
        const writers = getWriters(session);
        if (writers.length) {
            // Only an editor that can write is asked, since its model becomes the content of others.
            session.waiting.set(member.key, member);
            for (const writer of writers) {
                this.send(session, writer, { type: "collab-snapshot-request", epoch: session.epoch, authoritative: false });
            }
            return;
        }

        // Without a writer nothing has changed, so every editor holds the saved content.
        session.members.set(member.key, member);
        this.send(session, member, {
            type: "collab-joined", epoch: session.epoch, version: session.version, batches: [], canWrite: member.canWrite
        });
        this.updateSaver(session);
        this.sendPeers(session);
        if (member.canWrite && session.members.size > 1) {
            this.startReset(session);
        }
    }

    private remove(session: Session, keys: string[]) {
        for (const key of keys) {
            session.members.delete(key);
            session.waiting.delete(key);
        }
        if (!session.members.size && !session.waiting.size) {
            this.sessions.delete(session.noteId);
            return;
        }

        const lostAuthority = session.resetAuthority !== undefined && !session.members.has(session.resetAuthority);
        if (lostAuthority) {
            session.resetAuthority = undefined;
        }
        this.updateSaver(session);
        this.sendPeers(session);

        if (!getWriters(session).length) {
            // Nobody is left to provide a snapshot, so the waiting editors start from the saved content.
            const waiting = [ ...session.waiting.values() ];
            session.waiting.clear();
            if (!session.members.size) {
                this.restart(session);
            }
            for (const member of waiting) {
                this.admit(session, member);
            }
        } else if (lostAuthority) {
            this.startReset(session);
        }
    }

    private receiveOps(session: Session, member: Member, baseVersion: number, ops: unknown[]) {
        if (!member.canWrite || !Array.isArray(ops)) {
            return;
        }
        if (baseVersion !== session.version) {
            this.send(session, member, { type: "collab-rejected", epoch: session.epoch });
            return;
        }

        session.log.push(ops);
        session.version++;
        for (const other of session.members.values()) {
            this.send(session, other, {
                type: "collab-ops", epoch: session.epoch, version: session.version, isOwn: other === member, ops
            });
        }
    }

    private receiveSnapshot(
        session: Session,
        member: Member,
        message: { version: number; authoritative: boolean; snapshot: unknown }
    ) {
        const { snapshot, version } = message;
        if (!member.canWrite || snapshot === undefined || snapshot === null) {
            return;
        }

        if (message.authoritative) {
            if (session.resetAuthority !== member.key) {
                return;
            }
            this.restart(session);
            session.snapshot = { version: 0, snapshot };
            for (const other of session.members.values()) {
                this.send(session, other, {
                    type: "collab-reset",
                    epoch: session.epoch,
                    ...(other === member ? {} : { snapshot: session.snapshot.snapshot })
                });
            }
            this.admitWaiting(session);
            return;
        }

        if (session.resetAuthority) {
            return;
        }
        const isUsable = Number.isInteger(version)
            && version >= (session.snapshot?.version ?? session.logStart)
            && version <= session.version;
        if (isUsable) {
            session.snapshot = { version, snapshot };
            session.log.splice(0, version - session.logStart);
            session.logStart = version;
        }
        this.admitWaiting(session);
    }

    private admitWaiting(session: Session) {
        const { snapshot } = session;
        if (!snapshot) {
            return;
        }
        for (const member of session.waiting.values()) {
            session.members.set(member.key, member);
            this.send(session, member, {
                type: "collab-joined",
                epoch: session.epoch,
                version: session.version,
                snapshot: snapshot.snapshot,
                batches: session.log.slice(snapshot.version - session.logStart),
                canWrite: member.canWrite
            });
        }
        session.waiting.clear();
        this.updateSaver(session);
        this.sendPeers(session);
    }

    private receiveHash(session: Session, version: number, hash: string) {
        const known = session.hashes.get(version);
        if (known === undefined) {
            session.hashes.set(version, hash);
            if (session.hashes.size > KEPT_HASHES) {
                for (const oldest of session.hashes.keys()) {
                    session.hashes.delete(oldest);
                    break;
                }
            }
        } else if (known !== hash) {
            this.startReset(session);
        }
    }

    /** Relays a selection to the other editors, which hold the model it was made in. */
    private receiveSelection(session: Session, member: Member, version: number, selection: unknown) {
        if (version !== session.version) {
            this.send(session, member, { type: "collab-selection-rejected", epoch: session.epoch });
            return;
        }
        for (const other of session.members.values()) {
            if (other !== member) {
                this.send(session, other, {
                    type: "collab-selection", epoch: session.epoch, peerId: member.peer.peerId, selection
                });
            }
        }
    }

    /** Tells every editor who the others are. */
    private sendPeers(session: Session) {
        const members = [ ...session.members.values() ];
        for (const member of members) {
            const peers = members.filter((other) => other !== member).map((other) => other.peer);
            this.send(session, member, { type: "collab-peers", peers });
        }
    }

    /** Asks the saving editor for its model, which every other editor then loads. */
    private startReset(session: Session) {
        const saver = session.saver === undefined ? undefined : session.members.get(session.saver);
        if (session.resetAuthority || !saver) {
            return;
        }
        session.resetAuthority = saver.key;
        this.send(session, saver, { type: "collab-snapshot-request", epoch: session.epoch, authoritative: true });
    }

    private restart(session: Session) {
        session.epoch++;
        session.version = 0;
        session.log = [];
        session.logStart = 0;
        session.snapshot = undefined;
        session.hashes.clear();
        session.resetAuthority = undefined;
    }

    /** The editor that saves the note is the writer that has been in the session the longest. */
    private updateSaver(session: Session) {
        const saver = getWriters(session)[0];
        if (saver?.key === session.saver) {
            return;
        }
        const previous = session.saver === undefined ? undefined : session.members.get(session.saver);
        if (previous) {
            this.send(session, previous, { type: "collab-saver", isSaver: false });
        }
        session.saver = saver?.key;
        if (saver) {
            this.send(session, saver, { type: "collab-saver", isSaver: true });
        }
    }

    private send(session: Session, member: Member, message: SessionMessage) {
        this.host.send(member.clientId, { ...message, noteId: session.noteId, memberId: member.memberId } as CollabServerMessage);
    }

}

type SessionMessage = CollabServerMessage extends infer M ? M extends unknown ? Omit<M, "noteId" | "memberId"> : never : never;

function getWriters(session: Session) {
    return [ ...session.members.values() ].filter((member) => member.canWrite);
}
