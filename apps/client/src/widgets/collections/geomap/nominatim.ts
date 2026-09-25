import { getCurrentLanguage } from "../../../services/i18n";
import { type GeoBounds, type GeocodingProvider, type GeoSearchOptions, type GeoSearchResult, SEARCH_RADIUS_M } from "./geocoding";
import { placeIcon } from "./osm_icons";
import { formatStreet, type PlaceAddress } from "./place_address";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_LOOKUP_URL = "https://nominatim.openstreetmap.org/lookup";

/**
 * The coarsest a boundary is simplified to, in degrees — roughly 100 m. At full detail a country runs
 * to megabytes, and a border drawn over a map is not read to the metre.
 */
const MAX_POLYGON_THRESHOLD = 0.001;

/**
 * How small a part of a place's own extent the simplification is allowed to lose. A fixed threshold
 * that suits a country flattens a building to a triangle, so it is scaled to what is being drawn.
 */
const POLYGON_THRESHOLD_RATIO = 1 / 100;

/** How a lookup names an OSM object, from how a search result names one. */
const OSM_TYPE_PREFIX: Record<string, string> = { node: "N", way: "W", relation: "R" };

/** The kinds of OSM object that can enclose ground. A node is a single point and has no boundary. */
const OSM_TYPES_WITH_A_BOUNDARY = new Set([ "way", "relation" ]);


/** Metres to a degree of latitude, the same the world over. A degree of longitude is this shortened
 *  by the cosine of the latitude. */
const METRES_PER_DEGREE = 111_320;

/** Caps how many results one search returns. */
const MAX_RESULTS = 8;

/**
 * Nominatim's usage policy allows at most one request per second, and blocks clients that exceed it.
 * See https://operations.osmfoundation.org/policies/nominatim/.
 */
const MIN_REQUEST_INTERVAL = 1000;

/** When the next request may go out, moved forward as each one is let through. */
let nextRequestAt = 0;

/** The requests waiting for a slot, in the order they asked for one. */
const waiting: { resolve(letThrough: boolean): void }[] = [];

/** Holds the wait of whichever request stands at the head of {@link waiting}. */
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Nominatim, the geocoder run by the OpenStreetMap Foundation.
 *
 * No API key, and it answers with `Access-Control-Allow-Origin: *`, so the browser can ask it
 * directly — which matters on desktop, where the page is served from `trilium-app://`. Its policy
 * also asks that clients identify themselves, which a browser can only do through the `Referer` it
 * sends of its own accord.
 *
 * The same policy rules out searching as the user types, which is why a search runs only when the
 * user asks for one (see SearchBox).
 *
 * A search is answered in two passes where the map says what it is showing, so that what is at hand
 * comes first and what is far off still comes at all (see searchNominatim).
 */
export const nominatim: GeocodingProvider = {
    name: "Nominatim (OpenStreetMap)",
    search: searchNominatim
};

async function searchNominatim(query: string, { viewport }: GeoSearchOptions = {}): Promise<GeoSearchResult[]> {
    const viewbox = toViewbox(viewport);

    // What the map is showing, and nothing else. A viewbox on its own is only a nudge next to how
    // well known a place is, so a supermarket in the town on screen stays buried under the towns of
    // that name across the world — restricting the search to the view is what brings it up.
    const nearby = viewbox ? await searchPlaces(query, { viewbox, bounded: "1" }) : [];
    if (nearby.length >= MAX_RESULTS) {
        return nearby;
    }

    // Then the wider world, so that a place nowhere near the map is still found, and a view holding
    // one match is not the whole answer. What is at hand stands above it either way.
    const elsewhere = await searchPlaces(query, viewbox ? { viewbox } : {});

    return dedupe([ ...nearby, ...elsewhere ]).slice(0, MAX_RESULTS);
}

/**
 * Drops a place already offered, keeping the first of them — which is the nearest, the passes running
 * that way round.
 *
 * By what it says as well as by which place it is. A shop and the building around it are two OSM
 * objects under one name and one address, and two rows a reader cannot tell apart are one answer
 * given twice.
 */
function dedupe(places: GeoSearchResult[]): GeoSearchResult[] {
    const seen = new Set<string>();

    return places.filter((place) => {
        if (seen.has(place.id) || seen.has(place.label)) {
            return false;
        }

        seen.add(place.id);
        seen.add(place.label);
        return true;
    });
}

/** One request to Nominatim's search, asked in the language the app runs in. */
async function searchPlaces(query: string, extraParams: Record<string, string>): Promise<GeoSearchResult[]> {
    const params = new URLSearchParams({
        q: query,
        format: "jsonv2",
        limit: String(MAX_RESULTS),
        // The address in parts, which is what names a house and places a shop (see place_address).
        addressdetails: "1",
        ...extraParams
    });

    // Place names in the language the app runs in, where Nominatim holds one. Trilium writes some
    // locale ids with an underscore (`pt_br`), which is not what a language tag looks like.
    const language = getCurrentLanguage();
    if (language) {
        params.set("accept-language", language.replace("_", "-"));
    }

    await waitForRequestSlot();
    const response = await fetch(`${NOMINATIM_URL}?${params}`);
    if (!response.ok) {
        throw new Error(`Nominatim answered ${response.status} ${response.statusText}`);
    }

    const places: NominatimPlace[] = await response.json();
    return places.map(toSearchResult).filter((result) => result !== null);
}

