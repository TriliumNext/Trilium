import { useCallback, useContext, useEffect, useRef, useState } from "preact/hooks";

import type { default as NoteContext, SaveState } from "../../../components/note_context";
import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";
import type { AttachmentEditor, NoteEditor } from "../../../services/content_renderer";
import protected_session_holder from "../../../services/protected_session_holder";
import server from "../../../services/server";
import SpacedUpdate from "../../../services/spaced_update";
import { type SavedData, useSaveBeforeLeaving } from "../../react/hooks";
import { ParentComponent } from "../../react/react_utils";

type SavedAttachments = NonNullable<SavedData["attachments"]>;

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
    /**
     * Numbers the change, uniquely among all changes, so that a save drops only the change it
     * sent, also when it is retried.
     */
    revision: number;
}

/**
 * The content changes that wait for a save, by the ID of the note or attachment they change.
 * `T` is the changed entity, and `I` the item that `collectItems()` builds for each change.
 */
abstract class PendingSaves<T, I extends object> {
    protected pending = new Map<string, PendingSave<T>>();
    private lastRevision = 0;
    private sentRevisions = new WeakMap<I, { id: string; revision: number }>();

    getUnsavedContent(id: string) {
        const save = this.pending.get(id);
        return save ? readContent(save) : undefined;
    }

    release(id: string) {
        const save = this.pending.get(id);
        if (save?.getContent) {
            save.content = save.getContent();
            save.getContent = undefined;
        }
    }

    /** Drops the changes that `items`, as returned by `collectItems()`, saved. */
    markSaved(items: I[] | undefined) {
        for (const item of items ?? []) {
            const sent = this.sentRevisions.get(item);
            if (sent && this.pending.get(sent.id)?.revision === sent.revision) {
                this.pending.delete(sent.id);
            }
        }
    }

    protected schedule(id: string, entity: T, getContent: () => string) {
        this.pending.set(id, { entity, getContent, revision: ++this.lastRevision });
    }

    /** One item for each change, with the content read at the time of the call. */
    protected collectItems(toItem: (id: string, entity: T, content: string) => I) {
        const items: I[] = [];
        for (const [ id, save ] of this.pending) {
            const item = toItem(id, save.entity, readContent(save));
            this.sentRevisions.set(item, { id, revision: save.revision });
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

    /** @param scheduleUpdate schedules a save of the text note. */
    constructor(private scheduleUpdate: () => void) {
        super();
    }

    /** Sets the note whose attachments can change, and drops the changes to any other note. */
    setNoteId(noteId: string | undefined) {
        if (noteId !== this.noteId) {
            this.pending.clear();
        }
        this.noteId = noteId;
    }

    canEdit(attachment: FAttachment) {
        return !!this.noteId && attachment.ownerId === this.noteId;
    }

    scheduleSave(attachment: FAttachment, getContent: () => string) {
        this.schedule(attachment.attachmentId, attachment, getContent);
        this.scheduleUpdate();
    }

    /** The attachments to save with the note, read at the time of the call. */
    collect(): SavedAttachments {
        return this.collectItems((attachmentId, { role, mime, title }, content) => (
            { attachmentId, role, mime, title, content }
        ));
    }
}

/**
 * The changes that content embedded in a text note, such as a code note, makes to the notes it
 * shows. `useNoteEditor()` saves them.
 */
export class NoteSaves extends PendingSaves<FNote, SavedNote> implements NoteEditor {
    private saveStates = new Map<string, SaveState>();
    private stateListeners = new Set<() => void>();

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

    scheduleSave(note: FNote, getContent: () => string) {
        this.schedule(note.noteId, note, getContent);
        this.setSaveState(note.noteId, "unsaved");
        this.scheduleUpdate();
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
 * Saves the changes that content shown outside a text note, such as a canvas drawing in the full
 * detail of its attachment, makes to the attachments of `note`.
 */
export function useAttachmentEditor(
    note: FNote,
    noteContext: NoteContext | undefined
): AttachmentEditor {
    const parentComponent = useContext(ParentComponent);
    const [ saves ] = useState(() => {
        const saves = new AttachmentSaves(() => spacedUpdate.scheduleUpdate());
        saves.setNoteId(note.noteId);
        return saves;
    });
    const noteContextRef = useRef(noteContext);
    noteContextRef.current = noteContext;

    const prepare = useCallback(() => saves.collect(), [ saves ]);
    const commit = useCallback(async (attachments: SavedAttachments) => {
        protected_session_holder.touchProtectedSessionIfNecessary(note);
        for (const attachment of attachments) {
            await server.post(
                `notes/${note.noteId}/attachments`,
                attachment,
                parentComponent?.componentId
            );
        }
        saves.markSaved(attachments);
    }, [ note, parentComponent, saves ]);

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

    useSaveBeforeLeaving(spacedUpdate, noteContext);
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
    const [ saves ] = useState(() => new NoteSaves(
        () => spacedUpdate.scheduleUpdate(),
        parentComponent?.componentId,
        () => noteContextRef.current?.noteId ?? undefined
    ));

    const [ spacedUpdate ] = useState(() => new SpacedUpdate<SavedNote[]>({
        key: null,
        prepare: () => saves.collect(),
        commit: (notes) => saves.save(notes, ({ note, content }) => {
            protected_session_holder.touchProtectedSessionIfNecessary(note);
            return server.put(`notes/${note.noteId}/data`, { content }, saves.componentId);
        })
    }));

    useSaveBeforeLeaving(spacedUpdate, noteContext);
    useSaveOnUnmount(spacedUpdate);

    return saves;
}

/** Saves what is left once the content goes away. */
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
