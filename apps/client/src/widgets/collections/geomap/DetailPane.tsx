import "./DetailPane.css";

import clsx from "clsx";
import type { GeoJSONSource, MapGeoJSONFeature, Map as MapLibreGLMap, MapMouseEvent, MapSourceDataEvent } from "maplibre-gl";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import Component from "../../../components/component";
import NoteContext, { openInCurrentNoteContext } from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import NoteColorPicker from "../../../menus/custom-items/NoteColorPicker";
import linkContextMenu from "../../../menus/link_context_menu";
import { copyTextWithToast } from "../../../services/clipboard_ext";
import { t } from "../../../services/i18n";
import link from "../../../services/link";
import TitleRow from "../../layout/TitleRow";
import NoteDetail from "../../NoteDetail";
import PromotedAttributes from "../../PromotedAttributes";
import ActionButton from "../../react/ActionButton";
import Dropdown from "../../react/Dropdown";
import { FormListItem } from "../../react/FormList";
import { useLegacyComponentElement, useNoteColorClass, useNoteContext, useNoteLabel, useStaticTooltip } from "../../react/hooks";
import OverlayPanel, { OverlayPanelBody } from "../../react/OverlayPanel";
import { NoteContextContext, ParentComponent } from "../../react/react_utils";
import { removeFromMap } from "./api";
import { GPX_MIME, trackHitLayers, trackSourceId } from "./GpxTrack";
import { ParentMap } from "./map";
import { formatLocation, LOCATION_ATTRIBUTE, MARKER_LAYER, parseLocation } from "./Markers";

/**
 * Which marker the pane stands for, and why it came to be selected.
 *
 * Owned by the map view rather than by the pane, because a click on a marker is no longer the only
 * way in: a note just created on the map is opened into the pane by the code that created it (see
 * index.tsx), and state the pane kept to itself could not be set from there.
 */
export interface PaneSelection {
    noteId: string;
    /** Created a moment ago, so the pane opens with the stock title selected, ready to be typed
     *  over — the note has no name yet worth protecting from a keystroke. */
    isNew?: boolean;
    /** What of the note the click named, where it named more than the note. See {@link PaneFocus}. */
    focus?: PaneFocus;
}

/**
 * What of a GPX note the camera should honour, a file being more than one thing to point at: a flag
 * clicked is a place, stood clear of the pane at the zoom the reader chose; one of the file's
 * tracks clicked is a shape, fitted whole. Absent — the note opened without a click saying more,
 * or a click on the line of a file that holds only one journey's worth — the whole file is fitted.
 * Camera only: the pane shows the note either way.
 */
export type PaneFocus =
    | { at: [ number, number ] }
    | { track: number };

/**
 * The pane standing against the trailing edge of the map for as long as a marker is selected.
 *
 * Drawn over the map rather than beside it: the map is what goes fullscreen (see MapToolbar), so a
 * pane outside it would leave the screen. It reads as a dock because the map keeps out of its way
 * (see {@link paneOffset}).
 */
