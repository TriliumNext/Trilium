import { describe, expect, it } from "vitest";

import {
    extractClozeIndices,
    isClozeContent,
    parseClozeDeletions,
    renderClozeBack,
    renderClozeFront
} from "./cloze.js";

describe("cloze parsing", () => {
    it("extracts sorted unique indices", () => {
        expect(extractClozeIndices(
            "The capital {{c2::Paris}} sits on the {{c1::Seine}}; {{c1::Seine}} again and {{c10::far}}"
        )).toEqual([ 1, 2, 10 ]);
    });

    it("parses text and optional hints", () => {
        const deletions = parseClozeDeletions("A {{c1::plain}} and a {{c2::hinted::capital city}}");
        expect(deletions).toEqual([
            { index: 1, text: "plain" },
            { index: 2, text: "hinted", hint: "capital city" }
        ]);
    });

    it("detects cloze content without regex statefulness", () => {
        expect(isClozeContent("{{c1::x}}")).toBe(true);
        expect(isClozeContent("{{c1::x}}")).toBe(true);
        expect(isClozeContent("no markers")).toBe(false);
        expect(isClozeContent("{{not-a-cloze}}")).toBe(false);
    });

    it("ignores indices with leading zeros or non-digits", () => {
        expect(extractClozeIndices("{{c01::x}} {{c::y}}")).toEqual([]);
    });
});

describe("cloze rendering", () => {
    const content = "{{c1::Berlin}} is the capital of {{c2::Germany}}";

    it("hides only the target deletion on the front", () => {
        const front = renderClozeFront(content, 1);
        expect(front).toContain('class="flashcard-cloze"');
        expect(front).toContain("[...]");
        expect(front).toContain("Berlin");
        expect(front).not.toContain("Germany");
    });

    it("shows the target deletion highlighted on the back", () => {
        const back = renderClozeBack(content, 0);
        expect(back).toContain('class="flashcard-cloze-revealed">Berlin</span>');
        expect(back).toContain("Germany");
    });

    it("renders hints in place of the ellipsis", () => {
        expect(renderClozeFront("{{c3::Paris::city}}", 2)).toContain("[city]");
    });

    it("handles multiline deletion bodies", () => {
        expect(renderClozeFront("line {{c1::one\ntwo}} end", 0)).toContain("[...]");
        expect(renderClozeBack("line {{c1::one\ntwo}} end", 0)).toContain("one\ntwo");
    });
});
