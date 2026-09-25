/**
 * Points on the map: reading one out of what a reader typed, writing one back, and boxing a set of
 * them so the camera can be pointed at all of them at once.
 *
 * The forms understood are the ones a reader arrives with: a bare pair, as both Google Maps and
 * OpenStreetMap hand over when asked for a place's coordinates and as `#geolocation` holds them;
 * the `geo:` URI the map itself offers a place under (see the location actions in DetailPane and
 * ContextMenus); and the URLs of those two sites, which are what a reader copies when they have
 * not gone looking for the coordinates at all.
 */

import type { GeoSearchResult } from "./geocoding";

/** How far north or south a point can stand, and how far east or west. */
const MAX_LATITUDE = 90;
const MAX_LONGITUDE = 180;

/** A decimal number, signed or not, as every form below spells one. */
const NUMBER = String.raw`[+-]?\d+(?:\.\d+)?`;

/**
 * The forms a point is written in, each holding the latitude first and the longitude second.
 *
 * Ordered from the most exact to the loosest: a bare pair is the whole of what was typed, while the
 * URL forms are looked for within it, and `@lat,lng` would otherwise be read out of a Google Maps
 * URL that also carries the place it stands for.
 */
const FORMS = [
    /** A bare pair, separated by a comma or by spaces: `45.9432, 24.9668`. */
    new RegExp(String.raw`^(${NUMBER})\s*(?:,\s*|\s+)(${NUMBER})$`),
    /** The `geo:` URI, whose zoom and uncertainty parameters are left to whoever wants them. */
    new RegExp(String.raw`^geo:(${NUMBER}),(${NUMBER})`, "i"),
    /** OpenStreetMap's marker link: `?mlat=45.9432&mlon=24.9668`. */
    new RegExp(String.raw`[?&]mlat=(${NUMBER})&mlon=(${NUMBER})`, "i"),
    /** OpenStreetMap's view, which its address bar carries: `#map=15/45.9432/24.9668`. */
    new RegExp(String.raw`#map=${NUMBER}/(${NUMBER})/(${NUMBER})`, "i"),
    /** What Google Maps puts a query under: `?q=45.9432,24.9668`. */
    new RegExp(String.raw`[?&](?:q|query|ll)=(${NUMBER}),(${NUMBER})`, "i"),
    /** Where Google Maps says the view stands: `/@45.9432,24.9668,15z`. */
    new RegExp(String.raw`@(${NUMBER}),(${NUMBER})`)
];

/**
 * The point `query` names, as `[lng, lat]` — the order the map holds a position in (see
 * `parseLocation` in Markers) — or `null` for anything that does not name one.
 *
 * A pair that stands off the Earth is not a point: `1234, 5678` is a pair of numbers a reader is
 * looking for rather than somewhere to be flown to.
 */
export function parseCoordinates(query: string): [number, number] | null {
    const trimmed = query.trim();

    for (const form of FORMS) {
        const match = form.exec(trimmed);
        if (!match) continue;

        const lat = Number(match[1]);
        const lng = Number(match[2]);
        if (Math.abs(lat) > MAX_LATITUDE || Math.abs(lng) > MAX_LONGITUDE) continue;

        return [ lng, lat ];
    }

    return null;
}

/**
 * A point as it is named on the map and in the list: the coordinates as they were typed rather than
 * padded out to a fixed precision, a reader who typed four decimals having meant four.
 */
export function formatCoordinates([ lng, lat ]: [number, number]) {
    return `${lat}, ${lng}`;
}

/**
 * How close a point named by its coordinates is shown. Nearer than the level a place of unsaid
 * extent is given: coordinates name one spot rather than the town around it.
 */
export const POINT_ZOOM = 16;

/**
 * Builds a `GeoSearchResult` for a bare coordinate, shaped like any geocoder result so `pickPlace`
 * can pin it and offer it for keeping as a marker (see PlacePanel). It has no name, so it is named by
 * its own coordinates and marked `unnamed`.
 *
 * Used for a coordinate typed into the search bar and for the device's location fix.
 */
export function pointPlace(center: [number, number]): GeoSearchResult {
    const [ lng, lat ] = center;
    const coordinates = formatCoordinates(center);

    return {
        id: `point:${lng},${lat}`,
        name: coordinates,
        label: coordinates,
        lat,
        lng,
        zoom: POINT_ZOOM,
        unnamed: true
    };
}

/** The corners of a box, as `fitBounds` wants them: south-west first, north-east second. */
export type Bounds = [[number, number], [number, number]];

/**
 * The box a set of `[lng, lat]` points fits into, or `null` where there are no points.
 *
 * Longitude is read in two frames at once, because it is a circle wearing a seam: points either
 * side of ±180° are a stroll apart on the ground, and their raw minimum and maximum span nearly the
 * whole world. The same longitudes are therefore also read with the seam moved to 0° — each western
 * value pushed a turn east — and the shifted frame answers where it draws the narrower box.
 *
 * Only a box wider than half the world is reconsidered, that being the width a crossing of the seam
 * produces. Anything narrower is already whole, and the two widths are then equal to within what
 * floating point does to them, which is enough to send a set of points in Florida round the far
 * side of the world. The shifted answer may name longitudes past 180°, which `fitBounds` takes in
 * stride.
 *
 * Takes an iterable so a caller with many points — a GPX track holds thousands — can yield them as
 * they are read rather than gather them into an array first.
 */
export function boundsOf(points: Iterable<number[]>): Bounds | null {
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    let westShifted = Infinity, eastShifted = -Infinity;

    for (const [ lng, lat ] of points) {
        west = Math.min(west, lng);
        south = Math.min(south, lat);
        east = Math.max(east, lng);
        north = Math.max(north, lat);

        const shifted = lng < 0 ? lng + 360 : lng;
        westShifted = Math.min(westShifted, shifted);
        eastShifted = Math.max(eastShifted, shifted);
    }

    if (!Number.isFinite(west)) return null;

    const spansHalfTheWorld = east - west > 180;
    return spansHalfTheWorld && eastShifted - westShifted < east - west
        ? [ [ westShifted, south ], [ eastShifted, north ] ]
        : [ [ west, south ], [ east, north ] ];
}
