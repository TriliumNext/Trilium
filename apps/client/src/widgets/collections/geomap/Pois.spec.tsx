/**
 * The places the base map draws answering a click: which tile features are worth standing the map on,
 * which layers are hit-tested for them, and what the map's own markers do to a click that lands on
 * both.
 */
import type { Map as MapLibreGLMap, MapGeoJSONFeature } from "maplibre-gl";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLUSTER_LAYER } from "./clusters";
import type { GeoSearchResult } from "./geocoding";
import { MapStyleLoaded, ParentMap } from "./map";
import { MARKER_LAYER } from "./Markers";
import Pois, { clickableOpacity, clickableTint, poiFromFeature, poiLayers } from "./Pois";
import { PLACE_MARKER_COLOR } from "./PlaceMarker";

/**
 * The popup MapLibre would draw, recording what it was shown and whether it is up. Hoisted because
 * the module mock below it is, and that mock is what hands the class to the component.
 */
const { FakePopup } = vi.hoisted(() => {
    class FakePopup {
        static open: FakePopup[] = [];

        content: HTMLElement | null = null;
        lngLat: unknown;

        setLngLat(lngLat: unknown) { this.lngLat = lngLat; return this; }
        setDOMContent(content: HTMLElement) { this.content = content; return this; }

        addTo() {
            if (!FakePopup.open.includes(this)) FakePopup.open.push(this);
            return this;
        }

        remove() {
            FakePopup.open = FakePopup.open.filter((popup) => popup !== this);
            return this;
        }
    }

    return { FakePopup };
});

// isLocationDot is imported from MapToolbar, which extends GeolocateControl at module load
// (HiddenGeolocateControl); the mock must define it too.
vi.mock("maplibre-gl", () => ({ GeolocateControl: class {}, Popup: FakePopup, setWorkerUrl: vi.fn() }));

/** What the tooltip currently reads, or `null` where none is up. */
function tooltipText() {
    return FakePopup.open[0]?.content?.textContent ?? null;
}

type Listener = (e?: unknown) => void;

/** A place as a tile carries one: named, classified by its OSM tags, standing at a point. */
function poiFeature(properties: Record<string, unknown>, coordinates: [number, number] = [ 13.4, 52.5 ]) {
    return {
        id: 42,
        geometry: { type: "Point", coordinates },
        properties
    } as unknown as MapGeoJSONFeature;
}

/**
 * A map whose style draws places, standing in for MapLibre. What it has to answer is the hit test:
 * what the click landed on, told apart by which layers the query names.
 */
