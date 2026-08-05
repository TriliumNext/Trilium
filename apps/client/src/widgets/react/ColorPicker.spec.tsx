import { ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `isMobile()` is read at render time inside CustomColorCell; mock the module so both the
// desktop (no handler) and mobile (stopPropagation) branches can be exercised.
const isMobileMock = vi.fn(() => false);
vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    isMobile: () => isMobileMock()
}));

import { renderInto } from "../../test/render";
import ColorPicker, { DEFAULT_COLOR_PALETTE, tryParseColor } from "./ColorPicker";

/**
 * Mounts a `ColorPicker` inside `act()` so the mount effects run — in particular the one that
 * constructs the `Debouncer` behind the native colour input. Rendering outside `act()` leaves that
 * effect pending, and input changes are then silently dropped.
 */
async function renderColorPicker(vnode: ComponentChild) {
    let container: HTMLElement | undefined;
    await act(async () => {
        container = renderInto(vnode);
    });
    if (!container) throw new Error("render produced no container");
    return container;
}

function cells(container: HTMLElement) {
    return Array.from(container.querySelectorAll<HTMLElement>(".color-cell"));
}

function presetCells(container: HTMLElement) {
    return cells(container).filter((cell) =>
        !cell.classList.contains("color-cell-reset") && !cell.classList.contains("custom-color-cell"));
}

function resetCell(container: HTMLElement) {
    return container.querySelector<HTMLElement>(".color-cell-reset");
}

function customCell(container: HTMLElement) {
    return container.querySelector<HTMLElement>(".custom-color-cell");
}

describe("tryParseColor", () => {
    it("parses valid colors and returns null for invalid input", () => {
        expect(tryParseColor("#ff0000")?.hex().toLowerCase()).toBe("#ff0000");
        expect(tryParseColor("red")?.hex().toLowerCase()).toBe("#ff0000");

        // The invalid branch logs via console.error; silence it so the run stays clean.
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        expect(tryParseColor("definitely-not-a-color")).toBeNull();
        expect(consoleError).toHaveBeenCalled();
        consoleError.mockRestore();
    });
});