export default function DetailPane({ notes, parentNote, placing, isReadOnly, selection, onSelect, onRelocate }: {
    notes: FNote[];
    /** The map's own note, which is how the tree is told what the map holds a note by. */
    parentNote: FNote;
    /** A marker is being placed, which is what the next click on the map is for. */
    placing: boolean;
    /** The map may not be edited, which leaves the pane the ways of opening a note and no more. */
    isReadOnly: boolean;
    /** The marker the pane stands for, or `null` for a pane that is not up. See {@link PaneSelection}. */
    selection: PaneSelection | null;
    /** How the pane asks for its selection to change — a marker clicked, or nothing at all. */
    onSelect: (selection: PaneSelection | null) => void;
    /** Arms this map for the selected marker to be put somewhere else, the next click being where. */
    onRelocate: (noteId: string) => void;
}) {
    const map = useContext(ParentMap);
    const note = notes.find((note) => note.noteId === selection?.noteId);
    const [ location ] = useNoteLabel(note, LOCATION_ATTRIBUTE);
    const { noteContext, paneComponent } = usePaneNoteContext(note);

    /**
     * Lets the pane go, having given whatever is being edited in it the chance to save.
     *
     * Switching from one marker to another needs no such thing: that is a note switch within the
     * pane, and the context announces it. Closing announces nothing at all — the widgets are simply
     * unmounted — so the event a note context is removed under is raised here in its place, which is
     * what the editors are listening for (see the spaced updates in hooks.tsx).
     *
     * Raised but not waited on: the save is under way by the time the call returns, and a request
     * already in flight does not care that what started it has gone. Waiting would hold the pane
     * open for a round trip to the server every time it was closed with something unsaved in it.
     */
    const closePane = useCallback(() => {
        void paneComponent.handleEventInChildren("beforeNoteContextRemove", { ntxIds: [ PANE_NTX_ID ] });
        onSelect(null);
    }, [ paneComponent, onSelect ]);

    /**
     * Arms the map for this marker to be put somewhere else, and stands the pane down while it waits.
     *
     * The pane goes because the click that names the new place has to land on the map, and the pane
     * covers the part of it nearest the marker — leaving it up would put the likeliest destinations
     * out of reach. What the map is waiting for is said by the instruction toast instead (see
     * index.tsx), which is where the same arming from the right-click menu says it too.
     */
    const relocate = useCallback(() => {
        if (!note) return;
        closePane();
        onRelocate(note.noteId);
    }, [ note, closePane, onRelocate ]);

    /**
     * Follows a link inside the pane whose note stands on this map: the pane switches to it — the
     * map panning along, through the easing effect below — the same as if its marker had been
     * clicked. Answers whether the note stands on the map at all, a link to anything else keeping
     * its ordinary meaning (see the interception in MarkerDetails).
     */
    const followLink = useCallback((noteId: string) => {
        const target = notes.find((n) => n.noteId === noteId);
        if (!target || !parseLocation(target.getLabelValue(LOCATION_ATTRIBUTE))) return false;

        onSelect({ noteId });
        return true;
    }, [ notes, onSelect ]);

    // A note no longer on the map takes the pane with it. Its location may merely have been cleared
    // — which is all "remove from map" does — so the note being gone is not the only case. A GPX
    // track is on the map by being one: its place is its line, not a location label.
    useEffect(() => {
        if (selection && (!note || (note.mime !== GPX_MIME && !parseLocation(location)))) {
            void closePane();
        }
    }, [ selection, note, location, closePane ]);

    // A marker or a GPX track selects, anywhere else clears. Read off the rendered layers rather
    // than bound to them (`map.on("click", MARKER_LAYER, ...)`) so one handler answers all, with no
    // ordering to rely on. The markers come ahead of the tracks for the reason the context menu
    // puts them there: a pin standing on its own line is the smaller target, and the one aimed at.
    useEffect(() => {
        if (!map || placing) return;

        const onClick = (e: MapMouseEvent) => {
            const feature = map.queryRenderedFeatures(e.point, { layers: [ MARKER_LAYER, ...trackHitLayers(map) ] })[0];
            if (!feature) {
                void closePane();
                return;
            }

            onSelect({ noteId: String(feature.properties.id), focus: featureFocus(feature) });
        };

        map.on("click", onClick);
        return () => { map.off("click", onClick); };
    }, [ map, placing, closePane, onSelect ]);

    // The marker is brought to the middle of what the pane leaves uncovered. Off the selection
    // rather than in the click handler, so a marker the map opened by hand — the note it has just
    // created — is held clear of the pane the same way as one that was clicked; and off the
    // location too, so a marker that has just been put somewhere else is followed there.
    //
    // A GPX track is not a point but a shape, so it is fitted rather than centred: panned and
    // zoomed until it stands in the part of the map the pane leaves uncovered — the whole file,
    // or only what the click named where it named more (see PaneFocus).
    useEffect(() => {
        if (!map || !note) return;

        if (note.mime === GPX_MIME) {
            const focus = selection?.focus;

            // A clicked flag is a place the reader chose: stood clear of the pane at the zoom they
            // were reading at, exactly as a note marker is — flying out to frame the whole file
            // would lose the very flag they clicked.
            if (focus && "at" in focus) {
                map.easeTo({ center: focus.at, offset: paneOffset(map) });
                return;
            }

            const sourceId = trackSourceId(note.noteId);
            // Reading the track back off the map is asynchronous, and the answer may arrive after
            // the pane has moved on — to another note, or to nothing at all — or after another
            // asking of it has already fitted the map.
            let done = false;

            const fit = async () => {
                const bounds = await trackBounds(map, note.noteId, focus?.track);
                if (done || !bounds) return;
                done = true;
                map.off("sourcedata", onSourceData);
                map.fitBounds(bounds, { padding: trackFitPadding(map), maxZoom: TRACK_FIT_MAX_ZOOM });
            };

            // A track selected the moment it was brought onto the map has no line yet: its content
            // is still being fetched (see NoteGpxTrackWrapper), so the source the bounds are read
            // from is not there to be asked. The source announces itself when it goes up, and the
            // fit follows — once, the announcement repeating for as long as the source lives.
            const onSourceData = (e: MapSourceDataEvent) => {
                if (e.sourceId === sourceId) void fit();
            };

            map.on("sourcedata", onSourceData);
            void fit();

            return () => {
                done = true;
                map.off("sourcedata", onSourceData);
            };
        }

        const coordinates = parseLocation(location);
        if (!coordinates) return;

        map.easeTo({ center: coordinates, offset: paneOffset(map) });
        // The focus is depended on by identity, which a click renews even on the same note: every
        // click is a fresh ask, and re-clicking what is already open brings it back into view.
    }, [ map, note?.noteId, location, selection?.focus ]);

    // Bound only while something is selected, so the map's other Escape — giving up on placing a
    // marker (see index.tsx) — stands alone when nothing is.
    useEffect(() => {
        if (!selection) return;

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                void closePane();
            }
        };
        // Captured, not bubbled: the panel stops key presses made inside it from reaching the map
        // underneath (see OverlayPanel), which would stop them reaching this listener too.
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [ selection?.noteId, closePane ]);

    if (!note) {
        return null;
    }

    return (
        // What the pane holds reads the note out of the context rather than being handed one (see
        // TitleRow), and answers to the pane's own component rather than the map's (see below).
        <ParentComponent.Provider value={paneComponent}>
            <NoteContextContext.Provider value={noteContext}>
                <MarkerDetails note={note} parentNote={parentNote} isReadOnly={isReadOnly} onClose={closePane} onRelocate={relocate} onFollowLink={followLink} />
                {selection?.isNew && <SelectTitleOnFirstOpen />}
            </NoteContextContext.Provider>
        </ParentComponent.Provider>
    );
}

