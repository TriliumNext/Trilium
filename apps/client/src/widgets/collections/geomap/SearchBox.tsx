import "./SearchBox.css";

import clsx from "clsx";
import type { Map as MapLibreGLMap } from "maplibre-gl";
import type { TargetedKeyboardEvent } from "preact";
import { useCallback, useContext, useRef, useState } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import { logError } from "../../../services/ws";
import { getMeasurementSystem } from "../../../utils/formatters";
import { formatDistance } from "../../../utils/units";
import { filterTokens, matchesFilter } from "../../react/filter";
import FormAutocomplete from "../../react/FormAutocomplete";
import Icon from "../../react/Icon";
import OverlayToolbar, { OverlayToolbarButton } from "../../react/OverlayToolbar";
import { formatCoordinates, parseCoordinates } from "./coordinates";
import { DEFAULT_GEOCODING_PROVIDER_NAME, DEFAULT_PLACE_ICON, type GeoBounds, GEOCODING_PROVIDERS, type GeoSearchResult, SEARCH_RADIUS_M } from "./geocoding";
import { GPX_MIME } from "./GpxTrack";
import { ParentMap } from "./map";
import { describePlace } from "./place_address";
import { LOCATION_ATTRIBUTE, parseLocation } from "./Markers";
import { frameResult, type SearchResult } from "./results";

/** Shorter queries are not searched. */
const MIN_QUERY_LENGTH = 2;

/** The zoom level a place is shown at where the geocoder does not say how much ground it covers. */
const PLACE_ZOOM = 12;

/**
 * How close a place is framed at most. A house's extent is a few metres across, which on its own
 * would fill the screen with the roof.
 */
const PLACE_MAX_ZOOM = 17;

/** The room kept around a framed place, so its pin and name do not sit against the map's edge. */
const PLACE_PADDING = 60;

/** The zoom level a marker is shown at, closer in since a note marks a spot rather than an area. */
const MARKER_ZOOM = 15;

/** The mean radius of the Earth, which is what a great-circle distance is measured on. */
const EARTH_RADIUS_M = 6_371_008.8;

/**
 * How wide the result list is drawn. The field is a corner of the map, while what it offers is whole
 * addresses, which at the field's own width is mostly an ellipsis.
 */
const RESULT_LIST_WIDTH = 500;

/**
 * How close a point named by its coordinates is shown. Nearer than the level a place of unsaid
 * extent is given: coordinates are typed to reach one spot rather than the town around it.
 */
const POINT_ZOOM = 16;

/** Caps how many of the map's own notes the list offers. */
const MAX_MARKER_RESULTS = 8;

/** The key of the row reporting on a geocoder run, which only ever appears once. */
const STATUS_KEY = "geocode-status";


interface SearchBoxProps {
    /** The notes on the map, searched by title. */
    notes: FNote[];
    /**
     * Reports what the list offered and which of it was taken, so the map can stand on that one and
     * step through the rest (see `showResult` in index.tsx). None where the reader has moved on from
     * the search altogether, the field having been emptied.
     */
    onPickResult(picked: { results: SearchResult[]; index: number } | null): void;
}

/**
 * One row of the result list. `key` identifies it, since `FormAutocomplete` items are strings and two
 * rows can read the same.
 */
type SearchEntry = {
    key: string;
    label: string;
    /** A boxicons class, as `FNote.getIcon()` gives it. Headings have none. */
    icon?: string;
    /** How far the place is from the middle of the map, in metres. */
    distance?: number;
    /** A second line under the first: the address that places a place, or whose answer a row is. */
    detail?: string;
} & (
    /** A note of the map's own. `center` is absent for a GPX track, which stands on no one point. */
    | { kind: "marker"; center?: [number, number]; noteId: string }
    /** A place from the geocoder, carried whole for whoever the pick is reported to. */
    | { kind: "place"; center: [number, number]; result: GeoSearchResult }
    /**
     * A point the query names outright. Carried as a place, which is what it is taken as, but a row
     * of its own: what it says is what taking it does, the coordinates being what the reader just
     * typed rather than something found for them.
     */
    | { kind: "point"; center: [number, number]; result: GeoSearchResult }
    /** Names the run of rows below it; not a choice (see `isHeading` on FormAutocomplete). */
    | { kind: "heading" }
    /** Runs the geocoder for `query`. */
    | { kind: "geocode"; query: string }
    /** Reports on a geocoder run; picking it does nothing. */
    | { kind: "info" }
);

