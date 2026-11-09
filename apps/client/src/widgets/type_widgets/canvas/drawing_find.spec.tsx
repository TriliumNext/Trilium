import type {
    ExcalidrawElement, ExcalidrawTextElement
} from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { scrollRectIntoView } from "../../../services/highlight_matches";
import {
    attachExcalidraw, DrawingFindTarget, type DrawingMatch, DrawingMatches, getSceneTransform,
    MATCH_COLORS
} from "./drawing_find";
import type { DrawingView } from "./drawing_view";

vi.mock("@excalidraw/excalidraw", () => ({
    CaptureUpdateAction: { NEVER: "never", EVENTUALLY: "eventually" },
    // One line, 10 pixels for each character, from the index of the match.
    getMatchedLines: (_element: unknown, query: string, index: number) => [
        { offsetX: index * 10, offsetY: 0, width: query.length * 10, height: 20 }
    ],
    getSceneVersion: (elements: readonly { version: number }[]) =>
        elements.reduce((sum, { version }) => sum + version, 0),
    useI18n: vi.fn()
}));
// happy-dom lays nothing out, so nothing scrolls; the spec reads what would be scrolled to.
vi.mock("../../../services/highlight_matches", () => ({ scrollRectIntoView: vi.fn() }));

const ANY_CASE = { matchCase: false, wholeWord: false };
const VIEW: DrawingView = { zoom: { value: 1 }, scrollX: 0, scrollY: 0 } as DrawingView;
/** A view at zoom 2, where a match at y = 300 is 600 pixels down the 200 pixels of the box. */
const ZOOMED_VIEW: DrawingView = { zoom: { value: 2 }, scrollX: 0, scrollY: 0 } as DrawingView;

let root: HTMLElement;

beforeEach(() => {
    root = document.createElement("div");
    document.body.append(root);
    vi.spyOn(root, "getBoundingClientRect")
        .mockReturnValue({ left: 100, top: 50, width: 400, height: 200 } as DOMRect);
    vi.mocked(scrollRectIntoView).mockClear();
});

afterEach(() => {
    root.remove();
});