/**
 * Puts the caret in the title with the whole of the stock name selected — how the pane opens on a
 * note the map has just created, whose name is the one thing it still lacks (see PaneSelection).
 *
 * A component rather than a call after `setNote`, because only rendering says when there is an
 * input to focus: the title widget grows one as the switch's announcement works through it, over
 * more than one render, and a dispatch fired after any fixed delay is a bet on how many. This
 * hears the announcement the same way the title widget does, so by the time its effect runs, the
 * commit that mounted the input is done. The widget matches the event on the pane's ntxId, as it
 * matches the one note_create raises for a note created anywhere else.
 */
function SelectTitleOnFirstOpen() {
    const { note } = useNoteContext();
    const parentComponent = useContext(ParentComponent);
    // Once per opening: the note being edited re-announces itself (a rename saving, say), and the
    // caret must not jump back to the title mid-thought.
    const done = useRef(false);

    useEffect(() => {
        if (!note || done.current || !parentComponent) return;
        done.current = true;
        void parentComponent.handleEventInChildren("focusAndSelectTitle", { isNewNote: true, ntxId: PANE_NTX_ID });
    }, [ note?.noteId, parentComponent ]);

    return null;
}

/** Must agree with `--geo-detail-pane-width` in DetailPane.css. */
const PANE_WIDTH = 380;

/** Must agree with `--geo-map-inset` in index.css. */
const PANE_INSET = 20;

