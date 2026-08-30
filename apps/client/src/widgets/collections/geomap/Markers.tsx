import { GEO_LOCATION_ATTRIBUTE } from "@triliumnext/commons";
import { AddLayerObject, type CircleLayerSpecification, type ExpressionSpecification, type GeoJSONSource, type MapGeoJSONFeature, type Map as MapLibreGLMap, type MapMouseEvent, type SymbolLayerSpecification } from "maplibre-gl";
import { useCallback, useContext, useEffect, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import FNote from "../../../entities/fnote";
import { getReadableTextColor } from "../../../services/css_class_manager";
import { renderIconImage } from "../../../services/icon_glyphs";
import { useTriliumEvent } from "../../react/hooks";
import { CLUSTER_LAYERS, CLUSTER_SOURCE_OPTIONS, installClusterLayers, UNCLUSTERED_ONLY, useClusterExpansion } from "./clusters";
import { ParentMap } from "./map";

export { GEO_LOCATION_ATTRIBUTE as LOCATION_ATTRIBUTE } from "@triliumnext/commons";
export const MARKER_LAYER = "points-layer";
export const MARKER_SOURCE = "points";
/** The glow put under the selected marker, drawn from the same source beneath the pins. */
export const SELECTION_LAYER = "selection-layer";
export const DEFAULT_MARKER_COLOR = "#2A81CB";

/**
 * The pin, in the coordinates its SVG is drawn in.
 *
 * Exported because a pin stands on its coordinate rather than over it, so anything else the map puts
 * at that coordinate has to know how much of the pin is in the way (see {@link Tooltips}).
 */
export const MARKER_WIDTH = 25;
export const MARKER_HEIGHT = 41;
/**
 * Room left around the pin for its shadow, in those same coordinates.
 *
 * The shadow is drawn by a filter and an SVG clips to its own viewport, so a canvas the size of the
 * pin cuts the blur off in a straight line down either side and across the tip — on a light map that
 * reads as a grey box behind the pin rather than as a shadow. Wide enough for the blur (about three
 * times its deviation) plus the distance it is pushed down.
 */
export const MARKER_SHADOW_PADDING = 6;
const MARKER_ICON_SIZE = 20;
// Centred on the pin's round head, which is a circle of the pin's own width sitting at the top.
const MARKER_ICON_X = (MARKER_WIDTH - MARKER_ICON_SIZE) / 2;
const MARKER_ICON_Y = (MARKER_WIDTH - MARKER_ICON_SIZE) / 2;

export const LABEL_LAYOUT: Extract<AddLayerObject, { type: "symbol" }>["layout"] = {
    "text-field": [ "get", "name" ],
    "text-font": [ "Open Sans Regular" ],
    "text-size": 12,
    "text-anchor": "top",
    // Titles are placed against one another rather than drawn over one another: where two would
    // overlap, only the one placed first is kept, and the map thins them out again as it is zoomed
    // in. A dozen notes in one town used to stack every title into an unreadable pile.
    //
    // `text-optional` is what keeps this from hiding notes. Without it a symbol whose title cannot
    // be placed is dropped whole, pin and all — the pins go with the titles, and a note nobody can
    // see is also one nobody can hover or right-click, since both hit-test the rendered layer.
    "text-optional": true,
    // A little air around each title, so two that merely brush past each other both survive but two
    // that would read as one word do not.
    "text-padding": 4
};

/**
 * What a title is drawn in, over a light map and over a dark one.
 *
 * A title is drawn the way the style draws its own place names: light on the dark styles, and haloed
 * by a soft, blurred glow rather than a hard keyline. A crisp white outline stood out as a cut-out
 * sticker on any map, and on a dark one it was a white edge around dark text.
 */
export const LABEL_PAINT = {
    light: {
        "text-color": "#333",
        "text-halo-color": "rgba(255, 255, 255, 0.8)"
    },
    dark: {
        "text-color": "#fff",
        "text-halo-color": "rgba(0, 0, 0, 0.8)"
    }
} satisfies Record<"light" | "dark", NonNullable<SymbolLayerSpecification["paint"]>>;

/**
 * The title of a marker whose titles are hidden.
 *
 * Hiding them empties the field rather than dropping the label layout, so that showing them again is
 * one property set on the standing layer — see the paint effect in {@link Markers}.
 */
const HIDDEN_TEXT_FIELD = "";

/**
 * How much bigger the selected pin is drawn than its neighbours.
 *
 * A layout scale on the standing layer rather than a second image: the pin is rasterized per colour
 * and icon, and a "selected" variant apiece would double that work for the sake of one marker at a
 * time. The `icon-offset` compensating for the shadow padding is multiplied by `icon-size`, so the
 * grown pin keeps standing on its coordinate with no further arithmetic.
 */
const SELECTED_PIN_SCALE = 1.3;

/**
 * The glow itself: a blurred disc at the selected pin's tip, so the marker the pane stands for reads
 * as standing in a spotlight. Dark over a light map and light over a dark one, striking the same
 * bargain as the titles (see {@link LABEL_PAINT}) — a hue of its own would vanish behind any pin
 * that happened to share it.
 */
const SELECTION_GLOW_PAINT = {
    light: { "circle-color": "rgba(0, 0, 0, 0.35)" },
    dark: { "circle-color": "rgba(255, 255, 255, 0.4)" }
} satisfies Record<"light" | "dark", NonNullable<CircleLayerSpecification["paint"]>>;

/** The glow's reach in screen pixels, a little wider than the grown pin standing over it. */
const SELECTION_GLOW_RADIUS = 18;

/**
 * Every note that carries a location, drawn as one symbol layer.
 *
 * A layer rather than an element apiece: the map is meant to hold thousands of notes, and a DOM node
 * per note is what made that slow. The pin is rasterized once per colour and icon and handed to the
 * map as an image, which the layer then stamps on the GPU.
 */
interface MarkersProps {
    notes: FNote[];
    hideLabels: boolean;
    isDarkTheme: boolean;
    clustered: boolean;
    /**
     * Whether the map is armed for a click that already means something — a note to be created where
     * it lands, or a marker to be moved there. A marker is not opened by such a click: it is a place
     * on the map like any other for as long as the map is waiting to be told one.
     */
    placing: boolean;
    /**
     * Whether opening the note is what a click on a marker means at all.
     *
     * False where something else on the map has taken that click over, which is what the detail pane
     * does: a marker is opened *into the pane* instead, and the note itself is reached from there
     * (see {@link DetailPane}). Left here rather than taken out, so that a map that carries no pane
     * — should one ever be wanted — still opens its notes the way it always did.
     */
    opensNotes: boolean;
    /**
     * The note whose marker the detail pane stands for, or `null` while the pane is down. Its pin
     * is drawn grown, above its neighbours and lit from below, so the map and the pane visibly
     * agree on which place is being talked about.
     */
    selectedNoteId: string | null;
}

export default function Markers({ notes, hideLabels, isDarkTheme, clustered, placing, opensNotes, selectedNoteId }: MarkersProps) {
    const map = useContext(ParentMap);
    const version = useNoteChangeVersion(notes);
    // Whether the style has finished loading at least once. Held outside the effects because either
    // may run after the style has loaded, and one that does has no other way to learn that it did —
    // `style.load` fires once per style and is long gone.
    const styleLoaded = useRef(false);
    // The markers last built, kept where both effects can reach them: the layer has to be able to
    // fill itself again the moment it is rebuilt, without waiting on a fresh build.
    const markerData = useRef<Awaited<ReturnType<typeof buildMarkerData>>>();
    // How the titles are to be drawn, read rather than depended on: `install` is what builds the
    // layer, so a version of it per look would take the layer down and every marker with it for
    // what is two paint properties and a layout one. Only a layer being added fresh reads this —
    // one already standing is repainted by the effect at the end.
    const labelStyle = useRef({ hideLabels, isDarkTheme });
    labelStyle.current = { hideLabels, isDarkTheme };
    // Which marker is selected, read rather than depended on for the same reason as the titles'
    // look: selecting one is a repaint of the standing layers (see the effect at the end), not a
    // rebuild of them. Only a layer being added fresh reads this.
    const selected = useRef(selectedNoteId);
    selected.current = selectedNoteId;

    /**
     * Puts the layer and its data on the map. A style is a world of its own — switching one wipes
     * every source, layer and image added to the last — so this has to run again after each style
     * load, not only when the notes change. Does nothing until there is both a loaded style to add
     * to and something to add.
     *
     * `clustered` is depended on rather than read from a ref, unlike the look of the titles: whether
     * a source gathers its notes is fixed when the source is made and cannot be set on one already
     * standing, so turning it on or off has to take the source down and put a new one up. Rebuilding
     * is the point here, which is why it is not kept out of the way as the others are.
     */
    const install = useCallback(() => {
        const data = markerData.current;
        if (!map || !data || !styleLoaded.current) return;
        const { features, images } = data;

        for (const [ id, image ] of images) {
            if (!map.hasImage(id)) {
                map.addImage(id, image, { pixelRatio: window.devicePixelRatio || 1 });
            }
        }

        if (!map.getSource(MARKER_SOURCE)) {
            map.addSource(MARKER_SOURCE, {
                type: "geojson",
                data: { type: "FeatureCollection", features: [] },
                ...(clustered ? CLUSTER_SOURCE_OPTIONS : {})
            });
        }

        if (!map.getLayer(MARKER_LAYER)) {
            map.addLayer({
                id: MARKER_LAYER,
                type: "symbol",
                source: MARKER_SOURCE,
                // Only the notes the source left standing on their own — the groups it made of the
                // rest are drawn by the cluster layers instead. Kept whether or not this map
                // gathers its notes: a source that does not has no group to hide, so the filter
                // passes everything, and the layer need not be built two ways.
                filter: UNCLUSTERED_ONLY,
                layout: {
                    "icon-image": [ "get", "icon" ],
                    "icon-size": selectionPinSize(selected.current),
                    // The selected pin drawn above its neighbours, which a grown pin half-buried
                    // under them would undo. Placement runs in the other order, so the selected
                    // title is also the likeliest to lose a contest — bearable, the pane spelling
                    // the title out anyway.
                    "symbol-sort-key": selectionSortKey(selected.current),
                    "icon-anchor": "bottom",
                    // The image carries padding for the shadow, so its bottom edge sits below
                    // the pin's tip. Push it back down by exactly that much, or every marker
                    // would stand a shadow's width off its own coordinate.
                    "icon-offset": [ 0, MARKER_SHADOW_PADDING ],
                    // Every note keeps its pin, however crowded the map: a pin dropped for
                    // colliding is a note that has silently left the map, and one that can no
                    // longer be hovered or right-clicked. Only the titles are thinned out (see
                    // LABEL_LAYOUT). The pins still take part in placement, so a title is never
                    // laid over one.
                    "icon-allow-overlap": true,
                    ...LABEL_LAYOUT,
                    "text-field": titleField(labelStyle.current.hideLabels, selected.current)
                },
                paint: {
                    // Archived notes are drawn faintly, as they were when each marker was an
                    // element of its own wearing an `archived` class.
                    "icon-opacity": [ "case", [ "get", "archived" ], 0.5, 1 ],
                    "text-opacity": [ "case", [ "get", "archived" ], 0.5, 1 ],
                    ...LABEL_PAINT[labelStyle.current.isDarkTheme ? "dark" : "light"],
                    "text-halo-width": 2,
                    "text-halo-blur": 1
                }
            });
        }

        // The glow slides in beneath the pins — added after them, so there is a layer to name as
        // the one to go under. It stands whether or not anything is selected: pointing its filter
        // at the selection is a property set on a standing layer, the discipline everything else
        // here follows.
        if (!map.getLayer(SELECTION_LAYER)) {
            map.addLayer({
                id: SELECTION_LAYER,
                type: "circle",
                source: MARKER_SOURCE,
                filter: isSelected(selected.current),
                paint: {
                    "circle-radius": SELECTION_GLOW_RADIUS,
                    // Faded from the centre outwards, so it reads as light on the ground rather
                    // than as a disc the pin stands on.
                    "circle-blur": 1,
                    ...SELECTION_GLOW_PAINT[labelStyle.current.isDarkTheme ? "dark" : "light"]
                }
            }, MARKER_LAYER);
        }

        if (clustered) {
            installClusterLayers(map, MARKER_SOURCE);
        }

        map.getSource<GeoJSONSource>(MARKER_SOURCE)?.setData({
            type: "FeatureCollection",
            features
        });
    }, [ map, clustered ]);

    // The layer, which stands for as long as the map does. Neither editing a note nor changing the
    // look of a title comes through here: taking the layer down and putting it back is what made
    // one note's colour blink every marker on the map off and back on, since the layer went at once
    // and the markers only returned once all of them had been built again.
    useEffect(() => {
        if (!map) return;

        function onStyleLoad() {
            styleLoaded.current = true;
            install();
        }

        // A style belongs to a map, so a map that has been removed has none — and asking a removed
        // map for a layer is not a no-op but a crash, since every such call goes through the style
        // that is no longer there. The map is removed by the component above this one, whose
        // cleanup Preact runs *before* this one's, so on a note switch this cleanup is always
        // handed a dead map. Nothing needs taking off a map that no longer exists, so the flag
        // ends the cleanup rather than guarding each call in turn.
        let mapRemoved = false;
        function onMapRemove() {
            mapRemoved = true;
        }
        map.on("remove", onMapRemove);

        // Listened for before the markers are built, not after. Building them is asynchronous, so
        // nothing says whether it finishes before or after the style loads, and `style.load` is a
        // one-shot event: a listener attached after it has fired is never called at all.
        // `isStyleLoaded()` is no safety net either, since it answers for the tiles as much as for
        // the style — on a map whose tiles are slow, or refused, it stays false long after the
        // style itself is ready to be added to. Lose that toss with both and the markers are never
        // added, which is what used to happen to a map big enough to be worth drawing.
        map.on("style.load", onStyleLoad);
        if (map.isStyleLoaded()) {
            styleLoaded.current = true;
        }

        // Whatever was last built goes straight back on, so a rebuilt layer is never empty while it
        // waits for a build it does not need.
        install();

        return () => {
            map.off("style.load", onStyleLoad);
            map.off("remove", onMapRemove);
            if (mapRemoved) return;

            // The layers before the source they all draw from: a source still in use cannot be
            // removed.
            for (const layer of [ MARKER_LAYER, SELECTION_LAYER, ...CLUSTER_LAYERS ]) {
                if (map.getLayer(layer)) {
                    map.removeLayer(layer);
                }
            }
            if (map.getSource(MARKER_SOURCE)) {
                map.removeSource(MARKER_SOURCE);
            }
        };
    }, [ map, install ]);

    // The markers themselves, handed to the standing layer as data. A note being edited reaches the
    // map through here and nowhere else, so the map is redrawn rather than rebuilt.
    useEffect(() => {
        if (!map) return;

        let cancelled = false;
        buildMarkerData(notes).then((built) => {
            if (cancelled) return;
            markerData.current = built;
            install();
        });

        return () => {
            cancelled = true;
        };
    }, [ map, notes, version, install ]);

    // The look of the titles, set on the layer already standing. Switching the map between a light
    // and a dark style — or hiding the titles — is a repaint of three properties, not a reason to
    // build every marker again: the pins are unaffected by either, and the rebuild that used to
    // follow took the whole layer off the map for as long as it ran. Nothing to do until the layer
    // is up, since one added after this has the current look built into it (see `install`).
    useEffect(() => {
        if (!map?.getLayer(MARKER_LAYER)) return;

        const labelPaint = LABEL_PAINT[isDarkTheme ? "dark" : "light"];
        // The glow keeps the same bargain the titles do, so it changes sides with them.
        const glowPaint = SELECTION_GLOW_PAINT[isDarkTheme ? "dark" : "light"];

        map.setLayoutProperty(MARKER_LAYER, "text-field", titleField(hideLabels, selectedNoteId));
        map.setPaintProperty(MARKER_LAYER, "text-color", labelPaint["text-color"]);
        map.setPaintProperty(MARKER_LAYER, "text-halo-color", labelPaint["text-halo-color"]);
        map.setPaintProperty(SELECTION_LAYER, "circle-color", glowPaint["circle-color"]);
    }, [ map, hideLabels, isDarkTheme, selectedNoteId ]);

    // The selected marker, told apart on the standing layers: its pin grown and raised above its
    // neighbours, the glow's filter pointed at it. Property updates for the same reason as the
    // titles' look — selecting a marker must not take every marker off the map and back. Nothing to
    // do until the layers are up, since ones added after this have the selection built in (see
    // `install`).
    useEffect(() => {
        if (!map?.getLayer(MARKER_LAYER)) return;

        map.setLayoutProperty(MARKER_LAYER, "icon-size", selectionPinSize(selectedNoteId));
        map.setLayoutProperty(MARKER_LAYER, "symbol-sort-key", selectionSortKey(selectedNoteId));
        map.setFilter(SELECTION_LAYER, isSelected(selectedNoteId));
    }, [ map, selectedNoteId ]);

    useClusterExpansion(map, MARKER_SOURCE, clustered && !placing);
    useMarkerOpening(map, opensNotes && !placing);

    return null;
}

/**
 * Whether a feature is the note the detail pane stands for.
 *
 * Matches nothing when nothing is selected — no note's id is the empty string — which is what lets
 * the glow layer stand permanently and be pointed by filter rather than added and taken away. A
 * cluster carries no `id` of its own, so a bubble never matches even while it holds the selected
 * note: a marker folded into one simply goes unhighlighted until the map is near enough to show it.
 */
function isSelected(selectedNoteId: string | null): ExpressionSpecification {
    return [ "==", [ "get", "id" ], selectedNoteId ?? "" ];
}

/** The selected pin grown and every other left alone; the plain size where nothing is selected. */
function selectionPinSize(selectedNoteId: string | null): ExpressionSpecification | number {
    return selectedNoteId ? [ "case", isSelected(selectedNoteId), SELECTED_PIN_SCALE, 1 ] : 1;
}

/** The selected pin sorted above its neighbours, higher keys being drawn later and so on top. */
function selectionSortKey(selectedNoteId: string | null): ExpressionSpecification | number {
    return selectedNoteId ? [ "case", isSelected(selectedNoteId), 1, 0 ] : 0;
}

/**
 * What the titles say: all of them, none of them — or, with the titles hidden, the selected one
 * alone. A pane discussing a note whose name the map refuses to utter would leave the highlight
 * pointing at an anonymous pin.
 */
function titleField(hideLabels: boolean, selectedNoteId: string | null) {
    if (!hideLabels) return LABEL_LAYOUT?.["text-field"];
    return selectedNoteId
        ? [ "case", isSelected(selectedNoteId), [ "get", "name" ], HIDDEN_TEXT_FIELD ] as ExpressionSpecification
        : HIDDEN_TEXT_FIELD;
}

/**
 * Opening a note by clicking its marker, which is what a marker is for.
 *
 * Bound to the layer rather than to the map, so MapLibre does the hit-testing and the handler hears
 * only the clicks that landed on a pin — the same way a bubble is opened (see `useClusterExpansion`).
 * A click that misses every marker is the map's own, and reaches the handler in `index.tsx`.
 *
 * Note that the note is opened whether or not the map may be edited. Clicking used to open a note on
 * a read-only map alone, because on an editable one the mouse belonged to dragging the marker; there
 * is no dragging any more — a marker is moved by being placed again, from its context menu — so
 * nothing is left for a click to mean instead.
 *
 * @param enabled whether a click on a marker is this map's to act on at all. False while the map is
 *                armed for placement, whose click is handled where that state lives and would
 *                otherwise both put the marker down and open the note it was clicked through.
 */
function useMarkerOpening(map: MapLibreGLMap | null, enabled: boolean) {
    useEffect(() => {
        if (!map || !enabled) return;

        function onClick(e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) {
            const noteId = e.features?.[0]?.properties.id;
            if (noteId) {
                appContext.triggerCommand("openInPopup", { noteIdOrPath: noteId });
            }
        }

        // A marker is a thing to be opened, and says so before it is.
        const setCursor = (cursor: string) => {
            if (map) map.getCanvas().style.cursor = cursor;
        };
        const onEnter = () => setCursor("pointer");
        const onLeave = () => setCursor("");

        map.on("click", MARKER_LAYER, onClick);
        map.on("mouseenter", MARKER_LAYER, onEnter);
        map.on("mouseleave", MARKER_LAYER, onLeave);

        return () => {
            map.off("click", MARKER_LAYER, onClick);
            map.off("mouseenter", MARKER_LAYER, onEnter);
            map.off("mouseleave", MARKER_LAYER, onLeave);
            // The pointer is put back by hand: relocation is armed from a marker's own context menu,
            // so this is torn down with the pointer sitting on a marker more often than not, and the
            // `mouseleave` that would have cleared it is no longer being listened for. The cursor
            // would otherwise stay a pointer over a map that is waiting to be clicked somewhere.
            onLeave();
        };
    }, [ map, enabled ]);
}

/**
 * A GeoJSON feature per located note, and the pin image each of them asks for.
 *
 * The features are gathered first and the pins drawn afterwards, all at once. Reading the notes is
 * next to free — a thousand of them cost about three milliseconds — while a pin costs some seven,
 * four fifths of which is spent handing its SVG to the browser to decode. Awaited one at a time in
 * the loop, as they were, a map paid that once per distinct colour and icon in turn; drawn together
 * it pays for the slowest of them only. A thousand notes in seven colours: fifty milliseconds
 * became eight.
 */
async function buildMarkerData(notes: FNote[]) {
    const features: GeoJSON.Feature[] = [];
    const wanted = new Map<string, { color: string, iconClass: string }>();

    for (const note of notes) {
        const latLng = parseLocation(note.getLabelValue(GEO_LOCATION_ATTRIBUTE));
        if (!latLng) continue;

        const color = note.getLabelValue("color") ?? DEFAULT_MARKER_COLOR;
        const iconClass = note.getIcon();
        const id = markerImageId(color, iconClass);

        if (!wanted.has(id)) {
            wanted.set(id, { color, iconClass });
        }

        features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: latLng },
            properties: {
                id: note.noteId,
                name: note.title,
                archived: note.isLabelTruthy("archived"),
                icon: id
            }
        });
    }

    const images = new Map<string, HTMLImageElement>();
    const drawn = await Promise.all(
        [ ...wanted ].map(async ([ id, { color, iconClass } ]) => [ id, await buildMarkerImage(color, iconClass) ] as const)
    );

    for (const [ id, image ] of drawn) {
        if (image) {
            images.set(id, image);
        }
    }

    return { features, images };
}

