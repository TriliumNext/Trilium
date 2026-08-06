/**
 * What "also delete the note" costs the tree, which is not one thing.
 *
 * A view that lists notes holds two kinds and looks like it holds one: the notes filed under it,
 * which hang from a branch of its own, and the notes it merely names. Deleting is the removal of one
 * placement for the first — which the note may well outlive — and the removal of the note itself for
 * the second. What is checked here is that the same rule decides both the sentence shown to the
 * reader and the request that follows, so the two can never disagree.
 */
import { describe, expect, it, vi } from "vitest";

import froca from "./froca";
import { buildNote } from "../test/easy-froca";
import { deleteNoteOrBranch, deletesNote, describeNoteDeletion, planNoteDeletion } from "./note_deletion";
import server from "./server";

// t() returns the key and the values it was given, so the assertions below are on which sentence is
// shown and what it was told to count rather than on its English wording.
vi.mock("./i18n", () => ({
    t: (key: string, values?: object) => (values ? `${key}:${JSON.stringify(values)}` : key)
}));

/**
 * A note hanging under the given parents, the first of which is the view asking about it. `buildNote`
 * only makes the one branch, so the rest are added the way froca adds a clone.
 */
function noteUnder(...parentNoteIds: string[]) {
    const [ first, ...rest ] = parentNoteIds;
    buildNote({ id: first, title: first, children: [ { id: "subject", title: "Subject" } ] });
    const note = froca.notes["subject"];

    for (const parentNoteId of rest) {
        note.addParent(parentNoteId, `${parentNoteId}_subject`, false);
    }

    return note;
}

describe("planNoteDeletion", () => {
    it("keeps the branch the view files the note under, and counts every place it hangs", () => {
        noteUnder("theview", "elsewhere");

        expect(planNoteDeletion("subject", "theview_subject"))
            .toEqual({ branchId: "theview_subject", places: 2 });
    });

    /**
     * A note the view merely names — dragged onto a relation map, say — hangs from nothing of the
     * view's, so there is no placement to remove and only the note itself can go.
     */
    it("names no branch where the view files the note nowhere", () => {
        noteUnder("elsewhere");

        expect(planNoteDeletion("subject", null)).toEqual({ branchId: null, places: 1 });
        expect(planNoteDeletion("subject")).toEqual({ branchId: null, places: 1 });
    });

    /** A branch the note does not hang from is no placement of ours either, however it got here. */
    it("refuses a branch that is not one of the note's own", () => {
        noteUnder("theview");

        expect(planNoteDeletion("subject", "someone_elses_branch"))
            .toEqual({ branchId: null, places: 1 });
    });

    it("plans nothing destructive for a note froca has never heard of", () => {
        expect(planNoteDeletion("missing", "missing_branch")).toEqual({ branchId: null, places: 0 });
    });
});

describe("deletesNote", () => {
    it("answers whether the note would survive the plan being carried out", () => {
        // Its only place is the view's, so deleting that branch deletes the note with it.
        expect(deletesNote({ branchId: "theview_subject", places: 1 })).toBe(true);
        // It hangs elsewhere too, so the note outlives the branch.
        expect(deletesNote({ branchId: "theview_subject", places: 2 })).toBe(false);
        // Nothing of the view's to delete, so the note itself goes however many places it has.
        expect(deletesNote({ branchId: null, places: 1 })).toBe(true);
        expect(deletesNote({ branchId: null, places: 3 })).toBe(true);
    });
});

describe("describeNoteDeletion", () => {
    it("says the note survives, and how many clones keep it standing", () => {
        expect(describeNoteDeletion({ branchId: "theview_subject", places: 3 }))
            .toBe(`confirm.delete_note_keeps_note:${JSON.stringify({ count: 2 })}`);
    });

    it("says the note itself goes where the view holds the only place it hangs", () => {
        expect(describeNoteDeletion({ branchId: "theview_subject", places: 1 }))
            .toBe("confirm.delete_note_deletes_note");
    });

    /** Merely named by the view, and hanging in one place, which the deletion takes. */
    it("says the note itself goes where the view files it nowhere", () => {
        expect(describeNoteDeletion({ branchId: null, places: 1 }))
            .toBe("confirm.delete_note_deletes_note");
    });

    /**
     * The costly reading, and the one the relation map used to take without saying so: the note is
     * not the view's to unfile, so deleting it takes every clone of it anywhere in the tree.
     */
    it("counts the places that would go with a note the view files nowhere", () => {
        expect(describeNoteDeletion({ branchId: null, places: 4 }))
            .toBe(`confirm.delete_note_deletes_clones:${JSON.stringify({ places: 4 })}`);
    });
});

describe("deleteNoteOrBranch", () => {
    it("deletes the branch the view files the note under, leaving its other places alone", async () => {
        noteUnder("theview", "elsewhere");
        const remove = vi.spyOn(server, "remove").mockResolvedValue(undefined);

        try {
            await deleteNoteOrBranch("subject", "theview_subject");

            const [ url ] = remove.mock.calls[0];
            expect(url).toMatch(/^branches\/theview_subject\?/);
            expect(url).toContain("last=true");
        } finally {
            remove.mockRestore();
        }
    });

    it("deletes the note itself where the view files it nowhere", async () => {
        noteUnder("elsewhere");
        const remove = vi.spyOn(server, "remove").mockResolvedValue(undefined);

        try {
            await deleteNoteOrBranch("subject", null);

            expect(remove.mock.calls[0][0]).toMatch(/^notes\/subject\?/);
        } finally {
            remove.mockRestore();
        }
    });
});
