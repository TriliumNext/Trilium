import { afterEach, describe, expect, it } from "vitest";

import { findTermRanges, getMatchText } from "./highlight_matches";

const JOINED = { joinTextNodes: true };
const JOINED_WITHOUT_MATH = { joinTextNodes: true, exclude: [ ".math-tex" ] };

afterEach(() => {
    document.body.replaceChildren();
});

describe("findTermRanges with joinTextNodes", () => {
    it("finds a match across inline formatting as one range over both text nodes", () => {
        const root = createRoot("Micro<strong>scope</strong> lens");
        const [ micro, scope ] = getTexts(root);

        const ranges = findTermRanges(root, [ "microscope" ], JOINED);

        expect(ranges).toHaveLength(1);
        expect(ranges[0].toString()).toBe("Microscope");
        expect(ranges[0].startContainer).toBe(micro);
        expect(ranges[0].startOffset).toBe(0);
        expect(ranges[0].endContainer).toBe(scope);
        expect(ranges[0].endOffset).toBe(5);
    });

    it("keeps each range inside one text node without the option", () => {
        const root = createRoot("Micro<strong>scope</strong> lens");

        expect(findTermRanges(root, [ "microscope" ])).toEqual([]);

        const ranges = findTermRanges(root, [ "scope" ]);
        expect(ranges).toHaveLength(1);
        expect(ranges[0].startContainer).toBe(ranges[0].endContainer);
        expect(ranges[0].toString()).toBe("scope");
    });

    it("reads a line break and a block boundary as a word break", () => {
        for (const html of [ "North<br>Sta<b>r</b>", "<p>North</p><p>Sta<b>r</b></p>" ]) {
            const root = createRoot(html);

            expect(findTermRanges(root, [ "northstar" ], JOINED)).toEqual([]);
            const ranges = findTermRanges(root, [ "north", "star" ], JOINED);
            expect(ranges.map((range) => range.toString())).toEqual([ "North", "Star" ]);
        }
    });

    it("reads an excluded element as a word break and finds nothing inside it", () => {
        const root = createRoot("Micro<span class=\"math-tex\">\\(x\\)</span>sco<b>pe</b> units");

        expect(findTermRanges(root, [ "microscope" ], JOINED_WITHOUT_MATH)).toEqual([]);
        expect(findTermRanges(root, [ "x" ], JOINED_WITHOUT_MATH)).toEqual([]);
        expect(findTermRanges(root, [ "scope" ], JOINED_WITHOUT_MATH)
            .map((range) => range.toString())).toEqual([ "scope" ]);
    });

    it("keeps case and accent folding", () => {
        const root = createRoot("Mod<em>èle</em> ktor<b>ý</b>");

        expect(findTermRanges(root, [ "modele", "KTORY" ], JOINED).map((range) => range.toString()))
            .toEqual([ "Modèle", "ktorý" ]);
    });

    it("stops at the limit", () => {
        const root = createRoot("a<b>b</b> a<b>b</b> a<b>b</b>");

        expect(findTermRanges(root, [ "ab" ], { ...JOINED, limit: 2 })).toHaveLength(2);
    });
});

describe("getMatchText", () => {
    const html = "<p>Micro<strong>scope</strong></p><p>North<br>Star</p>"
        + "<span class=\"math-tex\">\\(x\\)</span>end";

    it("joins inline text and breaks words at blocks, line breaks and excluded elements", () => {
        expect(getMatchText(createRoot(html), { exclude: [ ".math-tex" ] }))
            .toBe("Microscope North Star end");
    });

    it("reads the same text from an inert copy as from the live element", () => {
        const template = document.createElement("template");
        template.innerHTML = html;
        const live = createRoot(html);
        // The live element has math rendered in place of its source.
        const math = live.querySelector(".math-tex");
        if (math) math.innerHTML = "<span class=\"katex\">x rendered</span>";

        const inertText = getMatchText(template.content, { exclude: [ ".math-tex" ] });
        expect(getMatchText(live, { exclude: [ ".math-tex" ] })).toBe(inertText);
        expect(findTermRanges(live, [ "microscope" ], JOINED_WITHOUT_MATH)).toHaveLength(1);
    });
});

function createRoot(html: string) {
    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.appendChild(root);
    return root;
}

function getTexts(root: HTMLElement) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    while (walker.nextNode()) {
        texts.push(walker.currentNode as Text);
    }
    return texts;
}
