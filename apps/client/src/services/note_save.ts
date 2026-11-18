import type {
    BlocksConflictResponse, NoteBlocksResponse, NoteType, SaveConflictResponse, SaveDraftRequest,
    SaveDraftResponse, SavedAttachmentBase, SavedAttachmentRow, SaveNoteBlocksResponse,
    SaveNoteDataResponse
} from "@triliumnext/commons";
import { getContentFormat } from "@triliumnext/commons/src/lib/notes.js";

import type FNote from "../entities/fnote";
import { t } from "./i18n";
import server from "./server";
import toast from "./toast";
import { randomString } from "./utils";

/** What the content of an editor is based on: the blob that it read, and its format. */
export interface NoteBase {
    noteId: string;
    blobId: string;
    /** The content of `blobId`, where the editor knows it. */
    content?: string;
    type: NoteType;
    mime: string;
}

/** What an editor saves: its content, and the changes to attachments that it made. */
export interface SaveData {
    content: string;
    attachments?: SavedAttachmentRow[];
}

/** The version of a note that the server holds, read with its blob. */
export interface CurrentVersion {
    blobId: string;
    content: string;
}

/** The editor that a {@link NoteSaver} saves for. */
export interface SavingEditor<T extends SaveData> {
    /** The component that sends the saves. */
    componentId?: string;
    /** The data that the editor shows for `noteId`, or `undefined` once it shows another note. */
    getLatestData(noteId: string): Promise<T | undefined> | T | undefined;
    /** Shows `version` of the note `noteId`, the one that the user chose over the editor's. */
    loadVersion(noteId: string, version: CurrentVersion): void | Promise<void>;
    /** Shows the blocks `content` of the note `noteId`, the ones that the user chose. */
    loadBlocks?(noteId: string, content: string): void | Promise<void>;
    /** Tells that a save waits for the user to choose a version. */
    onPaused?(): void;
    /**
     * Tries to bring the changes of the editor onto `current`, before the user is asked. Resolves
     * to whether it did: the save is then sent again, based on `current`.
     */
    resolveConflict?(noteId: string, current: CurrentVersion): Promise<boolean> | boolean;
}

/** What the user chose after a conflict, or `abandon` when the editor went away first. */
type Decision = "keep" | "load" | "abandon";

/**
 * Why changes are kept as a draft: a version conflict, a conversion of the note, or the blocks of
 * an excerpt that can no longer be saved apart.
 */
type DraftCause = "conflict" | "conversion" | "blocksGone";

/** A draft that waits for the server to keep it as a revision. */
interface PendingDraft {
    request: SaveDraftRequest;
    cause: DraftCause;
    /** The changes that the draft holds, to tell changes made since from a repeated save. */
    data: SaveData;
    /** Shows the version that the user chose, once the draft is kept. */
    load?: () => Promise<void>;
}

/** What the saves of the blocks of an excerpt are based on. */
interface BlockBase {
    /** The hash of the blocks as read, `null` when they could not be read apart. */
    hash: string | null;
    /** The whole note that the blocks were read from, which a draft of them goes into. */
    note?: string;
}

/**
 * Saves the content of an editor, each save based on the version that the editor read: the server
 * refuses a save over a version that the editor has not seen. A version conflict pauses the save
 * until the user chooses a version, and a format conflict keeps the editor's changes as a revision.
 * A save leaves the queue of its spaced update only once it is saved, or its draft is kept.
 */
export class NoteSaver<T extends SaveData> {
    private bases = new Map<string, NoteBase>();
    /** What an editor of some blocks read, by note. */
    private blockBases = new Map<string, BlockBase>();
    /** The attachments that the saves of each note created or replaced. */
    private attachments = new Map<string, SavedAttachmentBase[]>();
    private questions = new Map<string, (decision: Decision) => void>();
    private drafts = new Map<string, PendingDraft>();

    constructor(private editor: SavingEditor<T>) {}

    /** Sets the version that the editor shows of the note of `base`. */
    setBase(base: NoteBase) {
        this.bases.set(base.noteId, base);
        this.attachments.delete(base.noteId);
    }

    getBase(noteId: string) {
        return this.bases.get(noteId);
    }