/** A geocoder run, kept so its results can be listed under the query they answer. */
interface GeocodeRun {
    query: string;
    status: "loading" | "done" | "failed";
    results: SearchEntry[];
}

/**
 * A search bar over a geo map, which flies the map to the marker or place picked from it.
 *
 * The map's own notes are matched by title as the user types. The geocoder is not: it costs a request
 * to a third party, and providers rate-limit and discourage per-keystroke lookups, so it sits at the
 * bottom of the list as a row that runs it when picked. It is told what the map is showing, so that
 * what is nearby is preferred to what merely shares a name.
 *
 * A place taken from the geocoder is pinned where it stands, since flying to a spot the map has
 * nothing at otherwise leaves the user to work out which patch of ground was meant. The pin stands
 * until another is taken or the field is emptied.
 *
 * The rows are the choices themselves rather than help with typing, so the first stands ready and
 * Enter takes it — `autoActivate`, as the attribute pickers use it. From a field holding nothing but
 * a name, that is: Enter, which runs the geocoder, and Enter again, which takes what it found.
 *
 * `FormAutocomplete` handles the debounce, the stale-response guard, keyboard navigation and a
 * dropdown portalled out of the map's scrolling container. `keepOpenOnPick` keeps the list up so the
 * geocoder row can replace itself with results, so closing it after a marker or place is taken is
 * this component's job — see `dismissed`.
 */