function fakeMap({
    poiLayerIds = [ "poi-amenity", "poi-shop" ],
    ownLayerIds = [ MARKER_LAYER ],
    zoom = 18,
    styleColor = "rgb(85,85,85)" as unknown,
    styleOpacity = { stops: [ [ 16, 0 ], [ 17, 0.4 ] ] } as unknown
} = {}) {
    const listeners = new Map<string, Set<Listener>>();
    const canvas = { style: { cursor: "" } };
    const paint = new Map<string, unknown>(poiLayerIds.map((id) => [ id, styleColor ]));
    const opacities = new Map<string, unknown>(poiLayerIds.map((id) => [ id, styleOpacity ]));
    let onPoi: unknown[] = [];
    let onOwn: unknown[] = [];

    const layers = new Map<string, { sourceLayer: string }>();
    for (const id of poiLayerIds) layers.set(id, { sourceLayer: "pois" });
    for (const id of ownLayerIds) layers.set(id, { sourceLayer: "" });

    return {
        get cursor() { return canvas.style.cursor; },
        /** How far the map is zoomed in, which is what settles whether its places can be seen at all. */
        setZoom(to: number) { zoom = to; },
        /** What the next click lands on: a place of the base map, something of the map's own, or both. */
        setUnderPointer({ poi = [] as unknown[], own = [] as unknown[] }) {
            onPoi = poi;
            onOwn = own;
        },
        /** Fires a map click event with `originalEvent.target` set to the given element, as MapLibre
         *  does for a click on a marker. */
        click(target: Element | null = null) {
            for (const fn of listeners.get("click") ?? []) fn({ point: { x: 0, y: 0 }, originalEvent: { target } });
        },
        /** The pointer coming to rest on a place of the base map, as MapLibre reports it. */
        hover(feature: unknown) {
            for (const fn of listeners.get(`mousemove:${poiLayerIds}`) ?? []) {
                fn({ point: { x: 0, y: 0 }, features: [ feature ] });
            }
        },
        /** The pointer leaving the layers the places are drawn on. */
        unhover() {
            for (const fn of listeners.get(`mouseleave:${poiLayerIds}`) ?? []) fn();
        },
        /** Which layers the hover is currently bound to, as a style switch has to put back. */
        boundLayers() {
            return [ ...listeners.keys() ]
                .filter((key) => key.startsWith("mousemove:") && (listeners.get(key)?.size ?? 0) > 0)
                .flatMap((key) => key.slice("mousemove:".length).split(",").filter(Boolean));
        },
        fireStyleLoad() {
            for (const fn of listeners.get("style.load") ?? []) fn();
        },
        on(event: string, fnOrLayer: unknown, fn?: Listener) {
            const key = fn ? `${event}:${fnOrLayer}` : event;
            if (!listeners.has(key)) listeners.set(key, new Set());
            listeners.get(key)?.add((fn ?? fnOrLayer) as Listener);
        },
        off(event: string, fnOrLayer: unknown, fn?: Listener) {
            listeners.get(fn ? `${event}:${fnOrLayer}` : event)?.delete((fn ?? fnOrLayer) as Listener);
        },
        queryRenderedFeatures(_point: unknown, { layers: queried }: { layers: string[] }) {
            return queried.some((id) => poiLayerIds.includes(id)) ? onPoi : onOwn;
        },
        /** What a layer's places are currently painted in. */
        iconColor: (layer: string) => paint.get(layer),
        /** How solid a layer's places are currently drawn. */
        iconOpacity: (layer: string) => opacities.get(layer),
        getPaintProperty: (layer: string, name: string) =>
            name === "icon-color" ? paint.get(layer) : opacities.get(layer),
        setPaintProperty(layer: string, name: string, value: unknown) {
            if (name === "icon-color") paint.set(layer, value);
            else opacities.set(layer, value);
        },
        getLayersOrder: () => [ ...layers.keys() ],
        getLayer: (id: string) => layers.get(id),
        getCanvas: () => canvas,
        getZoom: () => zoom
    };
}

const containers: HTMLElement[] = [];

/** Puts the places of a map within reach, and hands back what a click on one reported. */
async function renderPois(map: ReturnType<typeof fakeMap>, { placing = false } = {}) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);

    const picked: GeoSearchResult[] = [];

    await act(async () => {
        render(
            <ParentMap.Provider value={map as unknown as MapLibreGLMap}>
                <MapStyleLoaded.Provider value={true}>
                    <Pois placing={placing} onPick={(place) => picked.push(place)} />
                </MapStyleLoaded.Provider>
            </ParentMap.Provider>,
            container
        );
    });

    return {
        picked,
        unmount: async () => { await act(async () => { render(null, container); }); }
    };
}

afterEach(() => {
    for (const container of containers) {
        render(null, container);
        container.remove();
    }
    containers.length = 0;
});

describe("geo map POI features", () => {
    it("reads a named place off a tile feature, classified by its OSM tags", () => {
        const place = poiFromFeature(poiFeature({ name: "Café Kranzler", amenity: "cafe" }));

        expect(place).toMatchObject({
            name: "Café Kranzler",
            // Nothing beyond the name, a tile carrying no address (see PlacePanel).
            label: "Café Kranzler",
            lng: 13.4,
            lat: 52.5,
            icon: "bx bx-coffee"
        });
        // Named by what OSM calls the place, so the same one clicked twice is the same place.
        expect(place?.id).toBe("poi:42");
    });

    it("names a place the way the rest of the map is named", () => {
        // The styles load their English variant, so a place says what its label would have said.
        const place = poiFromFeature(poiFeature({ name: "東京タワー", name_en: "Tokyo Tower", tourism: "attraction" }));

        expect(place?.name).toBe("Tokyo Tower");
    });

    it("falls through the tags to whichever kind the place is filed under", () => {
        expect(poiFromFeature(poiFeature({ name: "Edeka", shop: "supermarket" }))?.icon).toBe("bx bx-cart");
        // A kind the tables do not name is still drawn by its category, a shop as a shop.
        expect(poiFromFeature(poiFeature({ name: "Rossmann", shop: "chemist" }))?.icon).toBe("bx bx-store");
        // Every key a place can be filed under has an icon, so only a feature carrying no kind at
        // all is left for the panel to fall back on.
        expect(poiFromFeature(poiFeature({ name: "Something" }))?.icon).toBeUndefined();
    });

    it("passes over what is not a place worth keeping", () => {
        // A bench has no name, and the bare OSM tag is not what anyone means to keep.
        expect(poiFromFeature(poiFeature({ amenity: "bench" }))).toBeNull();
        expect(poiFromFeature(poiFeature({ name: "   ", amenity: "cafe" }))).toBeNull();
        expect(poiFromFeature(undefined)).toBeNull();
        expect(poiFromFeature({
            geometry: { type: "LineString", coordinates: [] },
            properties: { name: "A street" }
        } as unknown as MapGeoJSONFeature)).toBeNull();
    });

    it("hit-tests the layers of the style that draw places, and no others", () => {
        const map = fakeMap({ poiLayerIds: [ "poi-amenity" ], ownLayerIds: [ MARKER_LAYER, CLUSTER_LAYER ] });

        expect(poiLayers(map as unknown as MapLibreGLMap)).toEqual([ "poi-amenity" ]);
    });
});

