import { nominatim } from "./nominatim";
import type { PlaceAddress } from "./place_address";

/**
 * How much ground counts as here: what a search treats as the area around the reader, and what a
 * result is called nearby for standing within.
 *
 * A map zoomed into a neighbourhood shows a few hundred metres across, and a search restricted to
 * exactly that answers nothing for a shop three streets away. What the reader means by searching from
 * where they are standing is the town they are looking at, not the block.
 */
export const SEARCH_RADIUS_M = 25_000;

/** A rectangle of ground, as `[[west, south], [east, north]]`. */
export type GeoBounds = [[number, number], [number, number]];

export interface GeoSearchOptions {
    /**
     * What the map is showing. A place inside it is preferred to one of the same name elsewhere —
     * searching for a shop while looking at Corfu should not answer with the branch in Finland.
     *
     * A preference rather than a restriction: the only match for a query is worth offering wherever
     * it stands.
     */
    viewport?: GeoBounds;
}

/** The icon for a place whose kind the geocoder says nothing about. */
export const DEFAULT_PLACE_ICON = "bx bx-map-pin";

/** A single place returned by a geocoder. */
export interface GeoSearchResult {
    /** Unique within one result set. */
    id: string;
    /** Display text, with enough context to tell two places of the same name apart. */
    label: string;
    /** The place's own name, for labelling it on the map where the full label would be a paragraph. */
    name: string;
    /**
     * A boxicons class saying what kind of place it is, as `FNote.getIcon()` gives one — a cart for a
     * supermarket, a flag for a country. Absent where the provider says nothing about the kind.
     */
    icon?: string;
    lat: number;
    lng: number;
    /**
     * Where the place stands, in parts, for naming it and for saying where it is without reciting the
     * whole label. Absent where the provider breaks an address into nothing.
     */
    address?: PlaceAddress;
    /**
     * What the place covers, where the geocoder says. A street and the city around it are told apart
     * by their extent rather than by one zoom level guessed for both.
     */
    bounds?: GeoBounds;
    /**
     * How close the place asks to be shown, for one that knows better than the guess made for
     * a place of unsaid extent: a point named by its coordinates is meant exactly.
     */
    zoom?: number;
    /**
     * Whether the place is named only by where it stands, as a point read out of the search bar is.
     * A note kept from one has nothing to be called, so it takes the name a placed marker takes
     * (see `createNoteForPlace` in api and `keepPlaceAsMarker` in index).
     */
    unnamed?: boolean;
    /**
     * Fetches the boundary of the place — a country's coastline, a county's border — or `null` where
     * it has none worth drawing. Absent where the provider cannot supply one at all.
     *
     * A call rather than a value, so the boundary is asked for only once a place has been picked: a
     * search returns several places and at most one of them is ever looked at.
     *
     * A lookup given up on through `signal` answers `null` and gives up its place in the provider's
     * request queue, so what is asked for next is not held behind it.
     */
    outline?: (signal?: AbortSignal) => Promise<GeoJSON.Geometry | null>;
}

export interface GeocodingProvider {
    /** Display name, shown where the user picks a provider. */
    name: string;
    /**
     * Returns matches, best first, or an empty array when nothing matches. Throws when the provider
     * cannot be reached or refuses the request.
     */
    search(query: string, options?: GeoSearchOptions): Promise<GeoSearchResult[]>;
}

/**
 * The geocoders a map can search, keyed by the name a note selects one by.
 *
 * Same shape as `MAP_LAYERS` in map_layer.ts, so both are read the same way.
 */
export const GEOCODING_PROVIDERS: Record<string, GeocodingProvider> = {
    "nominatim": nominatim
};

export const DEFAULT_GEOCODING_PROVIDER_NAME: keyof typeof GEOCODING_PROVIDERS = "nominatim";
