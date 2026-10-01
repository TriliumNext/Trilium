import { describe, expect, it } from "vitest";

import type { RelationMapReification } from "@triliumnext/commons";

import { placeReificationTokens, projectRelationMap, relationSurvivesFold } from "./reification_layout";

function token(overrides: Partial<RelationMapReification> & Pick<RelationMapReification, "noteId" | "kind">): RelationMapReification {
    return {
        attributeId: overrides.noteId,
        title: overrides.noteId,
        subjectNoteId: "a",
        objectNoteId: null,
        ...overrides
    };
}

describe("placeReificationTokens", () => {
    const notes = [
        { noteId: "a", x: 0, y: 0 },
        { noteId: "b", x: 200, y: 0 },
        { noteId: "c", x: 0, y: 200 }
    ];

    it("sits a relation on the midpoint of its notes and a label above its owner", () => {
        const placed = placeReificationTokens(notes, [
            token({ noteId: "rel", kind: "relation", subjectNoteId: "a", objectNoteId: "b" }),
            token({ noteId: "lab", kind: "label", subjectNoteId: "a" })
        ]);

        // Note centers are (75, 20) and (275, 20). The midpoint is (175, 20),
        // and the token's top-left is half a 22px token back from that.
        expect(placed.find((item) => item.noteId === "rel")).toMatchObject({ x: 164, y: 9, kind: "relation" });
        // Note center (75, 20), lifted 48px above the box, then back by half the token.
        expect(placed.find((item) => item.noteId === "lab")).toMatchObject({ x: 64, y: -39, kind: "label" });
    });

    it("offsets two relations between the same notes, and lifts a self-relation", () => {
        const placed = placeReificationTokens(notes, [
            token({ noteId: "one", kind: "relation", subjectNoteId: "a", objectNoteId: "b" }),
            token({ noteId: "two", kind: "relation", subjectNoteId: "a", objectNoteId: "b" }),
            token({ noteId: "self", kind: "relation", subjectNoteId: "a", objectNoteId: "a" })
        ]);

        const one = placed.find((item) => item.noteId === "one");
        const two = placed.find((item) => item.noteId === "two");
        expect(one?.y).not.toBe(two?.y);
        expect(one?.x).toBe(two?.x);
        // Center (75, 20), lifted 48px, then back by half the token.
        expect(placed.find((item) => item.noteId === "self")).toMatchObject({ x: 64, y: -39 });
    });

    it("places a reification of a reification between the note and the first token", () => {
        const placed = placeReificationTokens(notes, [
            token({ noteId: "edge", kind: "relation", subjectNoteId: "a", objectNoteId: "b" }),
            token({ noteId: "meta", kind: "relation", subjectNoteId: "c", objectNoteId: "edge" })
        ]);

        const edge = placed.find((item) => item.noteId === "edge");
        const meta = placed.find((item) => item.noteId === "meta");
        expect(edge).toBeTruthy();
        expect(meta).toBeTruthy();
        if (!edge || !meta) {
            return;
        }
        // meta sits between c's center and the edge token's center, so its x is
        // between them rather than on either.
        expect(meta.x).toBeGreaterThan(0);
        expect(meta.x).toBeLessThan(edge.x);
    });

    it("skips a token whose ends are not on the map, and a token that is already a note box", () => {
        const placed = placeReificationTokens(notes, [
            token({ noteId: "missing", kind: "relation", subjectNoteId: "a", objectNoteId: "absent" }),
            token({ noteId: "a", kind: "label", subjectNoteId: "b" })
        ]);
        expect(placed).toEqual([]);
    });

    it("keeps a relation as the edge when its note was also placed on the map", () => {
        const placed = placeReificationTokens(
            [ ...notes, { noteId: "rel", x: 400, y: 400 } ],
            [ token({ noteId: "rel", kind: "relation", subjectNoteId: "a", objectNoteId: "b" }) ]
        );

        // The box at (400, 400) is ignored. The edge sits on the midpoint of a and b.
        expect(placed.find((item) => item.noteId === "rel")).toMatchObject({ x: 164, y: 9 });
    });
});

