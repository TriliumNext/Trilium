/**
 * The two groups standing over a relation map (see MapToolbar.tsx): the camera at one foot corner,
 * and the editing actions at the other.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import { renderInto } from "../../../test/render";
import MapToolbar, { EditToolbar, type MapCommand } from "./MapToolbar";

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

describe("relation map MapToolbar", () => {
    it("says the scale the map is drawn at, following it as the map is moved", () => {
        const { map, readout } = renderToolbar();

        expect(readout()?.textContent).toBe("100%");

        act(() => map.moveTo(2.5));
        expect(readout()?.textContent).toBe("250%");

        // A pan leaves the scale where it was, so the readout says the same thing.
        act(() => map.moveTo(2.5));
        expect(readout()?.textContent).toBe("250%");
    });

    it("leaves a step with no room left to it disabled", () => {
        const { map, zoomIn, zoomOut } = renderToolbar();

        expect([ zoomOut()?.disabled, zoomIn()?.disabled ]).toEqual([ false, false ]);

        act(() => map.moveTo(MIN_ZOOM));
        expect([ zoomOut()?.disabled, zoomIn()?.disabled ]).toEqual([ true, false ]);

        act(() => map.moveTo(MAX_ZOOM));
        expect([ zoomOut()?.disabled, zoomIn()?.disabled ]).toEqual([ false, true ]);
    });

    it("asks for what each button stands for rather than moving the map itself", () => {
        const { map, commands, readout, zoomIn, zoomOut } = renderToolbar();

        act(() => zoomOut()?.click());
        act(() => readout()?.click());
        act(() => zoomIn()?.click());

        expect(commands).toEqual([ "relationMapResetZoomOut", "relationMapResetPanZoom", "relationMapResetZoomIn" ]);
        expect(map.transformListeners()).toBe(1);
    });

    it("stands aside while there is no map to read", () => {
        const { buttons } = renderToolbar({ withMap: false });

        expect(buttons()).toHaveLength(0);
    });

    it("stops listening to a map that is torn down", () => {
        const { map, unmount } = renderToolbar();
        expect(map.transformListeners()).toBe(1);

        unmount();
        expect(map.transformListeners()).toBe(0);
    });
});

describe("relation map EditToolbar", () => {
    it("offers to add a note in words as well as in a mark, and hands the asking to the map view", () => {
        const { button, onAddNote } = renderEditToolbar();

        // The mark is a child of the button rather than the button's own class — the words beside it
        // are to stay words (see OverlayControlGroup.tsx).
        expect(button()?.querySelector(".bx-note")).not.toBeNull();
        expect(button()?.textContent).toBe("relation_map_buttons.create_child_note_text");

        act(() => button()?.click());
        expect(onAddNote).toHaveBeenCalledTimes(1);
    });

    it("refuses on a map that may not be edited", () => {
        const { button } = renderEditToolbar({ isReadOnly: true });

        expect(button()?.disabled).toBe(true);
    });
});

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2;

/** Builds the camera group over a map, holding on to what the buttons ask of it. */
function renderToolbar({ withMap = true } = {}) {
    const map = fakeMap();
    const commands: MapCommand[] = [];
    let container: HTMLElement | undefined;
    act(() => {
        container = renderInto(
            <MapToolbar
                panZoom={withMap ? map as unknown as Parameters<typeof MapToolbar>[0]["panZoom"] : undefined}
                onCommand={(command) => commands.push(command)}
            />
        );
    });
    if (!container) throw new Error("the toolbar was not rendered");

    const all = () => [ ...container?.querySelectorAll<HTMLButtonElement>(".relation-map-toolbar button") ?? [] ];
    return {
        map,
        commands,
        buttons: all,
        zoomOut: () => all()[0],
        readout: () => all()[1],
        zoomIn: () => all()[2],
        unmount: () => act(() => render(null, container as HTMLElement))
    };
}

/** Builds the editing group, which asks for nothing beyond what its one button is driven by. */
function renderEditToolbar({ isReadOnly = false } = {}) {
    const onAddNote = vi.fn();
    let container: HTMLElement | undefined;
    act(() => {
        container = renderInto(<EditToolbar isReadOnly={isReadOnly} onAddNote={onAddNote} />);
    });
    if (!container) throw new Error("the toolbar was not rendered");

    return {
        onAddNote,
        button: () => container?.querySelector<HTMLButtonElement>(".relation-map-edit-toolbar button") ?? null
    };
}

/** A stand-in for panzoom: a scale that can be moved, told to whoever asked to be told. */
function fakeMap() {
    let scale = 1;
    const listeners = new Set<() => void>();

    return {
        getTransform: () => ({ x: 0, y: 0, scale }),
        getMinZoom: () => MIN_ZOOM,
        getMaxZoom: () => MAX_ZOOM,
        on: (_event: string, handler: () => void) => listeners.add(handler),
        off: (_event: string, handler: () => void) => listeners.delete(handler),
        /** Reports a move, as the library does for a pan as well as for a zoom. */
        moveTo: (newScale: number) => {
            scale = newScale;
            for (const listener of listeners) listener();
        },
        transformListeners: () => listeners.size
    };
}
