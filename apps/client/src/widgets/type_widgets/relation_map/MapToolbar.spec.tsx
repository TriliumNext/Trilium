/**
 * The two groups standing over a relation map (see MapToolbar.tsx): the camera at one foot corner,
 * and the editing actions at the other.
 */
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import { renderInto } from "../../../test/render";
import MapToolbar, { EditToolbar, type MapCommand } from "./MapToolbar";

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

describe("relation map MapToolbar", () => {
    it("says the scale the map is drawn at", () => {
        const { readout, rerender } = renderToolbar();
        expect(readout()?.textContent).toBe("100%");

        rerender({ scale: 2.5 });
        expect(readout()?.textContent).toBe("250%");
    });

    it("leaves a step with no room left to it disabled", () => {
        const { zoomIn, zoomOut, rerender } = renderToolbar();
        expect([ zoomOut()?.disabled, zoomIn()?.disabled ]).toEqual([ false, false ]);

        rerender({ canZoomOut: false });
        expect([ zoomOut()?.disabled, zoomIn()?.disabled ]).toEqual([ true, false ]);

        rerender({ canZoomIn: false });
        expect([ zoomOut()?.disabled, zoomIn()?.disabled ]).toEqual([ false, true ]);
    });

    it("asks for what each button stands for rather than moving the map itself", () => {
        const { commands, readout, zoomIn, zoomOut } = renderToolbar();

        act(() => zoomOut()?.click());
        act(() => readout()?.click());
        act(() => zoomIn()?.click());

        expect(commands).toEqual([ "relationMapResetZoomOut", "relationMapResetPanZoom", "relationMapResetZoomIn" ]);
    });
});

describe("relation map EditToolbar", () => {
    it("offers to add a note in words as well as in a mark, and hands the asking to the map view", () => {
        const { button, onTogglePlacement } = renderEditToolbar();

        // The mark is a child of the button rather than the button's own class — the words beside it
        // are to stay words (see OverlayControlGroup.tsx).
        expect(button()?.querySelector(".bx-note")).not.toBeNull();
        expect(button()?.textContent).toBe("relation_map_buttons.create_child_note_text");
        expect(button()?.classList.contains("active")).toBe(false);

        act(() => button()?.click());
        expect(onTogglePlacement).toHaveBeenCalledTimes(1);
    });

    it("shows as pressed while the map is armed, and offers to cancel", () => {
        const { button } = renderEditToolbar({ placing: true });

        expect(button()?.classList.contains("active")).toBe(true);
        expect(button()?.textContent).toBe("relation_map_buttons.create_child_note_cancel_text");
    });

    it("refuses on a map that may not be edited", () => {
        const { button } = renderEditToolbar({ isReadOnly: true });

        expect(button()?.disabled).toBe(true);
    });
});

/** Builds the camera group, holding on to what the buttons ask for. */
function renderToolbar() {
    const commands: MapCommand[] = [];
    let container: HTMLElement | undefined;
    const rerender = (zoom: Partial<Parameters<typeof MapToolbar>[0]["zoom"]> = {}) => act(() => {
        container = renderInto(
            <MapToolbar
                zoom={{ scale: 1, canZoomIn: true, canZoomOut: true, ...zoom }}
                onCommand={(command) => commands.push(command)}
            />
        );
    });
    rerender();
    if (!container) throw new Error("the toolbar was not rendered");

    const all = () => [ ...container?.querySelectorAll<HTMLButtonElement>(".relation-map-toolbar button") ?? [] ];
    return {
        commands,
        rerender,
        zoomOut: () => all()[0],
        readout: () => all()[1],
        zoomIn: () => all()[2]
    };
}

/** Builds the editing group, which asks for nothing beyond what its one button is driven by. */
function renderEditToolbar({ isReadOnly = false, placing = false } = {}) {
    const onTogglePlacement = vi.fn();
    let container: HTMLElement | undefined;
    act(() => {
        container = renderInto(<EditToolbar isReadOnly={isReadOnly} placing={placing} onTogglePlacement={onTogglePlacement} />);
    });
    if (!container) throw new Error("the toolbar was not rendered");

    return {
        onTogglePlacement,
        button: () => container?.querySelector<HTMLButtonElement>(".relation-map-edit-toolbar button") ?? null
    };
}