/** One entry of a Nominatim `jsonv2` response, narrowed to the fields a result is built from. */
interface NominatimPlace {
    place_id?: number;
    osm_type?: string;
    osm_id?: number;
    display_name?: string;
    name?: string;
    lat?: string;
    lon?: string;
    /** `[south, north, west, east]`, as strings, which is the order Nominatim writes it in. */
    boundingbox?: string[];
    /** The OSM key the place is filed under: `shop`, `amenity`, `boundary`. */
    category?: string;
    /** The OSM value under that key: `supermarket`, `restaurant`, `administrative`. */
    type?: string;
    /** What kind of address the place is: `city`, `country`, `road`, `shop`. */
    addresstype?: string;
    /** The address in parts, asked for with `addressdetails`. */
    address?: NominatimAddress;
}

/**
 * Nominatim's breakdown of an address, narrowed to the parts a result is named and placed by.
 *
 * It names the town by what kind of settlement it is, so a place in a village carries `village` and
 * no `city`; the same goes for the region around it (see toAddress).
 */
interface NominatimAddress {
    house_number?: string;
    road?: string;
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    municipality?: string;
    county?: string;
    state?: string;
    province?: string;
    region?: string;
    country?: string;
    country_code?: string;
}

/** A place as the app holds one, or `null` where the entry carries no readable position. */
function toSearchResult(place: NominatimPlace): GeoSearchResult | null {
    const lat = Number(place.lat);
    const lng = Number(place.lon);
    if (!place.display_name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
    }

    const address = toAddress(place.address);
    const prefix = OSM_TYPE_PREFIX[place.osm_type ?? ""];
    const osmId = prefix && place.osm_id ? `${prefix}${place.osm_id}` : null;
    const hasBoundary = OSM_TYPES_WITH_A_BOUNDARY.has(place.osm_type ?? "");
    const bounds = toBounds(place.boundingbox);

    return {
        // What OSM calls the place, where it says: `place_id` is Nominatim's own numbering, and the
        // public service runs several instances that number independently, so the same place comes
        // back under two of them and is offered twice.
        id: osmId ?? String(place.place_id ?? `${lat},${lng}`),
        label: place.display_name,
        // Nominatim leaves `name` empty for a result that is an address rather than a named place.
        // Its street and number name it; the leading part of the label, which is the house number on
        // its own, is what is left when even those are missing.
        name: place.name || address?.street || place.display_name.split(",")[0].trim(),
        address,
        lat,
        lng,
        bounds,
        icon: placeIcon({ category: place.category, type: place.type, addressType: place.addresstype }),
        outline: osmId && hasBoundary ? (signal?: AbortSignal) => fetchOutline(osmId, bounds, signal) : undefined
    };
}

/**
 * Nominatim's address, in the parts a result is named and placed by, or nothing where it broke the
 * address into none.
 *
 * The town and the region are each named by whichever kind of place fills that role here: a village
 * has no `city`, and a county stands in for a state where a country has no states.
 */
function toAddress(address: NominatimAddress | undefined): PlaceAddress | undefined {
    if (!address) {
        return undefined;
    }

    const countryCode = address.country_code?.toLowerCase();
    const place: PlaceAddress = {
        street: formatStreet(address.house_number, address.road, countryCode),
        locality: address.city ?? address.town ?? address.village ?? address.hamlet ?? address.municipality,
        region: address.state ?? address.province ?? address.region ?? address.county,
        country: address.country,
        countryCode
    };

    return Object.values(place).some(Boolean) ? place : undefined;
}

/** The extent Nominatim reports, as MapLibre reads one, or nothing where it cannot be read. */
function toBounds(boundingbox: string[] | undefined): GeoSearchResult["bounds"] {
    if (boundingbox?.length !== 4) {
        return undefined;
    }

    const [ south, north, west, east ] = boundingbox.map(Number);
    if (![ south, north, west, east ].every(Number.isFinite)) {
        return undefined;
    }

    // A place spanning the antimeridian is reported west of east, which frames the whole world the
    // long way round. Rare enough to be left to the fallback zoom rather than split in two.
    if (west > east) {
        return undefined;
    }

    return [ [ west, south ], [ east, north ] ];
}

/**
 * What the map is showing, as Nominatim reads a preferred area: two opposite corners, longitude
 * first. Sent without `bounded` on the wider pass, so a place is ranked up for being in view rather
 * than a place out of view being refused.
 *
 * Grown to at least {@link SEARCH_RADIUS_M} about its middle, since a view of one neighbourhood
 * restricts a search to that neighbourhood and answers nothing for the next street over.
 *
 * A view running the other way round has been panned across the antimeridian, which no pair of
 * corners describes; nothing is sent for one, and the search is answered as if from nowhere.
 */
