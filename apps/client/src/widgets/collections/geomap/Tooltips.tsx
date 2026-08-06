import { type Map as MapLibreGLMap, type MapGeoJSONFeature, type MapMouseEvent, Popup } from "maplibre-gl";
import { useContext, useEffect } from "preact/hooks";

import froca from "../../../services/froca";
import { renderTooltip } from "../../../services/note_tooltip";
import { sanitizeNoteContentHtml } from "../../../services/sanitize_content";
import { isHtmlEmpty } from "../../../services/utils";
import { PANE_REACH } from "./DetailPane";
import { ParentMap } from "./map";
import { MARKER_HEIGHT, MARKER_LAYER } from "./Markers";

/**
 * How long the pointer has to rest on a marker before its note is read.
 *
 * A preview is a note's content, fetched from the server, so dragging the pointer across a crowded
 * map would otherwise read every note it happens to brush past. Deliberately shorter than the
 * {@link HOVER_DELAY} the preview itself sits out: the read begins part-way through that rest, so
 * the round trip happens *during* the remainder of the wait rather than after it. Waiting the whole
 * rest and only then reading is what made the preview arrive noticeably later here than anywhere
 * else in the app, whose tooltips race the render against the delay (see note_tooltip.ts).
 */
const READ_DELAY = 150;

/**
 * How long the pointer has to rest on a marker before its preview is shown.
 *
 * The same wait the tooltips everywhere else in the app make: a preview flashing up under every
 * passing pointer is flicker, not help. The note is read before this wait is over (see
 * {@link READ_DELAY}), but shown no sooner than this however fast the read comes back.
 */
const HOVER_DELAY = 500;

/**
 * How long the preview is left standing after the pointer leaves the marker.
 *
 * It is not closed at once because it is meant to be reached: the preview scrolls, carries the
 * note's links and a quick-edit button, and sits a little away from the pin — so getting to it
 * means crossing a gap where neither it nor the marker is under the pointer.
 */
const DISMISS_DELAY = 400;

/** How much air is left between the marker and the preview, whichever side it lands on. */
const MARKER_GAP = 8;

/**
 * What it takes to clear the marker from above and from below.
 *
 * A pin stands on its coordinate rather than over it: the whole of it is drawn *above* that point,
 * and its title hangs *below* it (see the top-anchored text in {@link Markers}'s label layout). So
 * a preview opening upwards has the pin's height to get past, and one opening downwards has the
 * title's — a line of twelve-pixel text, cleared with a little to spare, since its exact reach is
 * the renderer's business rather than ours.
 */
const CLEAR_ABOVE = MARKER_HEIGHT + MARKER_GAP;
const CLEAR_BELOW = 18 + MARKER_GAP;

/** Air kept between the preview and the map's edges when it is slid back inside them. */
const EDGE_PADDING = 8;

/**
 * The preview shown while the pointer rests on a marker.
 *
 * The same preview a note link shows anywhere else in the app — title and path, attributes, the
 * note's content and a quick-edit button — put together by the shared renderer. It is drawn into a
 * MapLibre popup rather than by the app's tooltip service because a marker is no longer an element:
 * the notes are drawn into one symbol layer (see {@link Markers}), and the service works by hovering
 * elements. What the layer gives us instead is the note behind the pixel under the pointer.
 *
 * Not every marker previews, and no preview outlives a click. The marker the detail pane stands for
 * shows nothing — the pane beside it already says everything the preview would, at full length. And
 * a click is always something being done — a marker opened into the pane, a place chosen, a pan
 * begun — whose result the preview would otherwise stand over; the app's tooltip service dismisses
 * on click for the same reason (see note_tooltip.ts). Without this, a preview whose marker was
 * clicked stood exactly where the pane then opened, and one still on its way landed on top of it.
 */
