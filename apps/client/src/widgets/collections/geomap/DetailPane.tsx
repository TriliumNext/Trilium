import "./DetailPane.css";

import clsx from "clsx";
import type { GeoJSONSource, MapGeoJSONFeature, Map as MapLibreGLMap, MapMouseEvent, MapSourceDataEvent } from "maplibre-gl";
import { useCallback, useContext, useEffect, useMemo, useRef } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { copyTextWithToast } from "../../../services/clipboard_ext";
import { t } from "../../../services/i18n";
import link from "../../../services/link";
import { isMobile } from "../../../services/utils";
import { announceEmbeddedNoteClosing, EmbeddedNoteActions, EmbeddedNoteScope, MaximizeAction, NoteColorAction, OpenNoteActions, SelectTitleOnFirstOpen, useEmbeddedNoteContext, useFollowLinksWithin } from "../../EmbeddedNotePane";
import TitleRow from "../../layout/TitleRow";
import NoteDetail from "../../NoteDetail";
import PromotedAttributes from "../../PromotedAttributes";
import ActionButton from "../../react/ActionButton";
import { useLegacyComponentElement, useNoteColorClass, useNoteLabel, useStaticTooltip } from "../../react/hooks";
import Modal from "../../react/Modal";
import OverlayPanel, { OverlayPanelBody } from "../../react/OverlayPanel";
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
export default function DetailPane({ notes, parentNote, placing, isReadOnly, selection, onSelect, onRelocate, maximized, onMaximizedChange }: {
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
    /**
     * The pane has been grown to cover the map (see {@link MaximizeAction} in the header below).
     * Owned by the map view rather than by the pane for the reason the selection is: the map places
     * what it draws around the pane, and a pane covering the whole of it leaves nothing to place
     * around — the marker previews have nowhere to stand clear to (see Tooltips), and the camera
     * has no uncovered half to aim into (see the easing effect below).
     */
    maximized: boolean;
    onMaximizedChange: (maximized: boolean) => void;
}) {
    const map = useContext(ParentMap);
    const note = notes.find((note) => note.noteId === selection?.noteId);
    const [ location ] = useNoteLabel(note, LOCATION_ATTRIBUTE);
    const { noteContext, component: paneComponent } = useEmbeddedNoteContext(note, PANE_NTX_ID);

    /**
     * Lets the pane go, having given whatever is being edited in it the chance to save (see
     * {@link announceEmbeddedNoteClosing}). Switching from one marker to another needs no such
     * thing: that is a note switch within the pane, and the context announces it.
     */
    const closePane = useCallback(() => {
        void announceEmbeddedNoteClosing(paneComponent, PANE_NTX_ID);
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

    // The pane comes back up beside the map rather than over it, however it was left: the state
    // outlives the pane, being the map's (see the props), where a card that is taken down and built
    // again would have forgotten by itself. Switching from one marker to another keeps it — the room
    // was asked for, not the marker it was asked on — which is why this waits on the pane going down
    // rather than on the note changing.
    useEffect(() => {
        if (!selection) onMaximizedChange(false);
    }, [ selection, onMaximizedChange ]);

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
        // Nothing is aimed at behind a surface that covers the map: the camera would be moving to a
        // place nobody can see, and the move is seen — the map slides while the pane is still
        // growing over it. Waiting instead is what makes the dependency below worth having, the
        // pane coming back down being the moment the marker is worth framing again.
        //
        // A phone shows the marker as a dialog over the whole screen rather than as a pane beside
        // the map (see MarkerSheet), so there is never a half of the map to hold it clear of: the
        // camera has nothing to do there at all, and what it did was pan the map behind a sheet.
        if (maximized || isMobile()) return;

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
        //
        // Growing and shrinking the pane are asks of the same kind, the room the camera is aiming
        // into being what changed: a pane put back down brings its marker clear of it again, rather
        // than leaving it under the pane until something else happens to move the camera.
    }, [ map, note?.noteId, location, selection?.focus, maximized ]);

    // Bound only while something is selected, so the map's other Escape — giving up on placing a
    // marker (see index.tsx) — stands alone when nothing is. A phone's dialog answers the key
    // itself (see MarkerSheet), and two answers to one press would close it twice over.
    useEffect(() => {
        if (!selection || isMobile()) return;

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
        // TitleRow), and answers to the pane's own component rather than the map's (see
        // EmbeddedNotePane) — the map would otherwise rebind to the marker's note, tear the map
        // down and take the WebGL context with it.
        <EmbeddedNoteScope component={paneComponent} noteContext={noteContext}>
            {isMobile() ? (
                <MarkerSheet
                    note={note} parentNote={parentNote} isReadOnly={isReadOnly}
                    onClose={closePane} onRelocate={relocate} onFollowLink={followLink}
                />
            ) : (
                <MarkerDetails
                    note={note} parentNote={parentNote} isReadOnly={isReadOnly}
                    maximized={maximized} onMaximizedChange={onMaximizedChange}
                    onClose={closePane} onRelocate={relocate} onFollowLink={followLink}
                />
            )}
            {selection?.isNew && <SelectTitleOnFirstOpen />}
        </EmbeddedNoteScope>
    );
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
function MarkerDetails({ note, parentNote, isReadOnly, maximized, onMaximizedChange, onClose, onRelocate, onFollowLink }: {
    note: FNote;
    parentNote: FNote;
    isReadOnly: boolean;
    maximized: boolean;
    onMaximizedChange(maximized: boolean): void;
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

    // Links followed within the pane: one pointing at another marker of this map switches the pane
    // to it, the map panning along, instead of navigating the whole tab away (see the shared hook).
    useFollowLinksWithin(paneRef, onFollowLink);

    return (
        <OverlayPanel
            containerRef={paneRef}
            className={clsx("geo-detail-pane", colorClass)}
            header={<TitleRow compact />}
            maximized={maximized}
            headerActions={
                <MaximizeAction
                    icon={maximized ? "bx bx-collapse-alt" : "bx bx-expand-alt"}
                    text={maximized ? t("geo-map.restore-details") : t("geo-map.expand-details")}
                    onClick={() => onMaximizedChange(!maximized)}
                />
            }
            close={{ text: t("geo-map.close-details"), onClick: onClose }}
        >
            {/* Grown over the map, the pane has a note's width, so what it holds is laid out for one
                (see `tn-embedded-note-pane-wide` in EmbeddedNotePane.css). */}
            <OverlayPanelBody className={clsx("geo-detail-pane-body tn-embedded-note-pane", maximized && "tn-embedded-note-pane-wide")}>
                <MarkerContents note={note} parentNote={parentNote} isReadOnly={isReadOnly} onRelocate={onRelocate} />
            </OverlayPanelBody>
        </OverlayPanel>
    );
}

/**
 * The marker as a phone shows it: the sheet the app raises its dialogs as, rather than a pane laid
 * over the map. A pane holding a whole note takes most of a phone's screen whatever is done to it,
 * so one drawn over the map leaves the map neither readable nor reachable — and the maximize that
 * would give it the rest of the screen has nothing left to give. The note is shown as a note
 * instead, and the map is left alone behind it (see the camera above).
 *
 * Dressed as the quick editor and the calendar's own sheet are, those being the app's ways of
 * showing a whole note over whatever raised it (see the shared rules in PopupEditor.css).
 *
 * `show` is not a state because every way out of this dialog is also a way out of the selection:
 * what answers `onHidden` clears it, and the sheet goes with it. Bootstrap is told to hide as the
 * element leaves the tree, so nothing is left dimming the page behind it (see Modal).
 */
function MarkerSheet({ note, parentNote, isReadOnly, onClose, onRelocate, onFollowLink }: {
    note: FNote;
    parentNote: FNote;
    isReadOnly: boolean;
    onClose(): void;
    onRelocate(): void;
    onFollowLink(noteId: string): boolean;
}) {
    // Marked on the dialog rather than on its body, so that what heads it — the note's own title
    // row, handed to the dialog — is inside the marked element too (see the pane above).
    const modalRef = useRef<HTMLDivElement>(null);
    useLegacyComponentElement(modalRef);
    useFollowLinksWithin(modalRef, onFollowLink);

    // Tinted by the marker's own colour as the pane over the map is, and by the same means the
    // quick editor is (see the `.with-hue` rules in theme-next-{light,dark}.css) — a sheet being
    // opaque, it takes the dialog's colours rather than the pane's.
    const colorClass = useNoteColorClass(note);

    return (
        <Modal
            className={clsx("geo-detail-sheet", colorClass)}
            size="lg"
            title={<TitleRow />}
            modalRef={modalRef}
            show
            onHidden={onClose}
        >
            <div className="geo-detail-pane-body tn-embedded-note-pane">
                <MarkerContents note={note} parentNote={parentNote} isReadOnly={isReadOnly} onRelocate={onRelocate} />
            </div>
        </Modal>
    );
}

/** What is shown of the marker, under whatever heads it. Shared by the pane and the sheet, which
 *  differ only in what they put around this and how they are dismissed. */
function MarkerContents({ note, parentNote, isReadOnly, onRelocate }: {
    note: FNote;
    parentNote: FNote;
    isReadOnly: boolean;
    onRelocate(): void;
}) {
    return (
        <>
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
                carries with it (see the view scope above). */}
            <NoteDetail />
        </>
    );
}

/** The pane's own ntxId, as the quick editor has one of its own. */
const PANE_NTX_ID = "_geo-detail-pane";

/**
 * What can be done with the marker: the ways of opening its note (see {@link OpenNoteActions}),
 * then the ways of changing it.
 */
function MarkerActions({ note, parentNote, isReadOnly, onRelocate }: { note: FNote; parentNote: FNote; isReadOnly: boolean; onRelocate(): void }) {
    const [ location ] = useNoteLabel(note, LOCATION_ATTRIBUTE);
    const latLng = parseLocation(location);

    return (
        <EmbeddedNoteActions>
            <OpenNoteActions note={note} />

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
                {/* Named for the pin it dresses, the colour it sets being worn everywhere the note
                    shows (see NoteColorPicker). */}
                <NoteColorAction note={note} title={t("geo-map.marker-color")} />

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
                    className="tn-embedded-note-remove"
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
        </EmbeddedNoteActions>
    );
}

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
