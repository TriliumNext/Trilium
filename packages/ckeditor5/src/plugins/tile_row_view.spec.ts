import { ButtonView, keyCodes, Locale } from "ckeditor5";
import editorStylesheetUrl from "ckeditor5/ckeditor5.css?url";
import { beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";

import TileRowView from "./tile_row_view.js";

/** Builds a row of groups with the given lengths, each tile labeled by its position in the row. */
function createRow(lengths: number[], locale = new Locale()) {
    let position = 0;
    const groups = lengths.map(length => Array.from({ length }, () => {
        const tile = new ButtonView(locale);
        tile.set({ label: String(position++) });
        return tile;
    }));
    const row = new TileRowView(locale, groups, "Tiles");
    row.render();
    const element = row.element as HTMLElement;
    document.body.appendChild(element);
    onTestFinished(() => {
        element.remove();
        row.destroy();
    });
    return row;
}

function focusedLabel(row: TileRowView) {
    return row.tiles.find(tile => tile.element === document.activeElement)?.label;
}

/** Focuses the tile with the label, presses the key and returns the label focused after. */
function move(row: TileRowView, from: string, keyCode: number) {
    row.tiles.find(tile => tile.label === from)?.focus();
    expect(focusedLabel(row)).toBe(from);
    const event = new KeyboardEvent("keydown", { keyCode, bubbles: true, cancelable: true });
    document.activeElement?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    return focusedLabel(row);
}

describe("TileRowView", () => {
    beforeAll(() => new Promise<void>((resolve, reject) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = editorStylesheetUrl;
        link.onload = () => resolve();
        link.onerror = () => reject(new Error("the editor stylesheet did not load"));
        document.head.appendChild(link);
    }));

    it("lays out every tile as a square on one row, styled as the list style grid", () => {
        const row = createRow([2, 3, 1]);
        const element = row.element as HTMLElement;
        expect(element.classList).toContain("ck-list-styles-list");
        expect(element.getAttribute("aria-label")).toBe("Tiles");

        const boxes = [...row.tiles].map(tile =>
            (tile.element as HTMLElement).getBoundingClientRect());
        expect(new Set(boxes.map(box => box.top)).size).toBe(1);
        expect(boxes[0].width).toBeCloseTo(boxes[0].height, 0);

        const columnGap = parseFloat(getComputedStyle(element).columnGap);
        expect(columnGap).toBeGreaterThan(0);
        expect(columnGap).toBeLessThan(20);
        const groupStarts = [2, 5];
        for (const [index, box] of boxes.entries()) {
            if (index > 0) {
                const expected = groupStarts.includes(index) ? 20 : columnGap;
                expect(box.left - boxes[index - 1].right, `before ${index}`).toBeCloseTo(expected, 1);
            }
        }
    });

    it("focuses the tile that is on, or else the first one", () => {
        const row = createRow([3]);
        row.focus();
        expect(focusedLabel(row)).toBe("0");

        (row.tiles.get(2) as ButtonView).isOn = true;
        row.focus();
        expect(focusedLabel(row)).toBe("2");
    });

    it("moves with the left and right arrows, wrapping at the ends", () => {
        const row = createRow([3]);

        expect(move(row, "0", keyCodes.arrowright)).toBe("1");
        expect(move(row, "2", keyCodes.arrowright)).toBe("0");
        expect(move(row, "0", keyCodes.arrowleft)).toBe("2");
        expect(move(row, "1", keyCodes.arrowdown)).toBe("1");
    });

    it("swaps the left and right arrows in a right-to-left interface", () => {
        const row = createRow([3], new Locale({ uiLanguage: "ar" }));

        expect(move(row, "1", keyCodes.arrowright)).toBe("0");
        expect(move(row, "1", keyCodes.arrowleft)).toBe("2");
    });

    it("passes on the execute event of its tiles", () => {
        const row = createRow([2]);
        const execute = vi.fn();
        row.on("execute", execute);

        row.tiles.last?.fire("execute");

        expect(execute).toHaveBeenCalledOnce();
        expect(execute.mock.calls[0][0].source).toBe(row.tiles.last);
    });
});
