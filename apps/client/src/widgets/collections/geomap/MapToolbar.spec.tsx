/**
 * The controls over a geo map, which used to be MapLibre's own — white boxes on a map that may well
 * be dark, dressed in neither Trilium's buttons nor its colors. What is checked here is what they
 * did for us: the two steps, a step that would carry the map past either end of the range it is
 * allowed being refused rather than merely doing nothing, and the screen being given and taken
 * back.
 */
import { GeolocateControl, type Map as MapLibreGLMap } from "maplibre-gl";
import { type ComponentProps, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderInto } from "../../../test/render";
import { ParentMap } from "./map";
import MapToolbar from "./MapToolbar";

const { showError } = vi.hoisted(() => ({ showError: vi.fn() }));
vi.mock("../../../services/toast", () => ({ default: { showError } }));
// t() returns its key, so assertions below check the button's title key rather than its English
// text.
vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

/** The order the group lays its buttons out in — the image viewer's, with the tilt leading and the
 *  screen at the end. */
const TILT = 0;
const ZOOM_OUT = 1;
const ZOOM_IN = 2;
const LOCATE = 3;
const FULLSCREEN = 4;

/** A map that zooms and tilts, says so, and stands somewhere — all these controls ask of one. */
type Listener = (payload?: unknown) => void;

function fakeMap({ zoom = 5, minZoom = 2, maxZoom = 22, pitch = 0 } = {}) {
    const listeners = new Map<string, Set<Listener>>();
    const fire = (event: string, payload?: unknown) => {
        for (const listener of listeners.get(event) ?? []) listener(payload);
    };
    const container = document.createElement("div");
    container.requestFullscreen = vi.fn(async () => {});
    document.body.appendChild(container);

    const setZoom = (value: number) => {
        zoom = Math.min(Math.max(value, minZoom), maxZoom);
        fire("zoom");
    };
    const setPitch = (value: number) => {
        pitch = value;
        fire("pitch");
    };
    /** Controls added via addControl; map.remove() clears them, as MapLibre's own teardown does. */
    const controls = new Set<unknown>();

    return {
        addControl: vi.fn((control: unknown) => { controls.add(control); }),
        removeControl: vi.fn((control: unknown) => { controls.delete(control); }),
        hasControl: (control: unknown) => controls.has(control),
        remove: () => controls.clear(),
        /** Fires a map click event with `originalEvent.target` set to the given element, as MapLibre
         *  does for a click on a marker. */
        click: (target: Element | null) => fire("click", { originalEvent: { target }, point: { x: 0, y: 0 } }),
        getZoom: () => zoom,
        getMinZoom: () => minZoom,
        getMaxZoom: () => maxZoom,
        getPitch: () => pitch,
        getContainer: () => container,
        zoomIn: vi.fn(() => setZoom(zoom + 1)),
        zoomOut: vi.fn(() => setZoom(zoom - 1)),
        /** The map being zoomed by something other than these buttons — the wheel, or a pinch. */
        zoomTo: setZoom,
        /** The view being leaned over by hand — Ctrl and a drag, which MapLibre honours itself. */
        tiltTo: setPitch,
        easeTo: vi.fn(({ pitch: leanedTo }: { pitch?: number }) => {
            if (leanedTo !== undefined) setPitch(leanedTo);
        }),
        on: (event: string, listener: Listener) => {
            listeners.set(event, (listeners.get(event) ?? new Set()).add(listener));
        },
        off: (event: string, listener: Listener) => { listeners.get(event)?.delete(listener); },
        get listenerCount() {
            let count = 0;
            for (const held of listeners.values()) count += held.size;
            return count;
        }
    };
}

/** Puts the document in or out of fullscreen and tells whoever is listening, as the browser does. */
function setFullscreenElement(element: Element | null) {
    Object.defineProperty(document, "fullscreenElement", { value: element, configurable: true });
    act(() => { document.dispatchEvent(new Event("fullscreenchange")); });
}