/** `lat,lng` as the label stores it, as the `[lng, lat]` GeoJSON wants, or `null` if unreadable. */
export function parseLocation(location: string | null | undefined): [number, number] | null {
    if (!location) return null;

    const [ lat, lng ] = location.split(",", 2).map((part) => parseFloat(part));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return [ lng, lat ];
}

/**
 * A place as it is written and as the label stores it — latitude first — from the `[lng, lat]`
 * {@link parseLocation} yields and MapLibre reports.
 *
 * Six decimals name a spot to within a stride, which is as fine as anything is pointed out on a map.
 * The full stored value is worth having when it is being carried somewhere else, so what is copied
 * asks for every digit rather than what was read.
 */
export function formatLocation([ lng, lat ]: [number, number], precision = 6) {
    return `${lat.toFixed(precision)}, ${lng.toFixed(precision)}`;
}

export function markerImageId(color: string, iconClass: string) {
    return `marker|${color}|${iconClass}`;
}

/** What has been rasterized already, since the same few pins are asked for over and over. */
const markerImages = new Map<string, Promise<HTMLImageElement | null>>();

/** The pin for a colour and icon, through the cache — what everything stamping pins should call,
 *  the GPX marks included (see GpxTrack), so a map never draws the same pin twice. */
export function buildMarkerImage(color: string, iconClass: string) {
    const id = markerImageId(color, iconClass);

    let image = markerImages.get(id);
    if (!image) {
        image = drawMarkerImage(color, iconClass);
        markerImages.set(id, image);
    }
    return image;
}

