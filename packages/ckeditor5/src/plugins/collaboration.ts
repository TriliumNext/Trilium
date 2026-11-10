import type {
    CollabClientMessage, CollabPeer, CollabSelection, CollabServerMessage, CollabSnapshot
} from "@triliumnext/commons";
import {
    type ModelRootElement, type ModelWriter, type Operation, OperationFactory, Plugin, transformOperationSets
} from "ckeditor5";

import PeerCursors from "./collaboration_cursors.js";

/** What the host passes to put the editor in the session of a note. */
export interface CollaborationSession {
    noteId: string;
    /** Identifies this editor among the ones that share a connection to the server. */
    memberId: string;
    send(message: CollabClientMessage): void;
    /** Called when the editor starts or stops being the one that saves the note. */
    onSaverChange?(isSaver: boolean): void;
    /** Called when an editor joins or leaves the session, with the other editors in it. */
    onPeersChange?(peers: CollabPeer[]): void;
}

type Outgoing = CollabClientMessage extends infer M ? M extends unknown ? Omit<M, "noteId" | "memberId"> : never : never;

const READ_ONLY_LOCK = "collaboration";

/** How long the editor waits after the last batch before it reports the hash of its content. */
const HASH_DELAY = 500;

/** How long the editor waits after its selection moved before it sends it. */
const SELECTION_DELAY = 100;

/**
 * Edits a note together with the other editors that have it open. The server orders the operation
 * batches of the editors and relays them (`CollaborationSessions` in `@triliumnext/core`); this
 * plugin sends the local operations, and transforms the ones of other editors over the local
 * operations the server has not accepted yet.
 *
 * The transformations of CKEditor do not always converge, so the editors report a hash of their
 * content, and the server resets the session from one editor when two hashes differ or when an
 * editor cannot apply a batch.
 *
 * Each editor also sends its selection, which the others show as a cursor (`PeerCursors`).
 */
export default class Collaboration extends Plugin {

    static get pluginName() {
        return "Collaboration" as const;
    }

    /** Whether this editor is the one that saves the note. */
    isSaver = false;

    private session?: CollaborationSession;
    private state: "idle" | "joining" | "joined" | "resetting" = "idle";
    private canWrite = false;
    private epoch = 0;
    /** The number of batches of the server that this editor has applied. */
    private version = 0;
    /** The local operations sent to the server and not acknowledged yet. */
    private inFlight: Operation[] = [];
    /** The local operations not sent yet. */
    private pending: Operation[] = [];
    /**
     * The size of the end of the graveyard that holds what the editor deleted outside the session.
     * Operations address the graveyard from its start, so the part before it matches the other editors.
     */
    private junkSize = 0;
    private isApplying = false;
    private isSnapshotRequested = false;
    private hashTimer?: ReturnType<typeof setTimeout>;
    private cursors!: PeerCursors;
    /** Whether the selection changed since the editor sent it, or the server did not relay it. */
    private isSelectionDirty = false;
    private selectionTimer?: ReturnType<typeof setTimeout>;

    init() {
        const model = this.editor.model;
        this.cursors = new PeerCursors(this.editor);

        model.on("applyOperation", (_event, [ operation ]: [ Operation ]) => {
            // A post-fixer adds its operations to the batch it fixes, so the ones that follow
            // the operations of another editor are not local. Each editor makes them itself.
            const isLocal = this.state === "joined" && !this.isApplying && operation.batch?.isLocal;
            if (isLocal && operation.isDocumentOperation) {
                this.pending.push(operation);
            }
        }, { priority: "lowest" });
        model.document.on("change", () => this.flush());
        // An edit elsewhere moves the selection too, which the other editors work out themselves.
        model.document.selection.on("change:range", (_event, { directChange }) => {
            if (directChange && this.isActive) {
                this.scheduleSelection();
            }
        });
    }

    override destroy() {
        this.stop();
        super.destroy();
    }

    /** Whether the editor is in a session, or on its way into one. */
    get isActive() {
        return this.state !== "idle";
    }

    /** The note of the session the editor is in. */
    get noteId() {
        return this.session?.noteId;
    }