    /**
     * Sets the hash of the blocks of the note `noteId` that an editor of some blocks shows, and
     * the whole note that they were read from.
     */
    setBlockBase(noteId: string, hash: string | null, note?: string) {
        this.blockBases.set(noteId, { hash, note });
    }

    /** Whether a save of the note `noteId` waits for the user, or for a draft to be kept. */
    isPaused(noteId: string) {
        return this.questions.has(noteId) || this.drafts.has(noteId);
    }

    /** Whether a save waits for the user to choose a version. */
    isAsking() {
        return this.questions.size > 0;
    }

    /**
     * Keeps the changes of each save that waits for the user as a revision instead, as the editor
     * goes away, except the save of the note `keptNoteId`, which the editor still shows.
     */
    abandon(keptNoteId?: string) {
        for (const [ noteId, answer ] of [ ...this.questions ]) {
            if (noteId !== keptNoteId) {
                answer("abandon");
            }
        }
    }

    /**
     * Saves `data` as the content of `note`. Resolves to the data that was saved, or to `undefined`
     * once the changes are kept as a revision instead. Rejects when the save failed and should be
     * tried again.
     */
    async saveNote(note: FNote, data: T): Promise<T | undefined> {
        const { noteId } = note;
        const pending = this.drafts.get(noteId);
        if (pending) {
            await this.resumeDraft(noteId, pending, data);
            return undefined;
        }

        let base = this.bases.get(noteId);
        if (!base) {
            await server.put(`notes/${noteId}/data`, data, this.editor.componentId);
            return data;
        }
        if (getContentFormat(note.type, note.mime) !== getContentFormat(base.type, base.mime)) {
            await this.keepDraft(noteId, this.createDraft(base, data, "conversion"));
            return undefined;
        }

        let saved = data;
        let isKeepingOther = false;
        for (;;) {
            try {
                const attachments = await this.getAttachmentRows(note, saved.attachments);
                const url = `notes/${noteId}/data`;
                const answer = await server.put<SaveNoteDataResponse | undefined>(url, {
                    content: saved.content,
                    attachments,
                    base: { blobId: base.blobId, type: base.type, mime: base.mime },
                    keepOther: isKeepingOther || undefined
                }, this.editor.componentId, { silentConflict: true });
                if (answer?.blobId) {
                    this.advance(base, saved, answer);
                    this.takeAttachments(noteId, answer.attachments ?? [], attachments);
                }
                return saved;
            } catch (e) {
                const conflict = parseConflict<SaveConflictResponse>(e);
                if (!conflict) {
                    throw e;
                }
                if (conflict.reason === "format") {
                    await this.keepDraft(noteId, this.createDraft(base, saved, "conversion"));
                    return undefined;
                }

                const current = await this.tryToResolve(noteId);
                if (current) {
                    base = { ...base, blobId: current.blobId, content: current.content };
                    this.bases.set(noteId, base);
                    saved = await this.editor.getLatestData(noteId) ?? saved;
                    isKeepingOther = false;
                    continue;
                }

                const decision = await this.ask(note, conflict.isVersioned);
                saved = await this.editor.getLatestData(noteId) ?? saved;
                if (decision === "keep") {
                    // Saved over the version of the note and of its attachments that it was shown.
                    base = { ...base, blobId: conflict.blobId };
                    this.takeAttachments(noteId, conflict.attachments ?? []);
                    isKeepingOther = true;
                    continue;
                }

                const draft = this.createDraft(base, saved, "conflict");
                if (decision === "load") {
                    draft.load = () => this.loadCurrentVersion(note);
                }
                await this.keepDraft(noteId, draft);
                return undefined;
            }
        }
    }

