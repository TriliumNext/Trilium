import { afterEach, describe, expect, it, vi } from "vitest";

import { NoteMapNodeObject, NotesAndRelationsData } from "./data";
import {
    createFade,
    CssData,
    getArrowOutline,
    getFadedAlpha,
    getHoveredNeighbourhood,
    getLabelFontSize,
    getNodeColors,
    isIconDrawn,
    isLabelDrawn,
    planFraming,
    traceRoundedPath,
    truncateLabel
} from "./rendering";

describe("getHoveredNeighbourhood", () => {
    const node = (id: string) => ({ id, name: id, type: "text", color: null, icon: "bx bx-file" });
    const [ hovered, pointedAt, pointingAt, elsewhere ] = [ node("hovered"), node("pointedAt"), node("pointingAt"), node("elsewhere") ];
    const link = (source: NoteMapNodeObject | string, target: NoteMapNodeObject | string) => ({ id: `${source}-${target}`, source, target, name: "relates" });

    it("gathers what the hovered note is related to, whichever way each relation runs", () => {
        const own = [ link(hovered, pointedAt), link(pointingAt, hovered) ];
        const { neighbours, highlightLinks } = getHoveredNeighbourhood(hovered, [
            ...own,
            link(pointedAt, elsewhere),
            // A relation whose ends the graph has yet to look up, which it is drawn without.
            link("hovered", "elsewhere")
        ]);

        expect([ ...neighbours ]).toEqual([ pointedAt, pointingAt ]);
        expect([ ...highlightLinks ]).toEqual(own);
    });

    it("has nothing to gather for a note nothing is related to", () => {
        const { neighbours, highlightLinks } = getHoveredNeighbourhood(elsewhere, [ link(hovered, pointedAt) ]);

        expect(neighbours.size).toBe(0);
        expect(highlightLinks.size).toBe(0);
    });
});

describe("getFadedAlpha", () => {
    it("draws whole what a hover leaves alone, and steps back what it does not", () => {
        // Nothing hovered at all, and the notes a hover is about: both drawn whole.
        expect(getFadedAlpha(0)).toBe(1);
        expect(getFadedAlpha(1)).toBe(1);

        // The rest of the map, and the way there.
        expect(getFadedAlpha(-1)).toBeCloseTo(0.15);
        expect(getFadedAlpha(-0.5)).toBeCloseTo(0.575);
    });
});

describe("getNodeColors", () => {
    it("draws a note as the badge it wears elsewhere, unless it asks for a colour of its own", () => {
        expect(getNodeColors({ color: null }, cssData)).toEqual({ fill: "#eeeeee", icon: "#333333" });

        // Its own colour is the reader's doing and stands; the icon is then cut out of it in what the
        // map is laid on, there being no badge pairing to draw on.
        expect(getNodeColors({ color: "#ff0000" }, cssData)).toEqual({ fill: "#ff0000", icon: "#ffffff" });

        // A note is free to ask for a colour CSS knows by name rather than by number.
        expect(getNodeColors({ color: "rebeccapurple" }, cssData).fill).toBe("rebeccapurple");
    });
});

describe("getLabelFontSize", () => {
    const onScreen = (screenPx: number, zoomLevel: number) => getLabelFontSize(screenPx, zoomLevel) * zoomLevel;

    it("carries a label part of the way with the zoom, rather than all of it or none", () => {
        // The canvas is scaled by the zoom, so the size asked for is divided back out of it.
        expect(getLabelFontSize(11, 1)).toBe(11);
        expect(getLabelFontSize(11, 4)).toBeCloseTo(11 * 4 ** 0.25 / 4);

        // Across the whole range of zooms the map allows, 11px comes out between 8 and 18 — the
        // titles come closer as the map is zoomed into without taking it over.
        expect(onScreen(11, 0.1)).toBeGreaterThan(5);
        expect(onScreen(11, 1)).toBe(11);
        expect(onScreen(11, 7)).toBeCloseTo(17.9, 1);
    });
});

describe("isLabelDrawn", () => {
    it("asks more of a small note than a large one before its name is worth the clutter", () => {
        // Zoomed well in, every note is named.
        expect(isLabelDrawn(1, 3)).toBe(true);

        expect(isLabelDrawn(6, 1.5)).toBe(false);
        expect(isLabelDrawn(7, 1.5)).toBe(true);

        expect(isLabelDrawn(10, 0.5)).toBe(false);
        expect(isLabelDrawn(11, 0.5)).toBe(true);

        // Zoomed far enough out, nothing is named however large.
        expect(isLabelDrawn(100, 0.2)).toBe(false);
    });
});

