import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTO_COLOR, createStroke, parseInkDocument } from "./ink_document";
import { darkenPicture } from "./ink_images";
import type { PdfPages } from "./ink_pdf";
import InkSurface, { isDarkColor } from "./ink_surface";

describe("ink surface input", () => {
    let container: HTMLDivElement;
    let surface: InkSurface;
    const onChange = vi.fn();
    const onStateChange = vi.fn();
    const onGesture = vi.fn();
    /** `[x, y, width, height, globalAlpha]` of each `fillRect()` call on any canvas. */
    const fillRects: number[][] = [];
    /** The `fillStyle` of each `fillRect()` call, in the order of `fillRects`. */
    const fillRectStyles: unknown[] = [];
    /** The `fillStyle` of each `fill()` call on any canvas. */
    const fills: unknown[] = [];
    /** The arguments of each `drawImage()` call on any canvas. */
    const drawImages: unknown[][] = [];

    beforeEach(() => {
        drawImages.length = 0;
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => stubContext(fillRects, fillRectStyles, fills, drawImages));
        vi.stubGlobal("Path2D", class { moveTo() {} quadraticCurveTo() {} closePath() {} });
        vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
        Element.prototype.setPointerCapture ??= () => {};
        container = document.createElement("div");
        document.body.append(container);
        onChange.mockReset();
        onStateChange.mockReset();
        onGesture.mockReset();
        surface = new InkSurface(container, { onChange, onGesture, onStateChange });
    });

    afterEach(() => {
        surface.destroy();
        container.remove();
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("pans with a finger unless finger drawing is on", async () => {
        swipe("touch", 1, 100);
        await nextFrame();
        expect(onChange).not.toHaveBeenCalled();
        expect(surface.getView().y).toBe(40);

        surface.fingerDrawing = true;
        swipe("touch", 2, 100);
        expect(onChange).toHaveBeenCalledOnce();
    });

    it("draws with a pen over a resting palm, which stays ignored until lifted", async () => {
        pointer("pointerdown", "touch", 1, 200);
        pointer("pointermove", "touch", 1, 210);
        swipe("pen", 2, 100);
        expect(onChange).toHaveBeenCalledOnce();

        pointer("pointermove", "touch", 1, 260);
        pointer("pointerdown", "touch", 3, 100);
        pointer("pointermove", "touch", 3, 150);
        pointer("pointerup", "touch", 3, 150);
        pointer("pointerup", "touch", 1, 260);
        await nextFrame();
        // 10 px from the palm before the pen landed and 50 px from the new finger, none from the
        // palm's move while it was ignored.
        expect(surface.getView().y).toBe(60);
    });

    it("keeps a pen stroke when fingers touch the screen while it is drawn", () => {
        pointer("pointerdown", "pen", 1, 100);
        pointer("pointermove", "pen", 1, 120);
        pointer("pointerdown", "touch", 2, 300);
        pointer("pointerdown", "touch", 3, 320);
        pointer("pointermove", "pen", 1, 140);
        pointer("pointerup", "pen", 1, 140);
        expect(onChange).toHaveBeenCalledOnce();
    });

    it("draws each stroke with the pressure sensitivity set when it began", () => {
        const sensitivities = () => parseInkDocument(surface.serialize()).strokes.map((stroke) => stroke.sensitivity);
        surface.sensitivity = 0;
        swipe("pen", 1, 100);
        const first = JSON.parse(surface.serialize()).objects[0];

        // A new value reaches only the strokes drawn after it, and the default is saved as none.
        surface.sensitivity = 90;
        swipe("pen", 2, 200);
        surface.sensitivity = 60;
        swipe("pen", 3, 300);
        expect(sensitivities()).toEqual([ 0, 90, undefined ]);
        expect(JSON.parse(surface.serialize()).objects[0]).toEqual(first);
    });

    it("pans with a pen or a mouse while space is held or the pan tool is picked", async () => {
        const strokeCount = () => parseInkDocument(surface.serialize()).strokes.length;
        surface.spacePanning = true;
        swipe("pen", 1, 100);
        await nextFrame();
        swipe("mouse", 2, 100);
        await nextFrame();
        expect(strokeCount()).toBe(0);
        expect(onChange).not.toHaveBeenCalled();
        expect(surface.getView().y).toBe(80);

        surface.spacePanning = false;
        swipe("pen", 3, 100);
        expect(strokeCount()).toBe(1);

        // The pan tool does the same without the space bar, and fingers pan with it whatever the option.
        surface.tool = "pan";
        surface.fingerDrawing = true;
        swipe("pen", 4, 100);
        await nextFrame();
        swipe("touch", 5, 100);
        await nextFrame();
        expect(strokeCount()).toBe(1);
        expect(surface.getView().y).toBe(160);
    });

    it("erases while the barrel button of a pen is held and pans with its middle button", async () => {
        const strokeCount = () => parseInkDocument(surface.serialize()).strokes.length;
        swipe("pen", 1, 100);
        expect(strokeCount()).toBe(1);

        // Barrel button held: buttons 1 (tip) + 2. The eraser shows as the tool while it is held.
        pointer("pointermove", "pen", 2, 100, 50, 2);
        expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ penErasing: true }));
        swipe("pen", 2, 100, 3);
        expect(strokeCount()).toBe(0);
        expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ penErasing: false }));

        // Middle button held: buttons 1 (tip) + 4.
        swipe("pen", 3, 100, 5);
        await nextFrame();
        expect(strokeCount()).toBe(0);
        expect(surface.getView().y).toBe(40);

        const contextMenu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        container.dispatchEvent(contextMenu);
        expect(contextMenu.defaultPrevented).toBe(true);
    });

    it("draws each line of the paper where the view puts it, rounded on its own", async () => {
        const lines = (calls: number[][]) => calls
            .filter(([ , , width, height, alpha ]) => width === 400 && height === 1 && alpha < 1)
            .map(([ , y ]) => y);
        surface.destroy();
        vi.spyOn(container, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 300));
        surface = new InkSurface(container, { onChange, onGesture, onStateChange: () => {} });
        fillRects.length = 0;
        surface.load({ version: 2, paper: "ruled", layout: "infinite", strokes: [] });
        expect(lines(fillRects)).toEqual([ 0, 32, 64, 96, 128, 160, 192, 224, 256, 288 ]);

        // Zooming to 70% around the middle puts the origin at (60, 45) and the lines 22.4 px apart.
        surface.zoomBy(0.7);
        fillRects.length = 0;
        await new Promise((resolve) => setTimeout(resolve, 200));
        const zoomed = lines(fillRects);
        expect(zoomed.slice(0, 4)).toEqual([ 0, 23, 45, 67 ]);
        expect(zoomed).toContain(269);
        // The preview frame and the settled redraw both draw them, at the same positions.
        expect(new Set(zoomed).size).toBe(14);
    });

    it("shows a view, or the whole content, around the middle of the container", () => {
        surface.destroy();
        vi.spyOn(container, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 300));
        surface = new InkSurface(container, { onChange, onGesture, onStateChange: () => {} });
        surface.load({ version: 2, paper: "ruled", layout: "infinite", strokes: [] });

        surface.showView({ x: 10, y: 20, zoom: 2 });
        expect(surface.getView()).toEqual({ zoom: 2, x: 180, y: 110 });
        expect(surface.getCenterView()).toEqual({ x: 10, y: 20, zoom: 2 });

        // An empty note shows its origin at the top left, at 100%.
        surface.showView("content");
        expect(surface.getView()).toEqual({ zoom: 1, x: 0, y: 0 });

        // The stroke and its width of 4 on each side span 996 to 2004 across, which fits at 1/3
        // with 32 px to spare on each side, and the top of the ink at 996 lies 32 px down.
        const stroke = createStroke({
            tool: "pen", color: AUTO_COLOR, size: 4, simulatePressure: false,
            points: [ 1000, 1000, 0.5, 2000, 1500, 0.5 ], order: 0
        });
        surface.load({ version: 2, paper: "ruled", layout: "infinite", strokes: [ stroke ] });
        surface.showView("content");
        // The origin lies on a whole pixel, which is 3 world units at this zoom.
        const view = surface.getCenterView();
        expect(Math.abs(view.x - 1500)).toBeLessThanOrEqual(1.5);
        expect(Math.abs(view.y - 1350)).toBeLessThanOrEqual(1.5);
        expect(view.zoom).toBeCloseTo(336 / 1008);

        // Fitting again keeps the part of the ink on screen, as on pages.
        surface.showView({ x: 1500, y: 1400, zoom: 1 });
        surface.showView("content");
        expect(Math.abs(surface.getCenterView().y - 1700)).toBeLessThanOrEqual(1.5);

        // A small drawing is enlarged to at most 200%, from the top of its ink at -4.
        surface.load({ version: 2, paper: "ruled", layout: "infinite", strokes: [ createStroke({ ...stroke, points: [ 0, 0, 0.5, 10, 10, 0.5 ] }) ] });
        surface.showView("content");
        expect(surface.getView()).toMatchObject({ zoom: 2, y: 40 });

        // A note of text boxes alone fits them: 1000 to 2008 across, from the top of the first.
        surface.load({
            version: 2, paper: "ruled", layout: "infinite", strokes: [],
            texts: [ { id: "a", order: 0, html: "<p>a</p>", x: 1000, y: 996, width: 300 }, { id: "b", order: 1, html: "<p>b</p>", x: 1500, y: 1500, width: 508 } ]
        });
        surface.showView("content");
        expect(Math.abs(surface.getCenterView().x - 1504)).toBeLessThanOrEqual(1.5);
        expect(Math.abs(surface.getCenterView().y - 1350)).toBeLessThanOrEqual(1.5);
        expect(surface.getCenterView().zoom).toBeCloseTo(336 / 1008);
    });

    it("shows pages up to an empty one after the last ink, and fits their width", () => {
        surface.destroy();
        vi.spyOn(container, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 300));
        surface = new InkSurface(container, { onChange, onGesture, onStateChange: () => {} });
        surface.load({ version: 2, paper: "blank", layout: "pages", strokes: [] });
        expect(surface.getPageCount()).toBe(1);

        // A new note shows the top of its first page across the width, with room on each side.
        surface.showView("content");
        expect(surface.getCenterView().zoom).toBeCloseTo(336 / 794);
        expect(surface.getView().y).toBe(32);

        // Ink on the second page, which spans 1147 to 2270, shows a third one after it.
        const onPageTwo = createStroke({
            tool: "pen", color: AUTO_COLOR, size: 3, simulatePressure: false,
            points: [ 100, 1500, 0.5, 200, 1520, 0.5 ], order: 0
        });
        surface.load({ version: 2, paper: "blank", layout: "pages", strokes: [ onPageTwo ] });
        expect(surface.getPageCount()).toBe(3);

        // Writing on the first page of an empty note adds a second, and undoing it takes it away.
        surface.load({ version: 2, paper: "blank", layout: "pages", strokes: [] });
        swipe("pen", 2, 100);
        expect(surface.getPageCount()).toBe(2);
        surface.undo();
        expect(surface.getPageCount()).toBe(1);
        surface.redo();
        expect(surface.getPageCount()).toBe(2);

        // A text box counts as well, on the page where it starts, as loaded or as typed.
        const typed = { id: "t1", order: 1, html: "<p>Typed</p>", x: 100, y: 1500, width: 200 };
        surface.load({ version: 2, paper: "blank", layout: "pages", strokes: [], texts: [ typed ] });
        expect(surface.getPageCount()).toBe(3);
        surface.setTextBoxes([]);
        expect(surface.getPageCount()).toBe(1);
        surface.setTextBoxes([ typed ]);
        expect(surface.getPageCount()).toBe(3);
        surface.load({ version: 2, paper: "blank", layout: "pages", strokes: [] });

        // The paper's sheet is filled where the view puts the page, and nothing below the last one.
        fillRects.length = 0;
        surface.showView({ x: 397, y: 0, zoom: 0.25 });
        const sheets = fillRects.filter(([ , , width, height, alpha ]) => alpha === 1 && width === 199 && height < 300);
        expect(sheets.map(([ x, y, , height ]) => [ x, y, height ])).toEqual([ [ 101, 150, 281 ] ]);
    });

    it("puts the pages on the background of the note list, or on a tint of the text color", () => {
        surface.destroy();
        vi.spyOn(container, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 300));
        container.style.color = "rgb(0, 0, 0)";
        container.style.backgroundColor = "rgb(255, 255, 255)";
        container.style.setProperty("--note-list-view-content-background", "rgba(0, 0, 0, 0.2)");
        surface = new InkSurface(container, { onChange, onGesture, onStateChange });
        surface.load({ version: 2, paper: "blank", layout: "pages", strokes: [] });
        // The fills across the whole view, over the page's own background.
        const desk = () => fillRects
            .map(([ x, y, width, height, alpha ], index) => ({ x, y, width, height, alpha, style: fillRectStyles[index] }))
            .filter(({ x, y, width, height, style }) =>
                x === 0 && y === 0 && width === 400 && height === 300 && style !== "rgb(255, 255, 255)")
            .map(({ style, alpha }) => [ style, alpha ]);

        fillRects.length = 0;
        fillRectStyles.length = 0;
        surface.refreshTheme();
        expect(desk()).toEqual([ [ "rgba(0, 0, 0, 0.2)", 1 ] ]);

        // A theme without that background tints the desk with the text color.
        container.style.removeProperty("--note-list-view-content-background");
        fillRects.length = 0;
        fillRectStyles.length = 0;
        surface.refreshTheme();
        expect(desk()).toEqual([ [ "rgb(0, 0, 0)", 0.06 ] ]);
    });

    it("moves between pages at the current zoom and reports the page in view", () => {
        surface.destroy();
        vi.spyOn(container, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 300));
        surface = new InkSurface(container, { onChange, onGesture, onStateChange });
        const onPageThree = createStroke({
            tool: "pen", color: AUTO_COLOR, size: 3, simulatePressure: false,
            points: [ 100, 2500, 0.5, 200, 2520, 0.5 ], order: 0
        });
        surface.load({ version: 2, paper: "blank", layout: "pages", strokes: [ onPageThree ] });
        surface.showView({ x: 397, y: 150, zoom: 1 });
        expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ page: 0, pageCount: 4 }));

        // The top of the next page goes 32 px below the top of the view, at the same zoom.
        surface.goToPage(1);
        expect(surface.getView()).toEqual({ zoom: 1, x: 200 - 397, y: 32 - 1147 });
        expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));

        // Pages outside the note are out of reach.
        surface.goToPage(-1);
        expect(surface.getView().y).toBe(32 - 1147);
        surface.goToPage(4);
        expect(surface.getView().y).toBe(32 - 1147);
    });

    it("undoes on a short tap with two fingers, but not after a pinch", () => {
        swipe("pen", 1, 100);
        swipe("pen", 2, 200);
        expect(onChange).toHaveBeenCalledTimes(2);

        pointer("pointerdown", "touch", 3, 300);
        pointer("pointerdown", "touch", 4, 320);
        pointer("pointerup", "touch", 3, 300);
        pointer("pointerup", "touch", 4, 320);
        expect(onChange).toHaveBeenCalledTimes(3);

        pointer("pointerdown", "touch", 5, 300);
        pointer("pointerdown", "touch", 6, 320);
        pointer("pointermove", "touch", 6, 380);
        pointer("pointerup", "touch", 5, 300);
        pointer("pointerup", "touch", 6, 380);
        expect(onChange).toHaveBeenCalledTimes(3);

        // A pen that lands on two resting fingers and lifts at once draws, and undoes nothing.
        pointer("pointerdown", "touch", 7, 300);
        pointer("pointerdown", "touch", 8, 320);
        swipe("pen", 9, 400);
        pointer("pointerup", "touch", 7, 300);
        pointer("pointerup", "touch", 8, 320);
        expect(parseInkDocument(surface.serialize()).strokes).toHaveLength(2);
    });

    it("straightens a line when the pen rests at its end, and moves its end with the pen", () => {
        vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout" ] });
        /** The `[x, y]` positions of each stroke of the note. */
        const drawn = () => parseInkDocument(surface.serialize()).strokes
            .map(({ points }) => points.filter((_, index) => index % 3 !== 2));
        const draw = (...positions: number[][]) => {
            for (const [ index, [ x, y ] ] of positions.entries()) {
                pointer(index ? "pointermove" : "pointerdown", "pen", 1, y, x);
            }
        };
        const wobblyLine = [ [ 50, 100 ], [ 100, 104 ], [ 150, 97 ], [ 200, 100 ] ];
        const straightLine = [ 50, 100, 150, 115, 250, 130 ];

        // Lifted without a rest, the stroke stays as drawn.
        draw(...wobblyLine);
        vi.advanceTimersByTime(400);
        pointer("pointerup", "pen", 1, 100, 200);
        expect(drawn()).toEqual([ wobblyLine.flat() ]);
        surface.undo();

        // After a rest the stroke is a line from its start to the pen, wherever the pen goes next.
        draw(...wobblyLine);
        vi.advanceTimersByTime(600);
        pointer("pointermove", "pen", 1, 130, 250);
        pointer("pointerup", "pen", 1, 130, 250);
        expect(drawn()).toEqual([ straightLine ]);

        // The first undo gives back the stroke as drawn and the second removes it.
        surface.undo();
        expect(drawn()).toEqual([ wobblyLine.flat() ]);
        surface.undo();
        expect(drawn()).toEqual([]);
        surface.redo();
        surface.redo();
        expect(drawn()).toEqual([ straightLine ]);
        surface.undo();
        surface.undo();

        // A rest at the end of a curve changes nothing.
        const curve = [ [ 50, 100 ], [ 100, 160 ], [ 150, 160 ], [ 200, 100 ] ];
        draw(...curve);
        vi.advanceTimersByTime(600);
        pointer("pointerup", "pen", 1, 100, 200);
        expect(drawn()).toEqual([ curve.flat() ]);
        surface.undo();

        // A rest where a stroke around a rectangle closes puts every point on its sides, and
        // the pen leaves it there.
        const rectangle = [
            [ 50, 100 ], [ 150, 103 ], [ 250, 100 ], [ 247, 150 ], [ 250, 200 ], [ 150, 197 ], [ 50, 200 ], [ 53, 150 ], [ 50, 100 ]
        ];
        draw(...rectangle);
        vi.advanceTimersByTime(600);
        pointer("pointermove", "pen", 1, 300, 300);
        pointer("pointerup", "pen", 1, 300, 300);
        const [ sides, ...others ] = parseInkDocument(surface.serialize()).strokes;
        expect(others).toEqual([]);
        expect(sides.points.length).toBeGreaterThan(rectangle.length * 3);
        for (let i = 0; i < sides.points.length; i += 3) {
            const [ x, y ] = sides.points.slice(i, i + 2);
            expect(x === 50 || x === 250 || y === 100 || y === 200).toBe(true);
        }
        surface.undo();
        expect(drawn()).toEqual([ rectangle.flat() ]);
        surface.undo();

        // A stroke around a triangle becomes one the same way.
        const triangle = [ [ 50, 100 ], [ 150, 103 ], [ 250, 100 ], [ 203, 180 ], [ 150, 260 ], [ 97, 180 ], [ 50, 100 ] ];
        draw(...triangle);
        vi.advanceTimersByTime(600);
        pointer("pointerup", "pen", 1, 100, 50);
        expect(drawn()[0].length).toBeGreaterThan(triangle.length * 2);
        surface.undo();
        expect(drawn()).toEqual([ triangle.flat() ]);
        surface.undo();

        // A stroke around a circle becomes a circle around the same center.
        const circle: number[][] = [];
        for (let degrees = 0; degrees <= 360; degrees += 20) {
            const radius = degrees % 40 ? 78 : 82;
            circle.push([
                Math.round(200 + radius * Math.cos(degrees * Math.PI / 180)),
                Math.round(200 + radius * Math.sin(degrees * Math.PI / 180))
            ]);
        }
        draw(...circle);
        vi.advanceTimersByTime(600);
        pointer("pointerup", "pen", 1, 200, 282);
        const [ round ] = drawn();
        expect(round.length).toBeGreaterThan(circle.length * 2);
        for (let i = 0; i < round.length; i += 2) {
            expect(Math.abs(Math.hypot(round[i] - 200, round[i + 1] - 200) - 80)).toBeLessThan(3);
        }
        surface.undo();
        surface.undo();

        // A shaft and two barbs become an arrow from the same start to the same tip.
        const arrow = [
            [ 300, 100 ], [ 250, 101 ], [ 200, 102 ], [ 150, 101 ], [ 100, 100 ],
            [ 120, 85 ], [ 140, 70 ], [ 120, 85 ], [ 100, 100 ], [ 115, 105 ], [ 130, 110 ]
        ];
        draw(...arrow);
        vi.advanceTimersByTime(600);
        pointer("pointerup", "pen", 1, 110, 130);
        const [ straight ] = drawn();
        expect(straight.slice(0, 2)).toEqual([ 300, 100 ]);
        expect(straight.length).toBeGreaterThan(arrow.length * 2);
        // The shaft is level from its start to the tip, where the stroke first turns back.
        const turn = straight.findIndex((x, index) => index % 2 === 0 && x === 100);
        expect(turn).toBeGreaterThan(0);
        expect(new Set(straight.slice(0, turn + 2).filter((_, index) => index % 2))).toEqual(new Set([ 100 ]));
    });

    it("draws the ink and the paper again in the colors of a new theme", async () => {
        surface.destroy();
        vi.spyOn(container, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 300));
        container.style.color = "rgb(0, 0, 0)";
        container.style.backgroundColor = "rgb(255, 255, 255)";
        surface = new InkSurface(container, { onChange, onGesture, onStateChange });
        const stroke = createStroke({
            tool: "pen", color: AUTO_COLOR, size: 3, simulatePressure: false,
            points: [ 10, 10, 0.5, 60, 10, 0.5 ], order: 0
        });
        surface.load({ version: 2, paper: "ruled", layout: "infinite", strokes: [ stroke ] });
        expect(fills).toContain("rgb(0, 0, 0)");

        container.style.color = "rgb(240, 240, 240)";
        container.style.backgroundColor = "rgb(20, 20, 20)";
        fills.length = 0;
        fillRects.length = 0;
        surface.refreshTheme();
        expect(fills).toEqual([ "rgb(240, 240, 240)" ]);
        expect(fillRects[0]).toEqual([ 0, 0, 400, 300, 1 ]);

        // The stroke being drawn takes the new color as well.
        surface.load({ version: 2, paper: "ruled", layout: "infinite", strokes: [] });
        pointer("pointerdown", "pen", 1, 100);
        pointer("pointermove", "pen", 1, 140);
        await nextFrame();
        container.style.color = "rgb(200, 0, 0)";
        fills.length = 0;
        surface.refreshTheme();
        await nextFrame();
        expect(fills).toContain("rgb(200, 0, 0)");
        expect(fills).not.toContain("rgb(240, 240, 240)");
    });

    it("lightens dark ink in a dark theme, and keeps the color it was saved in", async () => {
        surface.destroy();
        vi.spyOn(container, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 300));
        container.style.color = "rgb(0, 0, 0)";
        container.style.backgroundColor = "rgb(255, 255, 255)";
        surface = new InkSurface(container, { onChange, onGesture, onStateChange });
        const stroke = (color: string, order: number) => createStroke({
            tool: "pen", color, size: 3, simulatePressure: false, points: [ 10, 10 + order * 20, 0.5, 60, 10 + order * 20, 0.5 ], order
        });
        // Dark blue, and a red that reads on both.
        fills.length = 0;
        surface.load({ version: 2, paper: "ruled", layout: "infinite", strokes: [ stroke("#004f8b", 0), stroke("#e64d4d", 1) ] });
        expect(fills).toEqual([ "#004f8b", "#e64d4d" ]);

        container.style.color = "rgb(240, 240, 240)";
        container.style.backgroundColor = "rgb(20, 20, 20)";
        fills.length = 0;
        surface.refreshTheme();
        expect(fills).toEqual([ "#74c3ff", "#e64d4d" ]);
        expect(JSON.parse(surface.serialize()).objects.map(({ c }: { c?: string }) => c)).toEqual([ "#004f8b", "#e64d4d" ]);

        // The stroke being drawn takes the same color as the finished one.
        surface.load({ version: 2, paper: "ruled", layout: "infinite", strokes: [] });
        surface.color = "#004f8b";
        fills.length = 0;
        pointer("pointerdown", "pen", 1, 100);
        pointer("pointermove", "pen", 1, 140);
        await nextFrame();
        expect(fills).toContain("#74c3ff");
        expect(fills).not.toContain("#004f8b");
    });

    it("erases the parts of strokes the eraser covers, in one step to undo", () => {
        const strokes = () => parseInkDocument(surface.serialize()).strokes;
        const drag = (pointerId: number, fromX: number, toX: number) => {
            pointer("pointerdown", "pen", pointerId, 100, fromX);
            for (let x = fromX; x <= toX; x += 10) pointer("pointermove", "pen", pointerId, 100, x);
            pointer("pointerup", "pen", pointerId, 100, toX);
        };
        drag(1, 0, 200);
        const drawn = strokes()[0].points.length;

        // A tap cuts the line in two.
        surface.tool = "eraser";
        surface.eraserMode = "partial";
        drag(2, 100, 100);
        expect(strokes()).toHaveLength(2);
        expect(Math.max(...strokes()[0].points.filter((_, i) => i % 3 === 0))).toBeLessThan(100);
        surface.undo();
        expect(strokes().map((stroke) => stroke.points.length)).toEqual([ drawn ]);
        surface.redo();
        expect(strokes()).toHaveLength(2);
        surface.undo();

        // A drag erases the pieces it cuts as it goes, and undoing it gives back the line alone.
        drag(3, 100, 220);
        expect(strokes()).toHaveLength(1);
        surface.undo();
        expect(strokes().map((stroke) => stroke.points.length)).toEqual([ drawn ]);

        // An erase with a finger that a second finger turns into a pinch leaves the line as it was.
        surface.fingerDrawing = true;
        pointer("pointerdown", "touch", 4, 100, 60);
        for (let x = 70; x <= 140; x += 10) pointer("pointermove", "touch", 4, 100, x);
        expect(strokes().length).toBeGreaterThan(1);
        pointer("pointerdown", "touch", 5, 300, 300);
        expect(strokes().map((stroke) => stroke.points.length)).toEqual([ drawn ]);
        pointer("pointerup", "touch", 5, 300, 300);
        pointer("pointerup", "touch", 4, 100, 140);

        surface.eraserMode = "stroke";
        drag(5, 100, 100);
        expect(strokes()).toHaveLength(0);
    });

    it("shows the eraser at a pen while it erases, as Windows hides the cursor of a pen on the screen", () => {
        surface.tool = "eraser";
        const ring = () => container.querySelector<HTMLElement>(".handwriting-eraser-ring");
        expect(ring()?.hidden).toBe(true);

        pointer("pointerdown", "pen", 1, 100, 50);
        expect(ring()?.hidden).toBe(false);
        expect(ring()?.style.transform).toBe("translate(50px, 100px)");
        pointer("pointermove", "pen", 1, 120, 70);
        expect(ring()?.style.transform).toBe("translate(70px, 120px)");
        pointer("pointerup", "pen", 1, 120, 70);
        expect(ring()?.hidden).toBe(true);

        // The eraser end of a pen shows it too, but not a mouse, which keeps its cursor.
        pointer("pointerdown", "pen", 2, 100, 50, 32);
        expect(ring()?.hidden).toBe(false);
        pointer("pointerup", "pen", 2, 100, 50);
        pointer("pointerdown", "mouse", 4, 100, 50);
        expect(ring()?.hidden).toBe(true);
        pointer("pointerup", "mouse", 4, 100, 50);
    });

    it("draws the end of a stroke on a canvas just around it, which follows the pen", async () => {
        surface.destroy();
        vi.spyOn(container, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 2000, 1500));
        surface = new InkSurface(container, { onChange, onGesture, onStateChange: () => {} });
        surface.load({ version: 2, paper: "blank", layout: "infinite", strokes: [] });
        // Far down the canvas, where the screen shows world y 2000 to 3500.
        surface.showView({ x: 1000, y: 2750, zoom: 1 });
        const live = container.querySelector<HTMLCanvasElement>(".handwriting-live-layer canvas:last-child");
        if (!live) throw new Error("expected the live canvas");

        pointer("pointerdown", "pen", 1, 100, 400);
        for (let x = 420; x <= 600; x += 20) pointer("pointermove", "pen", 1, 100, x);
        await nextFrame();
        // The stroke spans 400 to 600 across at 100 down the screen, and the canvas that much and
        // 128 px around it.
        expect(live.width).toBeLessThan(500);
        expect(parseFloat(live.style.left)).toBeGreaterThan(250);
        expect(parseFloat(live.style.left)).toBeLessThan(400);
        expect(live.style.width).toBe(`${live.width}px`);
        // `left` places it in a right-to-left language too, where `right` of the stylesheet would win.
        expect(live.style.right).toBe("auto");
        expect(live.height).toBeGreaterThan(200);
        expect(parseFloat(live.style.top)).toBe(0);

        // Once the start of a long stroke has settled, the canvas covers only its end.
        for (let x = 620; x <= 1900; x += 20) pointer("pointermove", "pen", 1, 100, x);
        await nextFrame();
        expect(parseFloat(live.style.left)).toBeGreaterThan(600);
        expect(parseFloat(live.style.left) + live.width).toBeGreaterThanOrEqual(1900);
        pointer("pointerup", "pen", 1, 100, 1900);
    });

    describe("images", () => {
        const URL = "api/attachments/abc/image/exercise.png";
        const picture = document.createElement("canvas");
        const loadImage = vi.fn();
        const objects = (): Record<string, unknown>[] => JSON.parse(surface.serialize()).objects;
        /** The saved images, without what tells one object from another. */
        const images = () => objects().filter(({ o }) => o === "image").map(({ o, id, at, ...image }) => image);
        const box = () => container.querySelector<HTMLElement>(".handwriting-image-box");
        const hasSelection = () => onStateChange.mock.lastCall?.[0].hasSelection;

        beforeEach(() => {
            loadImage.mockReset().mockResolvedValue(picture);
            surface.destroy();
            vi.spyOn(container, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 300));
            surface = new InkSurface(container, { onChange, onGesture, onStateChange, loadImage });
            surface.load({ version: 2, paper: "blank", layout: "infinite", strokes: [] });
        });

        function dragHandle(handle: string, toX: number, toY: number) {
            const element = container.querySelector(`[data-handle="${handle}"]`);
            expect(element).not.toBeNull();
            element?.dispatchEvent(new PointerEvent("pointerdown", {
                pointerId: 9, pointerType: "mouse", clientX: 0, clientY: 0, button: 0, buttons: 1, bubbles: true
            }));
            pointer("pointermove", "mouse", 9, toY, toX);
            pointer("pointerup", "mouse", 9, toY, toX);
        }

        it("adds an image to the middle of the view, under the ink, and draws its picture once loaded", async () => {
            // A picture of 1000 by 500 pixels fills 80% of the view of 400 by 300.
            surface.addImage(URL, 1000, 500);
            expect(images()).toEqual([ { url: URL, x: 40, y: 70, w: 320, h: 160 } ]);
            expect(loadImage).toHaveBeenCalledExactlyOnceWith(URL);
            expect(onChange).toHaveBeenCalledOnce();
            expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ hasSelection: true, canUndo: true }));
            expect(box()?.hidden).toBe(false);
            expect(box()?.style).toMatchObject({ left: "40px", top: "70px", width: "320px", height: "160px" });
            // Until the picture loads, a tint of the text color fills its place.
            expect(fillRects).toContainEqual([ 40, 70, 320, 160, 0.08 ]);
            expect(drawImages).toEqual([]);

            await new Promise((resolve) => setTimeout(resolve));
            expect(drawImages).toContainEqual([ picture, 40, 70, 320, 160 ]);

            // The pen writes over the image, which stays where it is.
            swipe("pen", 1, 100);
            expect(parseInkDocument(surface.serialize()).strokes).toHaveLength(1);
            expect(images()).toHaveLength(1);

            // The view follows the image, and a note reloaded asks for no picture again.
            surface.zoomBy(2);
            expect(box()?.style).toMatchObject({ width: "640px", height: "320px" });
            surface.load(parseInkDocument(surface.serialize()));
            expect(hasSelection()).toBe(false);
            expect(loadImage).toHaveBeenCalledOnce();
        });

        it("saves each object with an ID and a time of its own, in drawing order", () => {
            vi.spyOn(Date, "now").mockReturnValue(1700000000000);
            swipe("pen", 1, 100);
            surface.addImage(URL, 1000, 500);
            swipe("pen", 2, 200);
            surface.addImage(URL, 100, 50);
            const boxOrder = surface.takeOrder();
            surface.setTextBoxes([ { id: "box", order: boxOrder, x: 0, y: 0, width: 100, html: "<p>a</p>" } ]);

            // A new image goes under the ink and the text, and over the images already there.
            const saved = objects();
            expect(saved.map(({ o, w }) => [ o, w ])).toEqual([
                [ "image", 320 ], [ "image", 100 ], [ undefined, 3 ], [ undefined, 3 ], [ "text", 100 ]
            ]);
            const ids = saved.map(({ id }) => id);
            expect(new Set(ids).size).toBe(5);
            expect(saved.slice(0, 4).map(({ at }) => at)).toEqual([ 1700000000000, 1700000000000, 1700000000000, 1700000000000 ]);

            // Reading the note again, moving an image and undoing leave each object its ID.
            surface.load(parseInkDocument(surface.serialize()));
            expect(objects().map(({ id }) => id)).toEqual(ids);
            surface.tool = "select";
            pointer("pointerdown", "pen", 1, 100, 100);
            pointer("pointermove", "pen", 1, 130, 120);
            pointer("pointerup", "pen", 1, 130, 120);
            expect(objects().map(({ id }) => id)).toEqual(ids);

            // A stroke drawn after the note was read lies over all of them.
            surface.tool = "pen";
            swipe("pen", 3, 250);
            expect(objects().map(({ o }) => o)).toEqual([ "image", "image", undefined, undefined, "text", undefined ]);
        });

        it("writes back what a later build saved and this one does not read", () => {
            const saved = JSON.stringify({
                version: 2, paper: "blank", layout: "infinite", audio: "api/attachments/abc/open",
                objects: [ { id: "a", w: 3, p: [ 0, 0, 128, 10, 0, 0 ], tilt: 4 }, { o: "shape", id: "b" } ]
            });
            surface.load(parseInkDocument(saved));
            swipe("pen", 1, 100);
            const again = JSON.parse(surface.serialize());
            expect(again.audio).toBe("api/attachments/abc/open");
            expect(again.objects.slice(0, 2)).toEqual(JSON.parse(saved).objects);
            expect(again.objects).toHaveLength(3);
        });

        it("asks for the text of the text boxes that can reach the first page, once one changes", async () => {
            const measureTexts = vi.fn().mockReturnValue([]);
            surface.destroy();
            surface = new InkSurface(container, { onChange, onGesture, onStateChange, loadImage, measureTexts });
            surface.load({ version: 2, paper: "blank", layout: "pages", strokes: [] });
            expect(await surface.exportThumbnail()).toBeUndefined();

            const box = (id: string, x: number, y: number) => ({ id, order: surface.takeOrder(), x, y, width: 100, html: "<p>a</p>" });
            const [ onPage, above, below, beside ] = [ box("a", 10, 10), box("b", 10, -500), box("c", 10, 5000), box("d", 2000, 10) ];
            // A box on another page leaves the picture as it is.
            surface.setTextBoxes([ below ]);
            expect(await surface.exportThumbnail()).toBeUndefined();

            surface.setTextBoxes([ below, onPage, above, beside ]);
            expect(await surface.exportThumbnail()).toBeDefined();
            expect(measureTexts).toHaveBeenLastCalledWith([ onPage, above ]);

            // On a canvas without bounds, every box is part of the picture.
            surface.setLayout("infinite");
            await surface.exportThumbnail();
            expect(measureTexts).toHaveBeenLastCalledWith([ below, onPage, above, beside ]);
        });

        it("moves, resizes and deletes the selected image with the select tool, each in one step to undo", () => {
            surface.addImage(URL, 1000, 500);
            surface.tool = "select";
            onChange.mockClear();

            // A drag on the image moves it, with a pen, a mouse or a finger.
            pointer("pointerdown", "pen", 1, 100, 50);
            pointer("pointermove", "pen", 1, 130, 70);
            pointer("pointerup", "pen", 1, 130, 70);
            expect(images()).toEqual([ { url: URL, x: 60, y: 100, w: 320, h: 160 } ]);
            expect(onChange).toHaveBeenCalledOnce();
            expect(onGesture).toHaveBeenCalled();
            pointer("pointerdown", "touch", 2, 150, 100);
            pointer("pointermove", "touch", 2, 140, 90);
            pointer("pointerup", "touch", 2, 140, 90);
            expect(images()[0]).toMatchObject({ x: 50, y: 90 });
            surface.undo();
            surface.undo();
            expect(images()[0]).toMatchObject({ x: 40, y: 70 });
            expect(hasSelection()).toBe(true);
            surface.redo();
            expect(images()[0]).toMatchObject({ x: 60, y: 100 });

            // A press that does not move, or a drag that the pointer cancels, changes nothing.
            onChange.mockClear();
            pointer("pointerdown", "mouse", 3, 150, 100);
            pointer("pointerup", "mouse", 3, 150, 100);
            pointer("pointerdown", "mouse", 4, 150, 100);
            pointer("pointermove", "mouse", 4, 250, 200);
            pointer("pointercancel", "mouse", 4, 250, 200);
            expect(images()[0]).toMatchObject({ x: 60, y: 100 });
            expect(onChange).not.toHaveBeenCalled();

            // A handle resizes it from the opposite corner, keeping its proportions.
            dragHandle("se", 220, 110);
            expect(images()).toEqual([ { url: URL, x: 60, y: 100, w: 160, h: 80 } ]);
            dragHandle("nw", 20, 170);
            expect(images()).toEqual([ { url: URL, x: 20, y: 80, w: 200, h: 100 } ]);
            expect(box()?.style).toMatchObject({ left: "20px", top: "80px", width: "200px" });

            // The bar over the box moves the image, though the press lies outside it.
            const bar = box()?.querySelector(".handwriting-box-bar");
            expect(bar).not.toBeNull();
            const press = { pointerType: "mouse", clientX: 0, clientY: 0, button: 0, buttons: 1, bubbles: true };
            bar?.dispatchEvent(new PointerEvent("pointerdown", { ...press, pointerId: 10 }));
            pointer("pointermove", "mouse", 10, 10, 30);
            pointer("pointerup", "mouse", 10, 10, 30);
            expect(images()).toEqual([ { url: URL, x: 50, y: 90, w: 200, h: 100 } ]);
            expect(hasSelection()).toBe(true);

            // Its button deletes the image, and a press on the button starts no drag.
            const remove = bar?.querySelector("button");
            expect(remove).not.toBeNull();
            remove?.dispatchEvent(new PointerEvent("pointerdown", { ...press, pointerId: 11 }));
            remove?.click();
            expect(images()).toEqual([]);
            expect(hasSelection()).toBe(false);
            expect(box()?.hidden).toBe(true);
            surface.undo();
            expect(images()).toHaveLength(1);
        });

        it("selects only with the select tool, and pans from outside the images", async () => {
            surface.addImage(URL, 1000, 500);
            surface.tool = "pen";
            expect(hasSelection()).toBe(false);

            surface.tool = "select";
            pointer("pointerdown", "mouse", 1, 100, 50);
            pointer("pointerup", "mouse", 1, 100, 50);
            expect(hasSelection()).toBe(true);

            // A drag that starts beside the image pans, and lets go of the selection.
            pointer("pointerdown", "mouse", 2, 10, 10);
            pointer("pointermove", "mouse", 2, 40, 10);
            pointer("pointerup", "mouse", 2, 40, 10);
            await nextFrame();
            expect(hasSelection()).toBe(false);
            expect(surface.getView().y).toBe(30);
            expect(images()[0]).toMatchObject({ x: 40, y: 70 });

            // A read-only note pans from anywhere.
            surface.readOnly = true;
            pointer("pointerdown", "mouse", 3, 150, 100);
            pointer("pointermove", "mouse", 3, 160, 100);
            pointer("pointerup", "mouse", 3, 160, 100);
            await nextFrame();
            expect(hasSelection()).toBe(false);
            expect(surface.getView().y).toBe(40);
            expect(images()[0]).toMatchObject({ x: 40, y: 70 });
        });

        it("keeps a new image inside the page in view, and shows a page after the last image", () => {
            surface.load({ version: 2, paper: "blank", layout: "pages", strokes: [] });
            surface.showView({ x: 700, y: 1200, zoom: 1 });
            // The middle of the view is on the second page, which spans 1147 to 2270.
            surface.addImage(URL, 2000, 1000);
            expect(images()).toEqual([ { url: URL, x: 0, y: 1147, w: 794, h: 397 } ]);
            expect(surface.getPageCount()).toBe(3);
            surface.undo();
            expect(surface.getPageCount()).toBe(1);
        });

        it("turns a picture dark for a dark theme", () => {
            expect([ "rgb(30, 30, 30)", "rgba(255, 255, 255, 1)", "color(srgb 0.1 0.1 0.2)", "" ].map(isDarkColor))
                .toEqual([ true, false, true, false ]);

            // White paper turns nearly black, black print nearly white, and red a lighter red.
            const pixels = { data: new Uint8ClampedArray([ 255, 255, 255, 255, 0, 0, 0, 128, 255, 0, 0, 255 ]) };
            const putImageData = vi.fn();
            vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(
                { drawImage() {}, getImageData: () => pixels, putImageData } as unknown as CanvasRenderingContext2D);
            const source = Object.assign(document.createElement("canvas"), { width: 4096, height: 1024 });
            const dark = darkenPicture(source) as HTMLCanvasElement;
            expect(dark).not.toBe(source);
            expect([ dark.width, dark.height ]).toEqual([ 2048, 512 ]);
            expect([ ...pixels.data ]).toEqual([ 18, 18, 18, 255, 237, 237, 237, 128, 255, 144, 144, 255 ]);
            expect(putImageData).toHaveBeenCalledOnce();
        });
    });

    it("puts the pages of a PDF on the sheets, under the ink, and shows a sheet for each", async () => {
        const PDF = "api/attachments/abc/open";
        const picture = document.createElement("canvas");
        const slide = { width: 1280, height: 720 };
        const pages = {
            pageCount: 3,
            sizes: [ slide, slide, slide ],
            render: vi.fn(async () => ({ picture, width: 960, height: 540 })),
            destroy: vi.fn()
        };
        const openPdf = vi.fn(async (_url: string): Promise<PdfPages | undefined> => pages);
        const settle = () => new Promise((resolve) => setTimeout(resolve));
        surface.destroy();
        vi.spyOn(container, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 300));
        surface = new InkSurface(container, { onChange, onGesture, onStateChange, openPdf });
        surface.load({ version: 2, paper: "blank", layout: "infinite", strokes: [] });

        expect(await surface.addPdf(PDF)).toBe(true);
        expect(onChange).toHaveBeenCalledOnce();
        expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ pdfs: [ PDF ], layout: "pages" }));
        expect(JSON.parse(surface.serialize())).toMatchObject({ pdfs: [ PDF ], layout: "pages" });
        await settle();
        expect(openPdf).toHaveBeenCalledExactlyOnceWith(PDF);
        expect(surface.getPageCount()).toBe(3);
        // The sheets take the size of the slides, each around the middle of an A4 sheet, and the
        // view fits the width of the first one.
        expect(drawImages).toContainEqual([ picture, -243, 0, 1280, 720 ]);
        expect(JSON.parse(surface.serialize()).sheets).toEqual([ [ 1280, 720, 0, 0 ], [ 1280, 720, 0, 1 ], [ 1280, 720, 0, 2 ] ]);
        surface.showView("content");
        expect(surface.getCenterView().zoom).toBe(336 / 1280);
        // The view is placed on a whole pixel, which is close to four units at this zoom.
        expect(Math.abs(surface.getCenterView().x - 397)).toBeLessThan(2);
        surface.goToPage(2);
        expect(surface.getView().y).toBe(Math.round(32 - 1488 * 336 / 1280));
        surface.goToPage(0);
        // An image fits inside the sheet in view.
        surface.addImage("api/attachments/abc/image/a.png", 4000, 1000);
        expect(JSON.parse(surface.serialize()).objects).toEqual([ expect.objectContaining({ o: "image", x: -243, w: 1280, h: 320 }) ]);
        surface.undo();
        onChange.mockClear();

        // Ink goes over the page, and a note reloaded with the same PDF does not open it again.
        swipe("pen", 1, 100);
        expect(surface.getPageCount()).toBe(3);
        surface.load(parseInkDocument(surface.serialize()));
        await settle();
        expect(openPdf).toHaveBeenCalledOnce();
        expect(surface.getPageCount()).toBe(3);

        // A second PDF goes after the last sheet in use, here the last of the first PDF, and the
        // view moves to its first page. A PDF that cannot be read adds nothing.
        const OTHER = "api/attachments/def/open";
        const BROKEN = "api/attachments/bad/open";
        const notes = {
            pageCount: 1, sizes: [ { width: 600, height: 800 } ],
            render: vi.fn(async () => ({ picture, width: 450, height: 600 })), destroy: vi.fn()
        };
        openPdf.mockImplementation(async (url: string) => (url === OTHER ? notes : url === BROKEN ? undefined : pages));
        expect(await surface.addPdf(BROKEN)).toBe(false);
        expect(await surface.addPdf(OTHER)).toBe(true);
        expect(surface.getPageCount()).toBe(4);
        expect(JSON.parse(surface.serialize())).toMatchObject({
            pdfs: [ PDF, OTHER ],
            sheets: [ [ 1280, 720, 0, 0 ], [ 1280, 720, 0, 1 ], [ 1280, 720, 0, 2 ], [ 600, 800, 1, 0 ] ]
        });
        expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ pdfs: [ PDF, OTHER ], page: 3 }));
        await settle();
        expect(drawImages).toContainEqual([ picture, 97, 3 * 744, 600, 800 ]);

        // Without the first PDF, the note keeps its ink, its sheets at their sizes and the pages
        // of the second PDF on theirs.
        surface.removePdf(PDF);
        expect(pages.destroy).toHaveBeenCalledOnce();
        expect(notes.destroy).not.toHaveBeenCalled();
        expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ pdfs: [ OTHER ], pageCount: 4 }));
        expect(JSON.parse(surface.serialize())).toMatchObject({
            pdfs: [ OTHER ],
            sheets: [ [ 1280, 720 ], [ 1280, 720 ], [ 1280, 720 ], [ 600, 800, 0, 0 ] ]
        });
        expect(parseInkDocument(surface.serialize()).strokes).toHaveLength(1);
    });

    it("adds a PDF after the ink of a note, and gives sheets to a note saved with a PDF and none", async () => {
        const PDF = "api/attachments/abc/open";
        const picture = document.createElement("canvas");
        const slide = { width: 1280, height: 720 };
        const pages = {
            pageCount: 2, sizes: [ slide, slide ],
            render: vi.fn(async () => ({ picture, width: 960, height: 540 })), destroy: vi.fn()
        };
        const openPdf = vi.fn(async () => pages);
        surface.destroy();
        vi.spyOn(container, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 300));
        surface = new InkSurface(container, { onChange, onGesture, onStateChange, openPdf });
        surface.load({ version: 2, paper: "blank", layout: "pages", strokes: [] });

        // The ink is on the first A4 sheet, which stays, and the slides follow it.
        swipe("pen", 1, 100);
        await surface.addPdf(PDF);
        expect(JSON.parse(surface.serialize()).sheets).toEqual([ [ 794, 1123 ], [ 1280, 720, 0, 0 ], [ 1280, 720, 0, 1 ] ]);
        expect(surface.getPageCount()).toBe(3);

        // A PDF that opens after another note was loaded is not added to that note.
        const adding = surface.addPdf("api/attachments/def/open");
        surface.load({ version: 2, paper: "blank", layout: "pages", strokes: [], legacyPdf: PDF });
        // Until the PDF is open, the note names it as it was saved.
        expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ pdfs: [ PDF ] }));
        expect(JSON.parse(surface.serialize())).toMatchObject({ pdf: PDF });
        expect(JSON.parse(surface.serialize())).not.toHaveProperty("sheets");
        onChange.mockClear();
        expect(await adding).toBe(false);
        await new Promise((resolve) => setTimeout(resolve));
        expect(JSON.parse(surface.serialize())).toMatchObject({ pdfs: [ PDF ], sheets: [ [ 1280, 720, 0, 0 ], [ 1280, 720, 0, 1 ] ] });
        expect(JSON.parse(surface.serialize())).not.toHaveProperty("pdf");
        expect(onChange).toHaveBeenCalledOnce();
    });

    it("reports a stroke or an erase for as long as it lasts, the pen resting or not", () => {
        vi.useFakeTimers({ toFake: [ "setInterval", "clearInterval", "setTimeout", "clearTimeout" ] });
        pointer("pointerdown", "pen", 1, 100);
        expect(onGesture).toHaveBeenCalledOnce();
        vi.advanceTimersByTime(2000);
        const whileDown = onGesture.mock.calls.length;
        expect(whileDown).toBeGreaterThanOrEqual(8);
        pointer("pointerup", "pen", 1, 100);
        vi.advanceTimersByTime(2000);
        expect(onGesture).toHaveBeenCalledTimes(whileDown);

        // A pan reports nothing, and an erase that the pointer cancels stops reporting.
        swipe("touch", 2, 100);
        expect(onGesture).toHaveBeenCalledTimes(whileDown);
        pointer("pointerdown", "pen", 3, 100, 50, 32);
        pointer("pointercancel", "pen", 3, 100, 50, 0);
        const afterErase = onGesture.mock.calls.length;
        vi.advanceTimersByTime(2000);
        expect(onGesture).toHaveBeenCalledTimes(afterErase);
    });

    function swipe(type: string, pointerId: number, y: number, buttons = 1) {
        pointer("pointerdown", type, pointerId, y, 50, buttons);
        pointer("pointermove", type, pointerId, y + 20, 50, buttons);
        pointer("pointermove", type, pointerId, y + 40, 50, buttons);
        pointer("pointerup", type, pointerId, y + 40);
    }

    function pointer(kind: string, pointerType: string, pointerId: number, y: number, x = 50, buttons = 1) {
        container.dispatchEvent(new PointerEvent(kind, {
            pointerId, pointerType, clientX: x, clientY: y, button: 0,
            buttons: kind === "pointerup" ? 0 : buttons, pressure: 0.5, bubbles: true
        }));
    }
});

/**
 * A 2D context whose methods do nothing, as happy-dom draws no canvas, except that `fillRect()`
 * calls are recorded in `fillRects` with their `fillStyle` in `fillRectStyles`, and the `fillStyle`
 * of `fill()` calls in `fills`.
 */
function stubContext(fillRects: number[][], fillRectStyles: unknown[], fills: unknown[], drawImages: unknown[][]) {
    const target: Record<string | symbol, unknown> = { globalAlpha: 1 };
    target.drawImage = (...args: unknown[]) => drawImages.push(args);
    target.fillRect = (x: number, y: number, width: number, height: number) => {
        fillRects.push([ x, y, width, height, target.globalAlpha as number ]);
        fillRectStyles.push(target.fillStyle);
    };
    target.fill = () => fills.push(target.fillStyle);
    return new Proxy(target, {
        get: (object, key) => (key in object ? object[key] : (object[key] = () => {})),
        set: (object, key, value) => {
            object[key] = value;
            return true;
        }
    }) as unknown as CanvasRenderingContext2D;
}

function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
}
