/**
 * The messages of a collaborative editing session of one note. The server orders and relays the
 * operations of the editors and never reads them: operations, snapshots and selections travel as
 * the JSON of the editor that produces them, which only an editor of the same kind understands.
 *
 * A session numbers its accepted operation batches: `version` is the number of batches accepted
 * since the session, or its last reset, started. `epoch` changes with every reset, so a message
 * from before a reset can be told apart and dropped.
 */

/**
 * The editor of a session: `text` is CKEditor on a text note, `code` is CodeMirror on a code
 * note. Every editor of a session is of the same kind.
 */
export type CollabEditorKind = "text" | "code";

/** The model of a text editor: the nodes of its main root and the ones the session deleted. */
export interface CollabTextSnapshot {
    main: unknown[];
    graveyard: unknown[];
}

/** The content of a code editor. */
export interface CollabCodeSnapshot {
    doc: string;
}

/** Another editor of the session, as its cursor and the list of who is editing show it. */
export interface CollabPeer {
    /** Identifies the editor in the session. A user with the note open twice is two peers. */
    peerId: string;
    userId: string;
    username: string;
    /** The user's hue on the color wheel, from `getAvatarHues()`. */
    avatarHue: number;
}

/** The selection of a text editor: its ranges as paths in the main root, and where the caret is. */
export interface CollabTextSelection {
    ranges: { start: number[]; end: number[] }[];
    isBackward: boolean;
}

/** The selection of a code editor: its ranges as offsets, each from its anchor to the caret. */
export interface CollabCodeSelection {
    ranges: { anchor: number; head: number }[];
}

/** Identifies the session and the editor in it. A window can show one note in several editors. */
interface CollabAddress {
    noteId: string;
    memberId: string;
}

export type CollabClientMessage = CollabAddress & ({
    type: "collab-join";
    kind: CollabEditorKind;
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
    snapshot: unknown;
} | {
    /** A hash of the content at `version`, which the server compares between the editors. */
    type: "collab-hash";
    epoch: number;
    version: number;
    hash: string;
} | {
    /**
     * The selection of the editor in the model of `version`, which the editor holds once all its
     * operations are acknowledged. The server relays it only while that version is current.
     */
    type: "collab-selection";
    epoch: number;
    version: number;
    selection: unknown;
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
    snapshot?: unknown;
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
    snapshot?: unknown;
} | {
    /** Whether this editor is the one that saves the note. */
    type: "collab-saver";
    isSaver: boolean;
} | {
    /** The other editors of the session, sent each time one joins or leaves. */
    type: "collab-peers";
    peers: CollabPeer[];
} | {
    /** The selection of another editor, in the model of the current version. */
    type: "collab-selection";
    epoch: number;
    peerId: string;
    selection: unknown;
} | {
    /** The selection was for an older version. The editor sends it again once it caught up. */
    type: "collab-selection-rejected";
    epoch: number;
});

/** What the host passes to put an editor in the session of a note. */
export interface CollabEditorSession {
    noteId: string;
    /** Identifies this editor among the ones that share a connection to the server. */
    memberId: string;
    send(message: CollabClientMessage): void;
    /** Called when the editor starts or stops being the one that saves the note. */
    onSaverChange?(isSaver: boolean): void;
    /** Called when an editor joins or leaves the session, with the other editors in it. */
    onPeersChange?(peers: CollabPeer[]): void;
}

/** The part of an editor that edits a note together with the others, whatever its kind. */
export interface CollabEditor {
    /** Whether the editor is in a session, or on its way into one. */
    readonly isActive: boolean;
    /** Whether this editor is the one that saves the note. */
    readonly isSaver: boolean;
    /** The note of the session the editor is in. */
    readonly noteId: string | undefined;
    /** Joins the session of a note. The editor is read-only until the server answers. */
    start(session: CollabEditorSession): void;
    stop(): void;
    /** Joins the session again after the connection to the server was lost. */
    rejoin(): void;
    /** Handles a message of the server. Messages for another editor or session are ignored. */
    receive(message: CollabServerMessage): void;
}