describe("isIconDrawn", () => {
    it("waits until the dot is drawn large enough on screen to hold a glyph", () => {
        // The dot is drawn a little inside the size the graph holds the note at, and that is what has
        // to come out at 7px on screen.
        expect(isIconDrawn(8.75, 1)).toBe(true);
        expect(isIconDrawn(8.74, 1)).toBe(false);

        // What a note too small at one zoom is drawn with at another.
        expect(isIconDrawn(5, 1)).toBe(false);
        expect(isIconDrawn(5, 2)).toBe(true);
    });
});

describe("truncateLabel", () => {
    /** A font of even, 5-unit-wide characters, so that a width is a count of them. */
    const measureWidth = (text: string) => text.length * 5;

    it("cuts a title to the width allowed, the ellipsis included in what has to fit", () => {
        // 12 ems of a 10px font is 120 units, which is 24 of these characters.
        expect(truncateLabel("x".repeat(24), 10, measureWidth)).toBe("x".repeat(24));

        const cut = truncateLabel("x".repeat(40), 10, measureWidth);
        expect(cut).toBe(`${"x".repeat(23)}…`);
        expect(measureWidth(cut)).toBeLessThanOrEqual(120);

        // A font wide enough that nothing fits still leaves a character to hang the ellipsis on,
        // rather than cutting the title away to nothing.
        expect(truncateLabel("abc", 10, () => 1000)).toBe("a…");
    });
});

