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
    /**
     * The row of the attachment `attachmentId` of the note `noteId` that the editor holds now, or
     * `undefined` when it holds no change to it.
     */
    getLatestAttachment?(noteId: string, attachmentId: string): SavedAttachmentRow | undefined;
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

/**
 * The hooks of an editor that records its changes since the version that it is based on, which
 * let a save refused over a version that another writer saved bring those changes onto it.
 */
export interface ChangeRecordHooks {
    /** Runs each time the content is read for a save, before it is sent. */
    onDataTaken(): void;
    /** Runs once the content read last is saved. */
    dataSaved(): void;
    /** As {@link SavingEditor.resolveConflict}, for the note of the editor. */
    resolveConflict(current: CurrentVersion): boolean;
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
    /** Reads the changes that the editor holds now, in place of `SavingEditor.getLatestData()`. */
    getLatest?: () => SaveData | undefined;
    /**
     * Shows the version that the user chose, once the draft is kept. Runs `keepNewerChanges`
     * right before the editor shows it.
     */
    load?: (keepNewerChanges: () => Promise<void>) => Promise<void>;
}

/** What the saves of the blocks of an excerpt are based on. */
interface BlockBase {
    /** The hash of the blocks as read, `null` when they could not be read apart. */
    hash: string | null;
    /** The whole note that the blocks were read from, which a draft of them goes into. */
    note?: string;
}

/** A version conflict that the user decides, as read from the answer of a 409. */
interface VersionConflict {
    isVersioned: boolean;
    /** As {@link SaveConflictResponse.attachments}. */
    attachments?: SavedAttachmentBase[];
    /** Bases the save that keeps its version on the version that the conflict names. */
    keepOther?(): void;
}

/** How {@link NoteSaver} sends one kind of save `D` until it is saved, or kept as a draft. */
interface SaveRequest<D> {
    /** Sends `data`, over the version that a conflict named when `isKeepingOther`. */
    send(data: D, isKeepingOther: boolean): Promise<void>;
    /**
     * Reads a rejection of `send()`: the cause of a draft that keeps the changes at once, a
     * version conflict that the user decides, or `null` for any other failure.
     */
    readConflict(e: unknown): DraftCause | VersionConflict | null;
    /** The data that the editor holds now, which replaces the data that was refused. */
    getLatest(): Promise<D | undefined> | D | undefined;
    /** Tries to bring the changes onto the version that the server holds, before asking. */
    resolve?(): Promise<boolean>;
    createDraft(data: D, cause: DraftCause): Promise<PendingDraft> | PendingDraft;
    /** Shows the version that the user chose over the draft, as {@link PendingDraft.load}. */
    loadOther(keepNewerChanges: () => Promise<void>): Promise<void>;
}