/** How far into the map the pane reaches: its width plus the gap, which it also covers. Exported
 *  because everything the map places has to keep out from under the pane — the camera holds the
 *  selected marker clear of it (below), and the marker previews slide clear of it too (see
 *  {@link Tooltips}). */
export const PANE_REACH = PANE_WIDTH + PANE_INSET;

/**
 * How far off centre to hold a marker so the pane does not cover it.
 *
 * An `offset` rather than camera `padding`, though padding is what it is for: padding stays in the
 * transform, so `getCenter()` — which the view is saved from (see map.tsx) — would report the middle
 * of the uncovered half from then on, walking the saved viewport sideways on every open.
 */
function paneOffset(map: MapLibreGLMap): [number, number] {
    // An embedded map narrower than the pane leaves nowhere to hold the marker clear of.
    if (map.getContainer().clientWidth <= PANE_REACH) {
        return [ 0, 0 ];
    }

    // The pane stands at the trailing edge, which is the left one in a right-to-left app.
    const shift = PANE_REACH / 2;
    return [ glob.isRtl ? shift : -shift, 0 ];
}

/** Air kept around a fitted track, so its ends stand clear of the pane and the map's own edges. */
const TRACK_FIT_AIR = 60;

/** How close fitting a track may zoom: a stroll around the block is still shown as a map of the
 *  neighbourhood, not of somebody's garden. */
const TRACK_FIT_MAX_ZOOM = 16;

/**
 * What of its note a clicked feature names, beyond the note itself: its own place, for a point (a
 * track's flag or a note's pin), or which of a file's journeys it is, for a line that says
 * (`track`, see GpxTrack). A line's extent cannot be read here — the geometry a rendered feature
 * answers with is clipped to the tile it was hit in — so a track is named for the camera effect to
 * measure off the source instead. A note marker's point is named too, and goes unused: its camera
 * follows the location label, which also moves when the marker does (see the camera effect).
 */
function featureFocus(feature: MapGeoJSONFeature): PaneFocus | undefined {
    if (feature.geometry.type === "Point") {
        return { at: feature.geometry.coordinates as [ number, number ] };
    }

    const track = feature.properties?.track;
    return typeof track === "number" ? { track } : undefined;
}

/**
 * The corners of the selected track, as `fitBounds` wants them, read back off the map itself — the
 * source already holds every point of the lines and their marks, so the file is not parsed twice.
 * `null` for a track that is not on this map, or holds nothing with a place.
 *
 * Given a `track`, only the journey under that index counts (see the `track` property in GpxTrack):
 * its flags stand on its line, and another journey's ground — or a waypoint hung off in a third
 * place — is exactly what focusing one track is meant to leave out of frame.
 *
 * Longitude is read in two frames at once, because it is a circle wearing a seam: a track across
 * the antimeridian holds points either side of ±180° that are a stroll apart on the ground, and
 * their raw minimum and maximum span nearly the whole world. The same longitudes are therefore
 * also read with the seam moved to 0° — each western value pushed a turn east — and whichever
 * frame drew the narrower box is the one answered. A crossing of one seam is whole in the other
 * frame; only a track truly girdling half the earth stays wide in both, and then wide is the
 * truth. The shifted answer may name longitudes past 180°, which `fitBounds` takes in stride.
 */
async function trackBounds(map: MapLibreGLMap, noteId: string, track?: number): Promise<[[number, number], [number, number]] | null> {
    const data = await map.getSource<GeoJSONSource>(trackSourceId(noteId))?.getData();
    if (!data || data.type !== "FeatureCollection") return null;

    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    let westShifted = Infinity, eastShifted = -Infinity;
    const extend = ([ lng, lat ]: number[]) => {
        west = Math.min(west, lng);
        south = Math.min(south, lat);
        east = Math.max(east, lng);
        north = Math.max(north, lat);

        const shifted = lng < 0 ? lng + 360 : lng;
        westShifted = Math.min(westShifted, shifted);
        eastShifted = Math.max(eastShifted, shifted);
    };

    for (const { geometry, properties } of data.features) {
        if (track !== undefined && properties?.track !== track) continue;

        if (geometry.type === "Point") {
            extend(geometry.coordinates);
        } else if (geometry.type === "MultiLineString") {
            for (const line of geometry.coordinates) {
                for (const point of line) {
                    extend(point);
                }
            }
        }
    }

    if (!Number.isFinite(west)) return null;

    return eastShifted - westShifted < east - west
        ? [ [ westShifted, south ], [ eastShifted, north ] ]
        : [ [ west, south ], [ east, north ] ];
}