describe("getArrowOutline", () => {
    it("points the arrowhead along the relation and stops it at the dot it points at", () => {
        const outline = getArrowOutline({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, 10);
        expect(outline).not.toBeNull();
        const [ tip, leftFlank, notch, rightFlank ] = outline ?? [];

        // Stopped a note's radius short of the middle of the note it points at.
        expect(tip).toEqual([ 90, 0 ]);

        // The tail is as far across as the width the arrowhead is drawn at, evenly either side of the
        // line, and swept in towards the tip in the middle — an arrowhead rather than a triangle.
        expect(leftFlank[0]).toBeCloseTo(80);
        expect(rightFlank[0]).toBeCloseTo(80);
        expect(leftFlank[1]).toBeCloseTo(3.6);
        expect(rightFlank[1]).toBeCloseTo(-3.6);
        expect(notch[0]).toBeGreaterThan(leftFlank[0]);
        expect(notch[0]).toBeLessThan(tip[0]);
        expect(notch[1]).toBeCloseTo(0);
    });

    it("turns with the relation, and gives up where there is nowhere to be drawn but inside a note", () => {
        // The same relation the other way up: the tip is a radius short of the note at the bottom.
        const outline = getArrowOutline({ x: 0, y: 0 }, { x: 0, y: 100 }, 10, 10) ?? [];
        expect(outline[0][0]).toBeCloseTo(0);
        expect(outline[0][1]).toBeCloseTo(90);

        // Two notes all but on top of one another: an arrowhead there would be drawn inside one of
        // them, pointing back the way it came.
        expect(getArrowOutline({ x: 0, y: 0 }, { x: 19, y: 0 }, 10, 10)).toBeNull();
        expect(getArrowOutline({ x: 0, y: 0 }, { x: 21, y: 0 }, 10, 10)).not.toBeNull();
    });
});

describe("traceRoundedPath", () => {
    it("rounds every corner by drawing an arc between the middles of the edges meeting at it", () => {
        const ctx = { beginPath: vi.fn(), moveTo: vi.fn(), arcTo: vi.fn(), closePath: vi.fn() };
        const square: [ number, number ][] = [ [ 0, 0 ], [ 10, 0 ], [ 10, 10 ], [ 0, 10 ] ];

        traceRoundedPath(ctx as unknown as CanvasRenderingContext2D, square, 2);

        // Started at the middle of an edge rather than at a corner, which is what leaves every corner
        // to be rounded — the first one included.
        expect(ctx.moveTo).toHaveBeenCalledWith(0, 5);
        expect(ctx.arcTo).toHaveBeenCalledTimes(4);
        expect(ctx.arcTo).toHaveBeenNthCalledWith(1, 0, 0, 5, 0, 2);
        // The last corner is rounded towards the point the path started from.
        expect(ctx.arcTo).toHaveBeenNthCalledWith(4, 0, 10, 0, 5, 2);
        expect(ctx.closePath).toHaveBeenCalled();
    });
});

describe("createFade", () => {
    afterEach(() => vi.restoreAllMocks());

    /** The clock the fade is run against, which is the one the animation frames are drawn on. */
    const atTime = (ms: number) => vi.spyOn(performance, "now").mockReturnValue(ms);

    it("takes a value to where a change puts it over the fade, and clamps it there", () => {
        atTime(0);
        let hovered = false;
        const fade = createFade([ "hovered", "other" ], (element) => (hovered && element !== "hovered" ? -1 : 0));

        // Nothing has been changed yet, so there is nothing on its way anywhere.
        expect(fade.get("other")).toBe(0);

        // Where everything stands is taken down before the change is made, that being what the fade
        // about to start reads from.
        fade.restart();
        hovered = true;
        expect(fade.get("other")).toBe(0);

        // Half of the fade's 160ms.
        atTime(80);
        expect(fade.get("other")).toBeCloseTo(-0.5);
        // What the hover is about does not move at all.
        expect(fade.get("hovered")).toBe(0);

        atTime(10_000);
        expect(fade.get("other")).toBe(-1);
    });

    it("starts a fade from wherever the last one had got to", () => {
        atTime(0);
        let hovered = false;
        const fade = createFade([ "other" ], () => (hovered ? -1 : 0));
        fade.restart();
        hovered = true;

        // The pointer leaves the note halfway through the fade its arrival started.
        atTime(80);
        fade.restart();
        hovered = false;

        // Which is where the way back begins, rather than from the map as it stands with nothing
        // hovered — half of the way back from half faded is a quarter.
        atTime(160);
        expect(fade.get("other")).toBeCloseTo(-0.25);
    });
});

describe("planFraming", () => {
    const node = (id: string) => ({ id, name: id, type: "text", color: null, icon: "bx bx-file" });
    const notesAndRelations: NotesAndRelationsData = {
        nodes: [ node("root"), node("linked"), node("loose") ],
        links: [ { id: "l", source: node("root"), target: node("linked"), name: "relates" } ],
        noteIdToSizeMap: {}
    };
    // A note two relations out, which the walk of the map reaches and the relation above does not
    // mention — so which of the two the framing was measured on can be told apart.
    const hopDistances = new Map([ [ "root", 0 ], [ "linked", 1 ], [ "loose", 2 ] ]);

    it("frames the notes reached from the one the map is rooted at, where it is rooted at one", () => {
        const plan = planFraming({ widgetMode: "sidebar", noteType: "text", notesAndRelations, hopDistances });

        expect([ ...plan.framedNoteIds ]).toEqual([ "root", "linked", "loose" ]);
        expect(plan.framesSubset).toBe(true);
        expect(plan.fittedNoteCount).toBe(3);
        expect(plan.padding).toBe(20);
    });

    it("frames what the relations touch where there is no note to walk out from", () => {
        // A search note is not among its own results, and the maps that are not rooted at the note
        // being read have nowhere to walk out from either.
        for (const plan of [
            planFraming({ widgetMode: "sidebar", noteType: "search", notesAndRelations, hopDistances }),
            planFraming({ widgetMode: "type", noteType: "text", notesAndRelations, hopDistances })
        ]) {
            expect([ ...plan.framedNoteIds ]).toEqual([ "root", "linked" ]);
            expect(plan.fittedNoteCount).toBe(2);
        }

        // The maps with room of their own keep their own margins.
        expect(planFraming({ widgetMode: "type", noteType: "text", notesAndRelations, hopDistances }).padding).toBe(30);
    });

    it("falls back to the whole graph where there is no more than a note to frame", () => {
        // A note whose map is only itself has no extent to fit: fitting it alone asks for a zoom of
        // hundreds and fills the card with a single circle.
        const lone = planFraming({ widgetMode: "sidebar", noteType: "text", notesAndRelations, hopDistances: new Map([ [ "root", 0 ] ]) });
        expect(lone.framesSubset).toBe(false);
        expect(lone.fittedNoteCount).toBe(3);

        // The same where the graph has not yet looked the ends of its relations up, which leaves
        // nothing to be framed at all.
        const unresolved = planFraming({
            widgetMode: "type",
            noteType: "text",
            notesAndRelations: { ...notesAndRelations, links: [ { id: "l", source: "root", target: "linked", name: "relates" } ] },
            hopDistances
        });
        expect(unresolved.framedNoteIds.size).toBe(0);
        expect(unresolved.fittedNoteCount).toBe(3);
    });
});

const cssData: CssData = {
    fontFamily: "sans-serif",
    textColor: "#000000",
    mutedTextColor: "#888888",
    backgroundColor: "#ffffff",
    anchorColor: "#eeeeee",
    anchorIconColor: "#333333"
};