/**
 * Saves the content of an editor, or the attachments that it changes, each save based on the
 * version that the editor read: the server refuses a save over a version that the editor has not
 * seen. A version conflict pauses the save
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

        const readBase = this.bases.get(noteId);
        if (!readBase) {
            await server.put(`notes/${noteId}/data`, data, this.editor.componentId);
            return data;
        }
        if (getContentFormat(note.type, note.mime)
            !== getContentFormat(readBase.type, readBase.mime)) {
            await this.keepDraft(noteId, this.createDraft(readBase, data, "conversion"));
            return undefined;
        }

        let base = readBase;
        /** The version that the last conflict named, when the server sent its content. */
        let named: CurrentVersion | undefined;
        return await this.sendUntilSaved(note, data, {
            send: async (saved, isKeepingOther) => {
                const attachments = await this.getAttachmentRows(note, saved.attachments);
                const answer = await server.put<SaveNoteDataResponse | undefined>(
                    `notes/${noteId}/data`, {
                        content: saved.content,
                        attachments,
                        base: { blobId: base.blobId, type: base.type, mime: base.mime },
                        keepOther: isKeepingOther || undefined
                    }, this.editor.componentId, { silentConflict: true });
                if (answer?.blobId) {
                    this.advance(base, saved, answer);
                    this.takeAttachments(noteId, answer.attachments ?? [], attachments);
                }
            },
            readConflict: (e) => {
                const conflict = parseConflict<SaveConflictResponse>(e);
                if (conflict?.reason === "format") {
                    return "conversion";
                }
                named = typeof conflict?.content === "string"
                    ? { blobId: conflict.blobId, content: conflict.content }
                    : undefined;
                return conflict && {
                    isVersioned: conflict.isVersioned,
                    attachments: conflict.attachments,
                    keepOther() {
                        // Saved over the version of the note and of its attachments that it was
                        // shown.
                        base = { ...base, blobId: conflict.blobId };
                    }
                };
            },
            getLatest: () => this.editor.getLatestData(noteId),
            resolve: async () => {
                const current = await this.tryToResolve(base, named);
                if (current) {
                    base = { ...base, blobId: current.blobId, content: current.content };
                    this.bases.set(noteId, base);
                }
                return !!current;
            },
            createDraft: (saved, cause) => this.createDraft(base, saved, cause),
            loadOther: (keepNewerChanges) => this.loadCurrentVersion(note, keepNewerChanges)
        });
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
        return await this.sendUntilSaved(note, data, {
            send: async ({ block: savedBlock, ...blocks }, isKeepingOther) => {
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
            },
            readConflict: (e) => {
                const conflict = parseConflict<BlocksConflictResponse>(e);
                if (conflict && conflict.reason !== "version") {
                    return conflict.reason === "format" ? "conversion" : "blocksGone";
                }
                return conflict && {
                    isVersioned: conflict.isVersioned,
                    attachments: conflict.attachments,
                    keepOther() {
                        hash = conflict.hash;
                    }
                };
            },
            getLatest: async () =>
                await this.editor.getLatestData(noteId) as typeof data | undefined,
            createDraft: (saved, cause) => this.createFragmentDraft(noteId, block, saved, cause),
            loadOther: (keepNewerChanges) => this.loadCurrentBlocks(note, block, keepNewerChanges)
        });
    }

    /**
     * Saves `row` as an attachment of `note`, based on the blob that the row names: a version
     * conflict asks the user, as one of the note does, and a draft keeps the note as it is with
     * the attachment of the row. Resolves to the row that was saved, or as {@link saveNote} does.
     */
    async saveAttachment(
        note: FNote, row: SavedAttachmentRow
    ): Promise<SavedAttachmentRow | undefined> {
        const { noteId } = note;
        const pending = this.drafts.get(noteId);
        if (pending) {
            await this.resumeDraft(noteId, pending, pending.data);
            return undefined;
        }

        const getLatest = () => (row.attachmentId
            ? this.editor.getLatestAttachment?.(noteId, row.attachmentId)
            : undefined);
        return await this.sendUntilSaved(note, row, {
            send: async (saved, isKeepingOther) => {
                /* v8 ignore next -- getAttachmentRows() returns an array for a non-empty one */
                const [ sent ] = await this.getAttachmentRows(note, [ saved ]) ?? [ saved ];
                const answer = await server.post<SavedAttachmentBase | undefined>(
                    `notes/${noteId}/attachments`,
                    isKeepingOther ? { ...sent, keepOther: true } : sent,
                    this.editor.componentId,
                    { silentConflict: true }
                );
                this.takeAttachments(noteId, answer ? [ answer ] : [], [ sent ]);
            },
            readConflict: (e) => {
                const conflict = parseConflict<SaveConflictResponse>(e);
                return conflict && {
                    isVersioned: conflict.isVersioned, attachments: conflict.attachments
                };
            },
            getLatest,
            createDraft: async (saved, cause) => {
                const { content } = await readCurrentVersion(noteId);
                const draft = this.createDraft(note, { content, attachments: [ saved ] }, cause);
                draft.getLatest = () => {
                    const latest = getLatest();
                    return latest && { content, attachments: [ latest ] };
                };
                return draft;
            },
            loadOther: (keepNewerChanges) => this.loadCurrentVersion(note, keepNewerChanges)
        });
    }

    /**
     * Sends `data` with `request` until it is saved, or its changes are kept as a draft. A version
     * conflict asks the user which version to keep, unless `request.resolve()` brings the changes
     * onto the other version first. Resolves as {@link saveNote} does.
     */
    private async sendUntilSaved<D>(
        note: FNote, data: D, request: SaveRequest<D>
    ): Promise<D | undefined> {
        const { noteId } = note;
        let saved = data;
        let isKeepingOther = false;
        for (;;) {
            try {
                await request.send(saved, isKeepingOther);
                return saved;
            } catch (e) {
                const conflict = request.readConflict(e);
                if (!conflict) {
                    throw e;
                }
                if (typeof conflict === "string") {
                    await this.keepDraft(noteId, await request.createDraft(saved, conflict));
                    return undefined;
                }

                if (await request.resolve?.()) {
                    saved = await request.getLatest() ?? saved;
                    isKeepingOther = false;
                    continue;
                }

                const decision = await this.ask(note, conflict.isVersioned);
                saved = await request.getLatest() ?? saved;
                if (decision === "keep") {
                    conflict.keepOther?.();
                    this.takeAttachments(noteId, conflict.attachments ?? []);
                    isKeepingOther = true;
                    continue;
                }

                const draft = await request.createDraft(saved, "conflict");
                if (decision === "load") {
                    draft.load = (keepNewerChanges) => request.loadOther(keepNewerChanges);
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
        noteId: string, block: string, data: SaveData, cause: DraftCause
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

    /** A draft of `data`, of the type and the format of `base`. */
    private createDraft(
        base: Pick<NoteBase, "type" | "mime">, data: SaveData, cause: DraftCause
    ): PendingDraft {
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
            await draft.load?.(() => this.keepChangesSince(noteId, draft));
        }
    }

    /**
     * Keeps the changes that the editor holds since `draft` as drafts of their own, until it holds
     * none that are not kept.
     */
    private async keepChangesSince(noteId: string, draft: PendingDraft) {
        let kept = draft;
        for (;;) {
            const latest = await this.readLatest(noteId, kept);
            if (!latest || isSameData(latest, kept.data)) {
                return;
            }
            kept = withData(kept, latest);
            await this.keepDraft(noteId, kept, true);
        }
    }

    /**
     * Keeps `pending`, the draft of a save that has not reached the server, and the changes that
     * the editor holds since, `data` or newer, as a draft of their own after it.
     */
    private async resumeDraft(noteId: string, pending: PendingDraft, data: SaveData) {
        const latest = await this.readLatest(noteId, pending) ?? data;
        const hasNewChanges = !isSameData(latest, pending.data);
        await this.keepDraft(noteId, pending, hasNewChanges);
        if (hasNewChanges) {
            await this.keepDraft(noteId, withData(pending, latest));
        }
    }

    /** The changes that the editor holds now for the note `noteId`, read as `draft` reads them. */
    private async readLatest(noteId: string, draft: PendingDraft) {
        return draft.getLatest ? draft.getLatest() : await this.editor.getLatestData(noteId);
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
     * The version that the server holds, once the changes of the editor apply to it, or `null`
     * when they do not. The changes apply as they are to `named`, the version that the conflict
     * named, when {@link appliesAsIs} says so. Otherwise the editor tries to bring them onto the
     * version, read with its blob at once, so a retry is based on exactly the version that the
     * editor saw.
     */
    private async tryToResolve(
        base: NoteBase, named: CurrentVersion | undefined
    ): Promise<CurrentVersion | null> {
        // With the same blob, the conflict is about an attachment, which a retry does not change.
        if (named && named.blobId !== base.blobId && await this.appliesAsIs(base, named)) {
            return named;
        }
        if (!this.editor.resolveConflict) {
            return null;
        }

        const current = await readCurrentVersion(base.noteId);
        return await this.editor.resolveConflict(base.noteId, current) ? current : null;
    }

    /**
     * Whether the changes of the editor apply as they are to `current`: it holds the content that
     * the editor read, under another blob as after the note is protected, or the content that the
     * editor saves, with no change to attachments, as when another editor of the note saved it.
     */
    private async appliesAsIs(base: NoteBase, current: CurrentVersion) {
        if (current.content === base.content) {
            return true;
        }
        const latest = await this.editor.getLatestData(base.noteId);
        return !!latest && !latest.attachments?.length && latest.content === current.content;
    }

    private async loadCurrentVersion(note: FNote, keepNewerChanges: () => Promise<void>) {
        const current = await readCurrentVersion(note.noteId);
        await keepNewerChanges();
        this.setBase({ noteId: note.noteId, ...current, type: note.type, mime: note.mime });
        await this.editor.loadVersion(note.noteId, current);
    }

    private async loadCurrentBlocks(
        note: FNote, block: string, keepNewerChanges: () => Promise<void>
    ) {
        const { content, hash, note: whole } = await server.get<NoteBlocksResponse>(
            `notes/${note.noteId}/blocks?block=${encodeURIComponent(block)}`
        );
        await keepNewerChanges();
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