export default function SearchBox({ notes, onPickResult }: SearchBoxProps) {
    const map = useContext(ParentMap);
    const [ query, setQuery ] = useState("");
    const [ geocodeRun, setGeocodeRun ] = useState<GeocodeRun>();
    // Empties the list once a marker or place has been taken, which is what closes the dropdown under
    // `keepOpenOnPick`. Typing again clears it.
    const [ dismissed, setDismissed ] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const entriesByKey = useRef(new Map<string, SearchEntry>());
    // Discards a run superseded by a later one, since each reports through the same state.
    const latestRun = useRef(0);
    const provider = GEOCODING_PROVIDERS[DEFAULT_GEOCODING_PROVIDER_NAME];

    const source = useCallback(async (currentQuery: string) => {
        const trimmed = currentQuery.trim();
        if (dismissed || trimmed.length < MIN_QUERY_LENGTH) {
            entriesByKey.current = new Map();
            return [];
        }

        // Measured from the middle of what the map is showing, at the moment the list is built: two
        // places of the same name are told apart by which of them is at hand.
        const origin = map ? map.getCenter().toArray() : null;
        const { places, notice } = geocodeEntries(geocodeRun, trimmed, provider.name);
        const found = [ ...matchMarkers(notes, trimmed), ...places ]
            .map((entry) => withDistance(entry, origin));
        // Above the groups rather than sorted into them: a reader who typed a point named where
        // they were going, and what a search turned up answers a different question.
        const point = pointEntry(trimmed);
        const entries = [
            ...(point ? [ withDistance(point, origin) ] : []),
            ...grouped(found),
            ...(notice ? [ notice ] : [])
        ];
        entriesByKey.current = new Map(entries.map((entry) => [ entry.key, entry ]));
        return entries.map((entry) => entry.key);
    }, [ notes, geocodeRun, dismissed, map, provider ]);

    const changeQuery = useCallback((newQuery: string) => {
        setDismissed(false);
        setQuery(newQuery);
        // Emptying the field is how the search is taken back off the map, pin and all.
        if (!newQuery.trim()) {
            onPickResult(null);
        }
    }, [ onPickResult ]);

    const runGeocoder = useCallback(async (searchQuery: string) => {
        const runId = ++latestRun.current;
        setGeocodeRun({ query: searchQuery, status: "loading", results: [] });

        try {
            // Where the map is looking, so a shop searched for from Corfu is answered with the one in
            // Corfu rather than the one in Finland.
            const results = await provider.search(searchQuery, { viewport: map ? viewportOf(map) : undefined });
            if (latestRun.current !== runId) return;
            setGeocodeRun({ query: searchQuery, status: "done", results: results.map(placeEntry) });
        } catch (e) {
            logError(`Geocoding with "${provider.name}" failed: ${e}`);
            if (latestRun.current !== runId) return;
            setGeocodeRun({ query: searchQuery, status: "failed", results: [] });
        }
    }, [ provider, map ]);

    /**
     * Puts the rows back on offer, so a query that was right can be looked at again without being
     * retyped: the field is come back to, or Enter is pressed on it with nothing on offer.
     *
     * Only where there is nothing on offer, since the Enter that takes a row arrives here too and
     * would otherwise undo the dismissal it has just caused.
     */
    const offerRowsAgain = useCallback(() => {
        if (!entriesByKey.current.size) {
            setDismissed(false);
        }
    }, []);

    const offerRowsOnEnter = useCallback((e: TargetedKeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            offerRowsAgain();
        }
    }, [ offerRowsAgain ]);

    /** Empties the field, which is also what takes a searched place off the map (see `changeQuery`). */
    const clearSearch = useCallback(() => {
        changeQuery("");
        // The field is where the reader was, and clearing it is rarely the end of searching.
        inputRef.current?.focus();
    }, [ changeQuery ]);

    const pickEntry = useCallback((key: string) => {
        const entry = entriesByKey.current.get(key);
        if (!entry || !map) return;

        if (entry.kind === "geocode") {
            runGeocoder(entry.query);
        } else if (entry.kind === "marker" || entry.kind === "place" || entry.kind === "point") {
            setDismissed(true);

            // The whole of what was offered, so the map can step through the rest of it once the
            // list has stood down (see ResultNavigator).
            const results = walkableResults(entriesByKey.current);
            const index = results.findIndex((result) => keyOf(result) === entry.key);
            onPickResult({ results, index });
            frameResult(map, results[index]);
        }
    }, [ map, runGeocoder, onPickResult ]);

    const isHeading = useCallback(
        (key: string) => entriesByKey.current.get(key)?.kind === "heading", []);

    const renderEntry = useCallback((key: string) => {
        const entry = entriesByKey.current.get(key);
        if (!entry) return key;

        if (entry.kind === "heading") {
            return entry.label;
        }

        // Two lines: what the row is, and under it what places it — the address of a place, and the
        // geocoder's name on the rows that are its to answer for.
        const [ name, detail ] = entry.kind === "place"
            ? [ entry.result.name, describePlace(entry.result) ]
            : [ entry.label, entry.detail ];

        return (
            <span className={`geo-search-entry geo-search-entry-${entry.kind}`}>
                <Icon icon={entry.icon} />
                <span className="geo-search-entry-lines">
                    <span className="geo-search-entry-name">{name}</span>
                    {detail && <span className="geo-search-entry-address">{detail}</span>}
                </span>
                {entry.distance !== undefined &&
                    <span className="geo-search-entry-distance">
                        {formatDistance(entry.distance, getMeasurementSystem())}
                    </span>}
            </span>
        );
    }, []);

    // The map failed to initialize, e.g. WebGL is unavailable (see map.tsx).
    if (!map) return null;

    return (
        <OverlayToolbar className="geo-search-toolbar" titlePosition="bottom">
            <Icon icon="bx bx-search" className="geo-search-icon" />
            <FormAutocomplete
                className="geo-search-input"
                inputRef={inputRef}
                currentValue={query}
                onChange={changeQuery}
                onPick={pickEntry}
                source={source}
                renderItem={renderEntry}
                isHeading={isHeading}
                dropdownMinWidth={RESULT_LIST_WIDTH}
                autoActivate
                openOnFocus
                openOnEnter
                keepOpenOnPick
                onFocus={offerRowsAgain}
                onKeyDown={offerRowsOnEnter}
                placeholder={t("geo-map.search-placeholder")}
                aria-label={t("geo-map.search")}
            />
            {/* Kept in the bar whether or not there is anything to clear, and only shown when there
                is: a button coming and going would take the bar's width with it, moving the field
                under the reader mid-word. */}
            <OverlayToolbarButton
                className={clsx("geo-search-clear", query && "shown")}
                icon="bx bx-x"
                text={t("options.search_clear")}
                onClick={clearSearch}
            />
        </OverlayToolbar>
    );
}