describe("geo map Pois", () => {
    it("stands the map on the place a click landed on", async () => {
        const map = fakeMap();
        const { picked } = await renderPois(map);

        map.setUnderPointer({ poi: [ poiFeature({ name: "Café Kranzler", amenity: "cafe" }) ] });
        await act(async () => { map.click(); });

        expect(picked).toHaveLength(1);
        expect(picked[0]).toMatchObject({ name: "Café Kranzler", icon: "bx bx-coffee" });
    });

    it("leaves a click that landed on the map's own to the map's own", async () => {
        const map = fakeMap();
        const { picked } = await renderPois(map);

        // A marker standing over a place: the pin is the smaller target and the one aimed at.
        map.setUnderPointer({
            poi: [ poiFeature({ name: "Café Kranzler", amenity: "cafe" }) ],
            own: [ { properties: { id: "note1" } } ]
        });
        await act(async () => { map.click(); });

        expect(picked).toEqual([]);
    });

    it("leaves a click that landed on the device's own dot to the dot", async () => {
        const map = fakeMap();
        const { picked } = await renderPois(map);
        map.setUnderPointer({ poi: [ poiFeature({ name: "Café Kranzler", amenity: "cafe" }) ] });

        // isLocationDot checks the click's target directly, since the dot is a DOM marker over the
        // canvas rather than a layer the POI hit test below can see.
        const dot = document.createElement("div");
        dot.className = "maplibregl-marker maplibregl-user-location-dot";
        await act(async () => { map.click(dot); });

        expect(picked).toEqual([]);
    });

    it("leaves the click alone while one is armed to place a marker", async () => {
        const map = fakeMap();
        const { picked } = await renderPois(map, { placing: true });

        map.setUnderPointer({ poi: [ poiFeature({ name: "Café Kranzler", amenity: "cafe" }) ] });
        await act(async () => { map.click(); });

        expect(picked).toEqual([]);
        // Nor does the pointer offer a place while the click means somewhere to put a marker.
        expect(map.boundLayers()).toEqual([]);
    });

    it("leaves the places alone until the map has drawn them", async () => {
        const map = fakeMap();
        const { picked } = await renderPois(map);

        // The styles fade their places in over the zoom above 16, and what cannot be seen is not
        // what a click was aimed at.
        const place = poiFeature({ name: "Café Kranzler", amenity: "cafe" });

        map.setZoom(16);
        map.setUnderPointer({ poi: [ place ] });
        await act(async () => { map.click(); });
        map.hover(place);

        expect(picked).toEqual([]);
        expect(map.cursor).toBe("");

        map.setZoom(17);
        await act(async () => { map.click(); });
        map.hover(place);

        expect(picked).toHaveLength(1);
        expect(map.cursor).toBe("pointer");
    });

    it("does nothing on a style that draws no places", async () => {
        // The raster layer has its places baked into the image, and Neutrino carries none.
        const map = fakeMap({ poiLayerIds: [] });
        const { picked } = await renderPois(map);

        map.setUnderPointer({ poi: [ poiFeature({ name: "Café Kranzler", amenity: "cafe" }) ] });
        await act(async () => { map.click(); });

        expect(picked).toEqual([]);
    });

    it("says a place can be clicked, and puts the pointer back when it goes", async () => {
        const map = fakeMap();
        const { unmount } = await renderPois(map);
        const place = poiFeature({ name: "Café Kranzler", amenity: "cafe" });

        map.hover(place);
        expect(map.cursor).toBe("pointer");

        map.unhover();
        expect(map.cursor).toBe("");

        map.hover(place);
        await unmount();
        // Torn down with the pointer sitting on a place, the `mouseleave` no longer being listened for.
        expect(map.cursor).toBe("");
        expect(map.boundLayers()).toEqual([]);
    });

    it("offers no pointer over a place that has no name to keep", async () => {
        const map = fakeMap();
        await renderPois(map);

        map.hover(poiFeature({ amenity: "bench" }));

        expect(map.cursor).toBe("");
    });

    it("leaves the pointer to a marker standing over a place", async () => {
        const map = fakeMap();
        await renderPois(map);
        const place = poiFeature({ name: "Café Kranzler", amenity: "cafe" });

        map.hover(place);
        expect(map.cursor).toBe("pointer");

        // The marker sets its own pointer and clears it again, so this leaves the cursor alone
        // rather than clearing what the marker has just set.
        map.setUnderPointer({ own: [ { properties: { id: "note1" } } ] });
        map.hover(place);

        expect(map.cursor).toBe("pointer");
    });

    it("puts the pointer back on the layers a style switch brought in", async () => {
        const map = fakeMap();
        await renderPois(map);

        expect(map.boundLayers()).toEqual([ "poi-amenity", "poi-shop" ]);

        // The layers are replaced wholesale, so the handlers are bound once each rather than twice.
        await act(async () => { map.fireStyleLoad(); });

        expect(map.boundLayers()).toEqual([ "poi-amenity", "poi-shop" ]);
        map.hover(poiFeature({ name: "Café Kranzler", amenity: "cafe" }));
        expect(map.cursor).toBe("pointer");
    });
});

