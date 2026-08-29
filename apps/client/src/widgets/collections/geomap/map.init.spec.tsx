/**
 * The map that cannot be built at all.
 *
 * MapLibre draws through WebGL and has no other way to draw, so a browser that will not give it a
 * context — WebGL turned off, or a GPU that is unavailable with no software fallback — makes the
 * constructor throw. Nothing caught it, and since the throw happens inside an effect with no error
 * boundary over the widgets, what the user got was the empty container the map would have filled:
 * a blank panel and a console message they never see. It says what happened now.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type MapLayer } from "./map_layer";

/** What MapLibre throws when it cannot get a context, message and all. */
const WEBGL_FAILURE_MESSAGE = JSON.stringify({
    statusMessage: "Could not create a WebGL context, GL_VENDOR = Disabled, GL_RENDERER = Disabled",
    type: "webglcontextcreationerror",
    message: "Failed to initialize WebGL"
});

/** The constructor of a browser that will not give MapLibre a context. */
function failingMap(): never {
    throw new Error(WEBGL_FAILURE_MESSAGE);
}

const { MapConstructor } = vi.hoisted(() => ({ MapConstructor: vi.fn() }));

vi.mock("maplibre-gl", () => ({
    AttributionControl: class {},
    Map: MapConstructor,
    ScaleControl: class {},
    setWorkerUrl: vi.fn()
}));

vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));

// t() returns the key, so the assertion below is on which message is shown rather than on its
// English wording.
vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

const LAYER: MapLayer = {
    name: "OpenStreetMap",
    type: "raster",
    url: "https://tile.example.org/{z}/{x}/{y}.png",
    attribution: "&copy; Example"
};

/**
 * The style the map reports once it has loaded one, which for a vector layer is the only place its
 * contents can be read: the layer names it by URL and MapLibre fetches it.
 */
const LOADED_STYLE = {
    version: 8,
    sources: { "versatiles-shortbread": { type: "vector", tiles: [ "https://tiles.example.org/{z}/{x}/{y}" ] } },
    layers: [ { id: "background", type: "background" } ]
};

/** The last map built, for the tests that ask what was done to it. */
let lastMap: ReturnType<typeof buildWorkingMap> | undefined;

/**
 * A map that builds, recording only the little the component asks of it.
 *
 * A `function` rather than an arrow: the component calls this through `new`, and Vitest refuses to
 * construct a mock whose implementation is not constructible.
 */
function workingMap(this: unknown) {
    lastMap = buildWorkingMap();
    return lastMap;
}

/**
 * What such a map does, including the part of MapLibre's own bookkeeping that matters here: a map
 * being removed hands every control it holds its notice and forgets them all, and `removeControl`
 * passes that notice on whether the map still holds the control or not — so a control told twice
 * reaches for the map it has already let go of.
 */
function buildWorkingMap() {
    const controls = new Set<unknown>();
    const listeners = new Map<string, Set<(payload?: unknown) => void>>();
    let removed = false;

    return {
        // The corner is recorded too, for the test that asks where the credit was stood.
        addControl: vi.fn((control: unknown, _corner?: string) => { controls.add(control); }),
        removeControl: vi.fn((control: unknown) => {
            if (removed) {
                throw new TypeError(`can't access property "off", this._map is undefined`);
            }
            controls.delete(control);
        }),
        hasControl: vi.fn((control: unknown) => controls.has(control)),
        remove: vi.fn(() => {
            removed = true;
            controls.clear();
        }),
        on: vi.fn((event: string, handler: (payload?: unknown) => void) => {
            const handlers = listeners.get(event) ?? new Set();
            handlers.add(handler);
            listeners.set(event, handlers);
        }),
        off: vi.fn((event: string, handler: (payload?: unknown) => void) => {
            listeners.get(event)?.delete(handler);
        }),
        once: vi.fn(),
        /** Fires an event as MapLibre would, for the tests that need one to have happened. */
        fire(event: string, payload?: unknown) {
            for (const handler of [ ...(listeners.get(event) ?? []) ]) {
                handler(payload);
            }
        },
        resize: vi.fn(),
        setStyle: vi.fn(),
        setCenter: vi.fn(),
        setZoom: vi.fn(),
        // What the map reads on `style.load` to learn what the style it was built with is made of.
        getStyle: () => structuredClone(LOADED_STYLE),
        getCenter: () => ({ lat: 0, lng: 0 }),
        getZoom: () => 2
    };
}

