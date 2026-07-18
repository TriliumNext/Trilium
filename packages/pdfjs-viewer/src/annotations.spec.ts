import { describe, expect, it } from "vitest";
import { processAnnotation, AnnotationType, rgbToHex } from "./annotations";

const SAMPLE_HIGHLIGHT = {
    annotationType: 9,
    annotationFlags: 4,
    borderStyle: { width: 0, rawWidth: 1, style: 1, dashArray: [3], horizontalCornerRadius: 0, verticalCornerRadius: 0 },
    color: { "0": 128, "1": 235, "2": 255 },
    backgroundColor: null,
    borderColor: null,
    rotation: 0,
    contentsObj: { str: "Comment goes here.", dir: "ltr" },
    hasAppearance: true,
    id: "18R",
    modificationDate: null,
    rect: [352.43, 276.30, 489.91, 314.61],
    subtype: "Highlight",
    hasOwnCanvas: false,
    noRotate: false,
    noHTML: false,
    isEditable: true,
    structParent: -1,
    titleObj: { str: "", dir: "ltr" },
    creationDate: "D:20260425093822",
    popupRef: "24R",
    opacity: 1,
    quadPoints: { "0": 353.35, "1": 313.98, "2": 489.05, "3": 313.98, "4": 353.35, "5": 276.95, "6": 489.05, "7": 276.95 },
    overlaidText: "First slide"
};

describe("processAnnotation", () => {
    it("extracts all fields from a highlight annotation", () => {
        const result = processAnnotation(SAMPLE_HIGHLIGHT, 3)!;
        expect(result).not.toBeNull();
        expect(result.id).toBe("18R");
        expect(result.type).toBe("highlight");
        expect(result.contents).toBe("Comment goes here.");
        expect(result.highlightedText).toBe("First slide");
        expect(result.author).toBe("");
        expect(result.pageNumber).toBe(3);
        expect(result.color).toBe("#80ebff");
        expect(result.creationDate).toBe("D:20260425093822");
        expect(result.modificationDate).toBeNull();
    });

    it("extracts author from titleObj.str", () => {
        const withAuthor = { ...SAMPLE_HIGHLIGHT, titleObj: { str: "John Doe", dir: "ltr" } };
        expect(processAnnotation(withAuthor, 1)!.author).toBe("John Doe");
    });

    it("skips non-comment types and empty annotations", () => {
        const link = { ...SAMPLE_HIGHLIGHT, annotationType: 2 }; // LINK
        expect(processAnnotation(link, 1)).toBeNull();

        const empty = { ...SAMPLE_HIGHLIGHT, contentsObj: { str: "", dir: "ltr" }, overlaidText: "" };
        expect(processAnnotation(empty, 1)).toBeNull();
    });

    it("keeps annotations with only one of contents or highlightedText", () => {
        const highlightOnly = { ...SAMPLE_HIGHLIGHT, contentsObj: { str: "", dir: "ltr" } };
        expect(processAnnotation(highlightOnly, 1)).not.toBeNull();
        expect(processAnnotation(highlightOnly, 1)!.highlightedText).toBe("First slide");

        const commentOnly = { ...SAMPLE_HIGHLIGHT, annotationType: AnnotationType.TEXT, overlaidText: undefined };
        expect(processAnnotation(commentOnly, 1)).not.toBeNull();
        expect(processAnnotation(commentOnly, 1)!.contents).toBe("Comment goes here.");
    });

    it("handles null color", () => {
        expect(processAnnotation({ ...SAMPLE_HIGHLIGHT, color: null }, 1)!.color).toBeNull();
    });
});

describe("rgbToHex", () => {
    it("converts various color formats to hex", () => {
        expect(rgbToHex({ 0: 128, 1: 235, 2: 255 })).toBe("#80ebff");
        expect(rgbToHex([255, 0, 0])).toBe("#ff0000");
        expect(rgbToHex([0, 0, 0])).toBe("#000000");
        expect(rgbToHex([255, 255, 255])).toBe("#ffffff");
    });
});
