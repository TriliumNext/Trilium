import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubTextLayout } from "../../../test/text_layout";
import TextBoxMeasurer, { drawTextBox } from "./ink_text";

describe("TextBoxMeasurer", () => {
    let layer: HTMLElement;
    let restore: () => void = () => {};
    const box = { id: "a", order: 0, x: 100, y: 200, width: 80, html: "<p>alpha <strong>beta</strong></p>" };

    function addElement(id: string, html: string) {
        const element = document.createElement("div");
        element.dataset.boxId = id;
        element.innerHTML = html;
        Object.defineProperty(element, "offsetHeight", { value: 40 });
        layer.append(element);
        return element;
    }

    beforeEach(() => {
        layer = document.createElement("div");
        document.body.append(layer);
    });

    afterEach(() => {
        restore();
        restore = () => {};
        layer.remove();
    });

    it("reads the text of a box where it is laid out, each run in its own font and color", () => {
        // "alpha" on the first line and the bold "beta", in a color of its own, on the second.
        const element = addElement("a", `<p style="font: 16px serif">alpha <strong style="font: bold 16px serif; color: rgb(255, 0, 0)">beta</strong></p>`);
        restore = stubTextLayout(element, [ 6 ]);
        const [ measured ] = new TextBoxMeasurer(() => layer).measure([ box ]);

        expect(measured.bounds).toEqual({ minX: 100, minY: 200, maxX: 180, maxY: 240 });
        expect(measured.runs.map(({ text, x, y }) => [ text, x, y ])).toEqual([ [ "alpha", 100, 208 ], [ "beta", 100, 228 ] ]);
        const [ plain, bold ] = measured.runs;
        expect(plain.font).toContain("16px");
        expect(plain.color).toBeUndefined();
        expect(bold.font).toMatch(/bold|700/);
        expect(bold.color).toBe("rgb(255, 0, 0)");

        // The text of the theme takes the color it is drawn with, and the other text its own.
        const fillText = vi.fn();
        const ctx = { fillText, font: "", fillStyle: "", textBaseline: "" };
        const fills: string[] = [];
        fillText.mockImplementation(() => fills.push(ctx.fillStyle));
        drawTextBox(ctx as unknown as CanvasRenderingContext2D, measured, "#000");
        expect(fillText.mock.calls).toEqual([ [ "alpha", 100, 208 ], [ "beta", 100, 228 ] ]);
        expect(fills).toEqual([ "#000", "rgb(255, 0, 0)" ]);
        expect(ctx.textBaseline).toBe("middle");
    });

    it("reads a box again only once its text, its width or its font size has changed", () => {
        const element = addElement("a", "<p>alpha</p>");
        restore = stubTextLayout(element);
        const layout = vi.spyOn(Range.prototype, "getClientRects");
        const measurer = new TextBoxMeasurer(() => layer);

        measurer.measure([ box ]);
        expect(layout).toHaveBeenCalledOnce();
        // A box that only moved keeps its text, at its new place.
        const [ moved ] = measurer.measure([ { ...box, x: 300, y: 50 } ]);
        expect(layout).toHaveBeenCalledOnce();
        expect(moved.bounds).toMatchObject({ minX: 300, minY: 50 });
        expect(moved.runs[0]).toMatchObject({ text: "alpha", x: 300, y: 58 });

        measurer.measure([ { ...box, html: "<p>alpha!</p>" } ]);
        measurer.measure([ { ...box, html: "<p>alpha!</p>", width: 120 } ]);
        measurer.measure([ { ...box, html: "<p>alpha!</p>", width: 120, fontSize: 20 } ]);
        expect(layout).toHaveBeenCalledTimes(4);

        // A box that is gone is forgotten, and read again when it comes back.
        measurer.measure([]);
        measurer.measure([ { ...box, html: "<p>alpha!</p>", width: 120, fontSize: 20 } ]);
        expect(layout).toHaveBeenCalledTimes(5);
    });

    it("leaves out a box without text, without an element or that is not laid out", () => {
        addElement("empty", "<p></p>");
        addElement("hidden", "<p>not laid out</p>");
        const measurer = new TextBoxMeasurer(() => layer);
        expect(measurer.measure([
            { ...box, id: "empty", html: "<p></p>" },
            { ...box, id: "missing" },
            { ...box, id: "hidden" }
        ])).toEqual([]);
        expect(new TextBoxMeasurer(() => null).measure([ box ])).toEqual([]);
    });
});