    /**
     * Saves `data` as the blocks of `note` that `block`, a `block` link parameter, points at, and
     * `data.block` as the blocks after the save. Resolves as {@link saveNote} does.
     */
    async saveBlocks(
        note: FNote, block: string, data: T & { block?: string }
    ): Promise<T | undefined> {
        const { noteId } = note;
        const pending = this.drafts.get(noteId);
        if (pending) {
            await this.resumeDraft(noteId, pending, data);
            return undefined;
        }

        // Only the blocks of a text note can be saved apart.
        if (note.type !== "text") {
            const draft = this.createFragmentDraft(noteId, block, data, "conversion");
            await this.keepDraft(noteId, draft);
            return undefined;
        }

        const url = `notes/${noteId}/blocks?block=${encodeURIComponent(block)}`;
        let hash = this.blockBases.get(noteId)?.hash;
        let saved = data;
        let isKeepingOther = false;
        for (;;) {
            const { block: savedBlock, ...blocks } = saved;
            try {
                const attachments = await this.getAttachmentRows(note, blocks.attachments);
                const answer = await server.put<SaveNoteBlocksResponse | undefined>(url, {
                    ...blocks,
                    attachments,
                    base: typeof hash === "string" ? { hash } : undefined,
                    keepOther: isKeepingOther || undefined,
                    block: savedBlock
                }, this.editor.componentId, { silentConflict: true });
                this.setBlockBase(noteId, answer?.hash ?? null, answer?.note);
                this.takeAttachments(noteId, answer?.attachments ?? [], attachments);
                return saved;
            } catch (e) {
                const conflict = parseConflict<BlocksConflictResponse>(e);
                if (!conflict) {
                    throw e;
                }
                if (conflict.reason !== "version") {
                    const cause = conflict.reason === "format" ? "conversion" : "blocksGone";
                    const draft = this.createFragmentDraft(noteId, block, saved, cause);
                    await this.keepDraft(noteId, draft);
                    return undefined;
                }

                const decision = await this.ask(note, conflict.isVersioned);
                saved = await this.editor.getLatestData(noteId) as typeof data | undefined ?? saved;
                if (decision === "keep") {
                    hash = conflict.hash;
                    this.takeAttachments(noteId, conflict.attachments);
                    isKeepingOther = true;
                    continue;
                }

                const draft = this.createFragmentDraft(noteId, block, saved, "conflict");
                if (decision === "load") {
                    draft.load = () => this.loadCurrentBlocks(note, block);
                }
                await this.keepDraft(noteId, draft);
                return undefined;
            }
        }
    }

    /**
     * A draft of the blocks of the text note `noteId` that `block`, a `block` link parameter,
     * points at, based on the note that they were read from.
     */
    private createFragmentDraft(
        noteId: string, block: string, data: T, cause: DraftCause
    ): PendingDraft {
        const { hash, note } = this.blockBases.get(noteId) ?? {};
        const base = typeof hash === "string" && note !== undefined ? { note, hash } : undefined;
        return {
            request: {
                revisionId: randomString(12),
                type: "text",
                mime: "text/html",
                fragment: { content: data.content, block, base },
                attachments: data.attachments
            },
            cause,
            data
        };
    }

    private createDraft(base: NoteBase, data: T, cause: DraftCause): PendingDraft {
        return {
            request: {
                revisionId: randomString(12),
                type: base.type,
                mime: base.mime,
                content: data.content,
                attachments: data.attachments
            },
            cause,
            data
        };
    }

    /**
     * Keeps `draft` as a revision of the note `noteId`, then shows the version that the user chose
     * unless `isFollowed`. Until the server answers, the draft stays, and a repeated save sends it
     * again with the same revision ID.
     */
    private async keepDraft(noteId: string, draft: PendingDraft, isFollowed = false) {
        this.drafts.set(noteId, draft);
        const answer = await server.post<SaveDraftResponse>(
            `notes/${noteId}/revisions/draft`, draft.request, this.editor.componentId
        );
        this.drafts.delete(noteId);
        showDraftToast(noteId, answer.isKept, draft.cause);
        if (!isFollowed) {
            await draft.load?.();
        }
    }

    /**
     * Keeps `pending`, the draft of a save that has not reached the server, and the changes that
     * the editor holds since, `data` or newer, as a draft of their own after it.
     */
    private async resumeDraft(noteId: string, pending: PendingDraft, data: T) {
        const latest = await this.editor.getLatestData(noteId) ?? data;
        const hasNewChanges = !isSameData(latest, pending.data);
        await this.keepDraft(noteId, pending, hasNewChanges);
        if (hasNewChanges) {
            await this.keepDraft(noteId, withData(pending, latest));
        }
    }

