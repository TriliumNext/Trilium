import { NoteMapPostResponse } from "@triliumnext/commons";
import { afterEach, describe, expect, it, vi } from "vitest";

import server from "../../services/server";
import { dropUnlinkedNotes, loadNotesAndRelations } from "./data";

describe("loadNotesAndRelations", () => {
    afterEach(() => vi.restoreAllMocks());

    /** Two notes pointed at from the root, one of them by two relations at once, and a loose note. */
    const response: NoteMapPostResponse = {
        notes: [
            [ "root", "Root", "text", null, "bx bx-home" ],
            [ "linked", "Linked", "code", "#ff0000", "bx bx-code" ],
            [ "loose", "Loose", "text", null, "bx bx-file" ]
        ],
        links: [
            { key: "1", sourceNoteId: "root", targetNoteId: "linked", name: "relates" },
            { key: "2", sourceNoteId: "root", targetNoteId: "linked", name: "mentions" },
            // The same relation twice over — a note can carry two of a name pointing the same way.
            { key: "3", sourceNoteId: "root", targetNoteId: "linked", name: "relates" }
        ],
        noteIdToDescendantCountMap: { root: 4, linked: 0 }
    };
    const answerWith = (resp: NoteMapPostResponse) => vi.spyOn(server, "post").mockResolvedValue(resp);

    it("reads the notes and gathers the relations running between each pair into one", async () => {
        answerWith(response);
        const { nodes, links, noteIdToSizeMap } = await loadNotesAndRelations("root", [], [], "link");

        expect(nodes).toEqual([
            { id: "root", name: "Root", type: "text", color: null, icon: "bx bx-home" },
            { id: "linked", name: "Linked", type: "code", color: "#ff0000", icon: "bx bx-code" },
            { id: "loose", name: "Loose", type: "text", color: null, icon: "bx bx-file" }
        ]);

        // One relation drawn for the pair, named for each of the ways they are related, and a name
        // carried twice named once.
        expect(links).toEqual([ { id: "root-linked", source: "root", target: "linked", name: "relates, mentions" } ]);

        // A note of a link map is drawn the larger the more is pointed at it, counting every relation
        // rather than the one drawn for them.
        expect(noteIdToSizeMap).toEqual({ root: 4, linked: 4 + Math.sqrt(3), loose: 4 });
    });

    it("drops the notes nothing links to only where it is asked to, and only from a link map", async () => {
        answerWith(response);
        const linkMap = await loadNotesAndRelations("root", [], [], "link", true);
        expect(linkMap.nodes.map((node) => node.id)).toEqual([ "root", "linked" ]);

        // A tree map links every note to its parent, so it has no unlinked notes to speak of — and is
        // sized by what hangs off each note rather than by what points at it.
        answerWith(response);
        const treeMap = await loadNotesAndRelations("root", [], [], "tree", true);
        expect(treeMap.nodes.map((node) => node.id)).toEqual([ "root", "linked", "loose" ]);
        expect(treeMap.noteIdToSizeMap).toEqual({ root: 4 + 1 + Math.round(Math.log(4) / Math.log(1.5)), linked: 4 });
    });
});

describe("dropUnlinkedNotes", () => {
    const nodes = [ { id: "root" }, { id: "source" }, { id: "target" }, { id: "loose" } ];
    const links = [ { id: "source-target", sourceNoteId: "source", targetNoteId: "target", names: [ "relates" ] } ];

    it("keeps the notes a relation touches along with the map root, and drops the rest", () => {
        expect(dropUnlinkedNotes(nodes, links, "root")).toEqual([ { id: "root" }, { id: "source" }, { id: "target" } ]);

        // Nothing linked at all: the root still stands on its own rather than leaving an empty map.
        expect(dropUnlinkedNotes(nodes, [], "root")).toEqual([ { id: "root" } ]);

        // A root that isn't among the nodes (a search note is not part of its own results) would
        // leave nothing to keep, so the map is left as it was rather than emptied.
        expect(dropUnlinkedNotes(nodes, [], "missing")).toEqual(nodes);
        expect(dropUnlinkedNotes(nodes, links, "missing")).toEqual([ { id: "source" }, { id: "target" } ]);
    });
});
