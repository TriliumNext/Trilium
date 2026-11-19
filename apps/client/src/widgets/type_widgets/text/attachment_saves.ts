import { useCallback, useContext, useEffect, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import type { default as NoteContext, SaveState } from "../../../components/note_context";
import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";
import type { AttachmentEditor, NoteEditor } from "../../../services/content_renderer";
import froca from "../../../services/froca";
import {
    type ChangeRecordHooks, type CurrentVersion, getLatestBlob, type SaveData
} from "../../../services/note_save";
import protected_session_holder from "../../../services/protected_session_holder";
import SpacedUpdate from "../../../services/spaced_update";
import { type SavedData, useNoteSaver, useSaveBeforeLeaving } from "../../react/hooks/editor";
import { ParentComponent } from "../../react/react_utils";

type SavedAttachments = NonNullable<SavedData["attachments"]>;

/** The spaced update that saves a note together with the attachment changes. */
type NoteUpdate = Pick<SpacedUpdate<unknown>, "scheduleUpdate" | "resetUpdateTimer">;

interface SavedNote {
    note: FNote;
    content: string;
}

interface PendingSave<T> {
    entity: T;
    /** Reads the content from the mounted editor. */
    getContent?: () => string;
    /** The content read when the editor went away. */
    content?: string;
    /** Runs with the content once it saves, unless the entity changed again by then. */
    onSaved?: (content: string) => void;
    /**
     * Numbers the change, uniquely among all changes, so that a save drops only the change it
     * sent, also when it is retried.
     */
    revision: number;
    /** The blob that the entity had when the first of the unsaved changes was made. */
    readAt?: string;
    /** The hooks of the mounted editor that records its changes since its base. */
    hooks?: ChangeRecordHooks;
}

/** A change that a save sent. */
interface SentRevision {
    id: string;
    revision: number;
    content: string;
    onSaved?: (content: string) => void;
    hooks?: ChangeRecordHooks;
}

/**
 * The content changes that wait for a save, by the ID of the note or attachment they change.
 * `T` is the changed entity, and `I` the item that `collectItems()` builds for each change.
 */
abstract class PendingSaves<T, I extends object> {
    protected pending = new Map<string, PendingSave<T>>();
    private lastRevision = 0;
    /** The revision of the last change to each entity, kept when `pending` drops the change. */
    private latestRevisions = new Map<string, number>();
    private sentRevisions = new WeakMap<I, SentRevision>();

    getUnsavedContent(id: string) {
        const save = this.pending.get(id);
        return save ? readContent(save) : undefined;
    }

    /** Whether a change of the entity `id` waits for a save. */
    hasChanges(id: string) {
        return this.pending.has(id);
    }

    /**
     * As {@link getUnsavedContent}, read for a save: the editor of the entity records its changes
     * since this content apart.
     */
    takeUnsavedContent(id: string) {
        const save = this.pending.get(id);
        return save ? takeContent(save) : undefined;
    }

    release(id: string) {
        const save = this.pending.get(id);
        if (save?.getContent) {
            save.content = save.getContent();
            save.getContent = undefined;
            save.hooks = undefined;
        }
    }

    /**
     * Drops the changes that `items`, as returned by `collectItems()`, saved, and runs the
     * `onSaved` of each.
     */
    markSaved(items: I[] | undefined) {
        for (const item of items ?? []) {
            const sent = this.sentRevisions.get(item);
            sent?.hooks?.dataSaved();
            if (sent && this.latestRevisions.get(sent.id) === sent.revision) {
                this.pending.delete(sent.id);
                this.latestRevisions.delete(sent.id);
                sent.onSaved?.(sent.content);
            }
        }
    }

    /**
     * Schedules a change of the entity `id`. `readAt`, the blob that the entity has now, is kept
     * from the first of the changes that are not saved yet.
     */
    protected schedule(
        id: string,
        entity: T,
        getContent: () => string,
        { onSaved, readAt, hooks }: Pick<PendingSave<T>, "onSaved" | "readAt" | "hooks"> = {}
    ) {
        const revision = ++this.lastRevision;
        const previous = this.pending.get(id);
        this.pending.set(id, {
            entity, getContent, onSaved, revision, readAt: previous ? previous.readAt : readAt,
            hooks
        });
        this.latestRevisions.set(id, revision);
    }

    /** One item for each change, with the content read for the save at the time of the call. */
    protected collectItems(
        toItem: (id: string, entity: T, content: string, readAt: string | undefined) => I
    ) {
        const items: I[] = [];
        for (const [ id, save ] of this.pending) {
            const content = takeContent(save);
            const item = toItem(id, save.entity, content, save.readAt);
            this.sentRevisions.set(item, {
                id, revision: save.revision, content, onSaved: save.onSaved, hooks: save.hooks
            });
            items.push(item);
        }

        return items;
    }
}

/**
 * The attachment changes that content, such as a canvas drawing, makes. A text note saves them
 * together with its own content, and `useAttachmentEditor()` saves them on their own.
 */
export default class AttachmentSaves
    extends PendingSaves<FAttachment, SavedAttachments[number]>
    implements AttachmentEditor {
    private noteId: string | undefined;
    private versionListeners = new Set<() => void>();

    /**
     * @param getUpdate returns the spaced update that saves the note.
     * @param componentId the component that sends the saves.
     */
    constructor(private getUpdate: () => NoteUpdate, readonly componentId?: string) {
        super();
    }

    /** Sets the note whose attachments can change, and drops the changes to any other note. */
    setNoteId(noteId: string | undefined) {
        if (noteId !== this.noteId) {
            this.discard();
        }
        this.noteId = noteId;
    }

    /** Drops the changes that wait for a save. */
    discard() {
        this.pending.clear();
    }

    /**
     * Drops the changes that wait for a save, as the user chose the version of another writer,
     * and calls the listeners of `subscribeVersionLoaded()` to show that version.
     */
    loadOtherVersion() {
        this.discard();
        for (const listener of this.versionListeners) {
            listener();
        }
    }

    subscribeVersionLoaded(listener: () => void) {
        this.versionListeners.add(listener);
        return () => {
            this.versionListeners.delete(listener);
        };
    }

    canEdit(attachment: FAttachment) {
        return !!this.noteId && attachment.ownerId === this.noteId;
    }

    scheduleSave(
        attachment: FAttachment,
        getContent: () => string,
        onSaved?: (content: string) => void
    ) {
        this.schedule(
            attachment.attachmentId, attachment, getContent, { onSaved, readAt: attachment.blobId }
        );
        this.getUpdate().scheduleUpdate();
    }

    postponeSave() {
        this.getUpdate().resetUpdateTimer();
    }

    /**
     * The attachments to save with the note, read at the time of the call, each with the blob
     * that its changes are based on.
     */
    collect(): SavedAttachments {
        return this.collectItems(toAttachmentRow);
    }

    /** The row that {@link collect} reads for the attachment `attachmentId`, if it changed. */
    getLatestRow(attachmentId: string) {
        const save = this.pending.get(attachmentId);
        return save && toAttachmentRow(attachmentId, save.entity, readContent(save), save.readAt);
    }
}

/**
 * The changes that content embedded in a text note, such as a code note, makes to the notes it
 * shows. `useNoteEditor()` saves them.
 */
export class NoteSaves extends PendingSaves<FNote, SavedNote> implements NoteEditor {
    private saveStates = new Map<string, SaveState>();
    private stateListeners = new Set<() => void>();
    /** The version of each note that its embeds show: the one they loaded, or saved last. */
    private loadedVersions = new Map<string, { blobId: string; content: string }>();

    /**
     * Runs as a note gets its first change since its last save, with the blob of the version that
     * its embeds show, if known.
     */
    onFirstChange?: (note: FNote, loadedBlobId: string | undefined) => void;

    /** Saves the changes to the note `noteId` now, unless its save waits for the user. */
    flush?: (noteId: string) => Promise<void>;

    /**
     * @param scheduleUpdate schedules a save.
     * @param componentId the component that saves the changes.
     * @param getHostNoteId the note that shows the embeds, which they cannot edit.
     */
    constructor(
        private scheduleUpdate: () => void,
        readonly componentId: string | undefined,
        private getHostNoteId: () => string | undefined = () => undefined
    ) {
        super();
    }

    canEdit(note: FNote) {
        return note.noteId !== this.getHostNoteId() && note.isContentAvailable();
    }

    scheduleSave(
        note: FNote,
        getContent: () => string,
        onSaved?: (content: string) => void,
        hooks?: ChangeRecordHooks
    ) {
        if (!this.pending.has(note.noteId)) {
            this.onFirstChange?.(note, this.loadedVersions.get(note.noteId)?.blobId);
        }
        this.schedule(note.noteId, note, getContent, { onSaved, hooks });
        this.setSaveState(note.noteId, "unsaved");
        this.scheduleUpdate();
    }

    /**
     * Lets the editor of the note `noteId` bring its changes onto `current`, as
     * `SavingEditor.resolveConflict()` does. `false` without an editor that records its changes.
     */
    resolveConflict(noteId: string, current: CurrentVersion) {
        return this.pending.get(noteId)?.hooks?.resolveConflict(current) ?? false;
    }

    setLoadedVersion(noteId: string, blobId: string, content: string) {
        this.loadedVersions.set(noteId, { blobId, content });
    }

    async saveNow(noteId: string) {
        try {
            await this.flush?.(noteId);
        } catch {
            // `SpacedUpdate` logs the failure and tries again.
        }
        return this.pending.has(noteId) ? undefined : this.loadedVersions.get(noteId)?.content;
    }

    /** Drops the changes to the note `noteId`, which were kept as a revision instead. */
    discard(noteId: string) {
        this.pending.delete(noteId);
        this.setSaveState(noteId, "saved");
    }

    getSaveState(noteId: string) {
        return this.saveStates.get(noteId);
    }

    subscribeSaveState(listener: () => void) {
        this.stateListeners.add(listener);
        return () => {
            this.stateListeners.delete(listener);
        };
    }

    /** The notes to save, read at the time of the call. */
    collect() {
        return this.collectItems((_noteId, note, content) => ({ note, content }));
    }

    /**
     * Saves `items`, as returned by `collect()`, one note after the other with `saveNote`. Stops at
     * the first note that fails to save, and rejects with its error.
     */
    async save(items: SavedNote[], saveNote: (item: SavedNote) => Promise<unknown>) {
        for (const item of items) {
            const { noteId } = item.note;
            this.setSaveState(noteId, "saving");
            try {
                await saveNote(item);
            } catch (e) {
                this.setSaveState(noteId, "error");
                throw e;
            }

            this.markSaved([ item ]);
            this.setSaveState(noteId, this.pending.has(noteId) ? "unsaved" : "saved");
        }
    }

    private setSaveState(noteId: string, state: SaveState) {
        this.saveStates.set(noteId, state);
        for (const listener of this.stateListeners) {
            listener();
        }
    }
}

/**
 * The writes that inline sources, such as Mermaid diagrams, hold back until their source stops
 * changing. The text note saves them into its model first, since they are part of its content.
 */
export class InlineSourceSaves {
    private readonly pending = new Set<() => void>();

    /** @param scheduleUpdate schedules a save of the text note. */
    constructor(private readonly scheduleUpdate: () => void) {}

    /** Holds `write` until {@link flush}, or until the source writes it itself. */
    add(write: () => void) {
        this.pending.add(write);
        this.scheduleUpdate();
    }

    delete(write: () => void) {
        this.pending.delete(write);
    }

    /** Makes the held writes now. */
    flush() {
        for (const write of [ ...this.pending ]) {
            write();
        }
    }
}

/**
 * Saves the changes that content shown outside a text note, such as a canvas drawing in the full
 * detail of its attachment, makes to the attachments of `note`.
 */
export function useAttachmentEditor(
    note: FNote,
    noteContext: NoteContext | undefined
): AttachmentEditor {
    const parentComponent = useContext(ParentComponent);
    const [ saves ] = useState(() => {
        const saves = new AttachmentSaves(() => spacedUpdate, parentComponent?.componentId);
        saves.setNoteId(note.noteId);
        return saves;
    });
    const noteContextRef = useRef(noteContext);
    noteContextRef.current = noteContext;
    const saver = useNoteSaver<SaveData>({
        /* v8 ignore next -- saveAttachment() reads the rows with getLatestAttachment() */
        getLatestData: () => undefined,
        getLatestAttachment: (_noteId, attachmentId) => saves.getLatestRow(attachmentId),
        loadVersion(noteId) {
            // A revision keeps the changes, as the user chose the version of another writer.
            spacedUpdate.discard(noteId);
            saves.loadOtherVersion();
        }
    });

    const prepare = useCallback(() => saves.collect(), [ saves ]);
    const commit = useCallback(async (attachments: SavedAttachments) => {
        // A deleted note is gone from `froca`, and the server refuses its changes.
        if (!(note.noteId in froca.notes)) {
            saves.markSaved(attachments);
            return;
        }
        protected_session_holder.touchProtectedSessionIfNecessary(note);
        for (const attachment of attachments) {
            // Once a revision keeps the changes instead, the rows left are not sent.
            if (!await saver.saveAttachment(note, attachment)) break;
        }
        saves.markSaved(attachments);
    }, [ note, saver, saves ]);

    const [ spacedUpdate ] = useState(() => new SpacedUpdate<SavedAttachments>(
        { key: note.noteId, prepare, commit },
        undefined,
        (state) => noteContextRef.current?.setContextData("saveState", { state })
    ));

    // `rebind()` takes the changes to the previous note before `setNoteId()` drops them.
    useEffect(() => {
        spacedUpdate.rebind(note.noteId, prepare, commit);
        saves.setNoteId(note.noteId);
    });

    useSaveBeforeLeaving(spacedUpdate, noteContext, saver);
    useSaveOnUnmount(spacedUpdate);

    return saves;
}

/**
 * Saves the changes that content embedded in the note of `noteContext`, such as a code note,
 * makes to the notes it shows. Each note saves with a request of its own.
 */
export function useNoteEditor(noteContext: NoteContext | null | undefined): NoteEditor {
    const parentComponent = useContext(ParentComponent);
    const noteContextRef = useRef(noteContext);
    noteContextRef.current = noteContext;
    const [ saves ] = useState(() => {
        const noteSaves = new NoteSaves(
            () => spacedUpdate.scheduleUpdate(),
            parentComponent?.componentId,
            () => noteContextRef.current?.noteId ?? undefined
        );
        // A change is based on the version that the embeds show. Without it, on the blob that
        // `froca` holds, as this client's own saves left it.
        noteSaves.onFirstChange = (note, loadedBlobId) => {
            const blobId = loadedBlobId ?? (note.blobId && getLatestBlob(note.noteId, note.blobId));
            if (blobId) {
                const { noteId, type, mime } = note;
                saver.setBase({ noteId, blobId, type, mime });
            }
        };
        noteSaves.flush = async (noteId) => {
            if (!saver.isPaused(noteId)) {
                await spacedUpdate.updateNowIfNecessary();
            }
        };
        return noteSaves;
    });
    const saver = useNoteSaver<SaveData>({
        getLatestData(noteId) {
            const content = saves.takeUnsavedContent(noteId);
            return content === undefined ? undefined : { content };
        },
        loadVersion(noteId) {
            saves.discard(noteId);
            // A queued save can still hold the discarded change, so the next save collects the
            // remaining changes again.
            spacedUpdate.discard(null);
            spacedUpdate.scheduleUpdate();
            // The embeds render again once the save that asked has finished.
            setTimeout(() => void appContext.triggerEvent("refreshEmbeddedNote", { noteId }));
        },
        resolveConflict: (noteId, current) => saves.resolveConflict(noteId, current),
        async saveChanges(noteId) {
            if (saves.hasChanges(noteId)) {
                await spacedUpdate.updateNowIfNecessary();
            }
        }
    });

    const [ spacedUpdate ] = useState(() => new SpacedUpdate<SavedNote[]>({
        key: null,
        prepare: () => saves.collect(),
        commit: (notes) => saves.save(notes, async ({ note, content }) => {
            if (!(note.noteId in froca.notes)) return;
            protected_session_holder.touchProtectedSessionIfNecessary(note);
            const saved = await saver.saveNote(note, { content });
            const blobId = saver.getBase(note.noteId)?.blobId;
            if (saved && blobId) {
                saves.setLoadedVersion(note.noteId, blobId, saved.content);
            }
        })
    }));

    // The embeds go away with the note that shows them.
    const hostNoteId = noteContext?.noteId;
    useEffect(() => {
        saver.abandon();
    }, [ saver, hostNoteId ]);
    useSaveBeforeLeaving(spacedUpdate, noteContext, saver);
    useSaveOnUnmount(spacedUpdate);

    return saves;
}

/**
 * Saves what is left once the content goes away. `useNoteSaver()`, called before, has kept a save
 * that waits for the user as a revision by then.
 */
function useSaveOnUnmount<T>(spacedUpdate: SpacedUpdate<T>) {
    useEffect(() => () => {
        spacedUpdate.updateNowIfNecessary().catch(() => {
            // Failures are logged by `SpacedUpdate` and retried.
        });
    }, [ spacedUpdate ]);
}

function readContent<T>(save: PendingSave<T>) {
    return save.getContent ? save.getContent() : save.content ?? "";
}

/** The content of `save`, read for a save: its editor records the changes since apart. */
function takeContent<T>(save: PendingSave<T>) {
    const content = readContent(save);
    save.hooks?.onDataTaken();
    return content;
}

/** The row that saves `content` as the attachment `attachmentId`, based on the blob `blobId`. */
function toAttachmentRow(
    attachmentId: string,
    { role, mime, title }: FAttachment,
    content: string,
    blobId: string | undefined
): SavedAttachments[number] {
    return { attachmentId, role, mime, title, content, ...(blobId ? { blobId } : {}) };
}