    /** Asks which version to keep, until the user chooses or the editor goes away. */
    private ask(note: FNote, isVersioned: boolean) {
        this.editor.onPaused?.();
        const toastId = `save-conflict-${note.noteId}-${randomString(6)}`;
        return new Promise<Decision>((resolve) => {
            const answer = (decision: Decision) => {
                this.questions.delete(note.noteId);
                toast.closePersistent(toastId);
                resolve(decision);
            };
            this.questions.set(note.noteId, answer);
            toast.showPersistent({
                id: toastId,
                icon: "bx bx-git-compare",
                title: t("note_save.conflict_title"),
                message: isVersioned
                    ? t("note_save.conflict_message")
                    : t("note_save.conflict_message_unversioned"),
                notes: [ note.noteId ],
                dismissible: false,
                wide: true,
                buttons: [
                    { text: t("note_save.keep_this_version"), onClick: () => answer("keep") },
                    { text: t("note_save.load_other_version"), onClick: () => answer("load") }
                ]
            });
        });
    }

    /**
     * The version that the server holds, once the editor brought its changes onto it, or `null`
     * when it did not. The content and the blob come from one read, so a retry is based on
     * exactly the version that the editor saw.
     */
    private async tryToResolve(noteId: string): Promise<CurrentVersion | null> {
        if (!this.editor.resolveConflict) {
            return null;
        }

        const current = await readCurrentVersion(noteId);
        return await this.editor.resolveConflict(noteId, current) ? current : null;
    }

    private async loadCurrentVersion(note: FNote) {
        const current = await readCurrentVersion(note.noteId);
        this.setBase({ noteId: note.noteId, ...current, type: note.type, mime: note.mime });
        await this.editor.loadVersion(note.noteId, current);
    }

    private async loadCurrentBlocks(note: FNote, block: string) {
        const { content, hash, note: whole } = await server.get<NoteBlocksResponse>(
            `notes/${note.noteId}/blocks?block=${encodeURIComponent(block)}`
        );
        this.setBlockBase(note.noteId, hash, whole);
        await this.editor.loadBlocks?.(note.noteId, content);
    }

    /** Takes the answer of a save of `saved` as the new base. */
    private advance(base: NoteBase, saved: T, answer: SaveNoteDataResponse) {
        recordReplacedBlob(base.noteId, base.blobId, answer.blobId);
        this.bases.set(base.noteId, {
            ...base,
            blobId: answer.blobId,
            content: answer.content ?? saved.content
        });
    }

    /**
     * Takes `saved` as the attachments that the next save replaces, at their blobs: those of the
     * answer to a save of the attachment rows `sent`, or those that a conflict named.
     */
    private takeAttachments(
        noteId: string, saved: SavedAttachmentBase[], sent?: SavedAttachmentRow[]
    ) {
        const known = this.attachments.get(noteId) ?? [];
        const savedIds = new Set(saved.map((attachment) => attachment.attachmentId));
        this.attachments.set(noteId, [
            ...known.filter((attachment) => !savedIds.has(attachment.attachmentId)),
            ...saved
        ]);
        for (const attachment of saved) {
            const readAt = sent
                ?.find((row) => row.attachmentId === attachment.attachmentId)?.blobId;
            if (readAt) {
                recordReplacedBlob(attachment.attachmentId, readAt, attachment.blobId);
            }
        }
    }

    /**
     * `rows` as a save with a base sends them: a row of an attachment that this editor saved
     * replaces it at the blob of that save, and a row without an ID replaces the attachment of
     * its title that the note has, at the blob that it has.
     */
    private async getAttachmentRows(note: FNote, rows: SavedAttachmentRow[] | undefined) {
        if (!rows?.length) {
            return rows;
        }

        const saved = this.attachments.get(note.noteId) ?? [];
        const needsNoteAttachments = rows.some((row) => !row.attachmentId
            && !saved.some((attachment) => attachment.title === row.title));
        const noteAttachments = needsNoteAttachments ? await note.getAttachments() : [];
        return rows.map((row): SavedAttachmentRow => {
            const savedAttachment = saved.find((attachment) => (row.attachmentId
                ? attachment.attachmentId === row.attachmentId
                : attachment.title === row.title));
            if (savedAttachment) {
                const { attachmentId, blobId } = savedAttachment;
                return { ...row, attachmentId, blobId };
            }
            if (row.attachmentId) {
                return row;
            }

            const existing = noteAttachments.find((attachment) => attachment.title === row.title);
            return existing?.blobId
                ? {
                    ...row,
                    attachmentId: existing.attachmentId,
                    blobId: getLatestBlob(existing.attachmentId, existing.blobId)
                }
                : row;
        });
    }
}