describe("Map initialization", () => {
    let container: HTMLElement;
    let Map: typeof import("./map").default;
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
        ({ default: Map } = await import("./map"));
        container = document.createElement("div");
        document.body.appendChild(container);
        warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        vi.clearAllMocks();
        warn.mockRestore();
    });

    /** Puts the map up, with whatever the mocked constructor has been told to do. */
    function renderMap({ scale = false, layer = LAYER }: { scale?: boolean; layer?: MapLayer } = {}) {
        act(() => {
            render(
                <Map
                    coordinates={{ lat: 0, lng: 0 }}
                    zoom={2}
                    layerData={layer}
                    viewportChanged={vi.fn()}
                    scale={scale}
                >
                    <div className="map-child">A child of the map</div>
                </Map>,
                container
            );
        });
    }

    it("says why there is no map, rather than leaving the panel blank", () => {
        MapConstructor.mockImplementation(failingMap);

        renderMap();

        // The placeholder stands where the map would have been...
        const placeholder = container.querySelector(".no-items");
        expect(placeholder).not.toBeNull();
        // i18next is not initialized in the client tests, so a key renders as itself.
        expect(placeholder?.textContent).toContain("geo-map.webgl-unavailable");

        // ...the children are not rendered, since they have no map to draw on...
        expect(container.querySelector(".map-child")).toBeNull();

        // ...and the reason is reported once, without a stack.
        expect(warn).toHaveBeenCalledOnce();
        expect(warn.mock.calls[0][0]).toContain("Could not create a WebGL context");
    });

    it("keeps the container, so a remount has somewhere to build", () => {
        MapConstructor.mockImplementation(failingMap);

        renderMap();

        expect(container.querySelector(".geo-map-container")).not.toBeNull();
    });

    it("draws the children and no placeholder when the map builds", () => {
        MapConstructor.mockImplementation(workingMap);

        renderMap();

        expect(container.querySelector(".no-items")).toBeNull();
        expect(container.querySelector(".map-child")).not.toBeNull();
    });

    it("stands the credit at the foot on desktop, and at the head of a mobile map", () => {
        MapConstructor.mockImplementation(workingMap);

        renderMap();
        expect(lastMap?.addControl.mock.calls[0][1]).toBe("bottom-left");

        // On mobile the foot is fully spoken for, so the credit moves to the head's leading
        // corner instead (see the comment in map.tsx).
        const host = window as unknown as { glob?: { device?: string } };
        host.glob = { device: "mobile" };
        try {
            render(null, container);
            renderMap();
            expect(lastMap?.addControl.mock.calls[0][1]).toBe("top-left");
        } finally {
            delete host.glob;
        }
    });

    /**
     * The app is served with `Referrer-Policy: no-referrer`, and OpenStreetMap answers a request that
     * says nothing of itself with a 403 drawn into the tile — an image reading "Access blocked",
     * served as HTTP 200, so the map fills with complaint and no error is ever raised. A policy on
     * the request itself is what overrules the document's.
     */
    it("tells a tile server where it is asking from, which the page's own policy would withhold", () => {
        MapConstructor.mockImplementation(workingMap);

        renderMap();

        const { transformRequest } = MapConstructor.mock.calls[0][0];
        expect(transformRequest("https://tile.openstreetmap.org/2/1/1.png", "Tile")).toEqual({
            url: "https://tile.openstreetmap.org/2/1/1.png",
            // The origin and never the path, so no note is named, and nothing at all from a secure
            // page to an insecure server.
            referrerPolicy: "strict-origin"
        });
    });

    describe("the raster source a custom map is drawn from", () => {
        /** The raster source of the style the map was built with. */
        function rasterSource() {
            return MapConstructor.mock.calls[0][0].style.sources["raster-tiles"];
        }

        // A block body: `mockImplementation` returns the mock, and a hook that returns a function is
        // taken for one that has handed back its own teardown — which Vitest then calls, recording a
        // constructor call with no arguments where the next test looks for its own.
        beforeEach(() => {
            MapConstructor.mockImplementation(workingMap);
        });

        /**
         * A URL typed into `#map:style` is copied from Leaflet Providers, where a server with
         * double-resolution tiles is written with Leaflet's `{r}`. MapLibre calls it `{ratio}` and
         * passes anything else through, so the letter itself went out in the request.
         */
        it("asks for the double-resolution tiles a Leaflet URL knows how to ask for", () => {
            renderMap({ layer: { ...LAYER, url: "https://tile.example.org/{z}/{x}/{y}{r}.png" } });

            expect(rasterSource().tiles).toEqual([ "https://tile.example.org/{z}/{x}/{y}{ratio}.png" ]);
        });

        it("leaves a URL that asks for no such thing exactly as it was given", () => {
            renderMap();

            expect(rasterSource().tiles).toEqual([ LAYER.url ]);
            // Never the level below drawn small: that is sharper, but it halves the labels and the
            // road widths the tile was drawn with, and reads as a map one zoom further out.
            expect(rasterSource().tileSize).toBe(256);
        });

        it("stops where the server stops, rather than asking for a level it has not got", () => {
            // OpenStreetMap answers 400 past z19, and a tile that fails leaves a hole where
            // stretching the level above would have done.
            renderMap();

            expect(rasterSource().maxzoom).toBe(19);
        });

        it("believes a layer that says where its own tiles stop", () => {
            renderMap({ layer: { ...LAYER, maxZoom: 22 } });

            expect(rasterSource().maxzoom).toBe(22);
        });
    });

    /**
     * The style switch and the frame it kept losing.
     *
     * MapLibre swaps styles by diffing, which keeps the painted map on screen — but it cannot diff
     * against a style that has not finished loading, and every style is still loading for at least
     * one animation frame after it is handed over. Rather than wait that frame out it tears the
     * whole style down and rebuilds: a "Unable to perform style diff" warning and a map that blinks
     * blank. The effect that reacts to the layer runs on mount, right behind the map's own
     * construction, so it always applies into that window. A style that arrives early is held until
     * `style.load` says the one before it is ready to be diffed against.
     */
    describe("a style that arrives before the last one has loaded", () => {
        /** A vector layer, whose style MapLibre fetches from the URL naming it. */
        const VECTOR_LAYER: MapLayer = {
            name: "VersaTiles Colorful",
            type: "vector",
            style: "https://tiles.versatiles.org/assets/styles/colorful/en.json"
        };

        beforeEach(() => {
            MapConstructor.mockImplementation(workingMap);
        });

        it("is held until then, and applied the moment it is safe to diff", () => {
            renderMap({ layer: VECTOR_LAYER });
            expect(lastMap?.setStyle).not.toHaveBeenCalled();

            act(() => lastMap?.fire("style.load"));

            expect(lastMap?.setStyle).toHaveBeenCalledOnce();
            expect(lastMap?.setStyle.mock.calls[0][0]).toBe(VECTOR_LAYER.style);
        });

        it("hands a vector layer's style to MapLibre as the URL naming it", () => {
            renderMap({ layer: VECTOR_LAYER });

            expect(MapConstructor.mock.calls[0][0].style).toBe(VECTOR_LAYER.style);
        });

        /**
         * Switching between two styles neither of which we ever see, which is every switch between
         * the built-in vector maps. What a child put on the outgoing style can only be told from the
         * style itself by knowing what that style was made of, and a style named by URL says nothing
         * about itself here: it is read where MapLibre resolves it, on the way in.
         */
        it("carries a child's additions between two styles named only by URL", () => {
            renderMap({ layer: VECTOR_LAYER });
            act(() => lastMap?.fire("style.load"));

            const darkLayer: MapLayer = { ...VECTOR_LAYER, style: `${VECTOR_LAYER.style}?dark`, isDarkTheme: true };
            renderMap({ layer: darkLayer });

            const { transformStyle } = lastMap?.setStyle.mock.calls.at(-1)?.[1] ?? {};
            // The map as it stands: the style it loaded, with a child's markers added on top.
            const previous = {
                ...LOADED_STYLE,
                sources: { ...LOADED_STYLE.sources, points: { type: "geojson", data: {} } },
                layers: [ ...LOADED_STYLE.layers, { id: "points-layer", type: "symbol", source: "points" } ]
            };
            const next = { version: 8, sources: { "versatiles-shortbread": { type: "vector" } }, layers: [ { id: "land", type: "background" } ] };

            const merged = transformStyle?.(previous, next);

            // The markers came across rather than blinking off until the new style loaded...
            expect(Object.keys(merged.sources)).toContain("points");
            expect(merged.layers.map((layer: { id: string }) => layer.id)).toEqual([ "land", "points-layer" ]);
            // ...and the style they were sitting on stayed behind with the map it drew.
            expect(merged.layers.map((layer: { id: string }) => layer.id)).not.toContain("background");
        });

        it("is applied straight away once the style before it has loaded", () => {
            renderMap();
            act(() => lastMap?.fire("style.load"));
            lastMap?.setStyle.mockClear();

            renderMap({ layer: { ...LAYER, url: "https://other.example.org/{z}/{x}/{y}.png" } });

            expect(lastMap?.setStyle).toHaveBeenCalledOnce();
        });

        it("is dropped when a later switch overtakes it before it was ever applied", () => {
            renderMap();
            const overtakingUrl = "https://other.example.org/{z}/{x}/{y}.png";
            renderMap({ layer: { ...LAYER, url: overtakingUrl } });

            act(() => lastMap?.fire("style.load"));

            expect(lastMap?.setStyle).toHaveBeenCalledOnce();
            expect(lastMap?.setStyle.mock.calls[0][0].sources["raster-tiles"].tiles).toEqual([ overtakingUrl ]);
        });
    });

    /**
     * Leaving a geo map for another note, which used to throw where nobody could catch it: the scale
     * was taken off a map that had already gone, and a control given its notice twice reaches for the
     * map it has let go of.
     */
    it("leaves a scale to the teardown of the map that holds it", () => {
        MapConstructor.mockImplementation(workingMap);
        renderMap({ scale: true });
        expect(lastMap?.addControl).toHaveBeenCalled();

        expect(() => act(() => { render(null, container); })).not.toThrow();

        expect(lastMap?.remove).toHaveBeenCalled();
        expect(lastMap?.removeControl).not.toHaveBeenCalled();
    });

    it("takes the scale off a map that is staying", () => {
        MapConstructor.mockImplementation(workingMap);
        renderMap({ scale: true });

        // The scale switched off while the map goes on being read, which is the one time this
        // cleanup has anything to do.
        renderMap({ scale: false });

        expect(lastMap?.removeControl).toHaveBeenCalledOnce();
        expect(lastMap?.remove).not.toHaveBeenCalled();
    });
});
