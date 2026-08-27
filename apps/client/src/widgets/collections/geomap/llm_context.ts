/**
 * What the map tells the LLM chat about itself (see `useLlmViewContext`): where the view stands,
 * which notes are on screen and how far each is from the center, so the model reads distances
 * rather than working them out from coordinates.
 */

import { metresBetween } from "./coordinates";
import { formatLocation } from "./Markers";

/** A note the map draws, at the `[lng, lat]` its `#geolocation` names. */
export interface GeoViewPin {
    noteId: string;
    title: string;
    point: [number, number];
}

/** The map as it stands at the moment a message is sent. */
export interface GeoViewSnapshot {
    /** `[west, south, east, north]`, as MapLibre's `getBounds().toArray()` flattens. */
    bounds: [number, number, number, number];
    center: [number, number];
    zoom: number;
    pins: GeoViewPin[];
    /** The note the detail pane is open on, if any. */
    selectedNoteId?: string | null;
    /** The place picked from the search, standing on the map under its own pin until kept or dismissed. */
    place?: GeoViewPlace;
}

/** A place from the search as the map shows it: not a note, but a spot the user has asked about. */
export interface GeoViewPlace {
    name: string;
    /** Where it stands, as `describePlace` says it; empty for a point named only by its coordinates. */
    where: string;
    point: [number, number];
}

/** How many on-screen pins are listed; the rest are counted. */
export const MAX_LISTED_PINS = 30;

export function describeGeoView({ bounds, center, zoom, pins, selectedNoteId, place }: GeoViewSnapshot): string {
    const [ west, south, east, north ] = bounds;
    const lines = [
        "This note is a geo map. The user is looking at:",
        `- Center: ${formatLocation(center, 5)} (latitude, longitude), zoom level ${zoom.toFixed(1)} (${describeZoom(zoom)})`,
        `- Visible area: latitude ${south.toFixed(5)} to ${north.toFixed(5)}, longitude ${west.toFixed(5)} to ${east.toFixed(5)}`,
        "",
        "Notes are pinned on the map through their `#geolocation` label, written as \"latitude,longitude\".",
        "When the user says \"here\" or \"nearby\", they mean the visible area. Distances below are from its center; rely on them rather than comparing coordinates."
    ];

    const measured = pins.map((pin) => ({ ...pin, metres: metresBetween(center, pin.point) }))
        .sort((a, b) => a.metres - b.metres);
    const isVisible = ({ point: [ lng, lat ] }: GeoViewPin) =>
        lat >= south && lat <= north && lng >= west && lng <= east;
    const visible = measured.filter(isVisible);
    const hidden = measured.length - visible.length;

    // The note the detail pane is open on is what "this note" or "it" most likely means, so it is
    // named before the listing whether or not it is on screen.
    const selected = selectedNoteId ? measured.find((pin) => pin.noteId === selectedNoteId) : undefined;
    if (selected) {
        lines.push("", `Selected note (open in the detail pane): ${describePin(selected)}, ${isVisible(selected) ? "on screen" : "off screen"}.`);
    }
    if (place) {
        const where = place.where ? ` (${place.where})` : "";
        lines.push("", `A place from the map's search is marked with a temporary pin (it is not a note yet): ${place.name}${where} at ${formatLocation(place.point, 5)}, ${formatMetres(metresBetween(center, place.point))} from the center. The user can keep it as a note.`);
    }

    if (measured.length === 0) {
        lines.push("", "No notes on this map are pinned yet.");
    } else if (visible.length === 0) {
        lines.push("", `None of the ${measured.length} pinned notes are on screen; the nearest is ${describePin(measured[0])}.`);
    } else {
        lines.push("", `${visible.length} pinned note${visible.length === 1 ? "" : "s"} on screen, nearest to the center first:`);
        for (const pin of visible.slice(0, MAX_LISTED_PINS)) {
            lines.push(`- ${describePin(pin)}${pin.noteId === selectedNoteId ? " (selected)" : ""}`);
        }
        if (visible.length > MAX_LISTED_PINS) {
            lines.push(`- …and ${visible.length - MAX_LISTED_PINS} more on screen`);
        }
        if (hidden > 0) {
            lines.push(`${hidden} more pinned note${hidden === 1 ? " is" : "s are"} off screen.`);
        }
    }

    return lines.join("\n");
}

function describePin(pin: GeoViewPin & { metres: number }) {
    return `${pin.title} (noteId: ${pin.noteId}) at ${formatLocation(pin.point, 5)}, ${formatMetres(pin.metres)} from the center`;
}

/** Metric throughout: the model reads it, and kilometres need no locale. */
function formatMetres(metres: number) {
    if (metres < 1000) {
        return `${Math.round(metres)} m`;
    }
    const km = metres / 1000;
    return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/** Roughly what a zoom level has on screen, so the model scales "nearby" to it. */
function describeZoom(zoom: number) {
    if (zoom >= 16) return "a few streets";
    if (zoom >= 13) return "a town or district";
    if (zoom >= 10) return "a city and its surroundings";
    if (zoom >= 6) return "a region";
    if (zoom >= 3) return "a country or continent";
    return "the whole world";
}
