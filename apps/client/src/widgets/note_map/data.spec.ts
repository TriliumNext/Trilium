import { NoteMapPostResponse } from "@triliumnext/commons";
import { afterEach, describe, expect, it, vi } from "vitest";

import server from "../../services/server";
import {
    applyRelationBridges,
    collapseKeys,
    carryPositions,
    collapseRelations,
    dropUnlinkedNotes,
    dropExpansion,
    expandReification,
    expandReifications,
    expandedLinkId,
    foldOrder,
    foldTitle,
    loadNotesAndRelations,
    NotesAndRelationsData,
    predicateCollapseKey,
    predicateForEdge,
    predicatesIn,
    presentRelations,
    relationEndTitle,
    resolveFoldEnd,
    splitFoldTitle,
    statementsBetween
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
    const notes = (): NotesAndRelationsData => ({
        nodes: [
            { id: "alpha", name: "Alpha", type: "text", color: null, icon: "bx bx-file", x: 0, y: 0 },
            { id: "beta", name: "Beta", type: "text", color: null, icon: "bx bx-file", x: 10, y: 0 },
            { id: "gamma", name: "Gamma", type: "text", color: null, icon: "bx bx-file", x: 0, y: 10 }
        ],
        links: [
            { id: "alpha-beta", source: "alpha", target: "beta", name: "cites" },
            { id: "alpha-gamma", source: "alpha", target: "gamma", name: "mentions" }
        ],
        noteIdToSizeMap: { alpha: 4, beta: 4, gamma: 4 },
        reificationLinks: []
    });

    it("folds the two notes and the relation into one node, then folds that node again", () => {
        const data = notes();
        const once = collapseRelations(data, new Set([ "alpha-beta" ]));
        const folded = once.nodes.find((node) => node.id === "fold:alpha-beta");

        // Gamma was reached through Alpha. cites(Alpha, Beta) does not mention Gamma.
        expect(once.nodes.map((node) => node.id)).toEqual([ "fold:alpha-beta" ]);
        expect(once.links).toEqual([]);
        expect(folded).toMatchObject({ name: "cites(Alpha, Beta)", x: 5, y: 0 });
        expect(folded?.fold).toEqual({
            linkId: "alpha-beta",
            sourceNoteId: "alpha",
            targetNoteId: "beta",
            predicate: "cites",
            predicates: [ "cites" ],
            subject: { noteId: "alpha" },
            object: { noteId: "beta" }
        });

        const both = collapseRelations(data, new Set([ "alpha-beta", "alpha-gamma" ]));
        expect(both.nodes.map((node) => node.id)).toEqual([ "fold:alpha-gamma" ]);
        expect(both.nodes[0].name).toBe("mentions(cites(Alpha, Beta), Gamma)");
        // Alpha was drawn inside the cites fold. mentions still belongs to Alpha, not to that fact.
        expect(both.nodes[0].fold).toMatchObject({
            predicate: "mentions",
            subject: { noteId: "alpha" },
            object: { noteId: "gamma" }
        });
        expect(both.links).toEqual([]);
    });

    it("draws a relation of the fact from the folded node, and leaves the notes' own relations out", () => {
        const data = notes();
        data.reificationLinks = [ {
            linkId: "alpha-beta",
            name: "cause",
            outgoing: true,
            attributeId: "cause-row",
            hostPredicate: "cites",
            note: [ "event", "Event X", "text", null, "bx bx-file" ]
        } ];

        const once = collapseRelations(data, new Set([ "alpha-beta" ]));

        expect(once.nodes.map((node) => node.id).sort()).toEqual([ "event", "fold:alpha-beta" ]);
        expect(once.links).toEqual([
            { id: "alpha-beta-cause-event", source: "fold:alpha-beta", target: "event", name: "cause" }
        ]);
    });

    it("folds an edge drawn from another edge only after that one, and leaves that one folded on expand", () => {
        const data = notes();
        data.reificationLinks = [ {
            linkId: "alpha-beta",
            name: "cause",
            outgoing: true,
            attributeId: "cause-row",
            hostPredicate: "cites",
            note: [ "event", "Event X", "text", null, "bx bx-file" ]
        } ];
        const open = applyRelationBridges(data);
        const cause = open.links.find((link) => link.name === "cause");
        expect(cause?.id).toBe("alpha-beta-cause-event");
        expect(foldOrder(open, "alpha-beta-cause-event")).toEqual([ "alpha-beta", "alpha-beta-cause-event" ]);

        // Asked for last, whichever way the set happens to list them.
        const folded = collapseRelations(open, new Set([ "alpha-beta-cause-event", "alpha-beta" ]));
        expect(folded.nodes.map((node) => node.id)).toEqual([ "fold:alpha-beta-cause-event" ]);
        expect(folded.nodes[0].name).toBe("cause(cites(Alpha, Beta), Event X)");
        expect(folded.nodes[0].fold).toMatchObject({
            predicate: "cause",
            subject: { fact: { predicate: "cites", source: { noteId: "alpha" }, object: { noteId: "beta" } } },
            object: { noteId: "event" }
        });
        expect(folded.links).toEqual([]);

        const expanded = collapseRelations(open, new Set([ "alpha-beta" ]));
        expect(expanded.nodes.map((node) => node.id).sort()).toEqual([ "event", "fold:alpha-beta" ]);
        expect(expanded.links).toEqual([
            {
                id: "alpha-beta-cause-event",
                source: "fold:alpha-beta",
                target: "event",
                name: "cause",
                hostPredicate: "cites",
                hostEndId: "edge:alpha-beta"
            }
        ]);
    });
});