function toViewbox(viewport: GeoBounds | undefined) {
    if (!viewport) {
        return null;
    }

    const [ [ west, south ], [ east, north ] ] = viewport;
    if (!(west < east)) {
        return null;
    }

    const middleLat = (south + north) / 2;
    const middleLng = (west + east) / 2;
    const latitudePad = SEARCH_RADIUS_M / METRES_PER_DEGREE;
    // A degree of longitude shortens towards the poles, where it is short enough that padding by one
    // would reach around the world; the cosine is floored to keep the padding finite.
    const longitudePad = latitudePad / Math.max(Math.cos(middleLat * Math.PI / 180), 0.01);

    return [
        clamp(Math.min(west, middleLng - longitudePad), -180, 180),
        clamp(Math.min(south, middleLat - latitudePad), -90, 90),
        clamp(Math.max(east, middleLng + longitudePad), -180, 180),
        clamp(Math.max(north, middleLat + latitudePad), -90, 90)
    ].map((degrees) => Number(degrees.toFixed(5))).join(",");
}

function clamp(value: number, least: number, most: number) {
    return Math.min(Math.max(value, least), most);
}

/**
 * The boundary of one OSM object, simplified, or `null` where it has none to draw.
 *
 * A lookup of its own rather than `polygon_geojson` on the search: a search answers with eight places
 * and the boundaries of the seven that go unlooked-at are the bulk of what would be carried.
 */
async function fetchOutline(osmId: string, bounds: GeoBounds | undefined, signal?: AbortSignal): Promise<GeoJSON.Geometry | null> {
    const params = new URLSearchParams({
        osm_ids: osmId,
        format: "jsonv2",
        polygon_geojson: "1",
        polygon_threshold: polygonThreshold(bounds)
    });

    if (!await waitForRequestSlot(signal)) {
        return null;
    }

    let response: Response;
    try {
        response = await fetch(`${NOMINATIM_LOOKUP_URL}?${params}`, { signal });
    } catch (e) {
        // Given up on while in flight, which is the caller's own doing rather than a failure.
        if (signal?.aborted) {
            return null;
        }
        throw e;
    }

    if (!response.ok) {
        throw new Error(`Nominatim answered ${response.status} ${response.statusText}`);
    }

    const [ place ]: { geojson?: GeoJSON.Geometry }[] = await response.json();
    const geometry = place?.geojson;
    // A shape that is a point or a line is what the pin already says, drawn again.
    return geometry?.type === "Polygon" || geometry?.type === "MultiPolygon" ? geometry : null;
}

/**
 * How coarsely to simplify a place of the given extent, in degrees.
 *
 * Douglas-Peucker drops every corner standing less than the threshold off the line between its
 * neighbours, so one wide enough to thin a coastline squares off a street corner and leaves a
 * building as the triangle that is the least a ring can be. The threshold is taken from the place's
 * narrower side — the one that collapses first — and capped at {@link MAX_POLYGON_THRESHOLD}, which
 * is what a country or a county gets.
 *
 * A place whose extent is unknown is one Nominatim reported no readable box for, and gets the cap.
 *
 * Written out to six decimals rather than stringified, which would send a threshold under a
 * millionth of a degree in exponential notation.
 */
function polygonThreshold(bounds: GeoBounds | undefined) {
    if (!bounds) {
        return MAX_POLYGON_THRESHOLD.toFixed(6);
    }

    const [ [ west, south ], [ east, north ] ] = bounds;
    const narrowerSide = Math.min(east - west, north - south);

    return Math.min(narrowerSide * POLYGON_THRESHOLD_RATIO, MAX_POLYGON_THRESHOLD).toFixed(6);
}

/**
 * Holds a request back until the interval the policy asks for has passed since the last one, and
 * answers whether it may go out.
 *
 * Requests are let through in the order they asked, so two started at once queue behind each other
 * instead of both finding the same slot free. One given up on through `signal` leaves the queue and
 * answers `false`: the requests behind it move up rather than waiting out a request never sent,
 * which is what keeps a search from queueing behind boundaries nobody is looking at any more.
 */
async function waitForRequestSlot(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) {
        return false;
    }

    // The slot at hand is taken there and then, so a lone request is not held for a turn of the
    // event loop before going out.
    const now = Date.now();
    if (!waiting.length && now >= nextRequestAt) {
        nextRequestAt = now + MIN_REQUEST_INTERVAL;
        return true;
    }

    return new Promise<boolean>((resolve) => {
        const request = { resolve };
        waiting.push(request);
        signal?.addEventListener("abort", () => {
            const queued = waiting.indexOf(request);
            if (queued >= 0) {
                waiting.splice(queued, 1);
                resolve(false);
            }
        }, { once: true });
        releaseNextRequest();
    });
}

/** Lets the request at the head of the queue through once its slot comes up, and then the next. */
function releaseNextRequest() {
    if (releaseTimer !== undefined || !waiting.length) {
        return;
    }

    releaseTimer = setTimeout(() => {
        releaseTimer = undefined;
        const request = waiting.shift();
        if (request) {
            nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL;
            request.resolve(true);
        }
        releaseNextRequest();
    }, Math.max(0, nextRequestAt - Date.now()));
}