describe("geo map place tooltips", () => {
    /** Long enough for the rest the name is held back for, whatever that rest is set to. */
    const RESTED = 500;

    beforeEach(() => {
        vi.useFakeTimers();
        FakePopup.open = [];
    });

    afterEach(() => { vi.useRealTimers(); });

    it("names the place the pointer has come to rest on", async () => {
        const map = fakeMap();
        await renderPois(map);

        map.hover(poiFeature({ name: "Café Kranzler", amenity: "cafe" }));
        // Not while the pointer is merely passing over it.
        expect(tooltipText()).toBeNull();

        vi.advanceTimersByTime(RESTED);

        expect(tooltipText()).toBe("Café Kranzler");
        // Where the place stands, so the name follows it as the map is moved.
        expect(FakePopup.open[0]?.lngLat).toEqual([ 13.4, 52.5 ]);
    });

    it("names the place with the icon it would wear as a marker", async () => {
        const map = fakeMap();
        await renderPois(map);

        map.hover(poiFeature({ name: "Edeka", shop: "supermarket" }));
        vi.advanceTimersByTime(RESTED);

        expect(FakePopup.open[0]?.content?.querySelector("i")?.className).toBe("bx bx-cart");
    });

    it("says nothing of a place with no name, nor of one a marker stands over", async () => {
        const map = fakeMap();
        await renderPois(map);

        map.hover(poiFeature({ amenity: "bench" }));
        vi.advanceTimersByTime(RESTED);
        expect(tooltipText()).toBeNull();

        map.setUnderPointer({ own: [ { properties: { id: "note1" } } ] });
        map.hover(poiFeature({ name: "Café Kranzler", amenity: "cafe" }));
        vi.advanceTimersByTime(RESTED);
        expect(tooltipText()).toBeNull();
    });

    it("carries the name across to the next place the pointer reaches", async () => {
        const map = fakeMap();
        await renderPois(map);

        map.hover(poiFeature({ name: "Café Kranzler", amenity: "cafe" }));
        vi.advanceTimersByTime(RESTED);
        expect(tooltipText()).toBe("Café Kranzler");

        // A different place, which never leaves the layer the two are drawn on.
        map.hover({ ...poiFeature({ name: "Edeka", shop: "supermarket" }), id: 43 });
        // The name just left goes at once rather than standing over its neighbour.
        expect(tooltipText()).toBeNull();

        vi.advanceTimersByTime(RESTED);
        expect(tooltipText()).toBe("Edeka");
    });

    it("takes the name down when the place is clicked, until the pointer has been away", async () => {
        const map = fakeMap();
        const place = poiFeature({ name: "Café Kranzler", amenity: "cafe" });
        map.setUnderPointer({ poi: [ place ] });
        await renderPois(map);

        map.hover(place);
        vi.advanceTimersByTime(RESTED);
        expect(tooltipText()).toBe("Café Kranzler");

        // The panel the click opens says the name at length, and the pin now carries it too.
        map.click();
        expect(tooltipText()).toBeNull();

        map.hover(place);
        vi.advanceTimersByTime(RESTED);
        expect(tooltipText()).toBeNull();

        map.unhover();
        map.hover(place);
        vi.advanceTimersByTime(RESTED);
        expect(tooltipText()).toBe("Café Kranzler");
    });

    it("takes the name down as the pointer leaves the place", async () => {
        const map = fakeMap();
        const { unmount } = await renderPois(map);

        map.hover(poiFeature({ name: "Café Kranzler", amenity: "cafe" }));
        vi.advanceTimersByTime(RESTED);
        map.unhover();
        expect(tooltipText()).toBeNull();

        // Nor is one left standing over a map that is no longer on the screen.
        map.hover(poiFeature({ name: "Café Kranzler", amenity: "cafe" }));
        vi.advanceTimersByTime(RESTED);
        await unmount();

        expect(tooltipText()).toBeNull();
    });
});