/**
 * The blob of the entity `entityId` that a client save made out of `blobId`, or `blobId` itself.
 * The entity changes of a save reach `froca` some time after its answer, so a blob that `froca`
 * still holds can be one that a save of this client replaced already.
 */
export function getLatestBlob(entityId: string, blobId: string) {
    let latest = blobId;
    for (let next = savedBlobs.get(`${entityId}:${latest}`); next;) {
        latest = next;
        next = savedBlobs.get(`${entityId}:${latest}`);
    }
    return latest;
}

/** Records that a save of the entity `entityId` replaced `oldBlobId` with `newBlobId`. */
export function recordReplacedBlob(entityId: string, oldBlobId: string, newBlobId: string) {
    if (oldBlobId === newBlobId) {
        return;
    }
    // The latest blob is never replaced, so the chains of `getLatestBlob()` end.
    savedBlobs.delete(`${entityId}:${newBlobId}`);
    savedBlobs.set(`${entityId}:${oldBlobId}`, newBlobId);
    if (savedBlobs.size > MAX_SAVED_BLOBS) {
        const [ oldest ] = savedBlobs.keys();
        savedBlobs.delete(oldest);
    }
}

/** The blob replacements of the saves of this client, `<entityId>:<old blob>` to the new blob. */
const savedBlobs = new Map<string, string>();
/** The most replacements that {@link savedBlobs} keeps. */
const MAX_SAVED_BLOBS = 1000;

/** The body of the 409 in `e`, a rejection of `server`, or `null` for any other failure. */
export function parseConflict<T extends { reason: string }>(e: unknown): T | null {
    if (typeof e !== "string") {
        return null;
    }
    try {
        const body = JSON.parse(e) as Partial<T> | null;
        return typeof body?.reason === "string" ? body as T : null;
    } catch {
        return null;
    }
}

async function readCurrentVersion(noteId: string): Promise<CurrentVersion> {
    const { blobId, content } = await server.get<{ blobId: string; content: string }>(
        `notes/${noteId}/blob`
    );
    return { blobId, content };
}

/** Whether `a` and `b` hold the same changes. */
function isSameData(a: SaveData, b: SaveData) {
    return a.content === b.content
        && JSON.stringify(a.attachments ?? []) === JSON.stringify(b.attachments ?? []);
}

/** `draft` with `data` in place of its changes, as a revision of its own. */
function withData(draft: PendingDraft, data: SaveData): PendingDraft {
    const { request } = draft;
    return {
        ...draft,
        request: {
            ...request,
            revisionId: randomString(12),
            ...(request.fragment
                ? { fragment: { ...request.fragment, content: data.content } }
                : { content: data.content }),
            attachments: data.attachments
        },
        data
    };
}

function showDraftToast(noteId: string, isKept: boolean, cause: DraftCause) {
    const message = getDraftMessage(cause, isKept);
    toast.showPersistent({
        id: `save-draft-${noteId}`,
        icon: isKept ? "bx bx-history" : "bx bx-error-circle",
        message,
        notes: [ noteId ],
        timeout: 15_000
    });
}

function getDraftMessage(cause: DraftCause, isKept: boolean) {
    switch (cause) {
        case "conversion":
            return isKept
                ? t("note_save.draft_kept_after_conversion")
                : t("note_save.draft_discarded_after_conversion");
        case "blocksGone":
            return isKept
                ? t("note_save.draft_kept_blocks_gone")
                : t("note_save.draft_discarded_blocks_gone");
        default:
            return isKept ? t("note_save.draft_kept") : t("note_save.draft_discarded");
    }
}
