/**
 * The bar of editing actions over a geo map (see EditToolbar.tsx). What is checked of each button
 * is that a press arms the map and a press on an armed one stands it down, that an armed mode is
 * worn as held down, and that a map that may not be edited refuses them all.
 */
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import { renderInto } from "../../../test/render";
import type { DrawTool } from "./DrawShape";
import EditToolbar from "./EditToolbar";
import { ParentMap } from "./map";

/** Builds the bar over a map, which it asks nothing more of than being there at all. */
function renderBar({ map = {} as never, isReadOnly = false, placing = false, drawingTool = null as DrawTool | null } = {}) {
    const onTogglePlacement = vi.fn();
    const onToggleDrawing = vi.fn();
    const onAddGpxTrack = vi.fn();
    let container: HTMLElement | undefined;
    act(() => {
        container = renderInto(
            <ParentMap.Provider value={map}>
                <EditToolbar isReadOnly={isReadOnly} placing={placing} onTogglePlacement={onTogglePlacement} drawingTool={drawingTool} onToggleDrawing={onToggleDrawing} onAddGpxTrack={onAddGpxTrack} />
            </ParentMap.Provider>
        );
    });
    if (!container) throw new Error("the toolbar was not rendered");

    const all = () => [ ...container?.querySelectorAll<HTMLButtonElement>(".geo-edit-toolbar button") ?? [] ];
    return {
        onTogglePlacement,
        onToggleDrawing,
        onAddGpxTrack,
        buttons: all,
        /** The first button, which is the +. */
        button: () => all()[0] ?? null,
        /** The drawing tools, one button per tool, standing between the + and the GPX button. */
        drawButton: (icon: string) => all().find((b) => b.classList.contains(icon)) ?? null,
        gpxButton: () => all()[all().length - 1] ?? null
    };
}

/** Every drawing tool on the bar, by the icon its button wears. */
const DRAW_TOOL_ICONS: { tool: DrawTool; icon: string }[] = [
    { tool: "line", icon: "bx-vector" },
    { tool: "polygon", icon: "bx-shape-polygon" },
    { tool: "rectangle", icon: "bx-rectangle" }
];

describe("geo map EditToolbar", () => {
    it("offers to add a note, and hands the arming to the map view", () => {
        const { button, onTogglePlacement } = renderBar();

        // The glyph is a child of the button rather than the button's own class — the words beside
        // it are to stay words — and it is the pin a dropped note wears (see EditToolbar.tsx).
        expect(button()?.querySelector(".bx-pin")).not.toBeNull();
        expect(button()?.classList.contains("active")).toBe(false);

        act(() => button()?.click());
        expect(onTogglePlacement).toHaveBeenCalledTimes(1);
    });

    it("wears an armed map as held down, and the same press stands it down", () => {
        const { button, onTogglePlacement } = renderBar({ placing: true });

        expect(button()?.classList.contains("active")).toBe(true);

        act(() => button()?.click());
        expect(onTogglePlacement).toHaveBeenCalledTimes(1);
    });

    it("offers every drawing tool, wears the armed one as held down, and hands the arming to the map view", () => {
        for (const { tool, icon } of DRAW_TOOL_ICONS) {
            const { drawButton, onToggleDrawing } = renderBar();

            expect(drawButton(icon)?.classList.contains("active")).toBe(false);
            act(() => drawButton(icon)?.click());
            expect(onToggleDrawing).toHaveBeenCalledWith(tool);

            const armed = renderBar({ drawingTool: tool });
            expect(armed.drawButton(icon)?.classList.contains("active")).toBe(true);
        }
    });

    it("offers to bring in a GPX track, and hands the asking to the map view", () => {
        const { gpxButton, onAddGpxTrack } = renderBar();

        expect(gpxButton()?.className).toContain("bx-trip");

        act(() => gpxButton()?.click());
        expect(onAddGpxTrack).toHaveBeenCalledTimes(1);
    });

    it("refuses every button on a map that may not be edited", () => {
        const { buttons } = renderBar({ isReadOnly: true });

        expect(buttons().length).toBeGreaterThan(2);
        for (const button of buttons()) {
            expect(button.disabled).toBe(true);
        }
    });

    it("stands aside where there is no map at all", () => {
        const { buttons } = renderBar({ map: null as never });

        expect(buttons()).toHaveLength(0);
    });
});
