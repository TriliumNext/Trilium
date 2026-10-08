/**
 * How a drawn shape is written onto its note, and read back off it.
 *
 * A shape lives in a label, like a marker's location (see `LOCATION_ATTRIBUTE` in Markers): the
 * same `lat,lng` pair, repeated, behind a prefix naming what the points make, as in
 * `#geoShape=line:48.858093,2.294694 48.860294,2.338629`. A polygon is a line closed at the end,
 * and the closing point is left out, since writing the first point twice only lets the two copies
 * disagree.
 *
 * A label rather than the note's content, so a shape travels in the attribute payload as
 * `#geolocation` does and the map draws every shape as soon as its children load, with no fetch per
 * shape. The
 * cost is a bounded size, which is why the drawing tools place one vertex per click rather than
 * following a freehand stroke, and why an imported track keeps its file-note form (see GpxTrack).
 */

import { type Bounds, boundsOf } from "./coordinates";

/** The label a shape note carries its geometry in. Declared in commons because `getNoteIcon`
 *  reads it to give a shape note the icon of the shape it draws, as it does
 *  `GEO_LOCATION_ATTRIBUTE`. */
export { GEO_SHAPE_ATTRIBUTE as SHAPE_ATTRIBUTE } from "@triliumnext/commons";

/** How many decimal places a coordinate keeps. Six is about a tenth of a meter, which is finer
 *  than a hand-placed vertex. */
const COORDINATE_DECIMALS = 6;

export interface GeoShapeLine {
    type: "line";
    /** `[lng, lat]` pairs, GeoJSON's order, ready for a MapLibre source or a Terra Draw feature. */
    coordinates: [number, number][];
}

export interface GeoShapePolygon {
    type: "polygon";
    /** `[lng, lat]` corners of the ring, without the closing repeat of the first. See
     *  {@link closeRing} for the ring in the form GeoJSON expects. */
    coordinates: [number, number][];
}

export interface GeoShapeCircle {
    type: "circle";
    /** `[lng, lat]` of the center. */
    center: [number, number];
    /** The circle's radius in meters, which a ring of points would only approximate. */
    radiusMeters: number;
    /**
     * The ring the circle is drawn as, where it is known already: the one a drawing tool produced,
     * or one an image map computes in pixels (see `imageSpace`). Without it the ring is walked out
     * of the radius by {@link circleRing}.
     */
    ring?: [number, number][];
}

/** Every kind of shape a note can carry. */
export type GeoShape = GeoShapeLine | GeoShapePolygon | GeoShapeCircle;

/** The fewest points each point-list kind needs: one point is no line, and two no area. A circle
 *  is not listed, being a center and a radius rather than a list of points. */
const MINIMUM_POINTS = { line: 2, polygon: 3 } as const;

/**
 * A shape as its label value: the kind, a colon, then each point as `lat,lng`, the order a
 * `#geolocation` label is read in however the coordinates are held in memory.
 *
 * A circle is written as its center and its radius in meters, `circle:48.85,2.29 500`, rather than
 * as the ring a drawing library holds it as. The ring only approximates the circle and is rebuilt
 * at whatever fineness the reader wants (see {@link circleRing}).
 */
export function serializeGeoShape(shape: GeoShape): string {
    if (shape.type === "circle") {
        return writeShape({
            type: "circle",
            points: [ toLatLng(shape.center) ],
            radius: Math.round(shape.radiusMeters * 10) / 10
        });
    }

    return writeShape({ type: shape.type, points: shape.coordinates.map(toLatLng) });
}

/**
 * The shape a label value spells, or null where it spells none.
 *
 * Null rather than a throw: the value is user-editable like any label, so a shape that cannot be
 * read is one the map does not draw rather than an error it falls over on. The rules are only what
 * the geometry demands: every point a finite `lat,lng` pair, and enough of them for the kind (see
 * {@link MINIMUM_POINTS}).
 */
export function parseGeoShape(value: string): GeoShape | null {
    const written = readShape(value);
    if (!written) return null;

    const [ first ] = written.points;
    if (written.type === "circle") {
        return { type: "circle", center: [ first[1], first[0] ], radiusMeters: written.radius };
    }

    return { type: written.type, coordinates: written.points.map(([ lat, lng ]) => [ lng, lat ]) };
}

/**
 * A shape label's value as it is written, before its pairs are read as places: the kind, each point
 * as the pair written for it, and a circle's radius. A geo map writes `lat,lng` pairs and a radius
 * in meters, an image map `x,y` pairs and a radius in pixels (see `imageSpace`).
 */
export type WrittenShape =
    | { type: "line" | "polygon"; points: [number, number][] }
    | { type: "circle"; points: [[number, number]]; radius: number };

/** The written shape a label value spells, or null where it spells none (see {@link parseGeoShape}). */
export function readShape(value: string): WrittenShape | null {
    const divide = value.indexOf(":");
    if (divide < 0) return null;

    const type = value.slice(0, divide);
    const rest = value.slice(divide + 1);

    if (type === "circle") {
        return readCircle(rest);
    }

    if (!isPointKind(type)) return null;

    const points = parsePoints(rest);
    if (!points || points.length < MINIMUM_POINTS[type]) return null;

    return { type, points };
}

