import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import hoistedNoteService from "../hoisted_note.js";
import optionService from "../options.js";
import SearchContext from "./search_context.js";

let getHoistedNoteId: ReturnType<typeof vi.spyOn>;
let getOptionBool: ReturnType<typeof vi.spyOn>;

describe("SearchContext", () => {
    beforeEach(() => {
        getHoistedNoteId = vi.spyOn(hoistedNoteService, "getHoistedNoteId").mockReturnValue("root");
        getOptionBool = vi.spyOn(optionService, "getOptionBool").mockReturnValue(true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("defaults every flag to false / empty when constructed without params", () => {
        const ctx = new SearchContext();

        expect(ctx.fastSearch).toBe(false);
        expect(ctx.includeArchivedNotes).toBe(false);
        expect(ctx.includeHiddenNotes).toBe(false);
        expect(ctx.ignoreHoistedNote).toBe(false);
        expect(ctx.ignoreInternalAttributes).toBe(false);
        expect(ctx.fuzzyAttributeSearch).toBe(false);
        expect(ctx.autocomplete).toBe(false);
        expect(ctx.highlightedTokens).toEqual([]);
        expect(ctx.originalQuery).toBe("");
        expect(ctx.fulltextQuery).toBe("");
        expect(ctx.dbLoadNeeded).toBe(false);
        expect(ctx.debugInfo).toBeNull();
        expect(ctx.error).toBeNull();
    });

    it("coerces truthy/falsy param values into strict booleans", () => {
        const ctx = new SearchContext({
            fastSearch: true,
            includeArchivedNotes: true,
            includeHiddenNotes: true,
            ignoreInternalAttributes: true,
            fuzzyAttributeSearch: true,
            autocomplete: true
        });

        expect(ctx.fastSearch).toBe(true);
        expect(ctx.includeArchivedNotes).toBe(true);
        expect(ctx.includeHiddenNotes).toBe(true);
        expect(ctx.ignoreInternalAttributes).toBe(true);
        expect(ctx.fuzzyAttributeSearch).toBe(true);
        expect(ctx.autocomplete).toBe(true);
    });

    it("passes through the plain ordering / paging / depth params verbatim", () => {
        const ctx = new SearchContext({
            ancestorDepth: "eq3",
            orderBy: "title",
            orderDirection: "desc",
            limit: 25,
            debug: true
        });

        expect(ctx.ancestorDepth).toBe("eq3");
        expect(ctx.orderBy).toBe("title");
        expect(ctx.orderDirection).toBe("desc");
        expect(ctx.limit).toBe(25);
        expect(ctx.debug).toBe(true);
    });

    it("falls back to the hoisted note id when no ancestor is supplied", () => {
        getHoistedNoteId.mockReturnValue("hoisted123");

        const ctx = new SearchContext();

        expect(getHoistedNoteId).toHaveBeenCalledTimes(1);
        expect(ctx.ancestorNoteId).toBe("hoisted123");
    });

    it("keeps an explicitly supplied ancestorNoteId and never consults the hoisted note", () => {
        const ctx = new SearchContext({ ancestorNoteId: "myAncestor" });

        expect(ctx.ancestorNoteId).toBe("myAncestor");
        expect(getHoistedNoteId).not.toHaveBeenCalled();
    });

    it("does not apply the hoisted note when ignoreHoistedNote is set", () => {
        getHoistedNoteId.mockReturnValue("hoisted123");

        const ctx = new SearchContext({ ignoreHoistedNote: true });

        expect(ctx.ignoreHoistedNote).toBe(true);
        expect(ctx.ancestorNoteId).toBeUndefined();
        expect(getHoistedNoteId).not.toHaveBeenCalled();
    });

    it("reads the searchEnableFuzzyMatching option for enableFuzzyMatching", () => {
        getOptionBool.mockReturnValue(false);

        const ctx = new SearchContext();

        expect(getOptionBool).toHaveBeenCalledWith("searchEnableFuzzyMatching");
        expect(ctx.enableFuzzyMatching).toBe(false);
    });

    it("defaults enableFuzzyMatching to true when the option is not yet initialized (throws)", () => {
        getOptionBool.mockImplementation(() => {
            throw new Error("option store not initialized");
        });

        const ctx = new SearchContext();

        expect(ctx.enableFuzzyMatching).toBe(true);
    });

    describe("recordContentMatch", () => {
        it("starts with an empty contentMatches map", () => {
            const ctx = new SearchContext();

            expect(ctx.contentMatches.size).toBe(0);
        });

        it("stores a quality for a note and upgrades it only when a better one arrives", () => {
            const ctx = new SearchContext();

            ctx.recordContentMatch("note1", { tier: "substring", matchedTokenCount: 1, inOrder: false });
            expect(ctx.contentMatches.get("note1")?.tier).toBe("substring");

            // Higher tier wins.
            ctx.recordContentMatch("note1", { tier: "exact_phrase", matchedTokenCount: 2, inOrder: false });
            expect(ctx.contentMatches.get("note1")?.tier).toBe("exact_phrase");

            // Weaker tier does not downgrade the stored quality.
            ctx.recordContentMatch("note1", { tier: "word_prefix", matchedTokenCount: 5, inOrder: false });
            expect(ctx.contentMatches.get("note1")?.tier).toBe("exact_phrase");
            expect(ctx.contentMatches.get("note1")?.matchedTokenCount).toBe(2);
        });

        it("breaks a tier tie by keeping the higher matchedTokenCount", () => {
            const ctx = new SearchContext();

            ctx.recordContentMatch("note1", { tier: "exact_word", matchedTokenCount: 1, inOrder: false });
            ctx.recordContentMatch("note1", { tier: "exact_word", matchedTokenCount: 3, inOrder: false });

            expect(ctx.contentMatches.get("note1")?.matchedTokenCount).toBe(3);
        });
    });

    describe("addError / hasError / getError", () => {
        it("records the first error and ignores subsequent ones", () => {
            const ctx = new SearchContext();

            expect(ctx.hasError()).toBe(false);
            expect(ctx.getError()).toBeNull();

            ctx.addError("first problem");
            ctx.addError("second problem");

            expect(ctx.hasError()).toBe(true);
            expect(ctx.getError()).toBe("first problem");
            expect(ctx.error).toBe("first problem");
        });
    });
});
