/**
 * How a drawn shape is written onto its note, and read back off it.
 *
 * A shape lives in a label the way a marker's location does (see `LOCATION_ATTRIBUTE` in Markers):
 * the same `lat,lng` atom, pluralized — a prefix naming what the points make, then the points.
 * `#geoShape=line:48.858093,2.294694 48.860294,2.338629` is the marker format anyone has already
 * read, walked along a path; a polygon is the same walk closed at the end (the closing point is
 * not written — it is the first one again, and writing it twice would only invite the two copies
 * to disagree).
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

export interface GeoShapePolygon {
    type: "polygon";
    /** `[lng, lat]` corners of the ring, without the closing repeat of the first — see
     *  {@link closeRing} for the ring as GeoJSON wants it. */
    coordinates: [number, number][];
}

export interface GeoShapeCircle {
    type: "circle";
    /** `[lng, lat]` of the centre. */
    center: [number, number];
    /** How far the circle reaches, in metres — the one number the points would only approximate. */
    radiusMeters: number;
}

/** Every kind of shape a note can carry. */
export type GeoShape = GeoShapeLine | GeoShapePolygon | GeoShapeCircle;

/** The fewest points each point-list kind is a shape at all with: one point is no line, and two
 *  no area. A circle is not among them — it is a centre and a reach, not a walk. */
const MINIMUM_POINTS = { line: 2, polygon: 3 } as const;

/**
 * A shape as its label value: the kind, a colon, and each point as `lat,lng` — the order the
 * reader of a `#geolocation` label expects, however the coordinates are held in memory. A circle
 * is its centre and then its radius in metres, `circle:48.85,2.29 500`, rather than the ring of
 * points a drawing library holds it as: the ring is an approximation regenerated at whatever
 * fineness the reader wants (see {@link circleRing}), and sixty-odd points would swell the label
 * for less information than two numbers carry.
 */
export function serializeGeoShape(shape: GeoShape): string {
    if (shape.type === "circle") {
        const [ lng, lat ] = shape.center;
        return `circle:${round(lat)},${round(lng)} ${Math.round(shape.radiusMeters * 10) / 10}`;
    }

    return `${shape.type}:${serializePoints(shape.coordinates)}`;
}

/**
 * The shape a label value spells, or null where it spells none.
 *
 * Null rather than a throw, whatever is wrong with it — the value is user-editable like any label,
 * and a shape that cannot be read is a shape the map does not draw, not an error the map falls
 * over on. The rules are only what the geometry itself demands: every point a finite `lat,lng`
 * pair, and enough of them for the kind (see {@link MINIMUM_POINTS}).
 */
export function parseGeoShape(value: string): GeoShape | null {
    const divide = value.indexOf(":");
    if (divide < 0) return null;

    const type = value.slice(0, divide);
    const rest = value.slice(divide + 1);

    if (type === "circle") {
        return parseCircle(rest);
    }

    if (!isPointKind(type)) return null;

    const coordinates = parsePoints(rest);
    if (!coordinates || coordinates.length < MINIMUM_POINTS[type]) return null;

    return { type, coordinates };
}

function parseCircle(rest: string): GeoShapeCircle | null {
    const parts = rest.trim().split(/\s+/);
    if (parts.length !== 2) return null;

    const center = parsePoints(parts[0]);
    const radiusMeters = Number(parts[1]);
    if (!center || center.length !== 1 || !Number.isFinite(radiusMeters) || radiusMeters <= 0) {
        return null;
    }

    return { type: "circle", center: center[0], radiusMeters };
}

/**
 * A polygon from the ring a drawing tool hands over, which spells the closing point out — GeoJSON
 * rings end where they began, and the label does not (see the module note).
 */
export function polygonFromRing(ring: [number, number][]): GeoShapePolygon {
    const [ firstLng, firstLat ] = ring[0] ?? [];
    const [ lastLng, lastLat ] = ring[ring.length - 1] ?? [];
    const closed = ring.length > 1 && firstLng === lastLng && firstLat === lastLat;
    return { type: "polygon", coordinates: closed ? ring.slice(0, -1) : ring };
}

/** The ring as GeoJSON wants it back: ended where it began. */
export function closeRing(coordinates: [number, number][]): [number, number][] {
    return [ ...coordinates, coordinates[0] ];
}

/** The mean of the earth's radii, as MapLibre also takes it. */
const EARTH_RADIUS_METERS = 6371008.8;

/** How many corners a circle's ring is drawn with — enough that nobody sees them. */
const CIRCLE_SEGMENTS = 64;

/**
 * A circle's reach walked out as a ring, one point per bearing, without the closing repeat — the
 * ring a circle label is drawn from (see {@link serializeGeoShape} for why it is not stored).
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
 * Where a ring stands: the mean of its points. Exact for the regular ring a circle tool hands
 * over, which is all it is asked about — this is how the centre a circle label stores is read
 * back off the ring Terra Draw drew (see `shapeFromFeature`).
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

function toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
    return (radians * 180) / Math.PI;
}

function isPointKind(type: string): type is keyof typeof MINIMUM_POINTS {
    return Object.hasOwn(MINIMUM_POINTS, type);
}

function serializePoints(coordinates: [number, number][]): string {
    return coordinates
        .map(([ lng, lat ]) => `${round(lat)},${round(lng)}`)
        .join(" ");
}

function parsePoints(value: string): [number, number][] | null {
    const coordinates: [number, number][] = [];
    for (const point of value.trim().split(/\s+/)) {
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

    return coordinates;
}

/** A coordinate at the precision the label keeps, without `toFixed`'s trailing zeros. */
function round(coordinate: number): number {
    const factor = 10 ** COORDINATE_DECIMALS;
    return Math.round(coordinate * factor) / factor;
}
