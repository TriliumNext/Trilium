import { collab, receiveUpdates, sendableUpdates, type Update } from "@codemirror/collab";
import { ChangeSet, Compartment, EditorState, Prec, StateEffect, Transaction } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import type {
    CollabClientMessage, CollabCodeSelection, CollabCodeSnapshot, CollabEditor, CollabEditorSession, CollabPeer,
    CollabServerMessage
} from "@triliumnext/commons";

import {
    clearPeerSelections, peerCursors, type PeerRange, setPeers, setPeerSelection
} from "./collaboration_cursors.js";

type Outgoing = CollabClientMessage extends infer M ? M extends unknown ? Omit<M, "noteId" | "memberId"> : never : never;

/** How long the editor waits after the last batch before it reports the hash of its content. */
const HASH_DELAY = 500;

/** How long the editor waits after its selection moved before it sends it. */
const SELECTION_DELAY = 100;

/**
 * Edits a code note together with the other editors that have it open. The server orders the
 * batches of changes of the editors and relays them (`CollaborationSessions` in
 * `@triliumnext/core`), and `@codemirror/collab` rebases the local changes the server has not
 * accepted yet over the ones of the other editors.
 *
 * The protocol is the one of the text editor (`Collaboration` in `@triliumnext/ckeditor5`): the
 * editors report a hash of their content, and the server resets the session from one of them
 * when two hashes differ. Each editor also sends its selection, which the others show as a cursor.
 */
export default class CodeCollaboration implements CollabEditor {

    isSaver = false;

    private session?: CollabEditorSession;
    private state: "idle" | "joining" | "joined" | "resetting" = "idle";
    private canWrite = false;
    private epoch = 0;
    /** The number of batches of the server that this editor has applied. */
    private version = 0;
    /** Whether a batch is sent to the server and not acknowledged yet. */
    private isPushing = false;
    private isSnapshotRequested = false;
    private isSelectionDirty = false;
    private hashTimer?: ReturnType<typeof setTimeout>;
    private selectionTimer?: ReturnType<typeof setTimeout>;
    private peerIds = new Set<string>();
    /** Holds `collab()` while the editor is in a session. Each session starts it over. */
    private collabCompartment = new Compartment();
    private lockCompartment = new Compartment();

    constructor(private view: EditorView) {
        view.dispatch({
            effects: StateEffect.appendConfig.of([
                this.collabCompartment.of([]),
                this.lockCompartment.of([]),
                peerCursors,
                EditorView.updateListener.of((update: ViewUpdate) => this.onUpdate(update))
            ])
        });
    }

    get isActive() {
        return this.state !== "idle";
    }

    get noteId() {
        return this.session?.noteId;
    }

    start(session: CollabEditorSession) {
        this.stop();
        this.session = session;
        this.join();
    }

    rejoin() {
        if (this.session) {
            this.join();
        }
    }

    stop() {
        if (!this.session) {
            return;
        }
        this.send({ type: "collab-leave" });
        this.session = undefined;
        this.leave();
    }

    receive(message: CollabServerMessage) {
        const session = this.session;
        if (!session || message.memberId !== session.memberId || message.noteId !== session.noteId) {
            return;
        }

        if (message.type === "collab-denied") {
            this.session = undefined;
            this.leave();
        } else if (message.type === "collab-saver") {
            this.setSaver(message.isSaver);
        } else if (message.type === "collab-peers") {
            this.setPeers(message.peers);
        } else if (message.type === "collab-joined") {
            this.canWrite = message.canWrite;
            this.restart(message.epoch, message.snapshot as CollabCodeSnapshot | undefined, message.batches);
            this.version = message.version;
        } else if (message.type === "collab-reset") {
            this.restart(message.epoch, message.snapshot as CollabCodeSnapshot | undefined, []);
        } else if (message.epoch !== this.epoch || this.state === "joining") {
            // The message belongs to a session that was reset since.
        } else if (message.type === "collab-snapshot-request" && message.authoritative) {
            // The server gives this content to every other editor, so it must not change until
            // the reset arrives.
            this.sendSnapshot(true);
            this.setState("resetting");
        } else if (this.state !== "joined") {
            // The editor waits for a reset, which discards the rest.
        } else if (message.type === "collab-ops") {
            this.receiveBatch(message.ops, message.isOwn);
        } else if (message.type === "collab-rejected") {
            this.isPushing = false;
            this.push();
        } else if (message.type === "collab-selection") {
            this.showSelection(message.peerId, message.selection as CollabCodeSelection);
        } else if (message.type === "collab-selection-rejected") {
            this.scheduleSelection();
        } else {
            this.isSnapshotRequested = true;
            this.sendSnapshotWhenSettled();
        }
    }