/**
 * What a fitted track has to keep clear of: the pane on its side of the map, and a rim of air all
 * round, so the line reads as standing in the viewport rather than pinned to its corners.
 *
 * The air gives way on a map too small to spare it, and the pane's reach is only counted where
 * there is room left over — the same bargain {@link paneOffset} strikes — since padding wider than
 * the map does not clip the fit but forfeits it: MapLibre cannot solve the camera and leaves it
 * where it stands.
 */
function trackFitPadding(map: MapLibreGLMap) {
    const { clientWidth, clientHeight } = map.getContainer();
    const air = Math.max(0, Math.min(TRACK_FIT_AIR, Math.floor(Math.min(clientWidth, clientHeight) / 4)));
    const padding = { top: air, bottom: air, left: air, right: air };

    if (clientWidth > PANE_REACH + 2 * air) {
        padding[glob.isRtl ? "left" : "right"] += PANE_REACH;
    }

    return padding;
}

/** The pane itself, for a marker there is one to draw. */
function MarkerDetails({ note, parentNote, isReadOnly, onClose, onRelocate, onFollowLink }: {
    note: FNote;
    parentNote: FNote;
    isReadOnly: boolean;
    onClose(): void;
    onRelocate(): void;
    /** Offered a link's note; answers whether the map took the navigation over. */
    onFollowLink(noteId: string): boolean;
}) {
    // The marker's own colour, which is what dresses its icon (see DetailPane.css) — as the quick
    // editor's wrapper carries it. Without it the pane would inherit the hue of the note split it
    // stands in, which is the map's colour and not the marker's.
    const colorClass = useNoteColorClass(note);

    /*
     * The pane stands for its component in the DOM, which is how the text editor finds its host:
     * every call it makes back into the app resolves one from the element it is mounted in (see
     * `useLegacyComponentElement`). The pane provides a component of its own — the whole point of it
     * being a component is that the map does not hear the pane's note switches — so without this the
     * editor arrives at the widget enclosing the map instead, which answers to none of what it asks
     * for: a note carrying a reference link died on `loadReferenceLinkTitle is not a function`.
     */
    const paneRef = useRef<HTMLDivElement>(null);
    useLegacyComponentElement(paneRef);

    /*
     * Links followed within the pane. One that points at another marker of this map switches the
     * pane to it — the map panning along — instead of navigating the whole tab away from the map.
     * Every other link keeps meaning what it means anywhere else, as does every way of asking for
     * more than a plain navigation.
     *
     * Captured on the pane's own element, so it goes ahead of the document-level handler every
     * link click otherwise lands in (see the delegated listeners in link.ts) — and of the editor's.
     */
    useEffect(() => {
        const pane = paneRef.current;
        if (!pane) return;

        const onClick = (e: MouseEvent) => {
            // A modified click asks for a new tab or window, neither of which the pane answers.
            if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

            const anchor = e.target instanceof Element ? e.target.closest("a") : null;
            const href = anchor?.getAttribute("href") ?? anchor?.getAttribute("data-href");
            if (!href) return;

            // A link that says how it wants to be opened — in a popup, at an attachment, at a
            // bookmark, in a named tab — is left to say it; only the plain "go to this note" is
            // the pane's to take, and only for a note the map can go to.
            const { noteId, ntxId, viewScope, openInPopup } = link.parseNavigationStateFromUrl(href);
            if (!noteId || ntxId || openInPopup || viewScope?.viewMode !== "default"
                || viewScope.attachmentId || viewScope.bookmark || !onFollowLink(noteId)) return;

            e.preventDefault();
            e.stopPropagation();
        };

        pane.addEventListener("click", onClick, true);
        return () => pane.removeEventListener("click", onClick, true);
    }, [ onFollowLink ]);

    return (
        <OverlayPanel
            containerRef={paneRef}
            className={clsx("geo-detail-pane", colorClass)}
            header={<TitleRow compact />}
            close={{ text: t("geo-map.close-details"), onClick: onClose }}
        >
            <OverlayPanelBody className="geo-detail-pane-body">
                <MarkerLocation note={note} />

                <MarkerActions note={note} parentNote={parentNote} isReadOnly={isReadOnly} onRelocate={onRelocate} />

                {/* Whatever fields the note's own definitions ask for, ahead of the note as the quick
                    editor puts them — a marker is often a note whose type says less about it than
                    its fields do. Nothing at all is shown for a note that promotes none.

                    The location is not among them, the line above naming it better: promoted, it is
                    a box of raw digits standing beside a map of the very place it names, and the way
                    to put a marker somewhere else here is to move it. */}
                <PromotedAttributes omit={[ LOCATION_ATTRIBUTE ]} />

                {/* The note itself, drawn by whichever widget its type calls for — the same one the
                    quick editor mounts, so a marker is written in exactly as it is anywhere else.
                    No toolbar stands beside it: the pane asks for the floating one, which the editor
                    carries with it (see the view scope below). */}
                <NoteDetail />
            </OverlayPanelBody>
        </OverlayPanel>
    );
}