describe("DrawingFindTarget", () => {
    it("finds the term in the text, from top to bottom, and replaces none", async () => {
        const surface = createSurface([
            createText("lower", 50, 120, "beta alpha"),
            createText("upper", 50, 40, "Alpha and alpha"),
            createText("deleted", 50, 0, "alpha", { isDeleted: true }),
            { id: "shape", type: "rectangle", version: 1 } as unknown as ExcalidrawElement
        ]);
        const target = createTarget(surface);

        expect(await target.find("alpha", ANY_CASE)).toBe(3);
        expect(surface.matches.map(({ element, lines }) => [ element.id, lines[0]?.offsetX ]))
            .toEqual([ [ "upper", 0 ], [ "upper", 100 ], [ "lower", 50 ] ]);
        expect(surface.current).toBeNull();
        expect(target.canReplace()).toBe(false);
        expect(await target.replaceAll()).toBe(3);

        expect(await target.find("alpha", { matchCase: true, wholeWord: false })).toBe(2);
        expect(await target.find("alph", { matchCase: false, wholeWord: true })).toBe(0);
        // The term matches as text, not as an expression, which would match "and".
        expect(await target.find("a.d", ANY_CASE)).toBe(0);
        await target.find("alpha", ANY_CASE);
        expect(await target.find("", ANY_CASE)).toBe(0);
        expect(surface.matches).toEqual([]);
    });

    it("keeps the view for a match in view, and scrolls the note to the match", async () => {
        const surface = createSurface([ createText("text", 50, 40, "alpha") ]);
        const target = createTarget(surface);
        await target.find("alpha", ANY_CASE);

        target.highlight(0);
        expect(surface.current).toBe(0);
        expect(surface.setView).not.toHaveBeenCalled();
        const [ element, getRect ] = vi.mocked(scrollRectIntoView).mock.lastCall ?? [];
        expect(element).toBe(root);
        // The match, 50 pixels wide at (50, 40) of the drawing, which is at (100, 50).
        expect(getRect?.()).toEqual({ left: 150, top: 90, width: 50, height: 20 });
    });

    it("moves the drawing to a match out of view, and back once the search moves on", async () => {
        const surface = createSurface([
            createText("near", 50, 10, "alpha"), createText("far", 50, 300, "alpha")
        ], ZOOMED_VIEW);
        const target = createTarget(surface);
        await target.find("alpha", ANY_CASE);

        // Centered vertically: (300 - 260) × 2 = 80 is the middle of 200, less half of 40.
        target.highlight(1);
        expect(surface.view).toEqual({ zoom: { value: 2 }, scrollX: 0, scrollY: -260 });
        expect(vi.mocked(scrollRectIntoView).mock.lastCall?.[1]())
            .toEqual({ left: 200, top: 130, width: 100, height: 40 });

        // Moving between matches of the drawing keeps the view from before the search.
        target.highlight(0);
        expect(surface.view).toEqual({ zoom: { value: 2 }, scrollX: 0, scrollY: 30 });
        target.highlight(null);
        expect(surface.view).toEqual(ZOOMED_VIEW);
        expect(surface.current).toBeNull();
    });

    it("returns to the view that the user moved the drawing to during the search", async () => {
        const surface = createSurface([
            createText("near", 50, 10, "alpha"), createText("far", 50, 300, "alpha")
        ], ZOOMED_VIEW);
        const target = createTarget(surface);
        await target.find("alpha", ANY_CASE);
        const userView = { zoom: { value: 2 }, scrollX: 5, scrollY: -100 } as DrawingView;

        target.highlight(1);
        surface.view = userView;
        target.highlight(null);
        expect(surface.view).toBe(userView);

        target.highlight(1);
        expect(surface.view).toEqual({ zoom: { value: 2 }, scrollX: 5, scrollY: -260 });
        target.highlight(null);
        expect(surface.view).toBe(userView);

        // A move of the user between two matches of the drawing.
        target.highlight(1);
        const movedView = { zoom: { value: 2 }, scrollX: 0, scrollY: -200 } as DrawingView;
        surface.view = movedView;
        target.highlight(0);
        expect(surface.view).toEqual({ zoom: { value: 2 }, scrollX: 0, scrollY: 30 });
        target.highlight(null);
        expect(surface.view).toBe(movedView);
    });

    it("keeps the view of the match that the search ends on, and selects that match", async () => {
        const surface = createSurface([ createText("far", 50, 300, "alpha") ], ZOOMED_VIEW);
        const target = createTarget(surface);
        await target.find("alpha", ANY_CASE);

        // `MergedFind.close()` takes the highlight away before it closes on the match.
        target.highlight(0);
        target.highlight(null);
        expect(target.close(0)).toBe(true);
        expect(surface.view).toEqual({ zoom: { value: 2 }, scrollX: 0, scrollY: -260 });
        expect(surface.select).toHaveBeenCalledWith(
            expect.objectContaining({ element: expect.objectContaining({ id: "far" }) }));
        expect(surface.matches).toEqual([]);

        // Closed on no match, the drawing returns to its view.
        surface.view = ZOOMED_VIEW;
        await target.find("alpha", ANY_CASE);
        target.highlight(0);
        expect(target.close(null)).toBe(false);
        expect(surface.view).toEqual(ZOOMED_VIEW);
    });

    it("counts a match out of view as at the nearest edge of the drawing", async () => {
        // Client tops: 50 + 10 × 2 = 70, and the bottom of the drawing, 250, for 600.
        const surface = createSurface([
            createText("near", 50, 10, "alpha"), createText("far", 50, 300, "alpha")
        ], ZOOMED_VIEW);
        const target = createTarget(surface);
        await target.find("alpha", ANY_CASE);

        expect(target.getFirstMatchBelow(0)).toBe(0);
        expect(target.getFirstMatchBelow(100)).toBe(1);
        expect(target.getFirstMatchBelow(251)).toBeNull();
    });

    it("searches again when the shapes change or show elsewhere, and reports it", async () => {
        const surface = createSurface([ createText("text", 50, 40, "alpha") ]);
        const target = createTarget(surface);
        const onChange = vi.fn();
        target.watchContent(onChange);

        await target.find("alpha", ANY_CASE);
        target.update();
        expect(onChange).not.toHaveBeenCalled();
        surface.elements = [ ...surface.elements, createText("added", 50, 80, "alpha") ];
        target.update();
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(surface.matches).toHaveLength(2);

        // The picture hands the drawing over to Excalidraw, which shows the matches instead.
        const other = createSurface(surface.elements);
        const detach = target.attach(other);
        expect(surface.matches).toEqual([]);
        expect(other.matches).toHaveLength(2);
        expect(onChange).toHaveBeenCalledTimes(2);
        detach();
        expect(onChange).toHaveBeenCalledTimes(3);
        expect(await target.find("alpha", ANY_CASE)).toBe(0);
    });
});