describe("geo map place colouring", () => {
    it("draws the places that answer a click in the colour a place is pinned in", async () => {
        const map = fakeMap();
        await renderPois(map);

        // Composed over what the style painted, which is what the rest of the places keep.
        expect(map.iconColor("poi-amenity")).toEqual(clickableTint("rgb(85,85,85)"));
        expect(map.iconColor("poi-shop")).toEqual(clickableTint("rgb(85,85,85)"));
    });

    it("asks of a place exactly what the click asks of it", () => {
        const [ step, input, tooFarOut, threshold, closeIn ] = clickableTint("rgb(85,85,85)") as unknown[];

        expect(step).toBe("step");
        expect(input).toEqual([ "zoom" ]);
        // Too far out to pick a place, so the style's own grey stands unchanged.
        expect(tooFarOut).toBe("rgb(85,85,85)");
        expect(threshold).toBe(17);
        // Close enough in, a place carrying a name is drawn in the colour one is pinned in, and one
        // without a name keeps the grey along with the click it does not answer.
        expect(closeIn).toEqual([
            "case",
            [ "to-boolean", [ "coalesce", [ "get", "name_en" ], [ "get", "name" ] ] ],
            PLACE_MARKER_COLOR,
            "rgb(85,85,85)"
        ]);
    });

    it("asks the zoom only where MapLibre takes it, at the top of the expression", () => {
        const tint = clickableTint("rgb(85,85,85)") as unknown[];

        // A paint value whose `["zoom"]` stands anywhere but the input of an outermost `step` or
        // `interpolate` is refused, and a refused value leaves the places painted as they were —
        // which is the whole of what a reader would see of the mistake.
        expect(tint[0]).toBe("step");
        expect(tint[1]).toEqual([ "zoom" ]);
        expect(mentionsZoom(tint.slice(2))).toBe(false);
    });

    it("leaves a style that paints its places some other way alone", async () => {
        // The old function syntax is an object rather than an expression, and cannot be composed with.
        const stops = { stops: [ [ 16, "#111" ], [ 20, "#999" ] ] };
        const map = fakeMap({ styleColor: stops });
        await renderPois(map);

        expect(map.iconColor("poi-amenity")).toBe(stops);
    });

    it("puts the style's own colour back when it goes", async () => {
        const map = fakeMap();
        const { unmount } = await renderPois(map);

        await unmount();

        expect(map.iconColor("poi-amenity")).toBe("rgb(85,85,85)");
        expect(map.iconColor("poi-shop")).toBe("rgb(85,85,85)");
    });

    it("colours the places a style switch brought in, over what that style painted them", async () => {
        const map = fakeMap();
        await renderPois(map);

        // A style paints its places afresh, so what was composed before is gone and the colour read
        // back is the new style's own rather than the last composition.
        map.setPaintProperty("poi-amenity", "icon-color", "rgb(20,20,20)");
        await act(async () => { map.fireStyleLoad(); });

        expect(map.iconColor("poi-amenity")).toEqual(clickableTint("rgb(20,20,20)"));
    });
});

