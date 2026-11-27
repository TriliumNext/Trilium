import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubTextLayout } from "../test/text_layout";
import { estimateTextLines, measureTextLines } from "./text_lines";

describe("measureTextLines", () => {
    let element: HTMLElement;
    let restore: () => void = () => {};

    beforeEach(() => {
        element = document.createElement("div");
        document.body.append(element);
    });

    afterEach(() => {
        restore();
        restore = () => {};
        element.remove();
    });

    it("reads one line for each line of text, or one for each text node on it", () => {
        // "alpha beta" wraps before the bold "beta gamma", which wraps before "gamma".
        element.innerHTML = "alpha <b>beta gamma</b>";
        const bold = element.querySelector("b");
        restore = stubTextLayout(element, [ 6, 11 ]);

        expect(measureTextLines(element)?.map(({ text, x, centerY, source }) => [ text, x, centerY, source ])).toEqual([
            [ "alpha", 0, 8, element ], [ "beta", 0, 28, element ], [ "gamma", 0, 48, element ]
        ]);
        expect(measureTextLines(element, true)?.map(({ text, x, centerY, source }) => [ text, x, centerY, source ])).toEqual([
            [ "alpha", 0, 8, element ], [ "beta", 0, 28, bold ], [ "gamma", 0, 48, bold ]
        ]);
    });

    it("splits a line where its text node changes, and takes one line in one call otherwise", () => {
        element.innerHTML = "one <i>two</i>";
        restore = stubTextLayout(element);
        const charRects = vi.spyOn(Range.prototype, "getBoundingClientRect");

        expect(measureTextLines(element)?.map(({ text, x }) => [ text, x ])).toEqual([ [ "one two", 0 ] ]);
        expect(charRects).not.toHaveBeenCalled();
        expect(measureTextLines(element, true)?.map(({ text, x, source }) => [ text, x, source.tagName ]))
            .toEqual([ [ "one", 0, "DIV" ], [ "two", 32, "I" ] ]);
    });

    it("returns nothing for an element that is not laid out, whose lines are then estimated", () => {
        element.textContent = "first\nsecond";
        expect(measureTextLines(element)).toBeNull();
        const style = { fontSize: "10px", lineHeight: "20px", paddingLeft: "4px", paddingTop: "2px" } as CSSStyleDeclaration;
        expect(estimateTextLines(element, style)).toEqual([
            { text: "first", x: 4, centerY: 12, source: element }, { text: "second", x: 4, centerY: 32, source: element }
        ]);
    });
});
