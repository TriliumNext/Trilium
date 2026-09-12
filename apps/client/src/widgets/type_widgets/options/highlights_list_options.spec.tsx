import { describe, expect, it, vi } from "vitest";

import { renderInto } from "../../../test/render";

const mocks = vi.hoisted(() => ({
    stored: [] as string[],
    saved: [] as string[][]
}));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useTriliumOptionJson: () => [ mocks.stored, (value: string[]) => void mocks.saved.push(value) ]
}));

import { HIGHLIGHT_FORMATS, HighlightsListOptions } from "./highlights_list_options";

describe("the highlights list options", () => {
    it("offers every format the list can be told to count, in the toolbar's own order", () => {
        mocks.stored = [];
        const boxes = [ ...renderInto(<HighlightsListOptions />).querySelectorAll<HTMLInputElement>("input") ];

        expect(boxes.map((box) => box.value)).toEqual(HIGHLIGHT_FORMATS.map(({ val }) => val));
        expect(boxes.every((box) => !box.checked)).toBe(true);
    });

    it("ticks the formats already counted, and adds the one that was ticked", () => {
        mocks.stored = [ "bold" ];
        mocks.saved = [];
        const boxes = [ ...renderInto(<HighlightsListOptions />).querySelectorAll<HTMLInputElement>("input") ];

        expect(boxes.filter((box) => box.checked).map((box) => box.value)).toEqual([ "bold" ]);

        const italic = boxes.find((box) => box.value === "italic");
        italic?.dispatchEvent(new Event("change", { bubbles: true }));
        expect(mocks.saved.at(-1)).toEqual([ "bold", "italic" ]);
    });
});

describe("the formats themselves", () => {
    it("gives each one an icon and a title, since the sidebar's menu shows both", () => {
        for (const format of HIGHLIGHT_FORMATS) {
            expect(format.val, "every format is named").toBeTruthy();
            expect(format.icon, `${format.val} has an icon`).toMatch(/^bx /);
            // Held as keys rather than resolved, a module-level `t()` running before the
            // translations have loaded.
            expect(format.titleKey, `${format.val} has a title key`).toMatch(/^highlights_list\./);
        }
    });
});