    private join() {
        this.leave();
        this.setState("joining");
        this.send({ type: "collab-join", kind: "code" });
    }

    private leave() {
        clearTimeout(this.hashTimer);
        clearTimeout(this.selectionTimer);
        this.isPushing = false;
        this.isSnapshotRequested = false;
        this.setPeers([]);
        this.setSaver(false);
        this.setState("idle");
        this.view.dispatch({ effects: this.collabCompartment.reconfigure([]) });
    }

    /** Starts at version 0 of an epoch, from the snapshot or else from the content of the editor. */
    private restart(epoch: number, snapshot: CollabCodeSnapshot | undefined, batches: unknown[][]) {
        const { view } = this;
        this.epoch = epoch;
        this.version = 0;
        this.isPushing = false;
        this.isSnapshotRequested = false;
        // The changes below are not edits of the user, so they must not be sent.
        this.setState("resetting");

        // Taking `collab()` out and putting it back drops the changes it held for the server.
        view.dispatch({
            changes: snapshot && { from: 0, to: view.state.doc.length, insert: snapshot.doc },
            effects: [ this.collabCompartment.reconfigure([]), clearPeerSelections.of(null) ],
            annotations: [ Transaction.addToHistory.of(false), Transaction.remote.of(true) ]
        });
        view.dispatch({
            effects: this.collabCompartment.reconfigure(collab({ startVersion: 0, clientID: this.session?.memberId }))
        });
        try {
            for (const batch of batches) {
                view.dispatch(receiveUpdates(view.state, batch.map(toUpdate)));
            }
        } catch (error) {
            this.fail(error);
            return;
        }

        this.setState("joined");
        this.scheduleSelection();
    }

    private onUpdate(update: ViewUpdate) {
        if (this.state !== "joined") {
            return;
        }
        if (update.docChanged) {
            this.push();
        }
        if (update.selectionSet) {
            this.scheduleSelection();
        }
    }

    /** Sends the local changes as one batch, unless the previous one is still on its way. */
    private push() {
        const updates = sendableUpdates(this.view.state);
        if (this.isPushing || !updates.length) {
            return;
        }
        this.isPushing = true;
        this.send({
            type: "collab-ops",
            epoch: this.epoch,
            baseVersion: this.version,
            ops: updates.map(({ clientID, changes }) => ({ clientID, changes: changes.toJSON() }))
        });
    }

    private receiveBatch(ops: unknown[], isOwn: boolean) {
        this.version++;
        try {
            // The editor's own batch comes back too, which is how `collab()` learns it was accepted.
            this.view.dispatch(receiveUpdates(this.view.state, ops.map(toUpdate)));
        } catch (error) {
            this.fail(error);
            return;
        }
        if (isOwn) {
            this.isPushing = false;
            this.push();
        }

        this.sendSnapshotWhenSettled();
        clearTimeout(this.hashTimer);
        this.hashTimer = setTimeout(() => this.sendHash(), HASH_DELAY);
        if (this.isSelectionDirty) {
            this.scheduleSelection();
        }
    }

    /** Whether the server has accepted every local change, so the content is the one of `version`. */
    private get isSettled() {
        return this.state === "joined" && !this.isPushing && !sendableUpdates(this.view.state).length;
    }

    private sendSnapshot(authoritative: boolean) {
        const snapshot: CollabCodeSnapshot = { doc: this.view.state.doc.toString() };
        this.send({ type: "collab-snapshot", epoch: this.epoch, version: this.version, authoritative, snapshot });
    }

