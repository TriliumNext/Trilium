/**
 * The messages of a collaborative editing session of one text note. The server orders and relays
 * the operations of the editors and never reads them, so operations and model nodes travel as the
 * JSON that CKEditor produces.
 *
 * A session numbers its accepted operation batches: `version` is the number of batches accepted
 * since the session, or its last reset, started. `epoch` changes with every reset, so a message
 * from before a reset can be told apart and dropped.
 */

/** The model of an editor: the nodes of its main root and the ones the session deleted. */
export interface CollabSnapshot {
    main: unknown[];
    graveyard: unknown[];
}

/** Identifies the session and the editor in it. A window can show one note in several editors. */
interface CollabAddress {
    noteId: string;
    memberId: string;
}

export type CollabClientMessage = CollabAddress & ({
    type: "collab-join";
} | {
    type: "collab-leave";
} | {
    /** Operations made on top of `baseVersion`, which the server accepts only if it is current. */
    type: "collab-ops";
    epoch: number;
    baseVersion: number;
    ops: unknown[];
} | {
    /** The answer to a `collab-snapshot-request`. */
    type: "collab-snapshot";
    epoch: number;
    version: number;
    authoritative: boolean;
    snapshot: CollabSnapshot;
} | {
    /** A hash of the content at `version`, which the server compares between the editors. */
    type: "collab-hash";
    epoch: number;
    version: number;
    hash: string;
} | {
    /** The editor could not apply the operations of another one, and asks for a reset. */
    type: "collab-error";
    epoch: number;
});

export type CollabServerMessage = CollabAddress & ({
    /**
     * The editor is in the session. Without a `snapshot` it is the first one and keeps its
     * content; otherwise it loads the snapshot and applies `batches` on top.
     */
    type: "collab-joined";
    epoch: number;
    version: number;
    snapshot?: CollabSnapshot;
    batches: unknown[][];
    canWrite: boolean;
} | {
    type: "collab-denied";
} | {
    /** An accepted batch. For the editor that sent it, `isOwn` makes it the acknowledgement. */
    type: "collab-ops";
    epoch: number;
    version: number;
    isOwn: boolean;
    ops: unknown[];
} | {
    /** The batch was based on an older version. The editor sends it again once it caught up. */
    type: "collab-rejected";
    epoch: number;
} | {
    /**
     * Asks for the model of the editor. A regular request is answered once every operation of the
     * editor is acknowledged; an authoritative one right away, and its answer resets the session.
     */
    type: "collab-snapshot-request";
    epoch: number;
    authoritative: boolean;
} | {
    /**
     * The session starts over at version 0 with a new epoch. The editor whose content the others
     * take receives no `snapshot`.
     */
    type: "collab-reset";
    epoch: number;
    snapshot?: CollabSnapshot;
} | {
    /** Whether this editor is the one that saves the note. */
    type: "collab-saver";
    isSaver: boolean;
});