/**
 * The pin for one colour and icon, drawn once.
 *
 * The icon comes from the shared icon service, so a marker wears the icon its note wears everywhere
 * else — including one from a pack the user brought along. It is cut straight out of the pin rather
 * than set on a disc of its own, so the note's colour is all that is seen, and takes whichever of
 * black or white stands out against that colour.
 *
 * `iconClass` is passed on whole, as {@link FNote.getIcon} gives it (`tn-icon f4 f4-bunker`). The
 * service resolves a class by wearing it and reading back what the stylesheet made of it, so every
 * class handed over is one more voice in that cascade: adding a `bx` of our own would have the
 * built-in pack's font competing with the pack the icon actually belongs to, and whichever won would
 * decide the font the glyph is drawn in.
 */
export async function drawMarkerImage(color: string, iconClass: string) {
    const scale = window.devicePixelRatio || 1;
    const icon = await renderIconImage(iconClass, {
        size: MARKER_ICON_SIZE,
        color: getReadableTextColor(color),
        scale
    });

    const badge = icon
        ? `<image href="${icon}" x="${MARKER_ICON_X}" y="${MARKER_ICON_Y}" width="${MARKER_ICON_SIZE}" height="${MARKER_ICON_SIZE}" preserveAspectRatio="xMidYMid meet" />`
        : "";

    // The viewBox starts at the padding's negative, so the pin and its icon keep the coordinates
    // they are drawn in and only the canvas around them grows.
    const canvasWidth = MARKER_WIDTH + 2 * MARKER_SHADOW_PADDING;
    const canvasHeight = MARKER_HEIGHT + 2 * MARKER_SHADOW_PADDING;

    return svgToImage(`\
<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth * scale}" height="${canvasHeight * scale}" viewBox="${-MARKER_SHADOW_PADDING} ${-MARKER_SHADOW_PADDING} ${canvasWidth} ${canvasHeight}">
    <defs>
        <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-color="black" flood-opacity="0.35" />
        </filter>
    </defs>
    <path d="M12.5 0C5.6 0 0 5.6 0 12.5C0 21.9 12.5 41 12.5 41S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0Z" filter="url(#shadow)" fill="${escapeXmlAttribute(color)}" />
    ${badge}
</svg>`);
}

