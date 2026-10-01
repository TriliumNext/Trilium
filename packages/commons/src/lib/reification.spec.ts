import { describe, expect, it } from "vitest";

import { buildReificationTitle, isReificationStructuralName, predicateForTitle, REIFICATION_TITLE_MAX_LENGTH } from "./reification.js";

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

describe("isReificationStructuralName", () => {
    it("recognizes the projection attributes and nothing else", () => {
        expect(isReificationStructuralName("reificationOf")).toBe(true);
        expect(isReificationStructuralName("reificationObject")).toBe(true);
        expect(isReificationStructuralName("reificationOfPredicate")).toBe(true);
        expect(isReificationStructuralName("supports")).toBe(false);
    });
});
