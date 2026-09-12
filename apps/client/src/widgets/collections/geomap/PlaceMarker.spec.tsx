/**
 * The pin standing on a place taken from the search: that it is drawn as a marker of the map rather
 * than as something laid over it, labelled with the place's name and following the style from light
 * to dark, and that it leaves nothing behind when it goes.
 */
import type { Map as MapLibreGLMap } from "maplibre-gl";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MapStyleLoaded, ParentMap } from "./map";
import { LABEL_PAINT, MARKER_SHADOW_PADDING, markerImageId } from "./Markers";
import PlaceMarker, { OUTLINE_FILL_LAYER, OUTLINE_LINE_LAYER, OUTLINE_SOURCE, PLACE_LAYER, PLACE_MARKER_COLOR, PLACE_MARKER_ICON, PLACE_SOURCE } from "./PlaceMarker";

// The pin is rasterized by loading an SVG into an Image, and happy-dom never fires that load — so
// the layer, which waits for the pin, would never be added. Only the rasterizing is stood in for;
// the layout and paint the assertions read are the real ones.
vi.mock("./Markers", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./Markers")>()),
    buildMarkerImage: vi.fn(async () => new Image())
}));

const TOKYO: [number, number] = [ 139.6503, 35.6762 ];

/** The ground a place covers, as a geocoder reports the boundary of a country or a county. */
const OUTLINE: GeoJSON.Geometry = {
    type: "Polygon",
    coordinates: [ [ [ 139.5, 35.5 ], [ 139.9, 35.5 ], [ 139.9, 35.8 ], [ 139.5, 35.8 ], [ 139.5, 35.5 ] ] ]
};

interface FakeLayer {
    id: string;
    source?: string;
    layout?: Record<string, unknown>;
    paint?: Record<string, unknown>;
}

/** A layer as it was added: what it was, and which layer it was asked to go under. */
interface AddedLayer {
    layer: FakeLayer;
    beforeId?: string;
}

/** A map that records what the component adds to it and takes away again. */
function fakeMap() {
    const layers = new Map<string, FakeLayer>();
    const sources = new Map<string, unknown>();
    const images = new Set<string>();
    const removals: string[] = [];
    const added: AddedLayer[] = [];

    return {
        removals,
        /** Where a layer was asked to be placed, which is what settles what is drawn over what. */
        addedBefore: (id: string) => added.find((entry) => entry.layer.id === id)?.beforeId,
        layer: (id: string) => layers.get(id),
        source: (id: string) => sources.get(id),
        hasImage: (id: string) => images.has(id),
        addImage: (id: string) => { images.add(id); },
        addSource: (id: string, source: unknown) => { sources.set(id, source); },
        addLayer: (layer: FakeLayer, beforeId?: string) => {
            layers.set(layer.id, layer);
            added.push({ layer, beforeId });
        },
        getSource: (id: string) => sources.get(id),
        getLayer: (id: string) => layers.get(id),
        removeSource: (id: string) => { removals.push(`source:${id}`); sources.delete(id); },
        removeLayer: (id: string) => { removals.push(`layer:${id}`); layers.delete(id); },
        on: () => {},
        off: () => {}
    };
}

const containers: HTMLElement[] = [];

/** Puts the pin on a map whose style is ready, and settles the pin image the layer waits for. */
async function renderMarker(map: ReturnType<typeof fakeMap>, props: {
    name?: string; isDarkTheme?: boolean; outline?: GeoJSON.Geometry;
} = {}) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);

    async function draw({ name = "Tokyo", isDarkTheme = false, outline }: typeof props) {
        await act(async () => {
            render(
                <ParentMap.Provider value={map as unknown as MapLibreGLMap}>
                    <MapStyleLoaded.Provider value={true}>
                        <PlaceMarker center={TOKYO} name={name} isDarkTheme={isDarkTheme} outline={outline} />
                    </MapStyleLoaded.Provider>
                </ParentMap.Provider>,
                container
            );
        });
        await settle();
    }

    await draw(props);

    return {
        /** The same pin drawn again with something changed — a boundary having arrived, say. */
        rerender: (changed: typeof props) => draw({ ...props, ...changed }),
        unmount: async () => { await act(async () => { render(null, container); }); }
    };
}

