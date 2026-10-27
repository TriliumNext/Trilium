import type { ColorMenuRequest } from "@triliumnext/ckeditor5";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createColorMenuHost } from "./color_menu";
import { buildFontColorConfig } from "./color_palette";

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

describe("createColorMenuHost", () => {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    let host = createColorMenuHost();
    afterEach(() => {
        host.destroy();
        host = createColorMenuHost();
    });

    function show(colors: Pick<ColorMenuRequest, "fontColor" | "fontBackgroundColor">) {
        const setColor = vi.fn<ColorMenuRequest["setColor"]>(() => host.hide());
        const setElement = vi.fn<ColorMenuRequest["setElement"]>();
        const onClose = vi.fn<ColorMenuRequest["onClose"]>();
        host.show({ anchor, ...colors, setColor, setElement, onClose });

        const menu = document.querySelector<HTMLElement>(".tn-popup.tn-menu");
        if (!menu) throw new Error("expected the menu to render");
        const pickers = [ ...menu.querySelectorAll<HTMLElement>(".color-picker") ];
        return { menu, pickers, setColor, setElement, onClose };
    }

    it("shows a row of the editor's swatches for the text and one for its background, each with its color selected", () => {
        const { menu, pickers, setElement } = show({ fontColor: "#e64d4d", fontBackgroundColor: null });

        expect(setElement).toHaveBeenCalledWith(menu);
        expect([ ...menu.querySelectorAll(".dropdown-header") ].map((header) => header.textContent)).toEqual([
            "text-editor.color-menu.text-color",
            "text-editor.color-menu.background-color"
        ]);
        expect(pickers).toHaveLength(2);

        const swatches = buildFontColorConfig().fontColor.colors.map(({ color }) => color);
        const [ text, background ] = pickers;
        expect([ ...text.querySelectorAll<HTMLElement>(".color-cell:not(.color-cell-reset, .custom-color-cell)") ]
            .map((cell) => cell.style.getPropertyValue("--color"))).toEqual(swatches);
        expect(text.querySelector(".color-cell.selected")?.getAttribute("style")).toContain("#e64d4d");
        expect(background.querySelector(".color-cell.selected")?.classList).toContain("color-cell-reset");
    });

    it("sets the color of the row a swatch is in, and removes it from the clear cell", () => {
        const first = show({ fontColor: null, fontBackgroundColor: null });
        first.pickers[1]?.querySelector<HTMLElement>(".color-cell[style*='#4de64d']")?.click();
        expect(first.setColor).toHaveBeenCalledExactlyOnceWith("fontBackgroundColor", "#4de64d");
        expect(first.menu.isConnected).toBe(false);
        expect(first.onClose).not.toHaveBeenCalled();

        const second = show({ fontColor: "#e64d4d", fontBackgroundColor: null });
        second.pickers[0]?.querySelector<HTMLElement>(".color-cell-reset")?.click();
        expect(second.setColor).toHaveBeenCalledExactlyOnceWith("fontColor", null);
    });

    it("opens the picker from the custom cell holding the color of the text, keeping the menu", async () => {
        const pick = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
        try {
            const { menu, pickers, setColor } = show({ fontColor: "#123456", fontBackgroundColor: null });
            const cell = pickers[0]?.querySelector<HTMLElement>(".custom-color-cell.selected");
            if (!cell) throw new Error("expected the custom cell to be selected");
            await vi.waitFor(() => expect(cell.style.getPropertyValue("--color")).toBe("#123456"));
            cell.click();

            expect(setColor).not.toHaveBeenCalled();
            expect(menu.isConnected).toBe(true);
            expect(pick.mock.contexts).toEqual([ cell.querySelector("input[type=color]") ]);
        } finally {
            pick.mockRestore();
        }
    });

    it("returns focus to the button on Escape, and not on a press elsewhere", () => {
        const escaped = show({ fontColor: null, fontBackgroundColor: null });
        escaped.menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        expect(escaped.onClose).toHaveBeenCalledExactlyOnceWith(true);
        expect(escaped.menu.isConnected).toBe(false);

        const dismissed = show({ fontColor: null, fontBackgroundColor: null });
        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        expect(dismissed.onClose).toHaveBeenCalledExactlyOnceWith(false);
        expect(dismissed.setElement).toHaveBeenLastCalledWith(null);
    });
});
