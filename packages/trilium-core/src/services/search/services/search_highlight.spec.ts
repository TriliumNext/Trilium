import { beforeEach, describe, expect, it } from "vitest";

import becca from "../../../becca/becca.js";
import BBranch from "../../../becca/entities/bbranch.js";
import BNote from "../../../becca/entities/bnote.js";
import { note, NoteBuilder } from "../../../test/becca_mocking.js";
import { normalizePreservingLength } from "../../utils/index.js";
import SearchResult from "../search_result.js";
import searchService from "./search.js";

let rootNote: NoteBuilder;

// "cafe" + combining acute accent (U+0301) — an NFD-decomposed "café".
const DECOMPOSED_CAFE = "café";

function makeResult(title: string, snippet: string): SearchResult {
    const child = note(title);
    rootNote.child(child);
    const result = new SearchResult(["root", child.note.noteId]);
    result.contentSnippet = snippet;
    return result;
}

describe("normalizePreservingLength", () => {
    it("keeps ligatures that a naive stripper would expand (length preserved)", () => {
        for (const s of ["straße", "æther", "ǆungla", "ﬁle"]) {
            expect(normalizePreservingLength(s)).toHaveLength(s.length);
        }
    });

    it("strips diacritics from precomposed characters 1:1", () => {
        expect(normalizePreservingLength("café")).toBe("cafe");
        expect(normalizePreservingLength("Ñandú")).toBe("nandu");
        // İ lowercases to "i̇" (2 code units) under a naive lowercase; the NFD-strip
        // removes the dot first so it stays a single "i" and length is preserved.
        expect(normalizePreservingLength("İ")).toBe("i");
    });

    it("preserves length for NFD-decomposed content (keeps bare combining marks)", () => {
        expect(normalizePreservingLength(DECOMPOSED_CAFE)).toHaveLength(DECOMPOSED_CAFE.length);
    });

    it("preserves length for astral (surrogate-pair) characters", () => {
        const withEmoji = "a\u{1F600}b";
        expect(normalizePreservingLength(withEmoji)).toHaveLength(withEmoji.length);
    });
});

describe("highlightSearchResults", () => {
    beforeEach(() => {
        becca.reset();
        rootNote = new NoteBuilder(new BNote({ noteId: "root", title: "root", type: "text" }));
        new BBranch({ branchId: "none_root", noteId: "root", parentNoteId: "none", notePosition: 10 });
    });

    it("wraps a plain token in <b> markers", () => {
        const result = makeResult("Note", "hello match world");
        searchService.highlightSearchResults([result], ["match"]);
        expect(result.highlightedContentSnippet).toBe("hello <b>match</b> world");
    });

    it("aligns markers correctly past a ligature that would shift a length-changing normalizer", () => {
        const result = makeResult("Note", "straße match");
        searchService.highlightSearchResults([result], ["match"]);
        expect(result.highlightedContentSnippet).toBe("straße <b>match</b>");
    });

    it("aligns markers correctly past NFD-decomposed content (no index drift, no mid-marker split)", () => {
        const result = makeResult("Note", `${DECOMPOSED_CAFE} match`);
        searchService.highlightSearchResults([result], ["match"]);
        expect(result.highlightedContentSnippet).toBe(`${DECOMPOSED_CAFE} <b>match</b>`);
    });

    it("highlights matches of a regex token via HighlightedTokenInfo", () => {
        const result = makeResult("Note", "coool result");
        searchService.highlightSearchResults([result], [{ token: "co+l", type: "regex" }]);
        expect(result.highlightedContentSnippet).toBe("<b>coool</b> result");
    });

    it("skips invalid regex patterns instead of throwing", () => {
        const result = makeResult("Note", "plain text");
        expect(() =>
            searchService.highlightSearchResults([result], [{ token: "(unclosed", type: "regex" }])
        ).not.toThrow();
        expect(result.highlightedContentSnippet).toBe("plain text");
    });
});