describe("projectRelationMap", () => {
    const notes = [
        { noteId: "a", x: 0, y: 0 },
        { noteId: "b", x: 200, y: 0 },
        { noteId: "c", x: 0, y: 200 },
        { noteId: "d", x: 500, y: 500 }
    ];
    const reifications = [
        token({ noteId: "ab", kind: "relation", subjectNoteId: "a", objectNoteId: "b", title: "R(A, B)" })
    ];
    const relations = [
        { sourceNoteId: "a", targetNoteId: "b" },
        { sourceNoteId: "ab", targetNoteId: "c" }
    ];

    it("draws R(A, B) as the arrow while A is open, and pulls C in along that arrow", () => {
        const projected = projectRelationMap(notes, reifications, relations, "a");

        expect(projected.circles.map((note) => note.noteId).sort()).toEqual([ "a", "b", "c" ]);
        expect(projected.tokens.map((item) => item.noteId)).toEqual([ "ab" ]);
    });

    it("draws R(A, B) as a circle where the arrow was, once that relation is open", () => {
        const projected = projectRelationMap(notes, reifications, relations, "ab");
        const opened = projected.circles.find((note) => note.noteId === "ab");

        // Centers of a and b are (75, 20) and (275, 20). The circle is centered
        // on that same point, so its top-left is (100, 0).
        expect(opened).toMatchObject({ x: 100, y: 0 });
        expect(projected.circles.map((note) => note.noteId).sort()).toEqual([ "ab", "c" ]);
        expect(projected.tokens).toEqual([]);
    });

    it("folds A, the relation and B into one circle, then folds that circle again", () => {
        const people = [
            { noteId: "john", x: 0, y: 0 },
            { noteId: "mary", x: 200, y: 0 },
            { noteId: "mark", x: 0, y: 200 },
            { noteId: "jealousy", x: 200, y: 200 }
        ];
        const edges = [
            token({ noteId: "loves", kind: "relation", subjectNoteId: "john", objectNoteId: "mary", attributeId: "loves" }),
            token({ noteId: "has", kind: "relation", subjectNoteId: "mark", objectNoteId: "jealousy", attributeId: "has" }),
            token({ noteId: "cause", kind: "relation", subjectNoteId: "loves", objectNoteId: "has", attributeId: "cause" })
        ];
        const links = [
            { attributeId: "loves", sourceNoteId: "john", targetNoteId: "mary" },
            { attributeId: "has", sourceNoteId: "mark", targetNoteId: "jealousy" },
            { attributeId: "cause", sourceNoteId: "loves", targetNoteId: "has" }
        ];

        const open = projectRelationMap(people, edges, links, "john");
        expect(open.circles.map((note) => note.noteId).sort()).toEqual([ "jealousy", "john", "mark", "mary" ]);
        expect(open.tokens.map((item) => item.noteId).sort()).toEqual([ "cause", "has", "loves" ]);

        const causeFolded = projectRelationMap(people, edges, links, "john", new Set([ "cause" ]));
        expect(causeFolded.circles.map((note) => note.noteId)).toEqual([ "cause" ]);
        expect(causeFolded.represent("john")).toBe("cause");
        expect(causeFolded.represent("jealousy")).toBe("cause");

        const lovesFolded = projectRelationMap(people, edges, links, "john", new Set([ "loves" ]));
        expect(lovesFolded.circles.map((note) => note.noteId).sort()).toEqual([ "jealousy", "loves", "mark" ]);
        expect(lovesFolded.circles.find((note) => note.noteId === "loves")).toMatchObject({ x: 100, y: 0 });
        expect(lovesFolded.represent("john")).toBe("loves");
        expect(lovesFolded.represent("mary")).toBe("loves");

        const bothFolded = projectRelationMap(people, edges, links, "john", new Set([ "loves", "has" ]));
        expect(bothFolded.circles.map((note) => note.noteId).sort()).toEqual([ "has", "loves" ]);
        expect(bothFolded.represent("cause")).toBe("cause");

        const allFolded = projectRelationMap(people, edges, links, "john", new Set([ "loves", "has", "cause" ]));
        expect(allFolded.circles.map((note) => note.noteId)).toEqual([ "cause" ]);
        expect(allFolded.circles[0]).toMatchObject({ x: 100, y: 100 });
        expect(allFolded.tokens).toEqual([]);
        expect(allFolded.represent("john")).toBe("cause");
        expect(allFolded.represent("mark")).toBe("cause");
    });

    it("drops the other relations of a folded fact's ends", () => {
        const people = [
            { noteId: "john", x: 0, y: 0 },
            { noteId: "mary", x: 200, y: 0 },
            { noteId: "mark", x: 400, y: 0 }
        ];
        const edges = [
            token({ noteId: "loves", kind: "relation", subjectNoteId: "john", objectNoteId: "mary", attributeId: "loves" })
        ];
        const links = [
            { attributeId: "loves", sourceNoteId: "john", targetNoteId: "mary" },
            { attributeId: "lovesMark", sourceNoteId: "mary", targetNoteId: "mark" }
        ];

        const folded = projectRelationMap(people, edges, links, "john", new Set([ "loves" ]));

        expect(folded.circles.map((note) => note.noteId)).toEqual([ "loves" ]);
        expect(relationSurvivesFold(
            links[1],
            folded.represent,
            new Set([ "loves" ]),
            new Set([ "loves" ])
        )).toBe(false);
    });
});
