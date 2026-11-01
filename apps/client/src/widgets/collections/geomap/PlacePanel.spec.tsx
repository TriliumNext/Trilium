/**
 * The panel standing over a place taken from the search: what it says about the place, and the two
 * things that can be done with one — kept as a marker of the map, or sent away.
 */
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import { renderInto } from "../../../test/render";
import type { GeoSearchResult } from "./geocoding";
import PlacePanel from "./PlacePanel";

// The real module besides `t`, which is left to stand for the text it would return: something in the
// tree below awaits `translationsInitializedPromise`, and a mock without it fails after the test has
// passed.
vi.mock("../../../services/i18n", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/i18n")>()),
    t: (key: string) => key
}));

const JUMBO: GeoSearchResult = {
    id: "N5",
    name: "Jumbo",
    label: "Jumbo, Str. Șos. Alba Iulia 70, Sibiu, Romania",
    lat: 45.796,
    lng: 24.147
};

function renderPanel({ isReadOnly = false } = {}) {
    const onAddMarker = vi.fn();
    const onClose = vi.fn();
    let container: HTMLElement | undefined;

    act(() => {
        container = renderInto(
            <PlacePanel place={JUMBO} isReadOnly={isReadOnly} onAddMarker={onAddMarker} onClose={onClose} />
        );
    });
    if (!container) throw new Error("the panel was not rendered");

    return { container, onAddMarker, onClose };
}

describe("geo map PlacePanel", () => {
    it("names the place and gives the address under it, with the coordinates to copy", () => {
        const { container } = renderPanel();

        expect(container.querySelector(".tn-overlay-panel-title-text")?.textContent).toBe("Jumbo");
        // The whole of it, the heading carrying only the name.
        expect(container.querySelector(".geo-place-panel-address")?.textContent)
            .toBe("Jumbo, Str. Șos. Alba Iulia 70, Sibiu, Romania");
        expect(container.querySelector(".geo-detail-pane-location")?.textContent).toContain("45.796");
    });

    it("keeps the place as a marker when asked, and sends itself away when told", () => {
        const { container, onAddMarker, onClose } = renderPanel();

        act(() => { container.querySelector<HTMLButtonElement>(".geo-place-panel-add")?.click(); });
        expect(onAddMarker).toHaveBeenCalledOnce();

        act(() => { container.querySelector<HTMLButtonElement>(".tn-overlay-panel-close")?.click(); });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it("takes the keyboard as it appears, so keeping the place is the next press", () => {
        const { container } = renderPanel();

        expect(document.activeElement).toBe(container.querySelector(".geo-place-panel-add"));
    });

    it("sends itself away on Escape, the focus it took having to have a way out", () => {
        const { container, onClose } = renderPanel();

        act(() => {
            container.querySelector(".tn-overlay-panel")
                ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        });

        expect(onClose).toHaveBeenCalledOnce();
    });

    it("offers no marker on a map that may not be edited, the place still being worth reading", () => {
        const { container } = renderPanel({ isReadOnly: true });

        expect(container.querySelector(".geo-place-panel-add")).toBeNull();
        expect(container.querySelector(".geo-place-panel-address")).not.toBeNull();
    });
});
