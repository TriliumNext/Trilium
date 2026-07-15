import { type CKTextEditor, type CommentsAdapter, type CommentsRepository, LOCAL_COMMENTS_USER_ID } from "@triliumnext/ckeditor5";

import type FNote from "../../../entities/fnote";
import ViewModeStorage from "../../collections/view_mode_storage";

const ATTACHMENT_ROLE = "comments";
const SAVE_DELAY_MS = 1_000;

/**
 * CKEditor's `CommentThreadDataJSON` as it round-trips through `JSON.stringify`: `Date` fields
 * become ISO strings and optional fields may be absent in older payloads.
 */
interface SerializedComment {
    commentId?: string;
    authorId: string;
    createdAt: string;
    content: string;
    attributes?: Record<string, unknown>;
}

interface SerializedCommentThread {
    threadId: string;
    resolvedAt?: string | null;
    resolvedBy?: string | null;
    attributes?: Record<string, unknown>;
    comments: SerializedComment[];
}

interface CommentsAttachmentData {
    threads: SerializedCommentThread[];
}

/**
 * Persists the premium Comments feature's thread data per note.
 *
 * The comment *markers* (`<comment-start>`/`<comment-end>` elements and `data-comment-*`
 * attributes) live inside the note content and are saved through the regular content save.
 * The thread *data* (comment texts, author, timestamps, resolved state) lives outside the
 * document, so it is persisted here into a `comments.json` attachment on the note.
 *
 * The integration is adapter-based:
 *
 * - **Loading is lazy.** When the editor upcasts a comment marker whose thread is unknown,
 *   the `CommentsRepository` asks the adapter's `getCommentThread()`, which reads the current
 *   note's attachment (cached per note visit). This sidesteps ordering problems around
 *   `setData()`: Trilium reuses one editor instance across note switches, so threads cannot
 *   simply be preloaded once at editor creation.
 * - **Saving snapshots at mutation time.** Every mutating adapter callback captures the full
 *   thread state one tick later (when the repository reflects the change) together with the
 *   note it belongs to, and the upload itself is debounced. A note switch mid-debounce
 *   therefore cannot attribute threads to the wrong note.
 */
export default class NoteCommentsManager {
    private note?: FNote;
    private storage?: ViewModeStorage<CommentsAttachmentData>;
    /** Threads of the current note, fetched at most once per note visit. */
    private loadPromise?: Promise<SerializedCommentThread[]>;
    private pendingSnapshot?: { storage: ViewModeStorage<CommentsAttachmentData>; data: CommentsAttachmentData };
    private saveTimer?: ReturnType<typeof setTimeout>;

    /** Must be called before (and on every) note switch, while the editor still shows the previous note. */
    setNote(note: FNote) {
        if (this.note?.noteId === note.noteId) {
            return;
        }

        // Flush the previous note's pending comment save before its storage handle is replaced.
        this.flushPendingSave();

        this.note = note;
        this.storage = new ViewModeStorage(note, "comments", ATTACHMENT_ROLE);
        this.loadPromise = undefined;
    }

    /** Hooks the adapter into a newly created editor instance (initial creation and watchdog restarts). */
    attach(editor: CKTextEditor) {
        if (!editor.plugins.has("CommentsRepository")) {
            // Comments are a premium feature; without a license the plugin is not loaded.
            return;
        }

        const repository = editor.plugins.get("CommentsRepository") as CommentsRepository;
        repository.adapter = this.buildAdapter(repository);
    }

    /** Uploads the latest snapshot immediately, if any save is still pending. */
    flushPendingSave() {
        clearTimeout(this.saveTimer);

        const snapshot = this.pendingSnapshot;
        this.pendingSnapshot = undefined;
        if (!snapshot) {
            return;
        }

        if (snapshot.storage === this.storage) {
            // Keep the per-visit cache in sync so a watchdog restart re-feeds the edited state.
            this.loadPromise = Promise.resolve(snapshot.data.threads);
        }

        snapshot.storage.store(snapshot.data).catch((e) => console.warn("Failed to save comment threads", e));
    }

    private buildAdapter(repository: CommentsRepository): CommentsAdapter {
        return {
            getCommentThread: async ({ threadId }) => {
                const threads = await this.loadThreads();
                const thread = threads.find((t) => t.threadId === threadId);
                if (!thread || !threadId) {
                    return null;
                }

                return {
                    threadId,
                    comments: thread.comments.map((c) => ({
                        ...c,
                        createdAt: new Date(c.createdAt),
                        attributes: c.attributes ?? {}
                    })),
                    resolvedAt: thread.resolvedAt ? new Date(thread.resolvedAt) : null,
                    resolvedBy: thread.resolvedBy ?? null,
                    attributes: thread.attributes ?? {}
                };
            },
            addCommentThread: async (data) => {
                this.scheduleSave(repository);
                return {
                    threadId: data.threadId,
                    comments: (data.comments ?? []).map((c) => ({
                        commentId: c.commentId ?? "",
                        createdAt: new Date()
                    }))
                };
            },
            addComment: async (data) => {
                this.scheduleSave(repository);
                return {
                    commentId: data.commentId,
                    createdAt: new Date()
                };
            },
            resolveCommentThread: async ({ threadId }) => {
                this.scheduleSave(repository);
                return {
                    threadId: threadId ?? "",
                    resolvedAt: new Date(),
                    resolvedBy: LOCAL_COMMENTS_USER_ID
                };
            },
            updateCommentThread: async () => this.scheduleSave(repository),
            reopenCommentThread: async () => this.scheduleSave(repository),
            removeCommentThread: async () => this.scheduleSave(repository),
            updateComment: async () => this.scheduleSave(repository),
            removeComment: async () => this.scheduleSave(repository)
        };
    }

    private loadThreads(): Promise<SerializedCommentThread[]> {
        const storage = this.storage;
        if (!storage) {
            return Promise.resolve([]);
        }

        if (!this.loadPromise) {
            this.loadPromise = storage.restore().then((data) => data?.threads ?? []);
        }
        return this.loadPromise;
    }

    private scheduleSave(repository: CommentsRepository) {
        const storage = this.storage;
        if (!storage) {
            return;
        }

        // Snapshot on the next tick: when an adapter method is called, the repository may not
        // yet reflect the change; one tick later it does, and the user cannot have switched
        // note within the same tick. `skipNotAttached` keeps threads whose markers are present
        // in the current content, which both drops threads of previously shown notes and
        // deletes threads whose commented text was removed.
        setTimeout(() => {
            if (this.storage !== storage) {
                return;
            }

            const threads = repository.getCommentThreads({ skipNotAttached: true, toJSON: true });
            // Round-trip through JSON to serialize the `Date` fields and detach the snapshot
            // from the live repository state.
            const data = JSON.parse(JSON.stringify({ threads })) as CommentsAttachmentData;
            this.pendingSnapshot = { storage, data };

            clearTimeout(this.saveTimer);
            this.saveTimer = setTimeout(() => this.flushPendingSave(), SAVE_DELAY_MS);
        }, 0);
    }
}