/** The pane's own ntxId, as the quick editor has one of its own. */
const PANE_NTX_ID = "_geo-detail-pane";

/**
 * A note context of the pane's own, pointed at whichever marker is selected — the arrangement the
 * quick editor makes, so that the icon and title widgets work and a rename saves the usual way.
 *
 * One context for the pane rather than one per marker: moving between markers is a note switch
 * within a standing pane, not a new pane.
 */
function usePaneNoteContext(note: FNote | undefined) {
    const parentComponent = useContext(ParentComponent);
    const [ noteContext ] = useState(() => new NoteContext(PANE_NTX_ID));
    // Stands between the map's component and the pane's contents. See below for why.
    const [ paneComponent ] = useState(() => new Component());

    useEffect(() => {
        if (!parentComponent) return;

        // A child of the map's component, so app-wide events still travel down into the pane — a
        // component hanging off nothing would never hear that its note was edited elsewhere.
        parentComponent.child(paneComponent);
        return () => parentComponent.removeChild(paneComponent);
    }, [ parentComponent, paneComponent ]);

    useEffect(() => {
        /*
         * The context was built here rather than by the tab manager, so it has no parent to raise
         * events through and is given one by hand — the pane's component, not the map's.
         *
         * Pointing a note context at a note announces a note switch, and an unbound `useNoteContext`
         * rebinds to whatever context it hears named (see hooks.tsx). The quick editor gets away
         * with announcing to its parent because it is a dialog at the root; the pane is inside the
         * map, so the collection view around it would rebind to the marker's note, tear the map down
         * and take the WebGL context with it.
         */
        noteContext.triggerEvent = (name, data) => paneComponent.handleEventInChildren(name, data);
    }, [ noteContext, paneComponent ]);

    useEffect(() => {
        if (!note) return;

        const notePath = note.getBestNotePathString(appContext.tabManager.getActiveContext()?.hoistedNoteId);
        void noteContext.setNote(notePath, {
            // Selecting a marker is not the kind of navigation that should dismiss an open dialog.
            keepActiveDialog: true,
            viewScope: {
                // A note held read-only only because of its size is editable here, as it is in the
                // quick editor; one the reader has marked read-only stays that way.
                readOnlyTemporarilyDisabled: !note.hasLabel("readOnly"),
                // The pane has a third of a note's width, which is not a toolbar's worth: the
                // editor's own follows the selection instead of standing in a bar (see link.ts).
                floatingToolbar: true
            }
        });
    }, [ noteContext, note?.noteId ]);

    return { noteContext, paneComponent };
}

