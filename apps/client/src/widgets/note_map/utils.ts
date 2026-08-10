/**
 * Where a map is being drawn. `expanded` is the connections tab's own map at the size of the window,
 * which the card's expand button opens — the only thing that opens it — so it is that card's map
 * rather than a surface of its own, and reads what the card reads.
 */
export type NoteMapWidgetMode = "ribbon" | "sidebar" | "expanded" | "hoisted" | "type";
export type MapType = "tree" | "link";

/**
 * Where the connections tab's map is told which of the two to draw.
 *
 * A preference of the reader's rather than a property of the note being read: the tab is a lens on
 * whatever passes under it, and a map that changed kind as one navigated — because one note out of a
 * subtree had once been left as a tree map — would be an instrument that cannot be relied on. The
 * maps that are a note's own thing are told by that note instead, through its `mapType` label.
 */
export const NOTE_MAP_TYPE_OPTION = "rightPaneNoteMapType";

/**
 * Whether the map takes the reader's own preference of the two ({@link NOTE_MAP_TYPE_OPTION}) rather
 * than what the note it is drawn for asks for. The connections tab and what its expand button opens,
 * which is the same map at the size of the window and is left showing the same one.
 */
export function usesReaderPreference(widgetMode: NoteMapWidgetMode) {
    return widgetMode === "sidebar" || widgetMode === "expanded";
}

/** Whether the map is rooted at the note being read, rather than at a configured or hoisted note. */
export function isRootedAtCurrentNote(widgetMode: NoteMapWidgetMode) {
    return widgetMode === "ribbon" || widgetMode === "sidebar" || widgetMode === "expanded";
}

/** The map a note asks to be drawn as through its `mapType` label, the link map standing for anything else. */
export function toMapType(labelValue: string | null | undefined): MapType {
    return labelValue === "tree" ? "tree" : "link";
}

/** How much of the map's box is kept clear around the graph when the view is fitted to it. */
const FIT_PADDING: Record<NoteMapWidgetMode, number> = {
    // The sidebar's is not a fixed one — see getFitPadding.
    sidebar: 0,
    ribbon: 50,
    // Not the sidebar's own, small enough that a graph fitted with room to spare is a thumbnail: what
    // the card is short of, a map given the greater part of the window has plenty of.
    expanded: 50,
    hoisted: 30,
    type: 30
};

/** What the sidebar's map is fitted with, between a map of a handful of notes and one of a crowd. */
const SIDEBAR_FIT_PADDING = { sparse: 20, dense: -25 };

/** The counts of framed notes those two are reached at, everything between being shared out evenly. */
const SIDEBAR_FIT_NOTES = { sparse: 5, dense: 25 };

/**
 * How much of the box to keep clear around the graph, given how many notes are being framed in it.
 *
 * Fixed everywhere but the sidebar, whose box is small enough that a graph fitted with room to spare
 * is a thumbnail of itself. A map of a crowd is fitted past the edges there (a negative padding): the
 * outermost notes are cropped rather than everything being shrunk to clear them, which is what the
 * room is better spent on when there is plenty left in the middle to look at.
 *
 * A map of a handful of notes has nothing to spare, and is mostly its labels — which the fit knows
 * nothing about, being measured on the notes alone — so those are given a margin instead, and the
 * maps between the two are shared out evenly.
 */
export function getFitPadding(widgetMode: NoteMapWidgetMode, framedNoteCount: number) {
    if (widgetMode !== "sidebar") {
        return FIT_PADDING[widgetMode];
    }

    const { sparse, dense } = SIDEBAR_FIT_NOTES;
    const crowdedness = Math.max(0, Math.min(1, (framedNoteCount - sparse) / (dense - sparse)));

    return SIDEBAR_FIT_PADDING.sparse + (SIDEBAR_FIT_PADDING.dense - SIDEBAR_FIT_PADDING.sparse) * crowdedness;
}

export function rgb2hex(rgb: string) {
    return `#${(rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/) || [])
        .slice(1)
        .map((n) => parseInt(n, 10).toString(16).padStart(2, "0"))
        .join("")}`;
}

/**
 * The colour a given part of the way from one to the other, for fading between two of them.
 *
 * @param ratio 0 for the first colour, 1 for the second. Both are expected as `#rrggbb`, and anything
 *              else is taken to be past fading — the colour being headed for is answered outright.
 */
export function mixColors(from: string, to: string, ratio: number) {
    const fromChannels = toChannels(from);
    const toChannels_ = toChannels(to);

    if (!fromChannels || !toChannels_) {
        return to;
    }

    const mixed = fromChannels.map((channel, i) => Math.round(channel + (toChannels_[i] - channel) * ratio));
    return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The colour asked for at the given opacity, as a canvas takes it.
 *
 * @param alpha 0 for nothing at all, 1 for the colour as it stands.
 */
export function withAlpha(color: string, alpha: number) {
    if (!/^#[0-9a-f]{6}$/i.test(color)) {
        // Only a plain `#rrggbb` takes the two digits that say by how much; anything else keeps what
        // it has rather than being handed something a canvas cannot read.
        return color;
    }

    return `${color}${Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, "0")}`;
}

/** The red, green and blue of a `#rrggbb`, or nothing where it is not one. */
function toChannels(color: string) {
    const channels = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);

    return channels ? channels.slice(1, 4).map((channel) => parseInt(channel, 16)) : null;
}

/** A relation as the map holds it, its ends being note ids until the graph has looked them up. */
interface TraversableLink {
    source: string | { id?: string | number };
    target: string | { id?: string | number };
}

/**
 * How many relations away from the given note each note of the map is, the note itself being none at
 * all. Notes it cannot be reached from are left out, as is every note where it is not in the map to
 * be reached from — a search note is not part of its own results.
 *
 * Which way round a relation runs is not what this asks: a note reached only by being pointed at is
 * as near as one pointed to.
 */
export function getHopDistances(anchorNoteId: string, links: TraversableLink[]) {
    const neighbours = new Map<string, string[]>();

    const endOf = (end: TraversableLink["source"]) => (typeof end === "object" ? end.id : end);
    const join = (from?: string | number, to?: string | number) => {
        if (typeof from !== "string" || typeof to !== "string") {
            return;
        }

        neighbours.set(from, [ ...(neighbours.get(from) ?? []), to ]);
    };

    for (const link of links) {
        const source = endOf(link.source);
        const target = endOf(link.target);
        join(source, target);
        join(target, source);
    }

    const distances = new Map<string, number>();
    if (!neighbours.has(anchorNoteId)) {
        return distances;
    }

    // Breadth first, so that a note is reached by the shortest way to it before any longer one.
    distances.set(anchorNoteId, 0);
    for (let frontier = [ anchorNoteId ], distance = 1; frontier.length > 0; distance++) {
        const next: string[] = [];

        for (const noteId of frontier) {
            for (const neighbour of neighbours.get(noteId) ?? []) {
                if (!distances.has(neighbour)) {
                    distances.set(neighbour, distance);
                    next.push(neighbour);
                }
            }
        }

        frontier = next;
    }

    return distances;
}