/** Lets the awaited pin image arrive, which is what the layer is held back for. */
async function settle() {
    await act(async () => { await Promise.resolve(); });
}

afterEach(() => {
    for (const container of containers) {
        render(null, container);
        container.remove();
    }
    containers.length = 0;
});

describe("geo map PlaceMarker", () => {
    it("stands the place on its own layer, pinned and named where the geocoder put it", async () => {
        const map = fakeMap();

        await renderMarker(map);

        expect(map.source(PLACE_SOURCE)).toMatchObject({
            type: "geojson",
            data: {
                geometry: { type: "Point", coordinates: TOKYO },
                properties: { name: "Tokyo" }
            }
        });

        const layer = map.layer(PLACE_LAYER);
        expect(layer?.source).toBe(PLACE_SOURCE);
        expect(layer?.layout).toMatchObject({
            "icon-image": markerImageId(PLACE_MARKER_COLOR, PLACE_MARKER_ICON),
            // The tip stands on the coordinate rather than the bottom edge of the image, as the note
            // pins do.
            "icon-anchor": "bottom",
            "icon-offset": [ 0, MARKER_SHADOW_PADDING ],
            // The one thing on the map the user has just asked to see does not give way to a label
            // that was already there.
            "icon-allow-overlap": true,
            "text-allow-overlap": true,
            "text-field": [ "get", "name" ]
        });
    });

    it("labels the place the way the map labels its own markers, on a light style and a dark one", async () => {
        const light = fakeMap();
        await renderMarker(light);
        expect(light.layer(PLACE_LAYER)?.paint).toMatchObject(LABEL_PAINT.light);

        const dark = fakeMap();
        await renderMarker(dark, { isDarkTheme: true });
        expect(dark.layer(PLACE_LAYER)?.paint).toMatchObject(LABEL_PAINT.dark);
    });

    it("draws the ground a place covers under its pin, where it covers any", async () => {
        const map = fakeMap();

        // The boundary is fetched once a place has been picked, so it arrives after the pin is up.
        const { rerender } = await renderMarker(map);
        await rerender({ outline: OUTLINE });

        expect(map.source(OUTLINE_SOURCE)).toMatchObject({ type: "geojson", data: { geometry: OUTLINE } });
        // A tint the map still shows through, ringed by the same colour the pin is drawn in.
        expect(map.layer(OUTLINE_FILL_LAYER)?.paint).toMatchObject({ "fill-color": PLACE_MARKER_COLOR });
        expect(map.layer(OUTLINE_LINE_LAYER)?.paint).toMatchObject({ "line-color": PLACE_MARKER_COLOR });
        // Under the pin, which would otherwise be buried by its own boundary.
        expect(map.addedBefore(OUTLINE_FILL_LAYER)).toBe(PLACE_LAYER);
        expect(map.addedBefore(OUTLINE_LINE_LAYER)).toBe(PLACE_LAYER);
    });

    it("draws no boundary for a place that stands at a point", async () => {
        const map = fakeMap();

        await renderMarker(map);

        expect(map.layer(OUTLINE_FILL_LAYER)).toBeUndefined();
        expect(map.source(OUTLINE_SOURCE)).toBeUndefined();
    });

    it("takes the layer and its source away with it, the layer first", async () => {
        const map = fakeMap();
        const { unmount } = await renderMarker(map);
        expect(map.layer(PLACE_LAYER)).toBeTruthy();

        await unmount();

        // A source still drawn from cannot be removed, so the layer goes first.
        expect(map.removals).toEqual([ `layer:${PLACE_LAYER}`, `source:${PLACE_SOURCE}` ]);
    });

    it("takes the boundary away with it too", async () => {
        const map = fakeMap();
        const { unmount } = await renderMarker(map, { outline: OUTLINE });

        await unmount();

        expect(map.removals).toEqual([
            `layer:${PLACE_LAYER}`, `source:${PLACE_SOURCE}`,
            `layer:${OUTLINE_FILL_LAYER}`, `layer:${OUTLINE_LINE_LAYER}`, `source:${OUTLINE_SOURCE}`
        ]);
    });
});