/**
 * What can be done with the marker: the ways of opening its note, then the ways of changing it.
 *
 * One way of opening it stands out — into the tab the map is in — and the rest are gathered behind
 * the button beside it. Three of them spread across the row read as three unrelated things when they
 * are one thing with three destinations, and the menu they are gathered into is the app's own, so
 * the pane offers exactly what a link offers anywhere else rather than a hand-kept subset of it.
 *
 * The quick editor is in that menu but not in the row: it is what a click on a marker used to raise,
 * and the pane took that click over — offering it here would put a modal back over the pane that
 * replaced it.
 */
function MarkerActions({ note, parentNote, isReadOnly, onRelocate }: { note: FNote; parentNote: FNote; isReadOnly: boolean; onRelocate(): void }) {
    const [ location ] = useNoteLabel(note, LOCATION_ATTRIBUTE);
    const hoistedNoteId = appContext.tabManager.getActiveContext()?.hoistedNoteId;
    // A path rather than an id: a note may hang in several places, and each of these opens a path.
    const notePath = note.getBestNotePathString(hoistedNoteId);
    const latLng = parseLocation(location);

    return (
        <div className="geo-detail-pane-actions">
            <ActionButton
                icon="bx bx-log-in"
                text={t("geo-map.open-note")}
                // Handed the event: `openInCurrentNoteContext` reads the target tab off the element
                // clicked, which lands the note in the tab the map is in.
                onClick={(e) => notePath && openInCurrentNoteContext(e as MouseEvent, notePath)}
                disabled={!notePath}
            />

            {/* The other ways of opening it, gathered behind one button rather than spread across
                three: they are one act with three destinations.

                A dropdown and not the menu the marker's own right-click raises — that one is shown
                at a point and dismissed by the next press on the document, and the press that opened
                it from inside the panel is that press. */}
            <Dropdown
                className="geo-detail-pane-more"
                buttonClassName="bx bx-dots-horizontal-rounded"
                title={t("geo-map.more-ways-to-open")}
                iconAction
                hideToggleArrow
                noDropdownListStyle
                // The panel clips what overflows it, so a menu nested in the row would be cut off at
                // its edge; and the panel's backdrop filter would flatten the menu's own.
                portalToBody
                disabled={!notePath}
            >
                {OTHER_WAYS_TO_OPEN.map(({ command, icon, title }) => (
                    <FormListItem
                        key={command}
                        icon={icon}
                        onClick={(e) => notePath && linkContextMenu.handleLinkContextMenuItem(
                            command, e as MouseEvent, notePath, {}, hoistedNoteId ?? null)}
                    >
                        {title()}
                    </FormListItem>
                ))}
            </Dropdown>

            <ActionButton
                icon="bx bx-map-alt"
                text={t("geo-map-context.open-location")}
                // Handed to whatever the system opens a place with, as the right-click menu does.
                onClick={() => latLng && link.goToLinkExt(null, `geo:${latLng[1]},${latLng[0]}`)}
                disabled={!latLng}
            />

            {/* Left out rather than disabled on a read-only map, as the right-click menu leaves them
                out: everything else in the row reads the note, these three alone write it. */}
            {!isReadOnly && <>
                {/* The colour the pin is drawn in, which the pane already wears in its title but had
                    no way of setting — the right-click menu was the only place it could be reached.

                    Sent to the body because the panel both clips what overflows it and carries a
                    backdrop filter, either of which would be enough to cut the menu off or flatten
                    its own frosting (see the Dropdown notes in CLAUDE.md). */}
                <Dropdown
                    className="geo-detail-pane-color"
                    buttonClassName="bx bx-palette"
                    title={t("geo-map.marker-color")}
                    iconAction
                    hideToggleArrow
                    noDropdownListStyle
                    portalToBody
                >
                    <NoteColorPicker note={note} />
                </Dropdown>

                {/* A track is offered nothing here: it is on the map by being drawn across it, and
                    its place is the line its file holds rather than a location that could be
                    written somewhere else. The right-click menu leaves it out for the same reason. */}
                {note.mime !== GPX_MIME && <ActionButton
                    className="geo-detail-pane-move"
                    icon="bx bx-move"
                    text={t("geo-map-context.move-marker")}
                    // The marker is put somewhere else by being placed again rather than dragged: the
                    // notes are drawn into one symbol layer, not an element apiece, so there is
                    // nothing on the map to take hold of.
                    onClick={onRelocate}
                />}

                <ActionButton
                    className="geo-detail-pane-remove"
                    icon="bx bx-trash"
                    // Named for what it does to a track, which is delete the note: a track's line is
                    // drawn from the note's own file, so there is no taking it off the map and
                    // keeping it (see removeFromMap). The right-click menu names it the same way.
                    text={t(note.mime === GPX_MIME ? "geo-map-context.delete-note" : "geo-map-context.remove-from-map")}
                    // Whether the note goes with its marker is asked before anything happens, the
                    // two being different wishes. Nothing closes the pane afterwards because the
                    // effect above already stands it down, either way round.
                    onClick={() => void removeFromMap(note, parentNote)}
                />
            </>}
        </div>
    );
}

