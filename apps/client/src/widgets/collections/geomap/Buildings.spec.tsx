/**
 * The buildings of the map underneath, stood up while the view is leaned over.
 *
 * What is checked here is mostly what the layer must *not* do. It draws from a source only the
 * built-in vector styles have, so a map on the raster layer has to be left alone rather than asked
 * for footprints it has none of. It replaces the style's own flat drawing of the same buildings, so
 * that one has to go down while it stands and come back when it does not. And it reads a height
 * that is an experimental extension of the tile schema rather than part of it, so a build of the
 * tiles without it must leave a town of low blocks rather than a flat grey plain.
 */
import type { FillExtrusionLayerSpecification, LayerSpecification, Map as MapLibreGLMap } from "maplibre-gl";
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it } from "vitest";

import { renderInto } from "../../../test/render";
import Buildings, { BUILDINGS_LAYER } from "./Buildings";
import { ParentMap } from "./map";

const SHORTBREAD_SOURCE = "versatiles-shortbread";

/** The built-in vector styles, in the shape this component reads them: footprints, then labels. */
function vectorStyleLayers(): LayerSpecification[] {
    return [
        { id: "land", type: "fill", source: SHORTBREAD_SOURCE, "source-layer": "land" },
        { id: "building:outline", type: "fill", source: SHORTBREAD_SOURCE, "source-layer": "buildings" },
        { id: "building", type: "fill", source: SHORTBREAD_SOURCE, "source-layer": "buildings" },
        { id: "poi-amenity", type: "symbol", source: SHORTBREAD_SOURCE, "source-layer": "pois" },
        { id: "label-street", type: "symbol", source: SHORTBREAD_SOURCE, "source-layer": "street_labels" }
    ];
}

/** The raster layer: one picture per tile, with no footprints in it to stand up. */
function rasterStyleLayers(): LayerSpecification[] {
    return [ { id: "raster-layer", type: "raster", source: "raster-tiles" } ];
}

/**
 * A map holding a style whose layers are in draw order, which is what this component arranges
 * itself within — and which tilts, since that is what it waits for.
 */
function fakeMap({ layers = vectorStyleLayers(), pitch = 0 } = {}) {
    const listeners = new Map<string, Set<() => void>>();
    const fire = (event: string) => {
        for (const listener of listeners.get(event) ?? []) listener();
    };

    return {
        layers,
        getStyle: () => ({ layers }),
        // A background layer draws from no source at all, so not every layer has one to compare.
        getSource: (id: string) => layers.find((layer) => "source" in layer && layer.source === id),
        getLayer: (id: string) => layers.find((layer) => layer.id === id),
        addLayer(layer: LayerSpecification, beforeId?: string) {
            const at = beforeId ? layers.findIndex((existing) => existing.id === beforeId) : -1;
            layers.splice(at < 0 ? layers.length : at, 0, layer);
        },
        removeLayer(id: string) {
            layers.splice(layers.findIndex((layer) => layer.id === id), 1);
        },
        setLayoutProperty(id: string, property: string, value: unknown) {
            const layer = layers.find((existing) => existing.id === id);
            if (!layer) throw new Error(`no such layer: ${id}`);
            layer.layout = { ...layer.layout, [property]: value };
        },
        getPitch: () => pitch,
        /** The view being leaned over, however it was — the 3D button, or Ctrl and a drag. */
        tiltTo(value: number) {
            pitch = value;
            fire("pitch");
        },
        /** A style having finished loading, which is what wipes and rebuilds everything on it. */
        loadStyle(replacement: LayerSpecification[]) {
            layers = replacement;
            this.layers = replacement;
            fire("style.load");
        },
        on(event: string, listener: () => void) {
            listeners.set(event, (listeners.get(event) ?? new Set()).add(listener));
        },
        off(event: string, listener: () => void) { listeners.get(event)?.delete(listener); },
        get listenerCount() {
            let count = 0;
            for (const held of listeners.values()) count += held.size;
            return count;
        }
    };
}

type FakeMap = ReturnType<typeof fakeMap>;

function renderBuildings(map: FakeMap, isDarkTheme = false) {
    let container: HTMLElement | undefined;
    act(() => {
        container = renderInto(
            <ParentMap.Provider value={map as unknown as MapLibreGLMap}>
                <Buildings isDarkTheme={isDarkTheme} />
            </ParentMap.Provider>
        );
    });
    if (!container) throw new Error("the buildings were not rendered");
    return container;
}

/**
 * The layer the component adds, or undefined while it stands down.
 *
 * Narrowed to the one kind of layer it can be, so that what the tests below read off it — the
 * filter, the extrusion paint — is known to be there rather than asserted to be.
 */
function extrusion(map: FakeMap): FillExtrusionLayerSpecification | undefined {
    const layer = map.layers.find((existing) => existing.id === BUILDINGS_LAYER);
    return layer?.type === "fill-extrusion" ? layer : undefined;
}

/** Whether the style's own flat drawing of the same footprints is still being drawn. */
function flatBuildingsVisible(map: FakeMap) {
    return map.layers
        .filter((layer) => "source-layer" in layer && layer["source-layer"] === "buildings" && layer.type === "fill")
        .every((layer) => layer.layout?.visibility !== "none");
}

