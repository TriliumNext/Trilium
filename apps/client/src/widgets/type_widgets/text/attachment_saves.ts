import { useCallback, useContext, useEffect, useRef, useState } from "preact/hooks";

import type NoteContext from "../../../components/note_context";
import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";
import type { AttachmentEditor } from "../../../services/content_renderer";
import protected_session_holder from "../../../services/protected_session_holder";
import server from "../../../services/server";
import SpacedUpdate from "../../../services/spaced_update";
import { type SavedData, useSaveBeforeLeaving } from "../../react/hooks";
import { ParentComponent } from "../../react/react_utils";

type SavedAttachments = NonNullable<SavedData["attachments"]>;

interface PendingSave {
    attachment: FAttachment;
    /** Reads the content from the mounted editor. */
    getContent?: () => string;
    /** The content read when the editor went away. */
    content?: string;
    /** Counts the changes, so that a save keeps the changes made while it ran. */
    revision: number;
}

/**
 * The attachment changes that content, such as a canvas drawing, makes. A text note saves them
 * together with its own content, and `useAttachmentEditor()` saves them on their own.
 */
export default class AttachmentSaves implements AttachmentEditor {
    private noteId: string | undefined;
    private pending = new Map<string, PendingSave>();
    private sentRevisions = new WeakMap<SavedAttachments, Map<string, number>>();

    /** @param scheduleUpdate schedules a save of the text note. */
    constructor(private scheduleUpdate: () => void) {}

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

    getUnsavedContent(attachmentId: string) {
        const save = this.pending.get(attachmentId);
        return save ? readContent(save) : undefined;
    }

    scheduleSave(attachment: FAttachment, getContent: () => string) {
        const revision = (this.pending.get(attachment.attachmentId)?.revision ?? 0) + 1;
        this.pending.set(attachment.attachmentId, { attachment, getContent, revision });
        this.scheduleUpdate();
    }

    release(attachmentId: string) {
        const save = this.pending.get(attachmentId);
        if (save?.getContent) {
            save.content = save.getContent();
            save.getContent = undefined;
        }
    }

    /** The attachments to save with the note, read at the time of the call. */
    collect(): SavedAttachments {
        const attachments: SavedAttachments = [];
        const revisions = new Map<string, number>();
        for (const [ attachmentId, save ] of this.pending) {
            const { role, mime, title } = save.attachment;
            attachments.push({ attachmentId, role, mime, title, content: readContent(save) });
            revisions.set(attachmentId, save.revision);
        }

        this.sentRevisions.set(attachments, revisions);
        return attachments;
    }

    /** Drops the changes that `attachments`, as returned by `collect()`, saved. */
    markSaved(attachments: SavedAttachments | undefined) {
        const revisions = attachments && this.sentRevisions.get(attachments);
        if (!revisions) {
            return;
        }

        for (const [ attachmentId, revision ] of revisions) {
            if (this.pending.get(attachmentId)?.revision === revision) {
                this.pending.delete(attachmentId);
            }
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

    // Saves what is left once the content goes away.
    useEffect(() => () => {
        spacedUpdate.updateNowIfNecessary().catch(() => {
            // Failures are logged by `SpacedUpdate` and retried.
        });
    }, [ spacedUpdate ]);

    return saves;
}

function readContent(save: PendingSave) {
    return save.getContent ? save.getContent() : save.content ?? "";
}
