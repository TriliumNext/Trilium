import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTO_COLOR, createStroke, parseInkDocument } from "./ink_document";
import InkSurface from "./ink_surface";

describe("ink surface input", () => {
    let container: HTMLDivElement;
    let surface: InkSurface;
    const onChange = vi.fn();
    const onStateChange = vi.fn();
    /** `[x, y, width, height, globalAlpha]` of each `fillRect()` call on any canvas. */
    const fillRects: number[][] = [];
    /** The `fillStyle` of each `fill()` call on any canvas. */
    const fills: unknown[] = [];

    beforeEach(() => {
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => stubContext(fillRects, fills));
        vi.stubGlobal("Path2D", class { moveTo() {} quadraticCurveTo() {} closePath() {} });
        vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
        Element.prototype.setPointerCapture ??= () => {};
        container = document.createElement("div");
        document.body.append(container);
        onChange.mockReset();
        onStateChange.mockReset();
        surface = new InkSurface(container, { onChange, onGestureStart: () => {}, onStateChange });
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
        surface = new InkSurface(container, { onChange, onGestureStart: () => {}, onStateChange: () => {} });
        fillRects.length = 0;
        surface.load({ paper: "ruled", layout: "infinite", strokes: [] });
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
        surface = new InkSurface(container, { onChange, onGestureStart: () => {}, onStateChange: () => {} });
        surface.load({ paper: "ruled", layout: "infinite", strokes: [] });

        surface.showView({ x: 10, y: 20, zoom: 2 });
        expect(surface.getView()).toEqual({ zoom: 2, x: 180, y: 110 });
        expect(surface.getCenterView()).toEqual({ x: 10, y: 20, zoom: 2 });

        // An empty note shows its origin at the top left, at 100%.
        surface.showView("content");
        expect(surface.getView()).toEqual({ zoom: 1, x: 0, y: 0 });

        // The stroke and its width of 4 on each side span 1008 by 508, which fit at 1/3 with
        // 32 px to spare on each side of the width.
        const stroke = createStroke({
            tool: "pen", color: AUTO_COLOR, size: 4, simulatePressure: false,
            points: [ 1000, 1000, 0.5, 2000, 1500, 0.5 ], order: 0
        });
        surface.load({ paper: "ruled", layout: "infinite", strokes: [ stroke ] });
        surface.showView("content");
        // The origin lies on a whole pixel, which is 3 world units at this zoom.
        const view = surface.getCenterView();
        expect(Math.abs(view.x - 1500)).toBeLessThanOrEqual(1.5);
        expect(Math.abs(view.y - 1250)).toBeLessThanOrEqual(1.5);
        expect(view.zoom).toBeCloseTo(336 / 1008);

        // A small drawing is not enlarged.
        surface.load({ paper: "ruled", layout: "infinite", strokes: [ createStroke({ ...stroke, points: [ 0, 0, 0.5, 10, 10, 0.5 ] }) ] });
        surface.showView("content");
        expect(surface.getView().zoom).toBe(1);
    });

    it("shows pages up to an empty one after the last ink, and fits their width", () => {
        surface.destroy();
        vi.spyOn(container, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 300));
        surface = new InkSurface(container, { onChange, onGestureStart: () => {}, onStateChange: () => {} });
        surface.load({ paper: "blank", layout: "pages", strokes: [] });
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
        surface.load({ paper: "blank", layout: "pages", strokes: [ onPageTwo ] });
        expect(surface.getPageCount()).toBe(3);

        // Writing on the first page of an empty note adds a second, and undoing it takes it away.
        surface.load({ paper: "blank", layout: "pages", strokes: [] });
        swipe("pen", 2, 100);
        expect(surface.getPageCount()).toBe(2);
        surface.undo();
        expect(surface.getPageCount()).toBe(1);
        surface.redo();
        expect(surface.getPageCount()).toBe(2);

        // The paper's sheet is filled where the view puts the page, and nothing below the last one.
        fillRects.length = 0;
        surface.showView({ x: 397, y: 0, zoom: 0.25 });
        const sheets = fillRects.filter(([ , , width, height, alpha ]) => alpha === 1 && width === 199 && height < 300);
        expect(sheets.map(([ x, y, , height ]) => [ x, y, height ])).toEqual([ [ 101, 150, 281 ] ]);
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
        surface = new InkSurface(container, { onChange, onGestureStart: () => {}, onStateChange });
        const stroke = createStroke({
            tool: "pen", color: AUTO_COLOR, size: 3, simulatePressure: false,
            points: [ 10, 10, 0.5, 60, 10, 0.5 ], order: 0
        });
        surface.load({ paper: "ruled", layout: "infinite", strokes: [ stroke ] });
        expect(fills).toContain("rgb(0, 0, 0)");

        container.style.color = "rgb(240, 240, 240)";
        container.style.backgroundColor = "rgb(20, 20, 20)";
        fills.length = 0;
        fillRects.length = 0;
        surface.refreshTheme();
        expect(fills).toEqual([ "rgb(240, 240, 240)" ]);
        expect(fillRects[0]).toEqual([ 0, 0, 400, 300, 1 ]);

        // The stroke being drawn takes the new color as well.
        surface.load({ paper: "ruled", layout: "infinite", strokes: [] });
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
 * calls are recorded in `fillRects` and the `fillStyle` of `fill()` calls in `fills`.
 */
function stubContext(fillRects: number[][], fills: unknown[]) {
    const target: Record<string | symbol, unknown> = { globalAlpha: 1 };
    target.fillRect = (x: number, y: number, width: number, height: number) => {
        fillRects.push([ x, y, width, height, target.globalAlpha as number ]);
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
