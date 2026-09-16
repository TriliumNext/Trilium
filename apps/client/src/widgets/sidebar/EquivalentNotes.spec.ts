import { describe, expect, it } from "vitest";

import type { EquivalentNotesGroup } from "@triliumnext/commons";

import { filterEquivalenceGroups, filterEquivalenceMembers, switcherButtonText } from "./EquivalentNotes";

const translation: EquivalentNotesGroup = {
    relationName: "translation",
    canonicalNoteId: "de1",
    members: [
        { noteId: "de1", title: "Auto", icon: "bx bx-note", displayName: "en" },
        { noteId: "en1", title: "Car", icon: "bx bx-note" }
    ]
};

const entity: EquivalentNotesGroup = {
    relationName: "entity",
    canonicalNoteId: "wiki",
    members: [
        { noteId: "wiki", title: "Wikipedia", icon: "bx bx-note", displayName: "Wiki" }
    ]
};

describe("equivalence switcher filters", () => {
    it("filters types by name or by a member's name or title, and members the same way", () => {
        const groups = [ translation, entity ];

        expect(filterEquivalenceGroups(groups, "").map((group) => group.relationName))
            .toEqual([ "translation", "entity" ]);
        expect(filterEquivalenceGroups(groups, "trans").map((group) => group.relationName))
            .toEqual([ "translation" ]);
        expect(filterEquivalenceGroups(groups, "car").map((group) => group.relationName))
            .toEqual([ "translation" ]);
        expect(filterEquivalenceGroups(groups, "wiki").map((group) => group.relationName))
            .toEqual([ "entity" ]);

        expect(filterEquivalenceMembers(translation.members, "en").map((member) => member.noteId))
            .toEqual([ "de1" ]);
        expect(filterEquivalenceMembers(translation.members, "car").map((member) => member.noteId))
            .toEqual([ "en1" ]);
        expect(filterEquivalenceMembers(translation.members, "missing")).toEqual([]);
    });

    it("names the status-bar button after this note's class name, or the type when that is empty", () => {
        expect(switcherButtonText(translation, "de1")).toBe("en");
        expect(switcherButtonText(translation, "en1")).toBe("translation");
        expect(switcherButtonText(undefined, "de1")).toBe("");
    });
});
