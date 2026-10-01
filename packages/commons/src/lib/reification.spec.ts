import { describe, expect, it } from "vitest";

import { buildReificationTitle, formatReificationDefinition, isReificationStructuralName, nextSelfReificationTitle, parseReificationDefinition, predicateForTitle, REIFICATION_TITLE_MAX_LENGTH } from "./reification.js";

describe("predicateForTitle", () => {
    it("splits camelCase and underscores into words", () => {
        expect(predicateForTitle("supports")).toBe("supports");
        expect(predicateForTitle("isChildOf")).toBe("is child of");
        expect(predicateForTitle("URLRef")).toBe("url ref");
        expect(predicateForTitle("is_child_of")).toBe("is child of");
    });
});

describe("buildReificationTitle", () => {
    it("names a relation R(A, B), and a label the same way", () => {
        expect(buildReificationTitle({
            subjectTitle: "Note A",
            predicate: "supports",
            objectTitle: "Note B"
        })).toBe("supports(Note A, Note B)");

        expect(buildReificationTitle({
            subjectTitle: "Prince Charles",
            predicate: "isChildOf",
            objectTitle: "Queen Elizabeth II"
        })).toBe("isChildOf(Prince Charles, Queen Elizabeth II)");

        expect(buildReificationTitle({
            subjectTitle: "Climate paper",
            predicate: "confidence",
            objectTitle: "0.8"
        })).toBe("confidence(Climate paper, 0.8)");

        expect(buildReificationTitle({
            subjectTitle: "Climate paper",
            predicate: "reviewed",
            objectTitle: ""
        })).toBe("reviewed(Climate paper)");

        expect(buildReificationTitle({
            subjectTitle: "  Climate paper  ",
            predicate: "reviewed"
        })).toBe("reviewed(Climate paper)");
    });

    it("truncates a long sentence to the title limit", () => {
        const title = buildReificationTitle({
            subjectTitle: "S".repeat(80),
            predicate: "supports",
            objectTitle: "O".repeat(80)
        });

        expect(title.length).toBeLessThanOrEqual(REIFICATION_TITLE_MAX_LENGTH);
        expect(title.endsWith("…")).toBe(true);
    });

    it("falls back when the subject and the predicate are both blank", () => {
        expect(buildReificationTitle({ subjectTitle: "   ", predicate: "   " })).toBe("note");
    });
});

describe("nextSelfReificationTitle", () => {
    it("marks the first three levels with primes and numbers them from the fourth", () => {
        expect(nextSelfReificationTitle("B")).toBe("B'");
        expect(nextSelfReificationTitle("B'")).toBe("B''");
        expect(nextSelfReificationTitle("B''")).toBe("B'''");
        expect(nextSelfReificationTitle("B'''")).toBe("B(4)");
        expect(nextSelfReificationTitle("B(4)")).toBe("B(5)");
        expect(nextSelfReificationTitle("B(12)")).toBe("B(13)");
        expect(nextSelfReificationTitle("B(3)")).toBe("B(3)'");
        expect(nextSelfReificationTitle("   ")).toBe("note'");
    });
});

describe("parseReificationDefinition", () => {
    it("reads a formula as a name, its places, and the notes it creates", () => {
        const definition = parseReificationDefinition(
            "argument(A, B, C, D) = R1(A, B); R2(B, C); C'; R3(C', D); R1(A, B)'"
        );
        expect(definition).toEqual({
            name: "argument",
            params: [ "A", "B", "C", "D" ],
            terms: [
                { name: "R1", level: 0, args: [ { name: "A", level: 0 }, { name: "B", level: 0 } ] },
                { name: "R2", level: 0, args: [ { name: "B", level: 0 }, { name: "C", level: 0 } ] },
                { name: "C", level: 1 },
                {
                    name: "R3",
                    level: 0,
                    args: [ { name: "C", level: 1 }, { name: "D", level: 0 } ]
                },
                { name: "R1", level: 1, args: [ { name: "A", level: 0 }, { name: "B", level: 0 } ] }
            ]
        });
        expect(definition ? formatReificationDefinition(definition) : "").toBe(
            "argument(A, B, C, D) = R1(A, B); R2(B, C); C'; R3(C', D); R1(A, B)'"
        );
        const fromCommas = parseReificationDefinition("Hello(A, B) = R(A, B), B'");
        expect(fromCommas ? formatReificationDefinition(fromCommas) : "").toBe("Hello(A, B) = R(A, B); B'");

        const composed = parseReificationDefinition(
            "complex_argument(A, B, C, D, E) = argument(A, B, C, D); argument(E, B, C, D); R1(A, E)"
        );
        expect(composed?.name).toBe("complex_argument");
        expect(composed?.terms[0]).toEqual({
            name: "argument",
            level: 0,
            args: [
                { name: "A", level: 0 },
                { name: "B", level: 0 },
                { name: "C", level: 0 },
                { name: "D", level: 0 }
            ]
        });
        expect(parseReificationDefinition("C(4)")).toBeNull();
        expect(parseReificationDefinition("argument(A) = A''''")).toBeNull();
        expect(parseReificationDefinition("argument(A, A) = A")).toBeNull();
    });
});

describe("isReificationStructuralName", () => {
    it("recognizes the projection attributes and nothing else", () => {
        expect(isReificationStructuralName("reificationOf")).toBe(true);
        expect(isReificationStructuralName("reificationObject")).toBe(true);
        expect(isReificationStructuralName("reificationOfPredicate")).toBe(true);
        expect(isReificationStructuralName("selfReificationOf")).toBe(true);
        expect(isReificationStructuralName("supports")).toBe(false);
    });
});
