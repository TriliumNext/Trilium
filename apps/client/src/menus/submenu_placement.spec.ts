import { beforeEach, describe, expect, it } from "vitest";

import { repositionSubmenu } from "./submenu_placement";

describe("repositionSubmenu", () => {
    beforeEach(() => {
        Object.defineProperty(document.documentElement, "clientHeight",
            { value: 800, configurable: true });
        Object.defineProperty(document.documentElement, "clientWidth",
            { value: 1000, configurable: true });
    });

    it("flips a submenu up only where it overflows the bottom and fits above", () => {
        expect(buildSubmenu({ top: 700, height: 200 }).contains("submenu-flip-up")).toBe(true);
        expect(buildSubmenu({ top: 300, height: 200 }).contains("submenu-flip-up")).toBe(false);
        expect(buildSubmenu({ top: 300, height: 600 }).contains("submenu-flip-up")).toBe(false);

        const stale = buildSubmenu({ top: 300, height: 200 }, "submenu-flip-up submenu-flip-start");
        expect([ ...stale ]).toEqual([]);
    });

    it("flips a submenu sideways only where it overflows one side and fits on the other", () => {
        expect(buildSubmenu({ left: 910, width: 300 }).contains("submenu-flip-start")).toBe(true);
        expect(buildSubmenu({ left: -100, width: 300 }).contains("submenu-flip-start")).toBe(true);
        expect(buildSubmenu({ left: 500, width: 300 }).contains("submenu-flip-start")).toBe(false);
        expect(buildSubmenu({ left: 910, width: 950 }).contains("submenu-flip-start")).toBe(false);
    });
});

interface Box {
    top?: number;
    height?: number;
    left?: number;
    width?: number;
}

// happy-dom does not lay out, so each case stubs `getBoundingClientRect()`.
function buildSubmenu({ top = 10, height = 100, left = 100, width = 200 }: Box, className = "") {
    const submenu = document.createElement("ul");
    submenu.className = className;
    Object.defineProperty(submenu, "getBoundingClientRect", {
        value: () => ({ top, height, bottom: top + height, left, width, right: left + width })
    });
    repositionSubmenu(submenu);
    return submenu.classList;
}