/** A colour comes from a label the user typed, and lands in an attribute of a document we build. */
function escapeXmlAttribute(value: string) {
    return value.replace(/[<>&"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function svgToImage(svgString: string) {
    return new Promise<HTMLImageElement | null>((resolve) => {
        const url = URL.createObjectURL(new Blob([ svgString ], { type: "image/svg+xml" }));
        const image = new Image();

        image.onload = () => {
            URL.revokeObjectURL(url);
            resolve(image);
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(null);
        };
        image.src = url;
    });
}

/**
 * A number that changes whenever something a marker is drawn from does.
 *
 * The notes are drawn into one layer rather than a component apiece, so there are no per-note hooks
 * to notice a title, colour, icon or location changing. Without this, moving a marker or taking one
 * off the map would leave the old drawing in place until the collection itself reloaded.
 */
function useNoteChangeVersion(notes: FNote[]) {
    const [ version, setVersion ] = useState(0);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const noteIds = new Set(notes.map((note) => note.noteId));
        const touched = loadResults.getAttributeRows().some((attribute) => !!attribute.noteId && noteIds.has(attribute.noteId))
            || loadResults.getNoteIds().some((noteId) => noteIds.has(noteId));

        if (touched) {
            setVersion((current) => current + 1);
        }
    });

    return version;
}