describe("geo map place solidity", () => {
    /** What the styles ask for: nothing at zoom 16, climbing to a fraction of solid by 17. */
    const STYLE_RAMP = { stops: [ [ 16, 0 ], [ 17, 0.4 ] ] };

    it("brings the places that answer a click up to nearly solid", async () => {
        const map = fakeMap();
        await renderPois(map);

        expect(map.iconOpacity("poi-amenity")).toEqual(clickableOpacity(STYLE_RAMP));
        expect(clickableOpacity(STYLE_RAMP)).toEqual([
            "interpolate",
            [ "linear" ],
            [ "zoom" ],
            // Below the zoom a place can be picked from, what the style asked for stands.
            16, 0,
            // At it, a place carrying a name is drawn nearly solid and the rest stay a background.
            17, [ "case", NAMED, 0.95, 0.4 ]
        ]);
    });

    it("keeps the curve the style asked to be read between its stops by", () => {
        const exponential = clickableOpacity({ stops: [ [ 16, 0 ], [ 18, 0.5 ] ], base: 1.5 });

        expect((exponential as unknown[])[1]).toEqual([ "exponential", 1.5 ]);
    });

    it("raises the places at the zoom they can be picked from, whatever the style's ramp says", () => {
        // A ramp that has finished climbing before a place can be picked says nothing about the
        // zooms that matter, so the raise is added as a stop of its own.
        expect(clickableOpacity({ stops: [ [ 14, 0 ], [ 15, 0.4 ] ] })).toEqual([
            "interpolate",
            [ "linear" ],
            [ "zoom" ],
            14, 0,
            15, 0.4,
            17, [ "case", NAMED, 0.95, 0.4 ]
        ]);

        // A flat number has no zoom to it, and is stepped in where the colour is.
        expect(clickableOpacity(0.4)).toEqual([
            "step", [ "zoom" ], 0.4, 17, [ "case", NAMED, 0.95, 0.4 ]
        ]);
    });

    it("leaves alone what it cannot read a ramp of numbers out of", async () => {
        expect(clickableOpacity({ stops: [ [ 16, "half" ] ] })).toBeNull();
        expect(clickableOpacity({ stops: [] })).toBeNull();
        expect(clickableOpacity(undefined)).toBeNull();
        expect(clickableOpacity([ "case", NAMED, 1, 0 ])).toBeNull();

        // A style this cannot be read out of keeps the solidity it asked for, colour or no colour.
        const map = fakeMap({ styleOpacity: [ "case", NAMED, 1, 0 ] });
        await renderPois(map);

        expect(map.iconOpacity("poi-amenity")).toEqual([ "case", NAMED, 1, 0 ]);
        expect(map.iconColor("poi-amenity")).toEqual(clickableTint("rgb(85,85,85)"));
    });

    it("asks the zoom only where MapLibre takes it, at the top of the expression", () => {
        const solid = clickableOpacity(STYLE_RAMP) as unknown[];

        expect(solid[0]).toBe("interpolate");
        expect(solid[2]).toEqual([ "zoom" ]);
        expect(mentionsZoom(solid.slice(3))).toBe(false);
    });

    it("puts the style's own solidity back when it goes", async () => {
        const map = fakeMap({ styleOpacity: STYLE_RAMP });
        const { unmount } = await renderPois(map);

        await unmount();

        expect(map.iconOpacity("poi-amenity")).toBe(STYLE_RAMP);
    });
});

/** What both builders ask of a place: that it carries a name to be kept under. */
const NAMED = [ "to-boolean", [ "coalesce", [ "get", "name_en" ], [ "get", "name" ] ] ];

/** Whether `["zoom"]` is asked anywhere within a value, however deeply it is nested. */
function mentionsZoom(value: unknown): boolean {
    if (!Array.isArray(value)) {
        return false;
    }

    return (value[0] === "zoom" && value.length === 1) || value.some(mentionsZoom);
}