describe("geo map Buildings", () => {
    it("stands the buildings up once the view is leaned over, and lays them back down with it", () => {
        const map = fakeMap();
        renderBuildings(map);

        // A map looked straight down at is left exactly as the style drew it: a roof seen from
        // above is the footprint already there, and the extrusion would only cost the draw twice.
        expect(extrusion(map)).toBeUndefined();
        expect(flatBuildingsVisible(map)).toBe(true);

        act(() => map.tiltTo(45));

        expect(extrusion(map)).toBeDefined();
        // The flat drawing goes down as the standing one goes up — both at once would draw the
        // same buildings twice, the fill showing through the walls at every ground floor.
        expect(flatBuildingsVisible(map)).toBe(false);

        act(() => map.tiltTo(0));

        expect(extrusion(map)).toBeUndefined();
        expect(flatBuildingsVisible(map)).toBe(true);
    });

    it("counts a lean already in force, the pitch never having been reported", () => {
        // A map restored into a leaned-over view, whose "pitch" event fires only once something
        // moves it — the buildings have to be up before that rather than after it.
        const map = fakeMap({ pitch: 60 });
        renderBuildings(map);

        expect(extrusion(map)).toBeDefined();
    });

    it("stands them under the style's own labels, not over them", () => {
        const map = fakeMap();
        renderBuildings(map);

        act(() => map.tiltTo(45));

        // A place name buried behind a tower reads as a missing label.
        const order = map.layers.map((layer) => layer.id);
        expect(order.indexOf(BUILDINGS_LAYER)).toBeLessThan(order.indexOf("poi-amenity"));
        expect(order.indexOf(BUILDINGS_LAYER)).toBeGreaterThan(order.indexOf("land"));
    });

    it("leaves a map with nothing to stand up alone", () => {
        // The raster layer is a picture per tile: it carries no footprints, and asking its source
        // for a layer of them would be an error per tile rather than a map without buildings.
        const map = fakeMap({ layers: rasterStyleLayers() });
        renderBuildings(map);

        act(() => map.tiltTo(45));

        expect(extrusion(map)).toBeUndefined();
        expect(map.layers.map((layer) => layer.id)).toEqual([ "raster-layer" ]);
    });

    it("reads a height the tiles may one day not carry, and leaves the cut-out footprints down", () => {
        const map = fakeMap();
        renderBuildings(map);

        act(() => map.tiltTo(45));
        const layer = extrusion(map);

        // The height is an experimental extension of the Shortbread schema rather than part of it,
        // so the layer has to degrade to low blocks rather than to a flat plain if it is dropped.
        expect(layer?.paint?.["fill-extrusion-height"]).toEqual([ "coalesce", [ "get", "height" ], 5 ]);
        expect(layer?.paint?.["fill-extrusion-base"]).toEqual([ "coalesce", [ "get", "min_height" ], 0 ]);
        // A footprint whose upper storeys are separate features would otherwise be drawn as a
        // solid block standing in the space those features describe.
        expect(layer?.filter).toEqual([ "!=", [ "get", "hide_3d" ], true ]);
        expect(layer?.minzoom).toBe(14);
    });

    it("puts them back where a style switch left them, painted for the map that arrived", () => {
        const map = fakeMap();
        renderBuildings(map, false);
        act(() => map.tiltTo(45));
        const overLightMap = extrusion(map)?.paint?.["fill-extrusion-color"];

        // A style switch carries the layer across (see keepAdditions in map.tsx) but appends what
        // it carries above everything in the incoming style, labels included — and the flat fill
        // it hid belongs to the style that has just gone.
        const carriedOver = extrusion(map);
        if (!carriedOver) throw new Error("nothing to carry over");
        act(() => {
            map.loadStyle([ ...vectorStyleLayers(), carriedOver ]);
            render(
                <ParentMap.Provider value={map as unknown as MapLibreGLMap}>
                    <Buildings isDarkTheme={true} />
                </ParentMap.Provider>,
                document.body.lastElementChild as HTMLElement
            );
        });

        const order = map.layers.map((layer) => layer.id);
        expect(order.filter((id) => id === BUILDINGS_LAYER)).toHaveLength(1);
        expect(order.indexOf(BUILDINGS_LAYER)).toBeLessThan(order.indexOf("poi-amenity"));
        expect(flatBuildingsVisible(map)).toBe(false);
        // Repainted for the map that arrived rather than the one that left.
        expect(extrusion(map)?.paint?.["fill-extrusion-color"]).not.toBe(overLightMap);
    });

    it("takes them down on a style that arrives with nothing to stand up", () => {
        // Switching to the raster map while the view is leaned over. `keepAdditions` now leaves the
        // layer behind rather than handing it on without its source (see map.spec), but this does
        // not lean on that: whatever a style load brings, the layer is left standing only where
        // there is something under it to draw from.
        const map = fakeMap();
        renderBuildings(map);
        act(() => map.tiltTo(45));
        const carriedOver = extrusion(map);
        if (!carriedOver) throw new Error("nothing to carry over");

        act(() => map.loadStyle([ ...rasterStyleLayers(), carriedOver ]));

        expect(extrusion(map)).toBeUndefined();
    });

    it("stops listening to a map it is taken off, giving the flat buildings back", () => {
        const map = fakeMap();
        const container = renderBuildings(map);
        act(() => map.tiltTo(45));

        act(() => { render(null, container); });

        expect(extrusion(map)).toBeUndefined();
        expect(flatBuildingsVisible(map)).toBe(true);
        expect(map.listenerCount).toBe(0);
    });
});
