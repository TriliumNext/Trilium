import { describe, expect, it } from "vitest";

import {
    allowedSearchOperators, CONTENT_SEARCH_OPERATORS, NO_SEARCH_OPERATORS, SEARCH_NOTE_PATH,
    SEARCH_NOTE_PATH_SEGMENTS, SEARCH_OPERATORS, TEXT_SEARCH_OPERATORS
} from "./search_syntax.js";

describe("SEARCH_NOTE_PATH_SEGMENTS", () => {
    it("holds every segment of the path, and names each one once", () => {
        const { properties, contentProperties, traversals, attributeSegments } = SEARCH_NOTE_PATH;

        expect(SEARCH_NOTE_PATH_SEGMENTS).toEqual([
            ...properties, ...contentProperties, ...traversals, ...attributeSegments
        ]);
        expect(new Set(SEARCH_NOTE_PATH_SEGMENTS).size).toBe(SEARCH_NOTE_PATH_SEGMENTS.length);
    });
});

describe("allowedSearchOperators", () => {
    it("restricts nothing for a label, a property or a traversal", () => {
        expect(allowedSearchOperators("#book")).toBeUndefined();
        expect(allowedSearchOperators("note.title")).toBeUndefined();
        expect(allowedSearchOperators("note.parents.title")).toBeUndefined();
    });

    it("restricts nothing after `labels.`, where the name is the user's own", () => {
        // `note.labels.text` names a label called `text`, not the note's own text.
        expect(allowedSearchOperators("note.labels.text")).toBeUndefined();
        expect(allowedSearchOperators("note.labels.content")).toBeUndefined();
    });

    it("allows no operator on a relation, which only a further property continues", () => {
        expect(allowedSearchOperators("~author")).toBe(NO_SEARCH_OPERATORS);
        expect(allowedSearchOperators("note.relations.author")).toBe(NO_SEARCH_OPERATORS);
        // Walking into the note the relation names lands on an ordinary property again.
        expect(allowedSearchOperators("~author.title")).toBeUndefined();
    });

    it("matches text with `*=*` alone", () => {
        expect(allowedSearchOperators("note.text")).toBe(TEXT_SEARCH_OPERATORS);
        expect([ ...TEXT_SEARCH_OPERATORS ]).toEqual([ "*=*" ]);
    });

    it("matches content with every operator but the ordering ones", () => {
        expect(allowedSearchOperators("note.content")).toBe(CONTENT_SEARCH_OPERATORS);
        expect(allowedSearchOperators("note.rawContent")).toBe(CONTENT_SEARCH_OPERATORS);
        expect(CONTENT_SEARCH_OPERATORS).toEqual(
            new Set(SEARCH_OPERATORS.filter((operator) => ![ ">", ">=", "<", "<=" ].includes(operator)))
        );
    });

    it("reads a property whatever it is spelled in, as the parser does", () => {
        expect(allowedSearchOperators("note.TEXT")).toBe(TEXT_SEARCH_OPERATORS);
        expect(allowedSearchOperators("NOTE.RawContent")).toBe(CONTENT_SEARCH_OPERATORS);
        expect(allowedSearchOperators("note.LABELS.text")).toBeUndefined();
    });
});