describe("attachExcalidraw", () => {
    it("shows the matches in Excalidraw, and selects the shape of a label at the end", async () => {
        const label = createText("label", 50, 40, "alpha", { containerId: "box" });
        let elements: ExcalidrawElement[] = [ label ];
        let onChange: (() => void) | undefined;
        const stopListening = vi.fn();
        const api = {
            registerAction: vi.fn(),
            getSceneElements: () => elements,
            getAppState: () => VIEW,
            updateScene: vi.fn(),
            onChange: vi.fn((callback: () => void) => {
                onChange = callback;
                return stopListening;
            })
        };
        const container = document.createElement("div");
        container.className = "excalidraw";
        container.tabIndex = 0;
        root.append(container);
        const target = new DrawingFindTarget({ current: root });
        const detach = attachExcalidraw(target, api as unknown as ExcalidrawImperativeAPI, root);

        // Excalidraw's search no longer takes Ctrl+F.
        const [ action ] = api.registerAction.mock.lastCall ?? [];
        expect(action).toMatchObject({ name: "searchMenu" });
        expect(action?.keyTest).toBeUndefined();

        // The canvas of the matches shows while the find bar has the focus.
        expect(root.hasAttribute("data-find-matches")).toBe(false);
        await target.find("alpha", ANY_CASE);
        expect(root.hasAttribute("data-find-matches")).toBe(true);
        target.highlight(0);
        expect(api.updateScene).toHaveBeenLastCalledWith({
            appState: {
                searchMatches: [ {
                    id: "label",
                    focus: true,
                    matchedLines: [ { offsetX: 0, offsetY: 0, width: 50, height: 20 } ]
                } ]
            },
            captureUpdate: "never"
        });

        elements = [ label, createText("added", 50, 80, "alpha") ];
        onChange?.();
        expect(api.updateScene).toHaveBeenLastCalledWith(expect.objectContaining({
            appState: { searchMatches: [
                expect.objectContaining({ id: "label", focus: false }),
                expect.objectContaining({ id: "added", focus: false })
            ] }
        }));

        expect(target.close(0)).toBe(true);
        expect(api.updateScene).toHaveBeenLastCalledWith({
            appState: { selectedElementIds: { box: true } },
            captureUpdate: "never"
        });
        expect(document.activeElement).toBe(container);
        expect(root.hasAttribute("data-find-matches")).toBe(false);

        await target.find("alpha", ANY_CASE);
        detach();
        expect(stopListening).toHaveBeenCalled();
        expect(root.hasAttribute("data-find-matches")).toBe(false);
    });
});

describe("DrawingMatches", () => {
    it("draws each match where Excalidraw does, turned with its text", () => {
        const container = document.createElement("div");
        const layerRef = { current: null as SVGGElement | null };
        const matches: DrawingMatch[] = [
            {
                element: createText("a", 50, 40, "alpha"),
                lines: [
                    { offsetX: 10, offsetY: 0, width: 30, height: 20 },
                    { offsetX: 0, offsetY: 20, width: 15, height: 20 }
                ]
            },
            {
                element: createText("b", 0, 100, "alpha", { angle: Math.PI / 2 }),
                lines: [ { offsetX: 0, offsetY: 0, width: 50, height: 20 } ]
            }
        ];

        render(
            <DrawingMatches matches={matches} current={1} theme="dark" layerRef={layerRef} />,
            container
        );
        expect(container.querySelector("svg.canvas-drawing-find.theme-dark")).not.toBeNull();
        expect(layerRef.current).toBe(container.querySelector("svg > g"));
        const groups = [ ...container.querySelectorAll("svg > g > g") ];
        expect(groups.map((group) => group.getAttribute("fill")))
            .toEqual([ MATCH_COLORS.dark.other, MATCH_COLORS.dark.current ]);
        expect([ ...groups[0]?.querySelectorAll("rect") ?? [] ].map((rect) =>
            [ "x", "y", "width", "height" ].map((name) => rect.getAttribute(name))))
            .toEqual([ [ "60", "40", "30", "20" ], [ "50", "60", "15", "20" ] ]);
        // Turned by 90 degrees around the center of the 200 × 20 text at (0, 100).
        expect(groups[0]?.getAttribute("transform")).toBeNull();
        const [ degrees, ...center ] = groups[1]?.getAttribute("transform")
            ?.match(/-?[\d.]+/g)?.map(Number) ?? [];
        expect(degrees).toBeCloseTo(90);
        expect(center).toEqual([ 100, 110 ]);

        expect(getSceneTransform({ zoom: { value: 2 }, scrollX: 10, scrollY: -5 } as DrawingView))
            .toBe("scale(2) translate(10 -5)");
        render(null, container);
    });
});

/** A surface that records the matches it shows, at `view`. */
function createSurface(elements: ExcalidrawElement[], view: DrawingView = VIEW) {
    const surface = {
        elements,
        view,
        matches: [] as DrawingMatch[],
        current: null as number | null,
        getElements: () => surface.elements,
        getView: () => surface.view,
        setView: vi.fn((next: DrawingView) => {
            surface.view = next;
        }),
        showMatches: vi.fn((matches: DrawingMatch[], current: number | null) => {
            surface.matches = matches;
            surface.current = current;
        }),
        select: vi.fn(() => true)
    };
    return surface;
}

function createTarget(surface: ReturnType<typeof createSurface>) {
    const target = new DrawingFindTarget({ current: root });
    target.attach(surface);
    return target;
}

/** A text element 200 × 20 at (`x`, `y`). */
function createText(
    id: string,
    x: number,
    y: number,
    originalText: string,
    properties: Partial<Record<keyof ExcalidrawTextElement, unknown>> = {}
) {
    return {
        id,
        type: "text",
        x,
        y,
        width: 200,
        height: 20,
        angle: 0,
        version: 1,
        isDeleted: false,
        containerId: null,
        originalText,
        text: originalText,
        ...properties
    } as unknown as ExcalidrawTextElement;
}
