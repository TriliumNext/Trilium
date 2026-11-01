import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildNote } from "../test/easy-froca";
import froca from "./froca";
import {
    clearLabelOnNotes, setArchivedOnNotes, setLabelOnNotes, shared
} from "./note_set";

// The writes alone, so the rest of the service reads a note the way the application does. Both
// shapes are replaced: `note_set` calls one of these by name and the others off the default export.
const writes = vi.hoisted(() => ({
    setLabelValues: vi.fn(),
    addLabel: vi.fn(),
    removeOwnedLabelByName: vi.fn()
}));
vi.mock("./attributes", async (importOriginal) => {
    const original = await importOriginal<{ default: object }>();
    return { ...original, ...writes, default: { ...original.default, ...writes } };
});

beforeEach(() => vi.clearAllMocks());

describe("shared", () => {
    it("answers with the value every note holds", () => {
        const notes = [
            buildNote({ title: "One", "#state": "Doing" }),
            buildNote({ title: "Two", "#state": "Doing" })
        ];

        expect(shared(notes, (note) => note.getLabelValue("state")))
            .toEqual({ agreed: true, value: "Doing" });
    });

    it("answers with nothing where the notes disagree", () => {
        const notes = [
            buildNote({ title: "One", "#state": "Doing" }),
            buildNote({ title: "Two", "#state": "Done" })
        ];

        expect(shared(notes, (note) => note.getLabelValue("state"))).toEqual({ agreed: false });
    });

    /**
     * Every note being unset is something they agree on, which a menu marks, and is not the same
     * answer as notes holding different values.
     */
    it("counts every note holding none as an agreement", () => {
        const notes = [ buildNote({ title: "One" }), buildNote({ title: "Two" }) ];

        expect(shared(notes, (note) => note.getLabelValue("state")))
            .toEqual({ agreed: true, value: null });
    });

    it("answers with nothing for no notes at all", () => {
        expect(shared([], (note) => note.title)).toEqual({ agreed: false });
    });

    it("reads whatever the caller asks for, not only labels", () => {
        const notes = [
            buildNote({ title: "One", "#archived": "" }),
            buildNote({ title: "Two", "#archived": "" })
        ];

        expect(shared(notes, (note) => note.isArchived)).toEqual({ agreed: true, value: true });
    });
});

describe("writing to a set of notes", () => {
    it("sets the label on every one of them", async () => {
        const first = buildNote({ title: "One" });
        const second = buildNote({ title: "Two", "#state": "Done" });

        await setLabelOnNotes([ first, second ], "state", "Doing");

        expect(writes.setLabelValues).toHaveBeenCalledWith(first, "state", [ "Doing" ]);
        expect(writes.setLabelValues).toHaveBeenCalledWith(second, "state", [ "Doing" ]);
    });

    it("takes the label off every one of them", async () => {
        const first = buildNote({ title: "One", "#state": "Doing" });
        const second = buildNote({ title: "Two", "#state": "Done" });

        await clearLabelOnNotes([ first, second ], "state");

        expect(writes.setLabelValues).toHaveBeenCalledWith(first, "state", []);
        expect(writes.setLabelValues).toHaveBeenCalledWith(second, "state", []);
    });

    /**
     * Only the labels a note owns are removed, so a note with nothing of its own would keep what it
     * inherits. An empty label of its own overrides it.
     */
    it("shadows an inherited value rather than removing nothing", async () => {
        const parent = buildNote({
            title: "Parent",
            "#state(inheritable)": "Doing",
            children: [ { title: "Card" } ]
        });
        const child = froca.notes[parent.getChildNoteIds()[0]];
        if (!child) throw new Error("expected the card to be built");

        await clearLabelOnNotes([ child ], "state");

        expect(writes.setLabelValues).toHaveBeenCalledWith(child, "state", [ "" ]);
    });

    it("archives the notes that are not archived already", async () => {
        const plain = buildNote({ title: "One" });
        const archived = buildNote({ title: "Two", "#archived": "" });

        await setArchivedOnNotes([ plain, archived ], true);

        expect(writes.addLabel).toHaveBeenCalledExactlyOnceWith(plain.noteId, "archived");
    });

    it("unarchives the notes that are archived", async () => {
        const plain = buildNote({ title: "One" });
        const archived = buildNote({ title: "Two", "#archived": "" });

        await setArchivedOnNotes([ plain, archived ], false);

        expect(writes.removeOwnedLabelByName).toHaveBeenCalledExactlyOnceWith(archived, "archived");
    });
});