describe("ColorPicker", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isMobileMock.mockReturnValue(false);
    });

    it("renders a reset cell, one cell per preset and a custom cell", () => {
        const container = renderInto(<ColorPicker currentValue={null} onChange={vi.fn()} />);

        expect(container.querySelector(".color-picker")).not.toBeNull();
        expect(resetCell(container)).not.toBeNull();
        expect(customCell(container)).not.toBeNull();
        expect(presetCells(container)).toHaveLength(DEFAULT_COLOR_PALETTE.length);
        // Each preset drives its swatch colour through the `--color` custom property.
        expect(presetCells(container)[0].getAttribute("style")).toContain(DEFAULT_COLOR_PALETTE[0]);
    });

    it("accepts a custom preset list and an extra class name", () => {
        const container = renderInto(
            <ColorPicker currentValue={null} onChange={vi.fn()} presets={["#111111", "#222222"]} className="extra" />);

        expect(container.querySelector(".color-picker")?.classList.contains("extra")).toBe(true);
        expect(presetCells(container)).toHaveLength(2);
    });

    it("marks the reset cell selected when there is no colour", () => {
        const container = renderInto(<ColorPicker currentValue={null} onChange={vi.fn()} />);

        expect(resetCell(container)?.classList.contains("selected")).toBe(true);
        expect(presetCells(container).some((cell) => cell.classList.contains("selected"))).toBe(false);
    });

    it("marks the matching preset selected, normalising the incoming colour", () => {
        // Given in a different notation and casing than the palette entry it must match.
        const container = renderInto(<ColorPicker currentValue="RGB(230, 77, 77)" onChange={vi.fn()} />);

        const selected = presetCells(container).filter((cell) => cell.classList.contains("selected"));
        expect(selected).toHaveLength(1);
        expect(selected[0].getAttribute("style")).toContain(DEFAULT_COLOR_PALETTE[0]);
        expect(resetCell(container)?.classList.contains("selected")).toBe(false);
        // A colour that is in the palette is not "custom".
        expect(customCell(container)?.classList.contains("selected")).toBe(false);
    });

    it("keeps the alpha channel when matching translucent presets", () => {
        // A palette may be translucent (the mind map tints node backgrounds this way), so the
        // alpha must survive normalisation — otherwise every entry collapses onto its opaque hue.
        const presets = ["#e64d4d40", "#4d99e640"];
        const container = renderInto(<ColorPicker currentValue="RGBA(230, 77, 77, 0.251)" onChange={vi.fn()} presets={presets} />);

        const selected = presetCells(container).filter((cell) => cell.classList.contains("selected"));
        expect(selected).toHaveLength(1);
        expect(selected[0].getAttribute("style")).toContain(presets[0]);
        expect(customCell(container)?.classList.contains("selected")).toBe(false);

        // The opaque hue is a different colour, and belongs to no preset in this palette.
        const opaque = renderInto(<ColorPicker currentValue="#e64d4d" onChange={vi.fn()} presets={presets} />);
        expect(presetCells(opaque).some((cell) => cell.classList.contains("selected"))).toBe(false);
        expect(customCell(opaque)?.classList.contains("selected")).toBe(true);
    });

    it("marks the custom cell selected for a colour outside the palette", () => {
        const container = renderInto(<ColorPicker currentValue="#123456" onChange={vi.fn()} />);

        expect(customCell(container)?.classList.contains("selected")).toBe(true);
        expect(presetCells(container).some((cell) => cell.classList.contains("selected"))).toBe(false);
    });

    it("treats an unparseable current value as no colour", () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const container = renderInto(<ColorPicker currentValue="not-a-color" onChange={vi.fn()} />);
        consoleError.mockRestore();

        expect(resetCell(container)?.classList.contains("selected")).toBe(true);
    });

    it("selects nothing at all when indeterminate, but still reports picks", () => {
        // Several targets that disagree: neither the matching preset, the reset cell nor the custom
        // cell may claim to hold the answer.
        const onChange = vi.fn();
        const inPalette = renderInto(<ColorPicker currentValue={DEFAULT_COLOR_PALETTE[0]} onChange={onChange} indeterminate />);
        expect(cells(inPalette).some((cell) => cell.classList.contains("selected"))).toBe(false);

        const outsidePalette = renderInto(<ColorPicker currentValue="#123456" onChange={onChange} indeterminate />);
        expect(cells(outsidePalette).some((cell) => cell.classList.contains("selected"))).toBe(false);

        const unset = renderInto(<ColorPicker currentValue={null} onChange={onChange} indeterminate />);
        expect(cells(unset).some((cell) => cell.classList.contains("selected"))).toBe(false);

        presetCells(unset)[1].click();
        expect(onChange).toHaveBeenCalledWith(DEFAULT_COLOR_PALETTE[1]);
    });

    it("uses the caller's tooltips when given", () => {
        const container = renderInto(
            <ColorPicker currentValue={null} onChange={vi.fn()} tooltips={{ clear: "Wipe it", set: "Paint it", setCustom: "Pick it" }} />);

        expect(resetCell(container)?.title).toBe("Wipe it");
        expect(presetCells(container)[0].title).toBe("Paint it");
        expect(customCell(container)?.title).toBe("Pick it");
    });

    it("reports the picked preset colour and null when cleared", () => {
        const onChange = vi.fn();
        const container = renderInto(<ColorPicker currentValue={null} onChange={onChange} />);

        presetCells(container)[2].click();
        expect(onChange).toHaveBeenLastCalledWith(DEFAULT_COLOR_PALETTE[2]);

        resetCell(container)?.click();
        expect(onChange).toHaveBeenLastCalledWith(null);
    });

    it("marks cells disabled and swallows clicks when disabled", () => {
        const onChange = vi.fn();
        const container = renderInto(<ColorPicker currentValue={null} onChange={onChange} disabled />);

        expect(cells(container).every((cell) => cell.classList.contains("disabled-color-cell"))).toBe(true);
        expect(container.querySelector<HTMLInputElement>("input[type=color]")?.disabled).toBe(true);

        presetCells(container)[0].click();
        resetCell(container)?.click();
        expect(onChange).not.toHaveBeenCalled();
    });

    it("debounces the native colour input and reports the picked value once", async () => {
        vi.useFakeTimers();
        try {
            const onChange = vi.fn();
            const container = await renderColorPicker(<ColorPicker currentValue={null} onChange={onChange} />);
            const input = container.querySelector<HTMLInputElement>("input[type=color]");
            expect(input).not.toBeNull();
            if (!input) return;

            // Two rapid changes within the debounce interval collapse into a single report.
            await act(async () => {
                input.value = "#aabbcc";
                input.dispatchEvent(new Event("change", { bubbles: true }));
                input.value = "#ddeeff";
                input.dispatchEvent(new Event("change", { bubbles: true }));
            });
            expect(onChange).not.toHaveBeenCalled();

            await act(async () => { vi.advanceTimersByTime(250); });
            expect(onChange).toHaveBeenCalledTimes(1);
            expect(onChange).toHaveBeenCalledWith("#ddeeff");
        } finally {
            vi.useRealTimers();
        }
    });

    it("re-reports the already picked custom colour when the custom cell is clicked again", async () => {
        vi.useFakeTimers();
        try {
            const onChange = vi.fn();
            const container = await renderColorPicker(<ColorPicker currentValue={null} onChange={onChange} />);
            const input = container.querySelector<HTMLInputElement>("input[type=color]");
            if (!input) return;

            await act(async () => {
                input.value = "#aabbcc";
                input.dispatchEvent(new Event("change", { bubbles: true }));
            });
            await act(async () => { vi.advanceTimersByTime(250); });
            onChange.mockClear();

            // The cell's handler re-opens the native picker via `input.click()`. Under happy-dom
            // that click bubbles back up to the same cell and recurses, so stub it out — the
            // behaviour under test is the re-emission, not the native dialog.
            const nativeClick = vi.spyOn(input, "click").mockImplementation(() => {});

            // Clicking the cell after a colour was picked re-emits it (rather than only
            // re-opening the native picker).
            await act(async () => { customCell(container)?.click(); });
            expect(onChange).toHaveBeenCalledWith("#aabbcc");
            expect(nativeClick).toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it("stops click propagation on the custom cell only on mobile", () => {
        isMobileMock.mockReturnValue(true);
        const mobileContainer = renderInto(<ColorPicker currentValue={null} onChange={vi.fn()} />);
        const mobileWrapper = mobileContainer.querySelector(".custom-color-cell")?.parentElement;
        const mobileEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
        const mobileStop = vi.spyOn(mobileEvent, "stopPropagation");
        mobileWrapper?.dispatchEvent(mobileEvent);
        expect(mobileStop).toHaveBeenCalled();

        isMobileMock.mockReturnValue(false);
        const desktopContainer = renderInto(<ColorPicker currentValue={null} onChange={vi.fn()} />);
        const desktopWrapper = desktopContainer.querySelector(".custom-color-cell")?.parentElement;
        const desktopEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
        const desktopStop = vi.spyOn(desktopEvent, "stopPropagation");
        desktopWrapper?.dispatchEvent(desktopEvent);
        expect(desktopStop).not.toHaveBeenCalled();
    });

    it("derives a contrasting foreground for light and dark custom colours", () => {
        // Light background -> black foreground; dark background -> white.
        const light = renderInto(<ColorPicker currentValue="#eeeeee" onChange={vi.fn()} />);
        const lightWrapper = light.querySelector(".custom-color-cell")?.parentElement;
        expect(lightWrapper?.getAttribute("style")?.toLowerCase()).toContain("#000000");

        const dark = renderInto(<ColorPicker currentValue="#111111" onChange={vi.fn()} />);
        const darkWrapper = dark.querySelector(".custom-color-cell")?.parentElement;
        expect(darkWrapper?.getAttribute("style")?.toLowerCase()).toContain("#ffffff");

        // No colour at all falls back to `inherit`.
        const none = renderInto(<ColorPicker currentValue={null} onChange={vi.fn()} />);
        const noneWrapper = none.querySelector(".custom-color-cell")?.parentElement;
        expect(noneWrapper?.getAttribute("style")).toContain("inherit");
    });
});
