import froca from "../services/froca.js";
import server from "../services/server.js";
import FBlob, { FBlobRow } from "./fblob.js";
import FNote, { FNoteRow } from "./fnote.js";

/**
 * A read-only, tree-detached view of a soft-deleted (not-yet-erased) note.
 *
 * It extends {@link FNote} so it satisfies `instanceof FNote` — required because `content_renderer`
 * and the note tooltip branch on `instanceof FNote` rather than a structural interface, so a mere
 * look-alike would render through the wrong code path. This makes a `DeletedFNote` interchangeable
 * with a live note everywhere a note is rendered read-only.
 *
 * It is never inserted into Froca (nor is the note in Becca): its parent/child/attribute arrays stay
 * empty, so every inherited Froca-backed method degrades to a safe default (no path, no attributes,
 * default icon). Only content access is overridden, pointing at the isolated `deleted-notes` route
 * that reads the soft-deleted row via SQL. Instances are transient and disappear when the caller
 * drops them, keeping the "caches hold live notes only" invariant intact.
 */
export default class DeletedFNote extends FNote {
    readonly isDeleted = true as const;

    private constructor(row: FNoteRow) {
        super(froca, row);
    }

    /** Fetches content from the isolated deleted-content route (bypasses Becca and the Froca blob cache). */
    override async getBlob(): Promise<FBlob | null> {
        const row = await server.get<FBlobRow>(`deleted-notes/${this.noteId}/blob`).catch(() => null);
        return row ? new FBlob(row) : null;
    }

    /** A soft-deleted note has no live tree path. */
    override getBestNotePathString(): string {
        return "";
    }

    /** Loads a single soft-deleted note, or `null` if it is live, already erased, or unknown. */
    static async load(noteId: string): Promise<DeletedFNote | null> {
        const row = await server.get<FNoteRow>(`deleted-notes/${noteId}/metadata`).catch(() => null);
        return row ? new DeletedFNote(row) : null;
    }

    /**
     * Factory for several ids at once. Returns a `DeletedFNote` for each id that is genuinely
     * soft-deleted-and-previewable; live/erased/unknown ids are dropped, so the result is exactly
     * the viewable subset (not necessarily in the requested order or length).
     */
    static async loadMany(noteIds: string[]): Promise<DeletedFNote[]> {
        const notes = await Promise.all(noteIds.map((noteId) => DeletedFNote.load(noteId)));
        return notes.filter((note): note is DeletedFNote => note != null);
    }
}
