import { describe, expect, it } from "vitest";
import { resolveAnnotation } from "./pdfAnnotationResolver";

/** Minimal PdfAnnotationInfo factory. */
function ann(id: string, page: number, highlight = "", contents = ""): PdfAnnotationInfo {
    return {
        id,
        type: "highlight",
        contents,
        highlightedText: highlight,
        author: "",
        pageNumber: page,
        color: null,
        creationDate: null,
        modificationDate: null
    };
}

const ANNOTATIONS: PdfAnnotationInfo[] = [
    ann("12R", 3, "The quick brown fox", ""),
    ann("14R", 3, "",                   "My sticky note"),
    ann("16R", 7, "another highlight",  "with a comment"),
];

describe("resolveAnnotation", () => {
    it("returns undefined when viewScope is absent", () => {
        expect(resolveAnnotation(ANNOTATIONS, undefined)).toBeUndefined();
    });

    it("returns undefined when annotationId is absent in viewScope", () => {
        expect(resolveAnnotation(ANNOTATIONS, { viewMode: "default" })).toBeUndefined();
    });

    // ── Exact ID match ──────────────────────────────────────────────────────────

    it("finds an annotation by exact ID", () => {
        const result = resolveAnnotation(ANNOTATIONS, { annotationId: "14R" });
        expect(result?.id).toBe("14R");
    });

    it("returns undefined when exact ID is not in the list", () => {
        expect(resolveAnnotation(ANNOTATIONS, { annotationId: "99R" })).toBeUndefined();
    });

    // ── Fallback: page + content preview ────────────────────────────────────────

    it("falls back to page+highlight when ID is missing and preview matches", () => {
        const result = resolveAnnotation(ANNOTATIONS, {
            annotationId: "staleId",
            annotationPage: 3,
            annotationPreview: "The quick brown"  // prefix of highlight
        });
        expect(result?.id).toBe("12R");
    });

    it("falls back to page+contents when highlightedText does not match", () => {
        const result = resolveAnnotation(ANNOTATIONS, {
            annotationId: "staleId",
            annotationPage: 3,
            annotationPreview: "My sticky"
        });
        expect(result?.id).toBe("14R");
    });

    it("strips the ellipsis (…) suffix from annotationPreview before matching", () => {
        const result = resolveAnnotation(ANNOTATIONS, {
            annotationId: "staleId",
            annotationPage: 7,
            annotationPreview: "another highl…"  // truncated with ellipsis
        });
        expect(result?.id).toBe("16R");
    });

    it("returns undefined when page matches but content does not", () => {
        const result = resolveAnnotation(ANNOTATIONS, {
            annotationId: "staleId",
            annotationPage: 3,
            annotationPreview: "no match here"
        });
        expect(result).toBeUndefined();
    });

    it("returns undefined when page does not match even if content does", () => {
        const result = resolveAnnotation(ANNOTATIONS, {
            annotationId: "staleId",
            annotationPage: 99,          // wrong page
            annotationPreview: "The quick brown fox"
        });
        expect(result).toBeUndefined();
    });

    it("requires both page and preview for the fallback — omitting page returns undefined", () => {
        const result = resolveAnnotation(ANNOTATIONS, {
            annotationId: "staleId",
            // no annotationPage
            annotationPreview: "The quick brown"
        });
        expect(result).toBeUndefined();
    });

    it("requires both page and preview for the fallback — omitting preview returns undefined", () => {
        const result = resolveAnnotation(ANNOTATIONS, {
            annotationId: "staleId",
            annotationPage: 3
            // no annotationPreview
        });
        expect(result).toBeUndefined();
    });

    // ── Exact match takes priority ───────────────────────────────────────────────

    it("prefers exact ID match over the page+content fallback", () => {
        // "12R" is on page 3 with "The quick brown fox"; the stale-id search
        // could also match it via content. Ensure the exact match wins when ID is right.
        const result = resolveAnnotation(ANNOTATIONS, {
            annotationId: "16R",
            annotationPage: 3,
            annotationPreview: "The quick brown"   // would match 12R via fallback
        });
        expect(result?.id).toBe("16R");            // exact wins
    });
});