    private sendSnapshotWhenSettled() {
        if (this.isSnapshotRequested && this.isSettled) {
            this.isSnapshotRequested = false;
            this.sendSnapshot(false);
        }
    }

    private sendHash() {
        if (this.isSettled) {
            const hash = hashText(this.view.state.doc.toString());
            this.send({ type: "collab-hash", epoch: this.epoch, version: this.version, hash });
        }
    }

    private setPeers(peers: CollabPeer[]) {
        const hasNewPeer = peers.some((peer) => !this.peerIds.has(peer.peerId));
        this.peerIds = new Set(peers.map((peer) => peer.peerId));
        this.view.dispatch({ effects: setPeers.of(peers) });
        this.session?.onPeersChange?.(peers);
        if (hasNewPeer) {
            // An editor that just joined has not seen the selection yet.
            this.scheduleSelection();
        }
    }

    /** Sends the selection once it has stopped moving and the editor is settled. */
    private scheduleSelection() {
        this.isSelectionDirty = true;
        clearTimeout(this.selectionTimer);
        this.selectionTimer = setTimeout(() => this.sendSelection(), SELECTION_DELAY);
    }

    private sendSelection() {
        // The offsets only mean the same to the other editors in the content of a version. An
        // editor that is not settled sends once its last batch is acknowledged.
        if (!this.isSettled) {
            return;
        }
        this.isSelectionDirty = false;
        const selection: CollabCodeSelection = {
            ranges: this.view.state.selection.ranges.map(({ anchor, head }) => ({ anchor, head }))
        };
        this.send({ type: "collab-selection", epoch: this.epoch, version: this.version, selection });
    }

    /** Shows the selection of another editor, which is given in the content of the current version. */
    private showSelection(peerId: string, selection: CollabCodeSelection) {
        if (!this.peerIds.has(peerId)) {
            return;
        }
        const { state } = this.view;
        // This editor is ahead of that version by its own unacknowledged changes.
        const local = sendableUpdates(state).map((update) => update.changes);
        const base = local.reduce((length, changes) => length - changes.newLength + changes.length, state.doc.length);
        const toLocal = (position: number) => local.reduce((mapped, changes) => changes.mapPos(mapped, 1), position);

        const isValid = (position: unknown) => Number.isInteger(position) && (position as number) >= 0
            && (position as number) <= base;
        const ranges: PeerRange[] = Array.isArray(selection?.ranges)
            && selection.ranges.every(({ anchor, head }) => isValid(anchor) && isValid(head))
            ? selection.ranges.map(({ anchor, head }) => ({ anchor: toLocal(anchor), head: toLocal(head) }))
            : [];
        this.view.dispatch({ effects: setPeerSelection.of({ peerId, ranges }) });
    }

    private fail(error: unknown) {
        console.warn("Collaboration: could not apply the changes of another editor, asking for a reset.", error);
        this.send({ type: "collab-error", epoch: this.epoch });
        this.setState("resetting");
    }

    private setSaver(isSaver: boolean) {
        if (this.isSaver !== isSaver) {
            this.isSaver = isSaver;
            this.session?.onSaverChange?.(isSaver);
        }
    }

    /** The editor is read-only while it has no session state to edit, and for a user who cannot write. */
    private setState(state: CodeCollaboration["state"]) {
        this.state = state;
        const isLocked = state === "joining" || state === "resetting" || (state === "joined" && !this.canWrite);
        // The editor has a read-only setting of its own, which this lock must outrank.
        this.view.dispatch({
            effects: this.lockCompartment.reconfigure(isLocked ? Prec.highest(EditorState.readOnly.of(true)) : [])
        });
    }

    /** Sends a message of the session, which every caller is in. */
    private send(message: Outgoing) {
        const session = this.session as CollabEditorSession;
        session.send({ ...message, noteId: session.noteId, memberId: session.memberId } as CollabClientMessage);
    }

}

function toUpdate(json: unknown): Update {
    const { clientID, changes } = json as { clientID: string; changes: unknown };
    return { clientID, changes: ChangeSet.fromJSON(changes) };
}

/** An FNV-1a hash of the text. */
function hashText(text: string) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
    }
    return (hash >>> 0).toString(16);
}
