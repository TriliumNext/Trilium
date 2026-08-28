/**
 * Reading a point out of what was typed into the search bar, so a pair of coordinates can be gone
 * to as directly as a place can be searched for.
 *
 * The forms understood are the ones a reader arrives with: a bare pair, as both Google Maps and
 * OpenStreetMap hand over when asked for a place's coordinates and as `#geolocation` holds them;
 * the `geo:` URI the map itself offers a place under (see the location actions in DetailPane and
 * ContextMenus); and the URLs of those two sites, which are what a reader copies when they have
 * not gone looking for the coordinates at all.
 */

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
