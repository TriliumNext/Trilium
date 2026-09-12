/**
 * Where the suggestion list is placed and how wide it is drawn. Everything the placement reads is
 * measured from the layout, which a headless DOM has none of, so the field and the viewport are
 * given the measurements a browser would have taken.
 */
import { afterEach, describe, expect, it } from "vitest";

import { computeDropdownPosition, stepOver } from "./FormAutocomplete";

/** The room the placement keeps between the list and the edge of the screen. */
const MARGIN = 8;

function fieldAt({ left = 20, top = 100, width = 240, height = 30 } = {}) {
    const element = document.createElement("div");
    element.getBoundingClientRect = () => ({
        left, top, width, height, right: left + width, bottom: top + height,
        x: left, y: top, toJSON: () => ({})
    });
    return element;
}

function setViewport(width: number, height: number) {
    for (const [ name, value ] of [ [ "clientWidth", width ], [ "clientHeight", height ] ] as const) {
        Object.defineProperty(document.documentElement, name, { value, configurable: true });
    }
}

afterEach(() => {
    for (const name of [ "clientWidth", "clientHeight" ]) {
        Reflect.deleteProperty(document.documentElement, name);
    }
});

describe("stepping through a list with headings in it", () => {
    const items = [ "Nearby", "a", "b", "Far away", "c" ];
    const isHeading = (item: string) => item === "Nearby" || item === "Far away";

    it("steps over the headings, in either direction, wrapping at the ends", () => {
        // Opening the list lands on the first entry that can be taken, not on the heading over it.
        expect(stepOver(items, -1, 1, isHeading)).toBe(1);
        expect(stepOver(items, 1, 1, isHeading)).toBe(2);
        // Past the last of one group is the first of the next, the heading between them stepped over.
        expect(stepOver(items, 2, 1, isHeading)).toBe(4);
        // And round the end, back to the top.
        expect(stepOver(items, 4, 1, isHeading)).toBe(1);
        expect(stepOver(items, 1, -1, isHeading)).toBe(4);
    });

    it("highlights nothing in a list that is headings alone", () => {
        expect(stepOver([ "Nearby" ], -1, 1, isHeading)).toBe(-1);
    });
});

describe("computeDropdownPosition", () => {
    it("hangs the list under the field, at the field's own width", () => {
        setViewport(1200, 800);

        expect(computeDropdownPosition(fieldAt())).toMatchObject({
            left: "20px",
            top: "130px",
            width: "240px"
        });
    });

    it("draws the list wider where the caller asks for more than the field", () => {
        setViewport(1200, 800);

        expect(computeDropdownPosition(fieldAt({ width: 240 }), 440)).toMatchObject({ width: "440px" });
        // The field is the floor: a minimum under it asks for nothing.
        expect(computeDropdownPosition(fieldAt({ width: 240 }), 100)).toMatchObject({ width: "240px" });
    });

    it("keeps a wider list on the screen rather than running it off the far edge", () => {
        setViewport(600, 800);

        // Asked for more than there is room for, it takes the room there is.
        expect(computeDropdownPosition(fieldAt({ left: 20 }), 2000)).toMatchObject({
            left: `${MARGIN}px`,
            width: `${600 - 2 * MARGIN}px`
        });

        // Wide enough to fit, but not where the field stands, so it is pulled back to fit.
        expect(computeDropdownPosition(fieldAt({ left: 400 }), 440)).toMatchObject({
            left: `${600 - MARGIN - 440}px`,
            width: "440px"
        });
    });

    it("flips above the field only where the room below is too little to be useful", () => {
        setViewport(1200, 800);
        expect(computeDropdownPosition(fieldAt({ top: 100 }))).toMatchObject({ top: "130px" });

        // Near the foot of the screen, where what is under the field would show barely an entry.
        setViewport(1200, 200);
        expect(computeDropdownPosition(fieldAt({ top: 150 })).top).not.toBe("180px");
    });
});
