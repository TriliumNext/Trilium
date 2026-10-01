import { NoteMapPostResponse } from "@triliumnext/commons";
import { afterEach, describe, expect, it, vi } from "vitest";

import server from "../../services/server";
import {
    applyRelationBridges,
    collapseRelations,
    dropUnlinkedNotes,
    expandReification,
    loadNotesAndRelations,
    NotesAndRelationsData,
    presentRelations
} from "./data";

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

describe("collapseRelations", () => {
    const people = (): NotesAndRelationsData => ({
        nodes: [
            { id: "john", name: "John", type: "text", color: null, icon: "bx bx-file", x: 0, y: 0 },
            { id: "mary", name: "Mary", type: "text", color: null, icon: "bx bx-file", x: 10, y: 0 },
            { id: "mark", name: "Mark", type: "text", color: null, icon: "bx bx-file", x: 0, y: 10 }
        ],
        links: [
            { id: "john-mary", source: "john", target: "mary", name: "loves" },
            { id: "john-mark", source: "john", target: "mark", name: "knows" }
        ],
        noteIdToSizeMap: { john: 4, mary: 4, mark: 4 },
        reificationLinks: []
    });

    it("folds the two notes and the relation into one node, then folds that node again", () => {
        const data = people();
        const loves = collapseRelations(data, new Set([ "john-mary" ]));
        const folded = loves.nodes.find((node) => node.id === "fold:john-mary");

        // Mark was reached through John. The fact loves(John, Mary) does not know Mark.
        expect(loves.nodes.map((node) => node.id)).toEqual([ "fold:john-mary" ]);
        expect(loves.links).toEqual([]);
        expect(folded).toMatchObject({ name: "loves(John, Mary)", x: 5, y: 0 });
        expect(folded?.fold).toEqual({
            linkId: "john-mary",
            sourceNoteId: "john",
            targetNoteId: "mary",
            predicate: "loves"
        });

        const both = collapseRelations(data, new Set([ "john-mary", "john-mark" ]));
        expect(both.nodes.map((node) => node.id)).toEqual([ "fold:john-mark" ]);
        expect(both.nodes[0].name).toBe("knows(loves(John, Mary), Mark)");
        expect(both.links).toEqual([]);
    });

    it("draws a relation of the fact from the folded node, and leaves the notes' own relations out", () => {
        const data = people();
        data.reificationLinks = [ {
            linkId: "john-mary",
            name: "cause",
            outgoing: true,
            note: [ "event", "Event X", "text", null, "bx bx-file" ]
        } ];

        const loves = collapseRelations(data, new Set([ "john-mary" ]));

        expect(loves.nodes.map((node) => node.id).sort()).toEqual([ "event", "fold:john-mary" ]);
        expect(loves.links).toEqual([
            { id: "john-mary-cause-event", source: "fold:john-mary", target: "event", name: "cause" }
        ]);
    });
});

describe("expandReification", () => {
    const ends = {
        rootId: "fact",
        predicate: "loves",
        subject: { id: "john", name: "John", type: "text", color: null, icon: "bx bx-file" },
        object: { id: "mary", name: "Mary", type: "text", color: null, icon: "bx bx-file" }
    };

    function factMap(): NotesAndRelationsData {
        return {
            nodes: [
                { id: "fact", name: "loves(John, Mary)", type: "text", color: null, icon: "bx bx-git-commit" },
                { id: "event", name: "Event X", type: "text", color: null, icon: "bx bx-file" }
            ],
            links: [
                { id: "fact-event", source: "fact", target: "event", name: "cause" }
            ],
            noteIdToSizeMap: { fact: 6, event: 4 },
            reificationLinks: []
        };
    }

    it("puts the two notes back and draws the fact's relations from the line between them", () => {
        const data = factMap();
        const view = expandReification(data, ends);

        expect(view.nodes.map((node) => node.id).sort()).toEqual([ "edge:john-mary", "event", "john", "mary" ]);
        expect(view.links).toEqual([
            { id: "john-mary", source: "john", target: "mary", name: "loves" },
            { id: "fact-event", source: "edge:john-mary", target: "event", name: "cause" }
        ]);
        expect(view.nodes.find((node) => node.id === "edge:john-mary")).toMatchObject({
            joint: true,
            jointOf: [ "john", "mary" ]
        });
        // The canvas paints from this same map. A copy would leave the new notes without a size.
        expect(view.noteIdToSizeMap).toBe(data.noteIdToSizeMap);
        expect(data.noteIdToSizeMap.john).toBe(4);
        expect(data.noteIdToSizeMap["edge:john-mary"]).toBe(1);
    });

    it("folds that line back into the fact and keeps the relation drawn from it", () => {
        const folded = presentRelations(factMap(), new Set([ "john-mary" ]), ends);

        expect(folded.nodes.map((node) => node.id).sort()).toEqual([ "event", "fold:john-mary" ]);
        expect(folded.links).toEqual([
            { id: "fact-event", source: "fold:john-mary", target: "event", name: "cause" }
        ]);
    });
});

describe("applyRelationBridges", () => {
    it("draws a relation of a fact from the middle of that fact's edge", () => {
        const data: NotesAndRelationsData = {
            nodes: [
                { id: "john", name: "John", type: "text", color: null, icon: "bx bx-file" },
                { id: "mary", name: "Mary", type: "text", color: null, icon: "bx bx-file" }
            ],
            links: [
                { id: "john-mary", source: "john", target: "mary", name: "loves" }
            ],
            noteIdToSizeMap: { john: 4, mary: 4 },
            reificationLinks: [ {
                linkId: "john-mary",
                name: "cause",
                outgoing: true,
                note: [ "event", "Event X", "text", null, "bx bx-file" ]
            } ]
        };

        const view = applyRelationBridges(data);

        expect(view.nodes.map((node) => node.id).sort()).toEqual([ "edge:john-mary", "event", "john", "mary" ]);
        expect(view.links).toContainEqual({
            id: "john-mary-cause-event",
            source: "edge:john-mary",
            target: "event",
            name: "cause"
        });
        expect(data.noteIdToSizeMap.event).toBe(4);
    });

    it("draws a relation between two facts as a line between those edges", () => {
        const data: NotesAndRelationsData = {
            nodes: [
                { id: "john", name: "John", type: "text", color: null, icon: "bx bx-file" },
                { id: "mary", name: "Mary", type: "text", color: null, icon: "bx bx-file" }
            ],
            links: [
                { id: "john-mary", source: "john", target: "mary", name: "loves" }
            ],
            noteIdToSizeMap: { john: 4, mary: 4 },
            reificationLinks: [ {
                linkId: "john-mary",
                name: "cause",
                outgoing: true,
                otherFact: {
                    linkId: "mark-jealousy",
                    predicate: "has",
                    subject: [ "mark", "Mark", "text", null, "bx bx-file" ],
                    object: [ "jealousy", "Jealousy", "text", null, "bx bx-file" ]
                }
            } ]
        };

        const view = applyRelationBridges(data);

        expect(view.nodes.map((node) => node.id).sort()).toEqual([
            "edge:john-mary", "edge:mark-jealousy", "jealousy", "john", "mark", "mary"
        ]);
        expect(view.links).toContainEqual({
            id: "mark-jealousy", source: "mark", target: "jealousy", name: "has"
        });
        expect(view.links).toContainEqual({
            id: "edge:john-mary-cause-edge:mark-jealousy",
            source: "edge:john-mary",
            target: "edge:mark-jealousy",
            name: "cause"
        });
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