export default function Tooltips({ selectedNoteId }: {
    /** The note the detail pane stands for, or `null` while the pane is down and every marker
     *  previews. See the selection in DetailPane. */
    selectedNoteId: string | null;
}) {
    const map = useContext(ParentMap);

    useEffect(() => {
        if (!map) return;

        const tooltip = new Popup({
            closeButton: false,
            closeOnClick: false,
            // The preview brings its own width — `.tooltip-inner` caps it at 500px — and MapLibre's
            // 240px default would squeeze a note's content into a column half that wide.
            maxWidth: "none",
            // Otherwise MapLibre puts the caret on the first link in the preview the moment it
            // opens, so merely passing the pointer over a marker takes the focus out of whatever
            // the user was actually typing in.
            focusAfterOpen: false,
            className: "marker-tooltip"
        });

        // The note under the pointer, which is not necessarily the one the preview shows: reading a
        // note and rendering it is asynchronous, and a marker only skimmed past has usually been
        // left again by the time its preview is ready.
        let hovered: string | null = null;
        let shown: string | null = null;
        // Whether the pointer is on the preview itself, which is what keeps it open.
        let onTooltip = false;
        // Whether this binding of the effect has been torn down, which is what stops a show still
        // in flight from adding its popup to a map nothing manages any more.
        let cancelled = false;
        let showTimer: ReturnType<typeof setTimeout> | undefined;
        let dismissTimer: ReturnType<typeof setTimeout> | undefined;

        async function show(noteId: string, coordinates: [ number, number ]) {
            // The read raced against the rest of the wait rather than run after it: the preview
            // holds to the full HOVER_DELAY however fast the note comes back, but a round trip no
            // longer stretches that wait unless it outlasts what is left of it.
            const [ content ] = await Promise.all([
                froca.getNote(noteId).then((note) => renderTooltip(note)),
                new Promise((resolve) => setTimeout(resolve, HOVER_DELAY - READ_DELAY))
            ]);
            // A note with no content and no path renders to nothing; the pointer may well have
            // moved on to another marker while this one was being read; and a click may have
            // dismissed the preview while it was still on its way (see dismiss).
            if (cancelled || !map || hovered !== noteId || !content || isHtmlEmpty(content)) return;

            shown = noteId;
            tooltip
                .setLngLat(coordinates)
                .setHTML(buildTooltipHtml(content))
                .addTo(map);
            placePreview(map, tooltip, coordinates, selectedNoteId !== null);

            // The popup builds its element afresh every time it is added to a map, so what keeps it
            // open while the pointer is on it has to be bound per opening rather than once.
            const element = tooltip.getElement();
            element?.addEventListener("mouseenter", onTooltipEnter);
            element?.addEventListener("mouseleave", onTooltipLeave);
        }

        function hide() {
            clearTimeout(showTimer);
            shown = null;
            onTooltip = false;
            tooltip.remove();
        }

        /**
         * Closes the preview unless the pointer has landed on it — or on another marker — by the
         * time this runs.
         */
        function scheduleDismiss() {
            clearTimeout(dismissTimer);
            dismissTimer = setTimeout(() => {
                if (!hovered && !onTooltip) hide();
            }, DISMISS_DELAY);
        }

        function onMouseMove(e: MapMouseEvent & { features?: MapGeoJSONFeature[]; }) {
            const feature = e.features?.[0];
            if (!feature || feature.geometry.type !== "Point") return;

            const noteId = String(feature.properties.id);
            // Watched by the move rather than by `mouseenter`, which fires on entering the layer and
            // not on entering a marker: dragging the pointer from one pin straight onto the next
            // never leaves the layer, so the first note's preview would stay up over the second.
            if (noteId === hovered) return;

            hovered = noteId;
            clearTimeout(showTimer);
            // Whatever is up belongs to the marker just left, so it goes now rather than standing
            // there wrong for as long as the new one takes to read.
            if (shown && shown !== noteId) hide();

            // The marker the pane stands for gets no preview: the pane beside it already says
            // everything the preview would, at full length.
            if (noteId === selectedNoteId) return;

            const coordinates = feature.geometry.coordinates as [ number, number ];
            showTimer = setTimeout(() => show(noteId, coordinates), READ_DELAY);
        }

        /**
         * Puts the preview away — up or still on its way — because the map was clicked, whatever
         * the click was for. Clearing `hovered` is what drops a show already past its timer, at
         * the guard it shares with every other way of being overtaken; it also means the marker
         * clicked does not re-arm until the pointer has left it and come back, which is the
         * behaviour wanted of a marker that was just acted on.
         */
        function dismiss() {
            hovered = null;
            clearTimeout(dismissTimer);
            hide();
        }

        function onMouseLeave() {
            hovered = null;
            clearTimeout(showTimer);
            scheduleDismiss();
        }

        function onTooltipEnter() {
            onTooltip = true;
            clearTimeout(dismissTimer);
        }

        function onTooltipLeave() {
            onTooltip = false;
            scheduleDismiss();
        }

        map.on("mousemove", MARKER_LAYER, onMouseMove);
        map.on("mouseleave", MARKER_LAYER, onMouseLeave);
        // Bound to the map rather than to the marker layer: a click anywhere is something being
        // done, and the preview goes whether the click landed on a pin, a track or bare ground.
        map.on("click", dismiss);

        return () => {
            cancelled = true;
            clearTimeout(showTimer);
            clearTimeout(dismissTimer);
            map.off("mousemove", MARKER_LAYER, onMouseMove);
            map.off("mouseleave", MARKER_LAYER, onMouseLeave);
            map.off("click", dismiss);
            tooltip.remove();
        };
        // Depending on the selection makes every change of it a dismissal in itself, which covers
        // the selections no click announces: a note created onto the map is opened into the pane
        // by the code that created it (see index.tsx).
    }, [ map, selectedNoteId ]);

    return null;
}

