/**
 * How a drawn shape is written onto its note, and read back off it.
 *
 * A shape lives in a label the way a marker's location does (see `LOCATION_ATTRIBUTE` in Markers):
 * the same `lat,lng` atom, pluralized — one pair per vertex, space-separated, behind a prefix naming
 * what the vertices make. `#geoShape=line:48.858093,2.294694 48.860294,2.338629` is the marker
 * format anyone has already read, walked along a path.
 *
 * A label rather than the note's content so the shape rides the attribute payload the way
 * `#geolocation` does: the map draws every shape the moment its children load, with no fetch per
 * shape. The trade is a bounded size — a label is no home for a thousand points, which is why the
 * drawing tools are the deliberate, click-a-vertex kind rather than freehand (and why an imported
 * track keeps its own file-note form; see GpxTrack).
 */

/** The label a shape note carries its geometry in. */
export const SHAPE_ATTRIBUTE = "geoShape";

/** How many decimal places a coordinate keeps: six is about a tenth of a metre, which is already
 *  more than a hand-placed vertex means. */
const COORDINATE_DECIMALS = 6;

export interface GeoShapeLine {
    type: "line";
    /** `[lng, lat]` pairs — GeoJSON's order, ready for a MapLibre source or a Terra Draw feature. */
    coordinates: [number, number][];
}

/** Every kind of shape a note can carry. Only lines yet; the format leaves room in its prefix. */
export type GeoShape = GeoShapeLine;

/**
 * A line as its label value: `line:` and then each vertex as `lat,lng`, in the order the reader of
 * a `#geolocation` label expects, however the coordinates are held in memory.
 */
export function serializeLine(coordinates: [number, number][]): string {
    const points = coordinates
        .map(([ lng, lat ]) => `${round(lat)},${round(lng)}`)
        .join(" ");
    return `line:${points}`;
}

/**
 * The shape a label value spells, or null where it spells none.
 *
 * Null rather than a throw, whatever is wrong with it — the value is user-editable like any label,
 * and a shape that cannot be read is a shape the map does not draw, not an error the map falls over
 * on. The rules are only what the geometry itself demands: every vertex a finite `lat,lng` pair,
 * and at least two of them, one point being no line.
 */
export function parseGeoShape(value: string): GeoShape | null {
    if (!value.startsWith("line:")) {
        return null;
    }

    const coordinates: [number, number][] = [];
    for (const point of value.slice("line:".length).trim().split(/\s+/)) {
        const parts = point.split(",");
        if (parts.length !== 2) {
            return null;
        }

        const lat = Number(parts[0]);
        const lng = Number(parts[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return null;
        }

        coordinates.push([ lng, lat ]);
    }

    if (coordinates.length < 2) {
        return null;
    }

    return { type: "line", coordinates };
}

/** A coordinate at the precision the label keeps, without `toFixed`'s trailing zeros. */
function round(coordinate: number): number {
    const factor = 10 ** COORDINATE_DECIMALS;
    return Math.round(coordinate * factor) / factor;
}
