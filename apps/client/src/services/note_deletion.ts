import froca from "./froca.js";
import { t } from "./i18n.js";
import server from "./server.js";
import utils from "./utils.js";

/**
 * What deleting a note from somewhere that shows it would cost the tree.
 *
 * A view that lists notes holds two kinds of them and usually looks like it holds one: notes filed
 * under it, which hang from a branch of its own, and notes it merely names — dragged onto a relation
 * map, say. Deleting is not one act for the two. For the first it is the removal of a single
 * placement, which the note may well outlive elsewhere; for the second there is no placement of the
 * view's to remove, so only the note itself can go, and it goes from every place it hangs.
 *
 * Which is why this is worked out before the reader is asked rather than after they have answered:
 * a checkbox reading "Also delete the note" means quite different things in the two cases, and
 * nothing on the box says which.
 */
export interface NoteDeletionPlan {
    /** The branch that would be deleted, or `null` where the note itself is what goes. */
    branchId: string | null;
    /** How many places the note has in the tree, all told. */
    places: number;
}

/**
 * A note as it stands in the view asking about it: which note, and which of its placements the view
 * is removing it from. Enough for {@link planNoteDeletion} to answer everything else, so a view that
 * wants the offer made need know nothing about what the offer costs.
 */
export interface NoteDeletionTarget {
    noteId: string;
    /** The note's branch under the view, where the view files it, and `null` where it does not. */
    branchId?: string | null;
}

/**
 * Works out what deleting the given note would mean, where `branchId` is the placement the caller is
 * removing it from.
 *
 * A branch the note does not actually hang from — none was given, or the view names a note it does
 * not file — leaves nothing of the caller's to delete, so the note itself is what the plan deletes.
 */
export function planNoteDeletion(noteId: string, branchId?: string | null): NoteDeletionPlan {
    const parentBranchIds = froca.getNoteFromCache(noteId)?.getParentBranchIds() ?? [];

    return {
        branchId: branchId && parentBranchIds.includes(branchId) ? branchId : null,
        places: parentBranchIds.length
    };
}

/** Whether carrying out the plan would take the note out of the tree, or leave it standing elsewhere. */
export function deletesNote({ branchId, places }: NoteDeletionPlan) {
    // No branch of the caller's to delete means the note itself goes, wherever it happened to hang;
    // and a branch that is the note's only one takes the note with it when it goes.
    return !branchId || places <= 1;
}

/**
 * What carrying out the plan would cost, in a sentence to be shown before it is carried out.
 *
 * Named in the app's own terms rather than the calling view's — a clone is what the reader is told a
 * note in several places is everywhere else (see the delete-notes dialog) — so the same sentence
 * serves whichever view is doing the asking.
 */
export function describeNoteDeletion(plan: NoteDeletionPlan) {
    if (!deletesNote(plan)) {
        return t("confirm.delete_note_keeps_note", { count: plan.places - 1 });
    }

    // Counted rather than pluralised: this reading is only reached above one, and a `count` would
    // have i18next ask translators for a singular that is never shown.
    if (!plan.branchId && plan.places > 1) {
        return t("confirm.delete_note_deletes_clones", { places: plan.places });
    }

    return t("confirm.delete_note_deletes_note");
}

/**
 * Carries out {@link planNoteDeletion} — the branch where the caller has one, the note itself where
 * it has not.
 *
 * The branch road serves both outcomes, deleting the last branch of a note being what deletes the
 * note; what it does not do is take the note's other places down with it, which is the road
 * `branches.deleteNotes` only takes when the reader ticks "delete all clones".
 */
export async function deleteNoteOrBranch(noteId: string, branchId?: string | null) {
    const { branchId: branchToDelete } = planNoteDeletion(noteId, branchId);
    const taskId = utils.randomString(10);
    const target = branchToDelete ? `branches/${branchToDelete}` : `notes/${noteId}`;

    await server.remove(`${target}?taskId=${taskId}&last=true`);
}