/**
 * The rows that stand somewhere on the map, in the order they were offered — the headings and the
 * geocoder's own rows being neither results nor anywhere.
 */
function walkableResults(entries: Map<string, SearchEntry>): SearchResult[] {
    const results: SearchResult[] = [];

    for (const entry of entries.values()) {
        if (entry.kind === "marker") {
            results.push({ kind: "note", noteId: entry.noteId, center: entry.center });
        } else if (entry.kind === "place" || entry.kind === "point") {
            results.push({ kind: "place", place: entry.result });
        }
    }

    return results;
}

/** The key the row a result came from was listed under (see `placeEntry` and `matchMarkers`). */
function keyOf(result: SearchResult) {
    return result.kind === "note" ? `marker:${result.noteId}` : `place:${result.place.id}`;
}

/**
 * How far a row's place stands from where the map is looking, for the rows that stand anywhere: the
 * geocoder's row and its reports name no place, and a map that could not be drawn is looking nowhere.
 */
function withDistance(entry: SearchEntry, origin: [number, number] | null): SearchEntry {
    const center = "center" in entry ? entry.center : undefined;
    if (!origin || !center) {
        return entry;
    }

    return { ...entry, distance: metresBetween(origin, center) };
}

/** The great-circle metres between two `[lng, lat]` points. */
function metresBetween([ lngA, latA ]: [number, number], [ lngB, latB ]: [number, number]) {
    const toRadians = Math.PI / 180;
    const deltaLat = (latB - latA) * toRadians;
    const deltaLng = (lngB - lngA) * toRadians;
    const h = Math.sin(deltaLat / 2) ** 2
        + Math.cos(latA * toRadians) * Math.cos(latB * toRadians) * Math.sin(deltaLng / 2) ** 2;

    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** What the map is showing, as a geocoder reads a preferred area. */
function viewportOf(map: MapLibreGLMap): GeoBounds {
    const bounds = map.getBounds();
    return [ [ bounds.getWest(), bounds.getSouth() ], [ bounds.getEast(), bounds.getNorth() ] ];
}

/**
 * The notes on the map that the query names and that are drawn somewhere.
 *
 * Matched by the terms the app filters its own lists by (see `filterTokens`), which ignores case and
 * accents on both sides and asks for every term rather than the whole query in one piece: "zurich"
 * finds "Zürich Hauptbahnhof", and "hotel paris" finds "Paris Hotel".
 *
 * All of them, however many: which of them the list has room for is settled once they can be ordered
 * by how far off they stand (see {@link grouped}).
 */
function matchMarkers(notes: FNote[], query: string): SearchEntry[] {
    const tokens = filterTokens(query);
    const matches: SearchEntry[] = [];

    for (const note of notes) {
        if (!matchesFilter(tokens, note.title)) continue;

        // A note without a readable location has no marker to fly to. A GPX track has no location
        // either — its route is in the file — but it is drawn on the map all the same, and the pane
        // fits the whole of it (see DetailPane).
        const center = parseLocation(note.getLabelValue(LOCATION_ATTRIBUTE));
        if (!center && note.mime !== GPX_MIME) continue;

        matches.push({
            kind: "marker",
            key: `marker:${note.noteId}`,
            noteId: note.noteId,
            label: note.title,
            icon: note.getIcon(),
            center: center ?? undefined
        });
    }

    return matches;
}

/**
 * What the geocoder has to offer for this query: the places a run answering it found, and whatever
 * has to be said about the run — the row that starts one, or a word on how the last one went.
 *
 * The two are separated because they belong in different parts of the list: places are sorted in
 * among the map's own notes, and a notice stands at the foot whatever the distances say.
 */
function geocodeEntries(run: GeocodeRun | undefined, query: string, provider: string): {
    places: SearchEntry[];
    notice: SearchEntry | null;
} {
    // Named under every row that is the geocoder's to answer for — the offer to ask it, and whatever
    // came of the asking — so that what is about to leave the map, and where the places on it came
    // from, is said where it is read rather than in a setting somewhere.
    if (run?.query !== query) {
        return {
            places: [],
            notice: {
                kind: "geocode",
                key: "geocode",
                label: t("geo-map.search-online", { query }),
                detail: provider,
                icon: "bx bx-search-alt",
                query
            }
        };
    }

    if (run.status === "loading") {
        return { places: [], notice: infoEntry(t("geo-map.searching-online"), "bx bx-loader-alt", provider) };
    }
    if (run.status === "failed") {
        return { places: [], notice: infoEntry(t("geo-map.search-failed"), "bx bx-error-circle", provider) };
    }
    if (!run.results.length) {
        return { places: [], notice: infoEntry(t("geo-map.no-places-found"), "bx bx-info-circle", provider) };
    }

    return { places: run.results, notice: null };
}

/**
 * What was found, under headings naming what each run of rows is: the map's own notes first, then
 * the geocoder's places, split by whether they are at hand.
 *
 * Nearest first within each. A note already standing on the map, a shop down the road and one on
 * another continent are three different answers to the same name, and the list used to run them
 * together.
 *
 * Headings only where more than one of the three was found: one name over the whole list
 * distinguishes it from nothing.
 */
function grouped(entries: SearchEntry[]): SearchEntry[] {
    const sorted = [ ...entries ].sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
    const places = sorted.filter((entry) => entry.kind === "place");
    const isAtHand = (entry: SearchEntry) => (entry.distance ?? Infinity) <= SEARCH_RADIUS_M;

    const groups: { key: string; label: string; rows: SearchEntry[] }[] = [
        // Capped once sorted, so what the list offers is the nearest of the notes that match rather
        // than whichever of them the map happens to hold first.
        { key: "on-map", label: t("geo-map.results-on-map"), rows: sorted.filter((entry) => entry.kind === "marker").slice(0, MAX_MARKER_RESULTS) },
        { key: "nearby", label: t("geo-map.results-nearby"), rows: places.filter(isAtHand) },
        { key: "far", label: t("geo-map.results-far"), rows: places.filter((entry) => !isAtHand(entry)) }
    ].filter((group) => group.rows.length);

    if (groups.length < 2) {
        return groups.flatMap((group) => group.rows);
    }

    return groups.flatMap((group) => [ headingEntry(group.key, group.label), ...group.rows ]);
}

function headingEntry(key: string, label: string): SearchEntry {
    return { kind: "heading", key: `heading:${key}`, label };
}

/**
 * The row for a point the query names outright, or `null` where it names none.
 *
 * A place like any the geocoder answers with, so that taking it pins it, offers it for keeping and
 * steps among the rest exactly as a searched place does — one without a name, which is why it is
 * named by its own coordinates.
 */
function pointEntry(query: string): SearchEntry | null {
    const center = parseCoordinates(query);
    if (!center) {
        return null;
    }

    const [ lng, lat ] = center;
    const coordinates = formatCoordinates(center);

    return {
        kind: "point",
        key: `place:point:${lng},${lat}`,
        label: t("geo-map.go-to-coordinates", { coordinates }),
        icon: "bx bx-crosshair",
        center,
        result: {
            id: `point:${lng},${lat}`,
            name: coordinates,
            label: coordinates,
            lat,
            lng,
            zoom: POINT_ZOOM,
            unnamed: true
        }
    };
}

function placeEntry(result: GeoSearchResult): SearchEntry {
    return {
        kind: "place",
        key: `place:${result.id}`,
        label: result.label,
        icon: result.icon ?? DEFAULT_PLACE_ICON,
        center: [ result.lng, result.lat ],
        result
    };
}

/** A row that reports on the geocoder rather than offering a place. */
function infoEntry(label: string, icon: string, detail: string): SearchEntry {
    return { kind: "info", key: STATUS_KEY, label, icon, detail };
}