beforeEach(() => {
    Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
    document.exitFullscreen = vi.fn(async () => {});
    // happy-dom leaves isSecureContext undefined and navigator.geolocation null; canLocate needs
    // both truthy, as a secure origin provides.
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    Object.defineProperty(navigator, "geolocation", { value: {}, configurable: true });
    // Mocked so a press does not call the real Geolocation API.
    vi.spyOn(GeolocateControl.prototype, "trigger").mockReturnValue(true);
    showError.mockClear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** Builds the controls over a map and settles them, so they are listening before being spoken to. */
function renderToolbar(map: ReturnType<typeof fakeMap> | null, props: ComponentProps<typeof MapToolbar> = {}) {
    let container: HTMLElement | undefined;
    act(() => {
        container = renderInto(
            <ParentMap.Provider value={map as unknown as MapLibreGLMap}>
                <MapToolbar {...props} />
            </ParentMap.Provider>
        );
    });
    if (!container) throw new Error("the toolbar was not rendered");
    return container;
}

function buttons(container: HTMLElement) {
    return [ ...container.querySelectorAll<HTMLButtonElement>(".tn-overlay-control-group button") ];
}

function press(container: HTMLElement, index: number) {
    act(() => buttons(container)[index].click());
}

/** Returns the GeolocateControl instance MapToolbar added, so a test can fire its events as MapLibre
 *  would. */
function controlOn(map: ReturnType<typeof fakeMap>) {
    const control: unknown = map.addControl.mock.calls[0]?.[0];
    if (!(control instanceof GeolocateControl)) throw new Error("no locate control was added");
    return control;
}

describe("geo map MapToolbar", () => {
    it("offers what the map's own controls did, laid out as the image viewer's group", () => {
        const container = renderToolbar(fakeMap());

        expect(buttons(container).map((button) => button.className)).toEqual([
            expect.stringContaining("geo-map-tilt-button"),
            expect.stringContaining("bx-minus-circle"),
            expect.stringContaining("bx-plus-circle"),
            expect.stringContaining("bx-current-location"),
            expect.stringContaining("bx-fullscreen")
        ]);
    });

    it("leans the view over and lays it flat again, its face naming the view it offers", () => {
        const map = fakeMap();
        const container = renderToolbar(map);
        expect(buttons(container)[TILT].textContent).toBe("3D");

        press(container, TILT);

        // Leaned over — by an eased flight rather than a jump — and now offering the way back.
        expect(map.easeTo).toHaveBeenCalled();
        expect(map.getPitch()).toBeGreaterThan(0);
        expect(buttons(container)[TILT].textContent).toBe("2D");

        press(container, TILT);

        expect(map.getPitch()).toBe(0);
        expect(buttons(container)[TILT].textContent).toBe("3D");
    });

    it("counts a tilt dragged in with Ctrl as 3D, the button never having been pressed", () => {
        const map = fakeMap();
        const container = renderToolbar(map);

        // As MapLibre's own Ctrl-drag would, without the button hearing of it directly.
        act(() => map.tiltTo(30));

        expect(buttons(container)[TILT].textContent).toBe("2D");
    });

    it("keeps the zoom steps off a mobile screen, where the fingers already zoom", () => {
        const host = window as unknown as { glob?: { device?: string } };
        host.glob = { device: "mobile" };
        try {
            const container = renderToolbar(fakeMap());

            // The zoom steps are hidden on mobile; the tilt, locate and fullscreen buttons remain
            // (see the mobile note in MapToolbar.tsx).
            expect(buttons(container).map((button) => button.className)).toEqual([
                expect.stringContaining("geo-map-tilt-button"),
                expect.stringContaining("bx-current-location"),
                expect.stringContaining("bx-fullscreen")
            ]);
        } finally {
            delete host.glob;
        }
    });

    it("stands aside until there is a map to zoom", () => {
        const container = renderToolbar(null);

        expect(buttons(container)).toHaveLength(0);
    });

    it("stands MapLibre's locate control on the map with its own button hidden, and takes it off again", () => {
        const map = fakeMap();
        const container = renderToolbar(map);

        expect(map.addControl).toHaveBeenCalledTimes(1);
        const control = controlOn(map);
        // trackUserLocation: true keeps following the device rather than jumping there once.
        expect(control.options.trackUserLocation).toBe(true);
        // enableHighAccuracy requests GPS; MapLibre's default position options settle for a coarser
        // fix.
        expect(control.options.positionOptions?.enableHighAccuracy).toBe(true);

        // GeolocateControl's own button is hidden by HiddenGeolocateControl; MapToolbar's
        // OverlayControlButton is used instead.
        const box = document.createElement("div");
        vi.spyOn(GeolocateControl.prototype, "onAdd").mockReturnValue(box);
        expect(control.onAdd(map as unknown as MapLibreGLMap)).toBe(box);
        expect(box.hidden).toBe(true);

        act(() => { render(null, container); });
        expect(map.removeControl).toHaveBeenCalledWith(control);

        // If the map was torn down first, its controls are already gone; removeControl must not be
        // called again, since MapLibre throws for a control the map no longer holds.
        const torn = fakeMap();
        const second = renderToolbar(torn);
        torn.remove();
        act(() => { render(null, second); });
        expect(torn.removeControl).not.toHaveBeenCalled();
    });

    it("presses the control's own button, and wears what the control is doing", () => {
        const map = fakeMap();
        const container = renderToolbar(map);
        const control = controlOn(map);
        const button = () => buttons(container)[LOCATE];

        expect(button().getAttribute("aria-label")).toBe("geo-map.locate");
        expect(button().classList.contains("active")).toBe(false);

        press(container, LOCATE);
        expect(control.trigger).toHaveBeenCalledTimes(1);

        // trackuserlocationstart sets "waiting"; the first geolocate event sets "following".
        act(() => { control.fire("trackuserlocationstart"); });
        expect(button().getAttribute("aria-label")).toBe("geo-map.locate-waiting");
        expect(button().classList.contains("active")).toBe(true);
        expect(button().classList.contains("locating")).toBe(true);

        act(() => { control.fire("geolocate", { coords: {}, timestamp: 0 }); });
        expect(button().getAttribute("aria-label")).toBe("geo-map.locate-following");
        expect(button().classList.contains("active")).toBe(true);
        expect(button().classList.contains("locating")).toBe(false);

        // A drag fires trackuserlocationend and userlocationlostfocus together; the state ends at
        // "background", not "off", since userlocationlostfocus is handled after.
        act(() => {
            control.fire("trackuserlocationend");
            control.fire("userlocationlostfocus");
        });
        expect(button().getAttribute("aria-label")).toBe("geo-map.locate-return");
        expect(button().classList.contains("active")).toBe(false);

        // A press with the camera free fires trackuserlocationstart, then userlocationfocus.
        act(() => {
            control.fire("trackuserlocationstart");
            control.fire("userlocationfocus");
        });
        expect(button().getAttribute("aria-label")).toBe("geo-map.locate-following");
        expect(button().classList.contains("active")).toBe(true);

        // A press while following fires only trackuserlocationend, so the state goes to "off".
        act(() => { control.fire("trackuserlocationend"); });
        expect(button().getAttribute("aria-label")).toBe("geo-map.locate");
        expect(button().classList.contains("active")).toBe(false);
    });

    it("says once when the position cannot be found, and stands down when access is denied", () => {
        const map = fakeMap();
        const container = renderToolbar(map);
        const control = controlOn(map);
        const button = () => buttons(container)[LOCATE];

        act(() => { control.fire("trackuserlocationstart"); });
        act(() => { control.fire("error", { code: 2, message: "unavailable" }); });
        expect(button().getAttribute("aria-label")).toBe("geo-map.locate-error");
        expect(showError).toHaveBeenCalledTimes(1);
        expect(showError).toHaveBeenLastCalledWith("geo-map.location-unavailable");

        // The watch keeps firing the same error; showError must not be called again for it.
        act(() => { control.fire("error", { code: 2, message: "unavailable" }); });
        expect(showError).toHaveBeenCalledTimes(1);

        // A later successful fix clears the error state.
        act(() => { control.fire("geolocate", { coords: {}, timestamp: 0 }); });
        expect(button().getAttribute("aria-label")).toBe("geo-map.locate-following");

        // A denied permission is terminal: the button is disabled and its title reflects that.
        act(() => { control.fire("error", { code: 1, message: "denied" }); });
        expect(button().disabled).toBe(true);
        expect(button().getAttribute("aria-label")).toBe("geo-map.locate-unavailable");
        expect(showError).toHaveBeenLastCalledWith("geo-map.location-denied");
    });

    it("tells a click on the device's dot from one on its accuracy circle, and hands over the fix", () => {
        const map = fakeMap();
        const onLocationClick = vi.fn();
        renderToolbar(map, { onLocationClick });
        const control = controlOn(map);
        // Class names match MapLibre's own dot and accuracy-circle markers.
        const dot = document.createElement("div");
        dot.className = "maplibregl-marker maplibregl-user-location-dot";
        const circle = document.createElement("div");
        circle.className = "maplibregl-marker maplibregl-user-location-accuracy-circle";

        // No geolocate event yet, so lastFix is null and the click is ignored.
        act(() => { map.click(dot); });
        expect(onLocationClick).not.toHaveBeenCalled();

        act(() => { control.fire("geolocate", { coords: { latitude: 45.9432, longitude: 24.9668 }, timestamp: 0 }); });
        act(() => { map.click(circle); });
        act(() => { map.click(null); });
        expect(onLocationClick).not.toHaveBeenCalled();

        // onLocationClick receives lastFix, not the click's own coordinates on the dot.
        act(() => { map.click(dot); });
        expect(onLocationClick).toHaveBeenCalledTimes(1);
        expect(onLocationClick).toHaveBeenCalledWith({ lat: 45.9432, lng: 24.9668 });
    });

    it("keeps the locate button off a map that cannot ask where the device is", () => {
        // isSecureContext is false for a page served over plain HTTP; canLocate requires a secure
        // origin.
        Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
        const map = fakeMap();
        const container = renderToolbar(map);

        expect(buttons(container).some((button) => button.classList.contains("bx-current-location"))).toBe(false);
        expect(map.addControl).not.toHaveBeenCalled();
    });

    it("zooms the map in either direction", () => {
        const map = fakeMap();
        const container = renderToolbar(map);

        press(container, ZOOM_IN);
        expect(map.zoomIn).toHaveBeenCalled();

        press(container, ZOOM_OUT);
        expect(map.zoomOut).toHaveBeenCalled();
    });

    it("disables the step that would carry the map past the range it is allowed", () => {
        const atTheTop = renderToolbar(fakeMap({ zoom: 22 }));
        expect(buttons(atTheTop)[ZOOM_IN].disabled).toBe(true);
        expect(buttons(atTheTop)[ZOOM_OUT].disabled).toBe(false);

        const atTheBottom = renderToolbar(fakeMap({ zoom: 2 }));
        expect(buttons(atTheBottom)[ZOOM_IN].disabled).toBe(false);
        expect(buttons(atTheBottom)[ZOOM_OUT].disabled).toBe(true);
    });

    it("follows the zoom as the map reports it, not only as the buttons set it", () => {
        const map = fakeMap({ zoom: 5, maxZoom: 6 });
        const container = renderToolbar(map);
        expect(buttons(container)[ZOOM_IN].disabled).toBe(false);

        // As the wheel or a pinch would.
        act(() => map.zoomTo(6));

        expect(buttons(container)[ZOOM_IN].disabled).toBe(true);
    });

    it("gives the map the screen and takes it back, saying which it is offering", () => {
        const map = fakeMap();
        const container = renderToolbar(map);

        press(container, FULLSCREEN);
        // The map itself goes on the screen, not the note's chrome around it.
        expect(map.getContainer().requestFullscreen).toHaveBeenCalled();

        setFullscreenElement(map.getContainer());
        expect(buttons(container)[FULLSCREEN].className).toContain("bx-exit-fullscreen");

        press(container, FULLSCREEN);
        expect(document.exitFullscreen).toHaveBeenCalled();
    });

    it("follows a screen left by pressing Escape rather than by the button", () => {
        const map = fakeMap();
        const container = renderToolbar(map);

        setFullscreenElement(map.getContainer());
        expect(buttons(container)[FULLSCREEN].className).toContain("bx-exit-fullscreen");

        setFullscreenElement(null);

        expect(buttons(container)[FULLSCREEN].className).toContain("bx-fullscreen");
    });

    it("stops listening to a map it is taken off", () => {
        const map = fakeMap();
        const container = renderToolbar(map);
        // One map.on listener each for zoom, pitch, and the dot-click handler.
        expect(map.listenerCount).toBe(3);

        // A map torn down under controls that stayed behind would go on being reported to.
        act(() => { render(null, container); });

        expect(map.listenerCount).toBe(0);
    });
});