    /** Joins the session of a note. The editor is read-only until the server answers. */
    start(session: CollaborationSession) {
        this.stop();
        this.session = session;
        this.join();
    }

    /** Joins the session again after the connection to the server was lost. */
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

    /** Handles a message of the server. Messages for another editor or session are ignored. */
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
            this.restart(message.epoch, message.snapshot, message.batches);
            this.version = message.version;
        } else if (message.type === "collab-reset") {
            this.restart(message.epoch, message.snapshot, []);
        } else if (message.epoch !== this.epoch || this.state === "joining") {
            // The message belongs to a session that was reset since.
        } else if (message.type === "collab-snapshot-request" && message.authoritative) {
            // The server gives this model to every other editor, so the model must not change
            // until the reset arrives.
            this.send({
                type: "collab-snapshot",
                epoch: this.epoch,
                version: this.version,
                authoritative: true,
                snapshot: { main: this.takeSnapshot().main, graveyard: [] }
            });
            this.suspend();
        } else if (this.state !== "joined") {
            // The editor waits for a reset, which discards the rest.
        } else if (message.type === "collab-ops") {
            this.receiveBatch(message.ops, message.isOwn);
        } else if (message.type === "collab-rejected") {
            this.sendInFlight();
        } else if (message.type === "collab-selection") {
            this.showSelection(message.peerId, message.selection);
        } else if (message.type === "collab-selection-rejected") {
            this.scheduleSelection();
        } else {
            this.isSnapshotRequested = true;
            this.sendSnapshotWhenSettled();
        }
    }

    private join() {
        this.leave();
        this.state = "joining";
        this.updateLock();
        this.send({ type: "collab-join" });
    }

    private leave() {
        clearTimeout(this.hashTimer);
        clearTimeout(this.selectionTimer);
        this.setPeers([]);
        this.state = "idle";
        this.inFlight = [];
        this.pending = [];
        this.isSnapshotRequested = false;
        this.setSaver(false);
        this.updateLock();
    }

    /** Stops sending and accepting operations until the server resets the session. */
    private suspend() {
        this.state = "resetting";
        this.inFlight = [];
        this.pending = [];
        this.updateLock();
    }

    /** Starts at version 0 of an epoch, from the snapshot or else from the content of the editor. */
    private restart(epoch: number, snapshot: CollabSnapshot | undefined, batches: unknown[][]) {
        const model = this.editor.model;
        this.epoch = epoch;
        this.version = 0;
        this.inFlight = [];
        this.pending = [];
        this.isSnapshotRequested = false;

        try {
            if (snapshot) {
                this.loadSnapshot(snapshot);
            } else {
                this.junkSize = model.document.graveyard.maxOffset;
            }
            for (const batch of batches) {
                this.applyRemote(batch.map((json) => OperationFactory.fromJSON(json, model.document)));
            }
        } catch (error) {
            this.fail(error);
            return;
        }

        // The steps from before the session move nodes the other editors do not have.
        this.editor.commands.get("undo")?.clearStack();
        this.editor.commands.get("redo")?.clearStack();
        this.state = "joined";
        this.updateLock();
        // The cursors pointed into the content that was replaced, and nobody has this selection yet.
        this.cursors.clear();
        this.scheduleSelection();
    }

    private receiveBatch(ops: unknown[], isOwn: boolean) {
        this.version++;
        if (isOwn) {
            this.inFlight = [];
            this.flush();
        } else {
            try {
                this.applyRemote(this.transform(ops));
            } catch (error) {
                this.fail(error);
                return;
            }
        }

        this.sendSnapshotWhenSettled();
        clearTimeout(this.hashTimer);
        this.hashTimer = setTimeout(() => this.sendHash(), HASH_DELAY);
        if (this.isSelectionDirty) {
            this.scheduleSelection();
        }
    }

    /** Transforms a batch of another editor over the local operations, and those over the batch. */
    private transform(ops: unknown[]) {
        const document = this.editor.model.document;
        const remote = ops.map((json) => OperationFactory.fromJSON(json, document));
        const local = [ ...this.inFlight, ...this.pending ];
        if (!local.length) {
            return remote;
        }

        const wasInFlight = new Set(this.inFlight);
        const result = transformOperationSets(remote, local, {
            document, useRelations: false, padWithNoOps: false, forceWeakRemove: false
        });
        this.inFlight = [];
        this.pending = [];
        for (const operation of result.operationsB) {
            // A transformation can split an operation, and each part stays in the queue of its original.
            const original = result.originalOperations.get(operation) as Operation;
            (wasInFlight.has(original) ? this.inFlight : this.pending).push(operation);
        }
        return result.operationsA;
    }

    private applyRemote(operations: Operation[]) {
        this.editor.model.enqueueChange({ isLocal: false, isUndoable: false }, (writer) => {
            for (const operation of operations) {
                this.applyOperation(writer, operation);
            }
        });
    }

    private applyOperation(writer: ModelWriter, operation: Operation) {
        const model = this.editor.model;
        this.isApplying = true;
        try {
            operation.baseVersion = model.document.version;
            writer.batch.addOperation(operation);
            model.applyOperation(operation);
        } finally {
            this.isApplying = false;
        }
    }

    private flush() {
        if (this.state !== "joined" || this.inFlight.length || !this.pending.length) {
            return;
        }
        this.inFlight = this.pending;
        this.pending = [];
        this.sendInFlight();
    }

    private sendInFlight() {
        this.send({
            type: "collab-ops",
            epoch: this.epoch,
            baseVersion: this.version,
            // The queued operations change with each transformation, so the message takes a copy.
            ops: JSON.parse(JSON.stringify(this.inFlight.map((operation) => operation.toJSON())))
        });
    }

    /** Whether the server has accepted every local operation, so the model is the one of `version`. */
    private get isSettled() {
        return this.state === "joined" && !this.inFlight.length && !this.pending.length;
    }

    private sendSnapshotWhenSettled() {
        if (this.isSnapshotRequested && this.isSettled) {
            this.isSnapshotRequested = false;
            this.send({
                type: "collab-snapshot",
                epoch: this.epoch,
                version: this.version,
                authoritative: false,
                snapshot: this.takeSnapshot()
            });
        }
    }

    private sendHash() {
        if (this.isSettled) {
            this.send({
                type: "collab-hash",
                epoch: this.epoch,
                version: this.version,
                hash: hashNodes(this.takeSnapshot().main)
            });
        }
    }

    private setPeers(peers: CollabPeer[]) {
        const hasNewPeer = peers.some((peer) => !this.cursors.has(peer.peerId));
        this.cursors.setPeers(peers);
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
        // The paths only mean the same to the other editors in the model of a version. An editor
        // that is not settled sends once its last batch is acknowledged.
        if (!this.isSettled) {
            return;
        }
        const selection = this.editor.model.document.selection;
        const root = getMainRoot(this.editor);
        this.isSelectionDirty = false;
        this.send({
            type: "collab-selection",
            epoch: this.epoch,
            version: this.version,
            selection: {
                ranges: Array.from(selection.getRanges())
                    .filter((range) => range.root === root)
                    .map((range) => ({ start: [ ...range.start.path ], end: [ ...range.end.path ] })),
                isBackward: selection.isBackward
            }
        });
    }

    /** Shows the selection of another editor, which is given in the model of the current version. */
    private showSelection(peerId: string, selection: CollabSelection) {
        if (!this.cursors.has(peerId)) {
            return;
        }
        const model = this.editor.model;
        const root = getMainRoot(this.editor);
        try {
            let ranges = selection.ranges.map(({ start, end }) => model.createRange(
                model.createPositionFromPath(root, start), model.createPositionFromPath(root, end)
            ));
            // This editor is ahead of that version by its own unacknowledged operations.
            for (const operation of [ ...this.inFlight, ...this.pending ]) {
                ranges = ranges.flatMap((range) => range.getTransformedByOperation(operation));
            }
            ranges = ranges.filter((range) => range.root === root);
            for (const range of ranges) {
                // A path that leads nowhere throws here, not where the position is created.
                range.start.getAncestors();
                range.end.getAncestors();
            }
            this.cursors.show(peerId, ranges, selection.isBackward);
        } catch {
            this.cursors.show(peerId, [], false);
        }
    }

    private fail(error: unknown) {
        console.warn("Collaboration: could not apply the operations of another editor, asking for a reset.", error);
        this.send({ type: "collab-error", epoch: this.epoch });
        this.suspend();
    }

    private takeSnapshot(): CollabSnapshot {
        const model = this.editor.model;
        const { graveyard } = model.document;
        const sessionGraveyard = model.createRange(
            model.createPositionAt(graveyard, 0),
            model.createPositionAt(graveyard, graveyard.maxOffset - this.junkSize)
        );

        const deleted: unknown[] = [];
        for (const item of sessionGraveyard.getItems({ shallow: true })) {
            // The range can end inside a text node, which only a proxy of its part represents.
            deleted.push(item.is("$textProxy")
                ? { data: item.data, attributes: Object.fromEntries(item.getAttributes()) }
                : item.toJSON());
        }
        return {
            main: Array.from(getMainRoot(this.editor).getChildren(), (child) => child.toJSON()),
            graveyard: deleted
        };
    }

    /** Replaces the model with the one of another editor. */
    private loadSnapshot(snapshot: CollabSnapshot) {
        const model = this.editor.model;
        const { graveyard } = model.document;
        const root = getMainRoot(this.editor);
        const none = "toNone";

        model.enqueueChange({ isLocal: false, isUndoable: false }, (writer) => {
            // The content of the editor goes to the end of the graveyard, past what the session addresses.
            this.applyOperation(writer, OperationFactory.fromJSON({
                __className: "MoveOperation",
                baseVersion: 0,
                sourcePosition: { root: root.rootName, path: [ 0 ], stickiness: none },
                howMany: root.maxOffset,
                targetPosition: { root: graveyard.rootName, path: [ graveyard.maxOffset ], stickiness: none }
            }, model.document));
            this.junkSize = graveyard.maxOffset;

            for (const [ target, nodes ] of [ [ graveyard, snapshot.graveyard ], [ root, snapshot.main ] ] as const) {
                if (nodes.length) {
                    this.applyOperation(writer, OperationFactory.fromJSON({
                        __className: "InsertOperation",
                        baseVersion: 0,
                        position: { root: target.rootName, path: [ 0 ], stickiness: none },
                        nodes,
                        shouldReceiveAttributes: false
                    }, model.document));
                }
            }
        });
    }

    private setSaver(isSaver: boolean) {
        if (this.isSaver !== isSaver) {
            this.isSaver = isSaver;
            this.session?.onSaverChange?.(isSaver);
        }
    }

    /** The editor is read-only while it has no session state to edit, and for a user who cannot write. */
    private updateLock() {
        const isLocked = this.state === "joining" || this.state === "resetting"
            || (this.state === "joined" && !this.canWrite);
        if (isLocked) {
            this.editor.enableReadOnlyMode(READ_ONLY_LOCK);
        } else {
            this.editor.disableReadOnlyMode(READ_ONLY_LOCK);
        }
    }

    /** Sends a message of the session, which every caller is in. */
    private send(message: Outgoing) {
        const session = this.session as CollaborationSession;
        session.send({ ...message, noteId: session.noteId, memberId: session.memberId } as CollabClientMessage);
    }

}

/** The root that holds the note. Every editor of Trilium has it. */
function getMainRoot(editor: Plugin["editor"]) {
    return editor.model.document.getRoot() as ModelRootElement;
}

/**
 * An FNV-1a hash of the nodes. The keys are sorted first, since two editors can hold the same
 * attributes in a different order.
 */
function hashNodes(nodes: unknown[]) {
    const text = JSON.stringify(nodes, (_key, value) => (value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([ a ], [ b ]) => (a < b ? -1 : 1)))
        : value));

    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
    }
    return (hash >>> 0).toString(16);
}

declare module "ckeditor5" {
    interface PluginsMap {
        [Collaboration.pluginName]: Collaboration;
    }
}
