/**
 * The style switch, which used to take the markers with it.
 *
 * Everything a child of the map draws — the note markers, a GPX track — is a source and a layer of
 * the map's style, since a map has nowhere else to put them. Switching the style therefore dropped
 * them, and they were added again only once the new style had loaded: on a slow network the map
 * stood empty for as long as that took. They are handed to the incoming style instead.
 */
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";

import { keepAdditions, styleContents, summarizeMapError } from "./map";

/** A style with the given sources and layers, as MapLibre serializes one. */
function style(sources: string[], layers: string[]): StyleSpecification {
    return {
        version: 8,
        sources: Object.fromEntries(sources.map((id) => [ id, { type: "geojson", data: { type: "FeatureCollection", features: [] } } ])),
        layers: layers.map((id) => ({ id, type: "background" } as LayerSpecification))
    };
}

/** The style with the markers on it, as the map stands once a child has added them. */
function withMarkers(base: StyleSpecification): StyleSpecification {
    return {
        ...base,
        sources: { ...base.sources, points: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
        layers: [ ...base.layers, { id: "points-layer", type: "symbol", source: "points" } as LayerSpecification ]
    };
}

describe("keepAdditions", () => {
    const applied = style([ "openmaptiles" ], [ "background", "water" ]);
    const next = style([ "versatiles" ], [ "land", "roads" ]);

    it("carries what a child added over, and leaves the old map behind", () => {
        const transformed = keepAdditions(styleContents(applied))(withMarkers(applied), next);

        // The markers came across...
        expect(Object.keys(transformed.sources)).toContain("points");
        expect(transformed.layers.map((layer) => layer.id)).toContain("points-layer");
        // ...and the style they were sitting on did not, or it would still be drawn underneath.
        expect(Object.keys(transformed.sources)).not.toContain("openmaptiles");
        expect(transformed.layers.map((layer) => layer.id)).not.toContain("water");
        // The incoming style is otherwise untouched, and what was added is drawn over it.
        expect(transformed.layers.map((layer) => layer.id)).toEqual([ "land", "roads", "points-layer" ]);
        expect(Object.keys(transformed.sources)).toContain("versatiles");
    });

    it("hands the source over as it now stands, not as it was added", () => {
        const previous = withMarkers(applied);
        const features = [ { type: "Feature", geometry: { type: "Point", coordinates: [ 1, 2 ] }, properties: {} } ];
        previous.sources.points = { type: "geojson", data: { type: "FeatureCollection", features } as never };

        const transformed = keepAdditions(styleContents(applied))(previous, next);

        // The markers survive with the notes on them: an empty source carried across would blink
        // every marker off until the next build filled it again, which is the point of carrying it.
        expect(transformed.sources.points).toEqual(previous.sources.points);
    });

    it("leaves a style alone when there is nothing on it but itself", () => {
        const transformed = keepAdditions(styleContents(applied))(applied, next);

        expect(transformed.layers.map((layer) => layer.id)).toEqual([ "land", "roads" ]);
        expect(Object.keys(transformed.sources)).toEqual([ "versatiles" ]);
    });

    it("keeps the incoming style's own when an addition shares its name", () => {
        const clashing = style([ "points" ], [ "points-layer" ]);
        const transformed = keepAdditions(styleContents(applied))(withMarkers(applied), clashing);

        expect(transformed.sources.points).toEqual(clashing.sources.points);
        expect(transformed.layers).toHaveLength(1);
    });

    /**
     * The 3D buildings, which draw from the vector style's own source rather than from one of their
     * own (see Buildings). Switching to the raster map used to carry the layer across and leave the
     * source behind, and MapLibre validates a whole style before applying any of it: the switch was
     * refused outright with `source "versatiles-shortbread" not found`, no `style.load` fired, and
     * the map stayed on the very style the reader had just asked to leave.
     */
    it("leaves behind an addition whose source belongs to the style that is going", () => {
        const buildings3d = {
            "id": "buildings-3d",
            "type": "fill-extrusion",
            "source": "openmaptiles",
            "source-layer": "buildings"
        } as LayerSpecification;
        const withBuildings: StyleSpecification = {
            ...applied,
            layers: [ ...applied.layers, buildings3d ]
        };

        const transformed = keepAdditions(styleContents(applied))(withBuildings, next);

        expect(transformed.layers.map((layer) => layer.id)).toEqual([ "land", "roads" ]);
        expect(Object.keys(transformed.sources)).toEqual([ "versatiles" ]);
    });

    it("still carries an addition that brought its own source along", () => {
        // The markers and the tracks, which are not affected by the rule above: their source is
        // carried across with them, so the layer naming it is satisfied in the incoming style.
        const transformed = keepAdditions(styleContents(applied))(withMarkers(applied), next);

        expect(transformed.layers.map((layer) => layer.id)).toContain("points-layer");
        expect(Object.keys(transformed.sources)).toContain("points");
    });

    /**
     * The map has loaded no style of its own yet, so there is nothing to tell a child's additions
     * apart from. Carrying nothing leaves the markers to be added again on `style.load`, which is
     * what happened before any of this.
     */
    it("carries nothing when the style it is switching from is not known", () => {
        const transformed = keepAdditions(undefined)(withMarkers(applied), next);

        expect(transformed).toBe(next);
    });
});

/**
 * The console, which a tile server refusing us used to fill.
 *
 * MapLibre prints an error nobody listens for itself, with the stack of the fetch behind it, and a
 * map asks for a hundred tiles: the same stack a hundred times over. One line per distinct failure
 * is what the map settles for instead.
 */
describe("summarizeMapError", () => {
    /** A failed request, as MapLibre's own `AJAXError` carries it. */
    function ajaxError(status: number, statusText: string, url: string) {
        return Object.assign(new Error(`AJAXError: ${statusText} (${status}): ${url}`), { status, statusText, url });
    }

    it("names the server and the status, and says which URL asked", () => {
        const { message } = summarizeMapError(ajaxError(403, "Forbidden", "https://tiles.mapgenie.io/games/fallout-4/10/512/510.png"));

        expect(message).toBe("tiles.mapgenie.io answered 403 Forbidden — could not load https://tiles.mapgenie.io/games/fallout-4/10/512/510.png");
        // The stack the message would otherwise be printed with is what makes it verbose.
        expect(message).not.toContain("maplibre");
    });

    it("counts every tile the same server refuses as the one failure", () => {
        const first = summarizeMapError(ajaxError(403, "Forbidden", "https://tiles.mapgenie.io/10/512/510.png"));
        const second = summarizeMapError(ajaxError(403, "Forbidden", "https://tiles.mapgenie.io/10/513/510.png"));

        expect(second.key).toBe(first.key);
        // A different server, or a different thing going wrong with the same one, is still worth saying.
        expect(summarizeMapError(ajaxError(404, "Not Found", "https://tiles.mapgenie.io/10/512/510.png")).key).not.toBe(first.key);
        expect(summarizeMapError(ajaxError(403, "Forbidden", "https://tiles.versatiles.org/10/512/510.png")).key).not.toBe(first.key);
    });

    it("copes with a status that has no text and a URL that is not one", () => {
        expect(summarizeMapError(ajaxError(0, "", "/local/tiles/10/512/510.png")).message)
            .toBe("/local/tiles/10/512/510.png answered 0 — could not load /local/tiles/10/512/510.png");
    });

    it("falls back to whatever the error says when it is not a failed request", () => {
        expect(summarizeMapError(new Error("Style is not done loading"))).toEqual({
            key: "Style is not done loading",
            message: "Style is not done loading"
        });
        expect(summarizeMapError("something went wrong").message).toBe("something went wrong");
    });
});