/**
 * The ways of opening a note other than in the tab one is already in, which the split hides behind
 * its arrow. The same four a link offers anywhere in the app, and each is carried out by the app's
 * own handler — only the naming of them is repeated here.
 *
 * Repeated because `linkContextMenu.getItems` asks for the event that raised it, which a menu drawn
 * before anything is pressed does not have. What it wants the event for is one mobile-only wording,
 * so the loss is a label rather than behaviour. The titles are thunks so they are translated when
 * the menu is drawn rather than when this module loads.
 */
export const OTHER_WAYS_TO_OPEN = [
    { command: "openNoteInNewTab", icon: "bx bx-link-external", title: () => t("link_context_menu.open_note_in_new_tab") },
    // The one the row never offered, and the one a map most wants: the place stays on show while the
    // note is read beside it.
    { command: "openNoteInNewSplit", icon: "bx bx-dock-right", title: () => t("link_context_menu.open_note_in_new_split") },
    { command: "openNoteInNewWindow", icon: "bx bx-window-open", title: () => t("link_context_menu.open_note_in_new_window") },
    // The quick editor, which is what a marker click used to raise before the pane took that click
    // over. Kept because the marker's own right-click menu offers it and the two should agree —
    // it is a way of opening the note that happens to stand over the pane, not a rival to it.
    { command: "openNoteInPopup", icon: "bx bx-edit", title: () => t("link_context_menu.open_note_in_popup") }
] as const;

/**
 * Where the marker stands, written out under the note's name.
 *
 * The map says it too, but only as exactly as the eye can read a map, and it is the written pair
 * that gets carried into a message or a search box. Pressing it copies — every digit the note holds
 * rather than the six shown, so what lands in the clipboard is the place and not the rounding, which
 * is the bargain the map's own menu strikes for the point under the pointer.
 */
function MarkerLocation({ note }: { note: FNote }) {
    const [ location ] = useNoteLabel(note, LOCATION_ATTRIBUTE);
    const coordinates = parseLocation(location);

    // The label is read in an effect, so a marker just opened has nothing to say yet.
    if (!coordinates) {
        return null;
    }

    return <LocationButton coordinates={coordinates} />;
}

/**
 * A component of its own so that the tooltip is built when the button appears rather than when the
 * pane does: the hook binds on mount and does not look again, and there is a render before the
 * location has been read in which there is no button to bind to.
 */
function LocationButton({ coordinates }: { coordinates: [number, number] }) {
    const buttonRef = useRef<HTMLButtonElement>(null);

    // The app's own tooltip rather than the browser's, as the buttons under it wear (see
    // ActionButton). Held still between renders because the hook builds the tooltip afresh whenever
    // it is handed different options, and an object literal is different every time.
    useStaticTooltip(buttonRef, useMemo(() => ({
        title: t("geo-map.copy-coordinates"),
        placement: "bottom" as const,
        animation: false
    }), []));

    return (
        <button
            ref={buttonRef}
            className="geo-detail-pane-location"
            onClick={() => copyTextWithToast(formatLocation(coordinates, FULL_PRECISION))}
        >
            <span className="bx bx-current-location" />
            {formatLocation(coordinates)}
        </button>
    );
}

/** Enough decimals to give back whatever was stored, the map writing a float's worth of them. */
const FULL_PRECISION = 15;