/**
 * Puts the preview where it covers neither the pin nor its title, taken over from MapLibre.
 *
 * Left to itself, MapLibre swings a popup *beside* its point whenever the point stands within half
 * the popup's width of the map's edge — and a preview beside a pin lies across the very marker it
 * belongs to: the pin's title hangs at the point, and the popup arrives vertically centred on it.
 * What a map application does instead is what is done here: the preview stays above the marker and
 * is *slid sideways* as far as it takes to stay on the map — and out from under the detail pane,
 * while one is up — the pin keeping its place under it.
 * Only a marker too near the top for the preview to fit above it has the preview open downwards,
 * past the title (see {@link CLEAR_BELOW}) — and a marker so hemmed in that neither fits gets the
 * upward one anyway, there being no placement left to prefer.
 *
 * Called after the popup is added, because the sliding is measured against the preview's rendered
 * size, which only mounting it can say. The correction lands in the same synchronous turn as the
 * mounting, so nothing is painted in between; and the offset it sets is read back by MapLibre on
 * every later reposition, so the preview follows its marker through any map movement.
 */
function placePreview(map: MapLibreGLMap, tooltip: Popup, coordinates: [ number, number ], paneUp: boolean) {
    const element = tooltip.getElement();
    if (!element) return;

    const { offsetWidth: width, offsetHeight: height } = element;
    const point = map.project(coordinates);
    const { clientWidth: mapWidth, clientHeight: mapHeight } = map.getContainer();

    const fitsAbove = point.y - CLEAR_ABOVE - height >= EDGE_PADDING;
    const fitsBelow = point.y + CLEAR_BELOW + height <= mapHeight - EDGE_PADDING;
    const anchor = fitsAbove || !fitsBelow ? "bottom" : "top";

    // Where the preview may stand: inside the map's edges with their due air — and short of the
    // detail pane, which covers the map's trailing side for as long as a marker is selected. A
    // preview slid under the pane would be shown to nobody. The trailing side is the left one in
    // a right-to-left app, as the pane's own arithmetic has it (see paneOffset in DetailPane).
    let nearEdge = EDGE_PADDING;
    let farEdge = mapWidth - EDGE_PADDING;
    if (paneUp) {
        if (glob.isRtl) nearEdge += PANE_REACH;
        else farEdge -= PANE_REACH;
    }

    // How far sideways the preview has to give: enough to bring whichever edge stands outside
    // that room back into it — and nothing at all where the room is too narrow to ever manage,
    // centring on the pin being the best that can then be done.
    let slide = 0;
    if (farEdge - nearEdge >= width) {
        slide = Math.max(slide, nearEdge + width / 2 - point.x);
        slide = Math.min(slide, farEdge - width / 2 - point.x);
    }

    // The anchor is an option rather than a setter, but one MapLibre reads afresh on every
    // reposition — setting it here is what its own auto-anchoring would otherwise do in the same
    // place (see `_update` in its Popup).
    tooltip.options.anchor = anchor;
    tooltip.setOffset([ slide, anchor === "bottom" ? -CLEAR_ABOVE : CLEAR_BELOW ]);
}

/**
 * The rendered preview, in the shape the app's tooltip styles are written against.
 *
 * Those styles reach all the way down from `.tooltip.note-tooltip > .tooltip-inner`, so a preview
 * drawn outside Bootstrap has to put that shape on by hand or it inherits none of them — including
 * everything the theme says about the title, the attribute line and the quick-edit button. `show`
 * stands in for the class Bootstrap adds when it reveals a tooltip, without which the preview would
 * be rendered at zero opacity.
 *
 * The content is sanitized because a note's HTML reaches the client through paths CKEditor never
 * saw — the internal API, ETAPI and sync — exactly as the tooltip service sanitizes it.
 *
 * Written without a line break anywhere between the tags, because `.tooltip-inner` is `pre-line`:
 * every newline inside it is a newline the preview is drawn with, and laying this out as one would
 * lay out markup put a blank line above the preview and another below it.
 */
function buildTooltipHtml(content: string) {
    return `<div class="tooltip note-tooltip show" role="tooltip">`
        + `<div class="tooltip-inner">`
        + `<div class="note-tooltip-content">${sanitizeNoteContentHtml(content)}</div>`
        + `</div>`
        + `</div>`;
}
