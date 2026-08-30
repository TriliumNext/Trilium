/**
 * Stepping through what a search turned up: which of them the map is pointed at, how the ends are
 * held, and where a step leaves the reader.
 */
import type { Map as MapLibreGLMap } from "maplibre-gl";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import { renderInto } from "../../../test/render";
import { ParentMap } from "./map";
import type { SearchResult } from "./results";
import ResultNavigator from "./ResultNavigator";

vi.mock("../../../services/i18n", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/i18n")>()),
    t: (key: string) => key
}));

const RESULTS: SearchResult[] = [
    { kind: "note", noteId: "note1", center: [ 24.15, 45.79 ] },
    { kind: "place", place: { id: "N5", name: "Jumbo", label: "Jumbo, Sibiu", lat: 45.8, lng: 24.2, bounds: [ [ 24.1, 45.7 ], [ 24.3, 45.9 ] ] } },
    { kind: "place", place: { id: "N6", name: "Jumbo", label: "Jumbo, Ohio", lat: 40.4, lng: -82.9 } }
];

function fakeMap() {
    return { flyTo: vi.fn(), fitBounds: vi.fn() };
}

function renderNavigator(index: number, results = RESULTS) {
    const map = fakeMap();
    const onStep = vi.fn();
    let container: HTMLElement | undefined;

    act(() => {
        container = renderInto(
            <ParentMap.Provider value={map as unknown as MapLibreGLMap}>
                <ResultNavigator results={results} index={index} onStep={onStep} />
            </ParentMap.Provider>
        );
    });
    if (!container) throw new Error("the navigator was not rendered");

    const buttons = [ ...container.querySelectorAll<HTMLButtonElement>("button") ];
    return { map, onStep, buttons, container };
}

describe("geo map ResultNavigator", () => {
    it("says where the reader stands among the results, counting from one", () => {
        const { buttons } = renderNavigator(1);

        expect(buttons[1].textContent).toBe("2 / 3");
    });

    it("steps to the next result and points the map at it", () => {
        const { buttons, onStep, map } = renderNavigator(0);

        act(() => { buttons[2].click(); });

        expect(onStep).toHaveBeenCalledWith(1);
        // The place covers ground the geocoder reported, so it is framed rather than flown to.
        expect(map.fitBounds).toHaveBeenCalledOnce();
    });

    it("steps back to a note, which marks a spot and is flown to", () => {
        const { buttons, onStep, map } = renderNavigator(1);

        act(() => { buttons[0].click(); });

        expect(onStep).toHaveBeenCalledWith(0);
        expect(map.flyTo).toHaveBeenCalledWith({ center: [ 24.15, 45.79 ], zoom: expect.any(Number) });
    });

    it("holds the ends rather than wrapping round them", () => {
        expect(renderNavigator(0).buttons[0].disabled).toBe(true);
        expect(renderNavigator(2).buttons[2].disabled).toBe(true);
        expect(renderNavigator(1).buttons.some((button) => button.disabled)).toBe(false);
    });

    it("points the map back at where it stands when the count itself is pressed", () => {
        const { buttons, onStep, map } = renderNavigator(2);

        act(() => { buttons[1].click(); });

        expect(onStep).toHaveBeenCalledWith(2);
        expect(map.flyTo).toHaveBeenCalledWith({ center: [ -82.9, 40.4 ], zoom: expect.any(Number) });
    });

    it("stands aside where there is nothing to step between", () => {
        expect(renderNavigator(0, RESULTS.slice(0, 1)).container.querySelector("button")).toBeNull();
    });
});