describe("expandReification", () => {
    const ends = {
        rootId: "fact",
        predicate: "cites",
        subject: { id: "alpha", name: "Alpha", type: "text", color: null, icon: "bx bx-file" },
        object: { id: "beta", name: "Beta", type: "text", color: null, icon: "bx bx-file" }
    };

    function factMap(): NotesAndRelationsData {
        return {
            nodes: [
                { id: "fact", name: "cites(Alpha, Beta)", type: "text", color: null, icon: "bx bx-git-commit" },
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

        expect(view.nodes.map((node) => node.id).sort()).toEqual([ "alpha", "beta", "edge:alpha-beta", "event" ]);
        expect(view.links).toEqual([
            { id: "expanded:fact", source: "alpha", target: "beta", name: "cites" },
            { id: "fact-event", source: "edge:alpha-beta", target: "event", name: "cause" }
        ]);
        expect(view.nodes.find((node) => node.id === "edge:alpha-beta")).toMatchObject({
            joint: true,
            jointOf: [ "alpha", "beta" ]
        });
        // The canvas paints from this same map. A copy would leave the new notes without a size.
        expect(view.noteIdToSizeMap).toBe(data.noteIdToSizeMap);
        expect(data.noteIdToSizeMap.alpha).toBe(4);
        expect(data.noteIdToSizeMap["edge:alpha-beta"]).toBe(1);
    });

    it("folds that line back into the fact and keeps the relation drawn from it", () => {
        const folded = presentRelations(factMap(), new Set([ expandedLinkId("fact") ]), [ ends ]);

        expect(folded.nodes.map((node) => node.id).sort()).toEqual([ "event", "fold:expanded:fact" ]);
        expect(folded.links).toEqual([
            { id: "fact-event", source: "fold:expanded:fact", target: "event", name: "cause" }
        ]);
    });

    it("expands a fact that only appears once the fact it hangs on is expanded", () => {
        const inner = {
            rootId: "inner",
            predicate: "mentions",
            subject: { id: "gamma", name: "Gamma", type: "text", color: null, icon: "bx bx-file" },
            object: { id: "delta", name: "Delta", type: "text", color: null, icon: "bx bx-file" }
        };
        const outer = {
            ...ends,
            object: { id: "inner", name: "mentions(Gamma, Delta)", type: "text", color: null, icon: "bx bx-git-commit" }
        };
        const data = factMap();
        data.nodes = [
            { id: "fact", name: "cites(Alpha, mentions(Gamma, Delta))", type: "text", color: null, icon: "bx bx-git-commit" }
        ];
        data.links = [];

        const oneLevel = expandReifications(data, [ outer ]);
        expect(oneLevel.nodes.map((node) => node.id).sort()).toEqual([ "alpha", "edge:alpha-inner", "inner" ]);

        const both = expandReifications(data, [ outer, inner ]);
        expect(both.nodes.map((node) => node.id).sort()).toEqual([ "alpha", "delta", "edge:gamma-delta", "gamma" ]);
        expect(both.links).toContainEqual({
            id: "expanded:fact",
            source: "alpha",
            target: "edge:gamma-delta",
            name: "cites"
        });
    });

    it("forgets the layers inside a note that is shown as one note", () => {
        const node = (id: string) => ({ id, name: id, type: "text", color: null, icon: "" });
        const expanded = new Set([ "outer", "inner" ]);
        const ends = new Map([
            [ "outer", {
                rootId: "outer",
                predicate: "cites",
                subject: node("alpha"),
                object: node("inner")
            } ],
            [ "inner", {
                rootId: "inner",
                predicate: "mentions",
                subject: node("gamma"),
                object: node("delta")
            } ]
        ]);
        const collapsed = new Set([ expandedLinkId("outer"), expandedLinkId("inner"), "kept" ]);

        dropExpansion("outer", expanded, ends, collapsed);

        expect([ ...expanded ]).toEqual([]);
        expect([ ...ends.keys() ]).toEqual([]);
        expect([ ...collapsed ]).toEqual([ "kept" ]);
    });
});

describe("relationEndTitle", () => {
    it("names a point on an edge as that edge, and a note as itself", () => {
        const data = {
            nodes: [
                { id: "a", name: "A", type: "text", color: null, icon: "" },
                { id: "b", name: "B", type: "text", color: null, icon: "" },
                { id: "chaos", name: "Chaos", type: "text", color: null, icon: "" },
                {
                    id: "edge:a-b",
                    name: "",
                    type: "text",
                    color: null,
                    icon: "",
                    joint: true,
                    jointOf: [ "a", "b" ] as [ string, string ]
                }
            ],
            links: [
                { id: "a-b", source: "a", target: "b", name: "links" },
                { id: "edge:a-b-leadsTo-chaos", source: "edge:a-b", target: "chaos", name: "leadsTo" }
            ]
        };
        const leadsTo = data.links[1];

        expect(relationEndTitle(leadsTo.source, data)).toBe("links(A, B)");
        expect(relationEndTitle(leadsTo.target, data)).toBe("Chaos");
    });

    it("names a point on a grouped edge as the statement the line hangs on", () => {
        const data = {
            nodes: [
                { id: "a", name: "A", type: "text", color: null, icon: "" },
                { id: "b", name: "B", type: "text", color: null, icon: "" },
                { id: "chaos", name: "Chaos", type: "text", color: null, icon: "" },
                {
                    id: "edge:a-b",
                    name: "",
                    type: "text",
                    color: null,
                    icon: "",
                    joint: true,
                    jointOf: [ "a", "b" ] as [ string, string ]
                }
            ],
            links: [
                { id: "a-b", source: "a", target: "b", name: "likes, hates" },
                {
                    id: "edge:a-b-leadsTo-chaos",
                    source: "edge:a-b",
                    target: "chaos",
                    name: "leadsTo",
                    hostPredicate: "likes",
                    hostEndId: "edge:a-b"
                }
            ]
        };
        const leadsTo = data.links[1];

        expect(relationEndTitle(leadsTo.source, data, new Set(), "likes")).toBe("likes(A, B)");
        expect(relationEndTitle(leadsTo.source, data)).toBe("likes(A, B), hates(A, B)");
        expect(foldTitle(
            [ "leadsTo" ],
            relationEndTitle(leadsTo.source, data, new Set(), leadsTo.hostPredicate),
            relationEndTitle(leadsTo.target, data)
        )).toBe("leadsTo(likes(A, B), Chaos)");
    });
});

describe("resolveFoldEnd", () => {
    it("walks a fold of a fold out to the note that stands for the inner relation", async () => {
        const calls: string[] = [];
        const noteId = await resolveFoldEnd({
            fact: {
                predicate: "links",
                source: { noteId: "a" },
                object: { noteId: "b" }
            }
        }, async (source, predicate, target) => {
            calls.push(`${predicate}(${source}, ${target})`);
            return predicate === "links" ? "links-note" : undefined;
        });

        expect(calls).toEqual([ "links(a, b)" ]);
        expect(noteId).toBe("links-note");
    });

    it("does not pick a statement when several on the same edge have notes", async () => {
        const noteId = await resolveFoldEnd({
            fact: {
                predicate: "cites",
                predicates: [ "cites", "mentions" ],
                source: { noteId: "alpha" },
                object: { noteId: "beta" }
            }
        }, async (_source, predicate) => `${predicate}-note`);

        expect(noteId).toBeUndefined();
    });
});

describe("carryPositions", () => {
    it("keeps a note where it was, and stands a new one where the note that left was", () => {
        const previous = [
            { id: "fact", name: "cites(Alpha, Beta)", type: "text", color: null, icon: "", x: 10, y: 20 },
            { id: "event", name: "Event X", type: "text", color: null, icon: "", x: 80, y: 20 }
        ];
        const next = [
            { id: "event", name: "Event X", type: "text", color: null, icon: "" },
            { id: "alpha", name: "Alpha", type: "text", color: null, icon: "" },
            { id: "beta", name: "Beta", type: "text", color: null, icon: "" }
        ];

        carryPositions(previous, next, "fact");

        expect(next.find((node) => node.id === "event")).toMatchObject({ x: 80, y: 20 });
        expect(next.find((node) => node.id === "alpha")).toMatchObject({ x: 10, y: 20, vx: 0, vy: 0 });
        expect(next.find((node) => node.id === "beta")).toMatchObject({ x: 50, y: 20, vx: 0, vy: 0 });
    });
});

describe("applyRelationBridges", () => {
    it("draws a relation of a fact from the middle of that fact's edge", () => {
        const data: NotesAndRelationsData = {
            nodes: [
                { id: "alpha", name: "Alpha", type: "text", color: null, icon: "bx bx-file" },
                { id: "beta", name: "Beta", type: "text", color: null, icon: "bx bx-file" }
            ],
            links: [
                { id: "alpha-beta", source: "alpha", target: "beta", name: "cites" }
            ],
            noteIdToSizeMap: { alpha: 4, beta: 4 },
            reificationLinks: [ {
                linkId: "alpha-beta",
                name: "cause",
                outgoing: true,
                attributeId: "cause-row",
                hostPredicate: "cites",
                note: [ "event", "Event X", "text", null, "bx bx-file" ]
            } ]
        };

        const view = applyRelationBridges(data);

        expect(view.nodes.map((node) => node.id).sort()).toEqual([ "alpha", "beta", "edge:alpha-beta", "event" ]);
        expect(view.links).toContainEqual({
            id: "alpha-beta-cause-event",
            source: "edge:alpha-beta",
            target: "event",
            name: "cause",
            hostPredicate: "cites",
            hostEndId: "edge:alpha-beta"
        });
        expect(data.noteIdToSizeMap.event).toBe(4);
    });

    it("draws a relation between two facts as a line between those edges", () => {
        const data: NotesAndRelationsData = {
            nodes: [
                { id: "alpha", name: "Alpha", type: "text", color: null, icon: "bx bx-file" },
                { id: "beta", name: "Beta", type: "text", color: null, icon: "bx bx-file" }
            ],
            links: [
                { id: "alpha-beta", source: "alpha", target: "beta", name: "cites" }
            ],
            noteIdToSizeMap: { alpha: 4, beta: 4 },
            reificationLinks: [ {
                linkId: "alpha-beta",
                name: "cause",
                outgoing: true,
                attributeId: "cause-row",
                hostPredicate: "cites",
                otherFact: {
                    linkId: "gamma-item",
                    predicate: "contains",
                    subject: [ "gamma", "Gamma", "text", null, "bx bx-file" ],
                    object: [ "item", "Item", "text", null, "bx bx-file" ]
                }
            } ]
        };

        const view = applyRelationBridges(data);

        expect(view.nodes.map((node) => node.id).sort()).toEqual([
            "alpha", "beta", "edge:alpha-beta", "edge:gamma-item", "gamma", "item"
        ]);
        expect(view.links).toContainEqual({
            id: "gamma-item", source: "gamma", target: "item", name: "contains"
        });
        expect(view.links).toContainEqual({
            id: "edge:alpha-beta-cause-edge:gamma-item",
            source: "edge:alpha-beta",
            target: "edge:gamma-item",
            name: "cause",
            hostPredicate: "cites",
            hostEndId: "edge:alpha-beta",
            farPredicate: "contains",
            farEndId: "edge:gamma-item"
        });

        const bridgeId = "edge:alpha-beta-cause-edge:gamma-item";
        expect(foldOrder(view, bridgeId)).toEqual([ "alpha-beta", "gamma-item", bridgeId ]);
        const folded = collapseRelations(view, new Set(foldOrder(view, bridgeId)));
        expect(folded.nodes.map((node) => node.id)).toEqual([ `fold:${bridgeId}` ]);
        expect(folded.nodes[0].name).toBe("cause(cites(Alpha, Beta), contains(Gamma, Item))");
        expect(folded.nodes[0].fold).toMatchObject({
            predicate: "cause",
            subject: { fact: { predicate: "cites", source: { noteId: "alpha" }, object: { noteId: "beta" } } },
            object: { fact: { predicate: "contains", source: { noteId: "gamma" }, object: { noteId: "item" } } }
        });

        const oneStep = collapseRelations(view, new Set([ "alpha-beta", "gamma-item" ]));
        expect(oneStep.nodes.map((node) => node.id).sort()).toEqual([ "fold:alpha-beta", "fold:gamma-item" ]);
        expect(oneStep.links).toEqual([
            {
                id: bridgeId,
                source: "fold:alpha-beta",
                target: "fold:gamma-item",
                name: "cause",
                hostPredicate: "cites",
                hostEndId: "edge:alpha-beta",
                farPredicate: "contains",
                farEndId: "edge:gamma-item"
            }
        ]);
    });

    it("keeps a fact-to-fact relation when only one fact is folded, including without a prior bridge", () => {
        const data: NotesAndRelationsData = {
            nodes: [
                { id: "alpha", name: "Alpha", type: "text", color: null, icon: "bx bx-file" },
                { id: "beta", name: "Beta", type: "text", color: null, icon: "bx bx-file" }
            ],
            links: [
                { id: "alpha-beta", source: "alpha", target: "beta", name: "cites" }
            ],
            noteIdToSizeMap: { alpha: 4, beta: 4 },
            reificationLinks: [ {
                linkId: "alpha-beta",
                name: "cause",
                outgoing: true,
                attributeId: "cause-row",
                hostPredicate: "cites",
                otherFact: {
                    linkId: "gamma-item",
                    predicate: "contains",
                    subject: [ "gamma", "Gamma", "text", null, "bx bx-file" ],
                    object: [ "item", "Item", "text", null, "bx bx-file" ]
                }
            } ]
        };

        const folded = presentRelations(data, new Set([ "alpha-beta" ]));
        expect(folded.links).toContainEqual({
            id: "gamma-item", source: "gamma", target: "item", name: "contains"
        });
        expect(folded.links).toContainEqual({
            id: "edge:alpha-beta-cause-edge:gamma-item",
            source: "fold:alpha-beta",
            target: "edge:gamma-item",
            name: "cause",
            hostPredicate: "cites",
            hostEndId: "edge:alpha-beta",
            farPredicate: "contains",
            farEndId: "edge:gamma-item"
        });

        const direct = collapseRelations(data, new Set([ "alpha-beta" ]));
        expect(direct.links).toContainEqual({
            id: "gamma-item", source: "gamma", target: "item", name: "contains"
        });
        expect(direct.links).toContainEqual({
            id: "edge:alpha-beta-cause-edge:gamma-item",
            source: "fold:alpha-beta",
            target: "edge:gamma-item",
            name: "cause"
        });
    });

    it("keeps the other fact's relation when only one fact is folded", () => {
        const data: NotesAndRelationsData = {
            nodes: [
                { id: "alpha", name: "Alpha", type: "text", color: null, icon: "bx bx-file" },
                { id: "beta", name: "Beta", type: "text", color: null, icon: "bx bx-file" },
                { id: "delta", name: "Delta", type: "text", color: null, icon: "bx bx-file" },
                { id: "epsilon", name: "Epsilon", type: "text", color: null, icon: "bx bx-file" }
            ],
            links: [
                { id: "alpha-beta", source: "alpha", target: "beta", name: "cites" },
                { id: "delta-epsilon", source: "delta", target: "epsilon", name: "mentions" }
            ],
            noteIdToSizeMap: { alpha: 4, beta: 4, delta: 4, epsilon: 4 },
            reificationLinks: [
                {
                    linkId: "alpha-beta",
                    name: "cause",
                    outgoing: true,
                    attributeId: "cause-row",
                    hostPredicate: "cites",
                    note: [ "event", "Event X", "text", null, "bx bx-file" ]
                },
                {
                    linkId: "delta-epsilon",
                    name: "because",
                    outgoing: true,
                    attributeId: "because-row",
                    hostPredicate: "mentions",
                    note: [ "reason", "Reason", "text", null, "bx bx-file" ]
                }
            ]
        };

        const folded = presentRelations(data, new Set([ "alpha-beta" ]));
        expect(folded.links).toContainEqual({
            id: "alpha-beta-cause-event",
            source: "fold:alpha-beta",
            target: "event",
            name: "cause",
            hostPredicate: "cites",
            hostEndId: "edge:alpha-beta"
        });
        expect(folded.links).toContainEqual({
            id: "delta-epsilon-because-reason",
            source: "edge:delta-epsilon",
            target: "reason",
            name: "because",
            hostPredicate: "mentions",
            hostEndId: "edge:delta-epsilon"
        });
        expect(folded.links).toContainEqual({
            id: "delta-epsilon", source: "delta", target: "epsilon", name: "mentions"
        });
    });

    it("folds every predicate on a grouped edge", () => {
        const data: NotesAndRelationsData = {
            nodes: [
                { id: "alpha", name: "Alpha", type: "text", color: null, icon: "bx bx-file" },
                { id: "beta", name: "Beta", type: "text", color: null, icon: "bx bx-file" }
            ],
            links: [
                { id: "alpha-beta", source: "alpha", target: "beta", name: "cites, mentions" }
            ],
            noteIdToSizeMap: { alpha: 4, beta: 4 }
        };

        const folded = collapseRelations(data, new Set([ "alpha-beta" ]));
        expect(folded.nodes[0].name).toBe("cites(Alpha, Beta), mentions(Alpha, Beta)");
        expect(folded.nodes[0].fold?.predicates).toEqual([ "cites", "mentions" ]);
        expect(folded.nodes[0].fold?.predicate).toBe("cites");
    });

    it("folds one statement of a grouped edge and leaves the other on the line", () => {
        const data: NotesAndRelationsData = {
            nodes: [
                { id: "alpha", name: "Alpha", type: "text", color: null, icon: "bx bx-file" },
                { id: "beta", name: "Beta", type: "text", color: null, icon: "bx bx-file" }
            ],
            links: [
                { id: "alpha-beta", source: "alpha", target: "beta", name: "cites, mentions" }
            ],
            noteIdToSizeMap: { alpha: 4, beta: 4 }
        };
        const foldId = `fold:${predicateCollapseKey("alpha-beta", "mentions")}`;

        const folded = collapseRelations(data, new Set([ predicateCollapseKey("alpha-beta", "mentions") ]));

        expect(folded.nodes.map((node) => node.id).sort()).toEqual([ "alpha", "beta", foldId ].sort());
        expect(folded.nodes.find((node) => node.id === foldId)?.name).toBe("mentions(Alpha, Beta)");
        expect(folded.links).toContainEqual({
            id: "alpha-beta", source: "alpha", target: "beta", name: "cites"
        });
        expect(folded.links.some((link) => link.source === foldId || link.target === foldId)).toBe(false);
    });

    it("folds a relation of one statement without folding the other name on that edge", () => {
        const data: NotesAndRelationsData = {
            nodes: [
                { id: "alpha", name: "Alpha", type: "text", color: null, icon: "bx bx-file" },
                { id: "beta", name: "Beta", type: "text", color: null, icon: "bx bx-file" }
            ],
            links: [
                { id: "alpha-beta", source: "alpha", target: "beta", name: "cites, mentions" }
            ],
            noteIdToSizeMap: { alpha: 4, beta: 4 },
            reificationLinks: [ {
                linkId: "alpha-beta",
                name: "cause",
                outgoing: true,
                attributeId: "cause-row",
                hostPredicate: "mentions",
                note: [ "event", "Event", "text", null, "bx bx-file" ]
            } ]
        };
        const open = applyRelationBridges(data);
        const bridgeId = "alpha-beta-cause-event";
        const order = foldOrder(open, bridgeId);
        const keys = collapseKeys(
            order,
            bridgeId,
            "cause",
            (id) => predicatesIn(open.links.find((link) => link.id === id)?.name ?? ""),
            (edgeId) => predicateForEdge(edgeId, order, open)
        );

        expect(keys).toEqual([ predicateCollapseKey("alpha-beta", "mentions"), bridgeId ]);

        const folded = collapseRelations(open, new Set(keys));

        expect(folded.nodes.map((node) => node.id).sort()).toEqual([ "alpha", "beta", `fold:${bridgeId}` ]);
        expect(folded.nodes.find((node) => node.id === `fold:${bridgeId}`)?.name).toBe("cause(mentions(Alpha, Beta), Event)");
        expect(folded.links).toContainEqual({
            id: "alpha-beta", source: "alpha", target: "beta", name: "cites"
        });
    });

    it("folds the far fact's statement and leaves the other name on that edge", () => {
        const data: NotesAndRelationsData = {
            nodes: [
                { id: "alpha", name: "Alpha", type: "text", color: null, icon: "bx bx-file" },
                { id: "beta", name: "Beta", type: "text", color: null, icon: "bx bx-file" },
                { id: "gamma", name: "Gamma", type: "text", color: null, icon: "bx bx-file" },
                { id: "item", name: "Item", type: "text", color: null, icon: "bx bx-file" }
            ],
            links: [
                { id: "alpha-beta", source: "alpha", target: "beta", name: "cites" },
                { id: "gamma-item", source: "gamma", target: "item", name: "likes, knows" }
            ],
            noteIdToSizeMap: { alpha: 4, beta: 4, gamma: 4, item: 4 },
            reificationLinks: [ {
                linkId: "alpha-beta",
                name: "cause",
                outgoing: true,
                attributeId: "cause-row",
                hostPredicate: "cites",
                otherFact: {
                    linkId: "gamma-item",
                    predicate: "knows",
                    subject: [ "gamma", "Gamma", "text", null, "bx bx-file" ],
                    object: [ "item", "Item", "text", null, "bx bx-file" ]
                }
            } ]
        };
        const open = applyRelationBridges(data);
        const bridgeId = "edge:alpha-beta-cause-edge:gamma-item";
        const order = foldOrder(open, bridgeId);
        const keys = collapseKeys(
            order,
            bridgeId,
            "cause",
            (id) => predicatesIn(open.links.find((link) => link.id === id)?.name ?? ""),
            (edgeId) => predicateForEdge(edgeId, order, open)
        );

        expect(keys).toEqual([
            "alpha-beta",
            predicateCollapseKey("gamma-item", "knows"),
            bridgeId
        ]);

        const folded = collapseRelations(open, new Set(keys));

        expect(folded.links).toContainEqual({
            id: "gamma-item", source: "gamma", target: "item", name: "likes"
        });
        expect(folded.nodes.find((node) => node.id === `fold:${bridgeId}`)?.name)
            .toBe("cause(cites(Alpha, Beta), knows(Gamma, Item))");
    });

    it("folds the edge a relation hangs on and leaves the reverse edge", () => {
        const data: NotesAndRelationsData = {
            nodes: [
                { id: "alpha", name: "Alpha", type: "text", color: null, icon: "bx bx-file" },
                { id: "beta", name: "Beta", type: "text", color: null, icon: "bx bx-file" },
                { id: "event", name: "Event", type: "text", color: null, icon: "bx bx-file" }
            ],
            links: [
                { id: "beta-alpha", source: "beta", target: "alpha", name: "mentions, contains" },
                { id: "alpha-beta", source: "alpha", target: "beta", name: "cites, likes" }
            ],
            noteIdToSizeMap: { alpha: 4, beta: 4, event: 4 },
            reificationLinks: [ {
                linkId: "alpha-beta",
                name: "cause",
                outgoing: true,
                attributeId: "cause-row",
                hostPredicate: "likes",
                note: [ "event", "Event", "text", null, "bx bx-file" ]
            } ]
        };
        const open = applyRelationBridges(data);
        const bridgeId = "alpha-beta-cause-event";
        const order = foldOrder(open, bridgeId);
        const keys = collapseKeys(
            order,
            bridgeId,
            "cause",
            (id) => predicatesIn(open.links.find((link) => link.id === id)?.name ?? ""),
            (edgeId) => predicateForEdge(edgeId, order, open)
        );

        expect(keys).toEqual([ predicateCollapseKey("alpha-beta", "likes"), bridgeId ]);

        const folded = collapseRelations(open, new Set(keys));

        expect(folded.links).toContainEqual({
            id: "beta-alpha", source: "beta", target: "alpha", name: "mentions, contains"
        });
        expect(folded.links).toContainEqual({
            id: "alpha-beta", source: "alpha", target: "beta", name: "cites"
        });
    });

    it("folds the statement that was left on the line as its own note", () => {
        const data: NotesAndRelationsData = {
            nodes: [
                { id: "alpha", name: "Alpha", type: "text", color: null, icon: "bx bx-file" },
                { id: "beta", name: "Beta", type: "text", color: null, icon: "bx bx-file" }
            ],
            links: [
                { id: "alpha-beta", source: "alpha", target: "beta", name: "cites, mentions" }
            ],
            noteIdToSizeMap: { alpha: 4, beta: 4 }
        };

        const folded = collapseRelations(data, new Set([
            predicateCollapseKey("alpha-beta", "cites"),
            predicateCollapseKey("alpha-beta", "mentions")
        ]));

        expect(folded.nodes.map((node) => node.name).sort()).toEqual([
            "Alpha", "Beta", "cites(Alpha, Beta)", "mentions(Alpha, Beta)"
        ]);
        expect(folded.links.some((link) => link.id === "alpha-beta")).toBe(false);
    });

    it("folds a relation of one statement on a grouped edge as that statement", () => {
        const data: NotesAndRelationsData = {
            nodes: [
                { id: "alpha", name: "Alpha", type: "text", color: null, icon: "bx bx-file" },
                { id: "beta", name: "Beta", type: "text", color: null, icon: "bx bx-file" }
            ],
            links: [
                { id: "alpha-beta", source: "alpha", target: "beta", name: "cites, mentions" }
            ],
            noteIdToSizeMap: { alpha: 4, beta: 4 },
            reificationLinks: [ {
                linkId: "alpha-beta",
                name: "cause",
                outgoing: true,
                attributeId: "mentions-row",
                hostPredicate: "mentions",
                note: [ "event", "Event", "text", null, "bx bx-file" ]
            } ]
        };

        const open = applyRelationBridges(data);
        const bridgeId = "alpha-beta-cause-event";
        const folded = collapseRelations(open, new Set(foldOrder(open, bridgeId)));

        expect(folded.nodes.map((node) => node.id)).toEqual([ `fold:${bridgeId}` ]);
        expect(folded.nodes[0].name).toBe("cause(mentions(Alpha, Beta), Event)");
        expect(folded.nodes[0].fold?.subject).toMatchObject({
            fact: { predicate: "mentions", predicates: [ "mentions" ] }
        });
    });

    it("splits a grouped fold title between statements", () => {
        expect(splitFoldTitle("cites(Alpha, Beta), mentions(Alpha, Beta)")).toEqual([
            "cites(Alpha, Beta)",
            "mentions(Alpha, Beta)"
        ]);
        expect(splitFoldTitle("cause(mentions(Alpha, Beta), Event)")).toEqual([
            "cause(mentions(Alpha, Beta), Event)"
        ]);
    });
});

describe("statementsBetween", () => {
    const links = [
        { id: "beta-alpha", source: "beta", target: "alpha", name: "mentions, contains" },
        { id: "alpha-beta", source: "alpha", target: "beta", name: "cites, likes" },
        { id: "edge:alpha-beta-cause-event", source: "edge:alpha-beta", target: "event", name: "cause" }
    ];

    it("lists both directions between two notes, and a line off an edge as itself", () => {
        expect(statementsBetween("alpha-beta", links)).toEqual([
            { linkId: "alpha-beta", predicate: "cites", sourceId: "alpha", targetId: "beta" },
            { linkId: "alpha-beta", predicate: "likes", sourceId: "alpha", targetId: "beta" },
            { linkId: "beta-alpha", predicate: "mentions", sourceId: "beta", targetId: "alpha" },
            { linkId: "beta-alpha", predicate: "contains", sourceId: "beta", targetId: "alpha" }
        ]);
        expect(statementsBetween("beta-alpha", links).map((item) => item.predicate)).toEqual([
            "mentions", "contains", "cites", "likes"
        ]);
        expect(statementsBetween("edge:alpha-beta-cause-event", links)).toEqual([
            { linkId: "edge:alpha-beta-cause-event", predicate: "cause", sourceId: "edge:alpha-beta", targetId: "event" }
        ]);
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