/** A written shape as its label value. The numbers are written as given, rounded by the caller. */
export function writeShape(shape: WrittenShape): string {
    const points = shape.points.map(([ a, b ]) => `${a},${b}`).join(" ");
    return shape.type === "circle"
        ? `circle:${points} ${shape.radius}`
        : `${shape.type}:${points}`;
}

function readCircle(rest: string): WrittenShape | null {
    const parts = rest.trim().split(/\s+/);
    if (parts.length !== 2) return null;

    const center = parsePoints(parts[0]);
    const radius = Number(parts[1]);
    if (!center || center.length !== 1 || !Number.isFinite(radius) || radius <= 0) {
        return null;
    }

    return { type: "circle", points: [ center[0] ], radius };
}

/**
 * A polygon from the ring a drawing tool produces, which spells the closing point out: GeoJSON
 * rings end where they began and the label does not (see the module note).
 */
export function polygonFromRing(ring: [number, number][]): GeoShapePolygon {
    const [ firstLng, firstLat ] = ring[0] ?? [];
    const [ lastLng, lastLat ] = ring[ring.length - 1] ?? [];
    const closed = ring.length > 1 && firstLng === lastLng && firstLat === lastLat;
    return { type: "polygon", coordinates: closed ? ring.slice(0, -1) : ring };
}

/** The ring as GeoJSON expects it: ended where it began. */
export function closeRing(coordinates: [number, number][]): [number, number][] {
    return [ ...coordinates, coordinates[0] ];
}

/** The mean of the earth's radii, the value MapLibre uses as well. */
const EARTH_RADIUS_METERS = 6371008.8;

/** How many corners a circle's ring is drawn with, enough that none of them show. */
export const CIRCLE_SEGMENTS = 64;

/**
 * A circle's radius walked out as a ring, one point per bearing, without the closing repeat. This
 * is the ring a circle label is drawn from, and is not stored (see {@link serializeGeoShape}).
 * Great-circle rather than flat arithmetic, so a wide circle far from the equator keeps its shape.
 */
export function circleRing(center: [number, number], radiusMeters: number, segments = CIRCLE_SEGMENTS): [number, number][] {
    const [ lng, lat ] = center;
    const angular = radiusMeters / EARTH_RADIUS_METERS;
    const latRad = toRadians(lat);
    const lngRad = toRadians(lng);

    const ring: [number, number][] = [];
    for (let i = 0; i < segments; i++) {
        const bearing = (2 * Math.PI * i) / segments;
        const pointLat = Math.asin(
            Math.sin(latRad) * Math.cos(angular) +
            Math.cos(latRad) * Math.sin(angular) * Math.cos(bearing)
        );
        const pointLng = lngRad + Math.atan2(
            Math.sin(bearing) * Math.sin(angular) * Math.cos(latRad),
            Math.cos(angular) - Math.sin(latRad) * Math.sin(pointLat)
        );
        ring.push([ toDegrees(pointLng), toDegrees(pointLat) ]);
    }

    return ring;
}

/**
 * The mean of a ring's points. Exact for the regular ring a circle tool produces, which is the only
 * one it is asked about: this is how `shapeFromFeature` recovers the center a circle label stores.
 */
export function ringCenter(ring: [number, number][]): [number, number] | null {
    if (ring.length === 0) return null;

    let lngSum = 0;
    let latSum = 0;
    for (const [ lng, lat ] of ring) {
        lngSum += lng;
        latSum += lat;
    }
    return [ lngSum / ring.length, latSum / ring.length ];
}

/**
 * The bounding box `DetailPane` frames a shape by. A circle is measured across {@link circleRing}
 * rather than at its center, so the box covers the whole radius. The seam at ±180° is
 * {@link boundsOf}'s to deal with, as it is for a track.
 */
export function geoShapeBounds(shape: GeoShape): Bounds | null {
    return boundsOf(shape.type === "circle" ? shapeRing(shape) : shape.coordinates);
}

/** The ring a circle is drawn as: the one it carries, or one walked out of its radius. */
export function shapeRing(shape: GeoShapeCircle): [number, number][] {
    return shape.ring ?? circleRing(shape.center, shape.radiusMeters);
}

function toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
    return (radians * 180) / Math.PI;
}

function isPointKind(type: string): type is keyof typeof MINIMUM_POINTS {
    return Object.hasOwn(MINIMUM_POINTS, type);
}

/** A `[lng, lat]` point as the `lat,lng` pair a geo label writes, at the precision it keeps. */
function toLatLng([ lng, lat ]: [number, number]): [number, number] {
    return [ round(lat), round(lng) ];
}

/** Each `a,b` pair in a run of them, in the order written. */
function parsePoints(value: string): [number, number][] | null {
    const points: [number, number][] = [];
    for (const point of value.trim().split(/\s+/)) {
        const parts = point.split(",");
        if (parts.length !== 2) {
            return null;
        }

        const a = Number(parts[0]);
        const b = Number(parts[1]);
        if (!Number.isFinite(a) || !Number.isFinite(b)) {
            return null;
        }

        points.push([ a, b ]);
    }

    return points;
}

/** A coordinate at the precision the label keeps, without `toFixed`'s trailing zeros. */
function round(coordinate: number): number {
    const factor = 10 ** COORDINATE_DECIMALS;
    return Math.round(coordinate * factor) / factor;
}
