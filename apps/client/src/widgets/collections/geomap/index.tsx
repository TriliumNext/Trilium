import "./index.css";

import type { Map as MapLibreGLMap } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import branches from "../../../services/branches";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { logError } from "../../../services/ws";
import CollectionProperties from "../../note_bars/CollectionProperties";
import { useCollectionTreeDrag, useColorScheme, useEffectiveReadOnly, useNoteBlob, useNoteContext, useNoteLabel, useNoteLabelBoolean, useNoteProperty, useSpacedUpdate } from "../../react/hooks";
import { ViewModeProps } from "../interface";
import { createNewNote, createNoteForPlace, createShapeNote, importGpxTrack, moveMarker } from "./api";
import Buildings from "./Buildings";
import ContextMenus from "./ContextMenus";
import { pointPlace } from "./coordinates";
import DetailPane, { PaneSelection } from "./DetailPane";
import DrawShape, { DrawTool } from "./DrawShape";
import EditToolbar from "./EditToolbar";
import GhostPin from "./GhostPin";
import { GPX_MIME, GpxTrack } from "./GpxTrack";
import Map, { DEFAULT_ZOOM, GeoMouseEvent } from "./map";
import { DEFAULT_MAP_LAYER_NAME, MAP_LAYERS, MapLayer } from "./map_layer";
import MapToolbar from "./MapToolbar";
import type { GeoSearchResult } from "./geocoding";
import Markers, { DEFAULT_MARKER_COLOR, FitToNotes, LOCATION_ATTRIBUTE } from "./Markers";
import PlaceMarker from "./PlaceMarker";
import PlacePanel from "./PlacePanel";
import Pois from "./Pois";
import ResultNavigator from "./ResultNavigator";
import { NOTE_ZOOM, type SearchResult } from "./results";
import SearchBox from "./SearchBox";
import { ShapeLayer } from "./ShapeLayer";
import { GeoShape, parseGeoShape, SHAPE_ATTRIBUTE } from "./shapes";
import Tooltips from "./Tooltips";

/**
 * Where a map stands when there is nothing to stand it on: no view has been saved and no note it
 * holds has a place. Latitude first, as {@link MapData} holds a centre.
 *
 * A little north of the equator on the prime meridian, which at {@link DEFAULT_ZOOM} is most of the
 * inhabited world. A map that holds located notes never opens here — it frames them instead (see
 * {@link FitToNotes}).
 */
const DEFAULT_COORDINATES: [number, number] = [20, 0];

/**
 * The instruction toast that says what the map is waiting for. One id for both kinds of placement:
 * only one of them can be armed at a time, and reusing the id means arming the other while one is up
 * rewrites that toast rather than stacking a second one under it.
 */
const PLACEMENT_TOAST_ID = "geo-placement";

/**
 * How long a place is stood on before its boundary is asked for. Long enough that stepping through
 * results asks for nothing on the way past, short enough not to be waited on once the stepping stops.
 */
const OUTLINE_DELAY_MS = 250;

export { LOCATION_ATTRIBUTE };

interface MapData {
    view?: {
        center?: { lat: number; lng: number } | [number, number];
        zoom?: number;
    };
}

/**
 * What the next click on the map is for, where it is for anything at all: a new note is to be created
 * there, the marker of the note named here is to be moved there, or a line is being drawn point by
 * point. `undefined` is a map that is only being looked at, which is every map most of the time.
 *
 * The three are one state rather than three because they are alternatives — a click cannot mean two
 * of them — and because the note being moved has nowhere else to be kept where it could not go
 * missing. Drawing differs from the other two in taking many clicks rather than one, which is why
 * the map's own click handler leaves it alone (see onClick): the clicks belong to the drawing
 * session (see DrawLine) until it finishes or is stood down.
 */
type Placement =
    | { mode: "new" }
    | { mode: "move"; noteId: string }
    | { mode: "draw"; tool: DrawTool };

export default function GeoView({ note, noteIds, viewConfig, saveConfig }: ViewModeProps<MapData>) {
    const { noteContext } = useNoteContext();
    const [ placement, setPlacement ] = useState<Placement>();
    // Which marker the detail pane stands for. Held here rather than in the pane so that creating a
    // note can open the pane on it (see createNoteAt below).
    const [ selection, setSelection ] = useState<PaneSelection | null>(null);
    // The place taken from the search, standing on the map under a pin of its own until it is kept as
    // a note or dismissed. It and the selection above are one state between them: both are what the
    // map is currently standing on, and both are shown in the same corner.
    const [ pickedPlace, setPickedPlace ] = useState<GeoSearchResult>();
    const [ placeOutline, setPlaceOutline ] = useState<GeoJSON.Geometry>();
    // What the last search offered and which of it the map stands on, so the rest can be stepped
    // through once the list has stood down (see ResultNavigator).
    const [ walk, setWalk ] = useState<{ results: SearchResult[]; index: number }>();
    // Which pick the map stands on, so a boundary arriving after a later one is dropped rather than
    // drawn around whatever took its place.
    const latestPlacePick = useRef(0);
    const outlineTimer = useRef<ReturnType<typeof setTimeout>>();
    // Gives up a boundary lookup already under way, which hands back its place in the geocoder's
    // request queue: the next search would otherwise wait out a boundary nobody is looking at.
    const outlineRequest = useRef<AbortController>();
    // Held still between renders: the pin's layer is rebuilt whenever it is handed a different one,
    // and an array literal is different every time (see PlaceMarker).
    const placeCenter = useMemo<[number, number] | null>(
        () => pickedPlace ? [ pickedPlace.lng, pickedPlace.lat ] : null, [ pickedPlace ]);
    // Whether that pane has been grown over the map. Held here for the reason the selection is: what
    // the map places around the pane has to know of it too (see the maximized pane in DetailPane).
    const [ paneMaximized, setPaneMaximized ] = useState(false);
    const [ coordinates, setCoordinates ] = useState(viewConfig?.view?.center);
    const [ zoom, setZoom ] = useState(viewConfig?.view?.zoom);
    const [ hasScale ] = useNoteLabelBoolean(note, "map:scale");
    const [ hideLabels ] = useNoteLabelBoolean(note, "map:hideLabels");
    const [ clustered ] = useNoteLabelBoolean(note, "map:cluster");
    const isReadOnly = useEffectiveReadOnly(note, noteContext);
    const [ includeArchived ] = useNoteLabelBoolean(note, "includeArchived");
    const [ notes, setNotes ] = useState<FNote[]>([]);
    const layerData = useLayerData(note);
    const spacedUpdate = useSpacedUpdate(() => {
        if (viewConfig) {
            saveConfig(viewConfig);
        }
    }, 5000);

    useEffect(() => { froca.getNotes(noteIds).then(setNotes); }, [ noteIds ]);

    useEffect(() => {
        if (!note) return;
        setCoordinates(viewConfig?.view?.center ?? DEFAULT_COORDINATES);
        setZoom(viewConfig?.view?.zoom ?? DEFAULT_ZOOM);
    }, [ note, viewConfig ]);

    // Note creation and marker relocation. Both are scoped to this map instance via local callbacks
    // rather than global commands: embedded maps share no note context (no distinct ntxId), so a
    // broadcast command would arm placement mode on every map at once. The edit bar and the marker's
    // context menu are these callbacks' only triggers, so a direct handler keeps each isolated to the
    // map that was clicked.
    //
    // A toggle rather than an arming: the button on the edit bar shows the mode as held down, so
    // pressing it again is the visible way out of it — the counterpart of the toast's Escape. It
    // also takes over a map armed to move a marker, a press on + saying what the next click is for
    // more plainly than whatever was armed before.
    /** Forgets the place the map was standing on, and whatever was still to be fetched for it. */
    const forgetPlace = useCallback(() => {
        latestPlacePick.current++;
        clearTimeout(outlineTimer.current);
        outlineRequest.current?.abort();
        setPickedPlace(undefined);
        setPlaceOutline(undefined);
    }, []);

    // Nothing is left waiting to be fetched for a map that is no longer on the screen.
    useEffect(() => () => {
        clearTimeout(outlineTimer.current);
        outlineRequest.current?.abort();
    }, []);

    /** Opens the pane on a note, which sends away the searched place the panel would otherwise share
     *  a corner with. */
    const selectNote = useCallback((next: PaneSelection | null) => {
        setSelection(next);
        if (next) {
            forgetPlace();
        }
    }, [ forgetPlace ]);

    /** Stands the map on a place found by searching, and fetches the ground it covers where it covers
     *  any (see PlaceMarker). */
    const pickPlace = useCallback((place: GeoSearchResult | null) => {
        const pickId = ++latestPlacePick.current;
        clearTimeout(outlineTimer.current);
        outlineRequest.current?.abort();
        setPickedPlace(place ?? undefined);
        setPlaceOutline(undefined);
        if (place) {
            setSelection(null);
        }

        const fetchOutline = place?.outline;
        if (!fetchOutline) return;

        // Held back until the reader has settled on a place rather than fetched for each one they
        // pass. The geocoder answers one request a second and the searches queue behind the same
        // count, so a boundary nobody waited to see would be waited out by the next search.
        outlineTimer.current = setTimeout(() => {
            const request = new AbortController();
            outlineRequest.current = request;
            fetchOutline(request.signal)
                .then((outline) => {
                    if (outline && latestPlacePick.current === pickId) {
                        setPlaceOutline(outline);
                    }
                })
                .catch((e) => logError(`Fetching the boundary of "${place.label}" failed: ${e}`));
        }, OUTLINE_DELAY_MS);
    }, []);

    /**
     * Points the map at the device's position the same way it points at a typed coordinate: pickPlace
     * opens it as a place, offered for keeping as a marker (see PlacePanel). Does nothing while a click
     * is armed to place a note instead.
     */
    const showLocation = useCallback((location: { lat: number; lng: number }) => {
        if (placement) return;
        pickPlace(pointPlace([ roundCoordinate(location.lng), roundCoordinate(location.lat) ]));
    }, [ placement, pickPlace ]);

    /**
     * Stands the map on one of a search's results: a place under a pin of its own, or a note of the
     * map's own in the detail pane. Where the map is pointed is the caller's, which is the one thing
     * that differs between taking a result from the list and stepping onto it.
     */
    const showResult = useCallback((results: SearchResult[], index: number) => {
        setWalk({ results, index });

        const result = results[index];
        if (result.kind === "place") {
            pickPlace(result.place);
        } else {
            // The pane aims the camera at the marker, so it is given the zoom to aim at as well.
            selectNote({ noteId: result.noteId, zoom: NOTE_ZOOM });
        }
    }, [ pickPlace, selectNote ]);

    /** Takes the search off the map altogether: what it was standing on, and the rest it offered. */
    const clearSearch = useCallback(() => {
        setWalk(undefined);
        forgetPlace();
    }, [ forgetPlace ]);

    /** Keeps the place the map stands on as a note of its own, which is what turns its pin into a
     *  marker; the pane then opens on the note as any other newly created one. */
    const keepPlaceAsMarker = useCallback(async () => {
        if (!pickedPlace) return;

        const created = await createNoteForPlace(note, pickedPlace);
        if (!created) return;

        setNotes((current) => current.some((n) => n.noteId === created.noteId) ? current : [ ...current, created ]);
        // A place named only by where it stands gave the note nothing to be called, so the pane
        // opens with the stock title picked out, exactly as it does over a marker just placed.
        selectNote({ noteId: created.noteId, isNew: pickedPlace.unnamed });
    }, [ note, pickedPlace, selectNote ]);

    const toggleNotePlacement = useCallback(() => {
        setPlacement((current) => current?.mode === "new" ? undefined : { mode: "new" });
    }, []);
    const startMarkerRelocation = useCallback((noteId: string) => setPlacement({ mode: "move", noteId }), []);
    const toggleDrawing = useCallback((tool: DrawTool) => {
        // A press on the armed tool stands the map down; a press on another switches to it, the
        // way + takes over a map armed to move a marker.
        setPlacement((current) => current?.mode === "draw" && current.tool === tool ? undefined : { mode: "draw", tool });
    }, []);

    /**
     * Makes a note of a finished shape and opens the pane on it, title selected, exactly as a
     * placed marker is offered for naming (see createNoteAt). Disarming comes first so a failure
     * to create the note does not leave the map drawing a shape nobody is looking at any more.
     */
    const finishShape = useCallback(async (shape: GeoShape) => {
        setPlacement(undefined);

        const created = await createShapeNote(note, shape);
        if (!created) return;

        setNotes((current) => current.some((n) => n.noteId === created.noteId) ? current : [ ...current, created ]);
        selectNote({ noteId: created.noteId, isNew: true });
    }, [ note, selectNote ]);

    /**
     * Creates a note where the click landed and opens the pane on it, title selected, so naming the
     * place is typing over the stock name — there is no dialog between the click and the note (see
     * createNewNote). Serving both ways of asking for a note: the armed click and the right-click menu.
     *
     * The note is put among the map's own before the pane is pointed at it. It is already a child —
     * the collection just has not reloaded around it yet — and the pane closes itself over a
     * selection it cannot find, so waiting for the reload would open the pane on a note it refuses.
     * The marker appears with the pane rather than after it, which is no accident either.
     */
    const createNoteAt = useCallback(async (e: GeoMouseEvent) => {
        const created = await createNewNote(note, e);
        if (!created) return;

        setNotes((current) => current.some((n) => n.noteId === created.noteId) ? current : [ ...current, created ]);
        selectNote({ noteId: created.noteId, isNew: true });
    }, [ note ]);

    /**
     * Asks for a GPX file and brings it onto the map as a child note (see importGpxTrack). The
     * note is put among the map's own straight away, as a created note is, so the track is drawn
     * the moment the file is read rather than after the collection reloads around it.
     *
     * The pane opens on it too, as it opens on a note just placed — and it is the pane's own fit
     * that brings the track into view (see DetailPane), waiting on the line if it has not been
     * drawn yet, so a file from the other side of the world does not land off-screen. Unlike a
     * placed note the title is not offered for typing over: the file's name already names it.
     */
    const addGpxTrack = useCallback(async () => {
        const file = await pickGpxFile();
        if (!file) return;

        const created = await importGpxTrack(note, file);
        if (!created) return;

        setNotes((current) => current.some((n) => n.noteId === created.noteId) ? current : [ ...current, created ]);
        selectNote({ noteId: created.noteId });
    }, [ note ]);

    // Placement mode is armed by the button or by the context menu. Tying the instruction toast and
    // the global Escape-to-cancel listener to the state (rather than the handler that armed it)
    // guarantees both are torn down on cancel, on completion (map click) and on unmount — otherwise
    // the listener leaks and a fresh one accumulates on every placement cycle.
    useEffect(() => {
        if (!placement) return;

        toast.showPersistent({
            id: PLACEMENT_TOAST_ID,
            ...(placement.mode === "new"
                ? {
                    icon: "plus",
                    title: t("geo-map.create-child-note-toast-title"),
                    message: t("geo-map.create-child-note-instruction")
                }
                : placement.mode === "move"
                    ? {
                        icon: "move",
                        title: t("geo-map.move-marker-toast-title"),
                        message: t("geo-map.move-marker-instruction")
                    }
                    : drawingToast(placement.tool))
        });

        const globalKeyListener = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setPlacement(undefined);
            }
        };
        window.addEventListener("keydown", globalKeyListener);

        return () => {
            window.removeEventListener("keydown", globalKeyListener);
            toast.closePersistent(PLACEMENT_TOAST_ID);
        };
    }, [ placement ]);

    const onClick = useCallback(async (e: GeoMouseEvent) => {
        // A drawing session's clicks are its vertices, one by one — not this handler's to spend,
        // and above all not to disarm on: the session runs until it finishes or is stood down.
        if (!placement || placement.mode === "draw") return;

        // Leaving placement mode closes the instruction toast via the effect's cleanup. The state is
        // cleared first either way, so a failure to write the location does not leave the map armed
        // for a click the user has stopped expecting to mean anything.
        setPlacement(undefined);

        if (placement.mode === "new") {
            await createNoteAt(e);
        } else {
            await moveMarker(placement.noteId, e.latlng);
        }
    }, [ placement, createNoteAt ]);

    // Dragging
    const containerRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<MapLibreGLMap>(null);
    useCollectionTreeDrag(containerRef, {
        dragEnabled: !isReadOnly,
        includeArchived,
        async callback(treeData, e) {
            const api = apiRef.current;
            // treeData is non-empty in practice (useNoteTreeDrag drops empty payloads), but guard
            // explicitly so the treeData[0] access can't throw.
            if (!note || !api || isReadOnly || !treeData.length) return [];

            const { noteId } = treeData[0];

            const offset = containerRef.current?.getBoundingClientRect();
            const x = e.clientX - (offset?.left ?? 0);
            const y = e.clientY - (offset?.top ?? 0);
            const lngLat = api.unproject([ x, y ]);
            const latlng = { lat: lngLat.lat, lng: lngLat.lng };

            const targetNote = await froca.getNote(noteId, true);
            const parents = targetNote?.getParentNoteIds();
            if (parents?.includes(note.noteId)) {
                await moveMarker(noteId, latlng);
                return [];
            }

            await branches.cloneNoteToParentNote(noteId, note.noteId);
            await moveMarker(noteId, latlng);
            return [ noteId ];
        }
    });

    return (
        <div className={`geo-view ${placement ? "placing-note" : ""}`}>
            {/* Nothing of its own at the end: locking is the read-only badge's, and adding a note
                lives on the map itself (see EditToolbar), where it survives the map going
                fullscreen without this bar. */}
            <CollectionProperties note={note} />
            { coordinates !== undefined && zoom !== undefined && <Map
                apiRef={apiRef} containerRef={containerRef}
                coordinates={coordinates}
                zoom={zoom}
                layerData={layerData}
                viewportChanged={(coordinates, zoom) => {
                    if (!viewConfig) viewConfig = {};
                    viewConfig.view = { center: coordinates, zoom };
                    spacedUpdate.scheduleUpdate();
                }}
                onClick={onClick}
                scale={hasScale}
            >
                <SearchBox
                    notes={notes}
                    onPickResult={(picked) => picked ? showResult(picked.results, picked.index) : clearSearch()}
                />
                {walk && <ResultNavigator
                    results={walk.results} index={walk.index}
                    onStep={(index) => showResult(walk.results, index)}
                />}
                {pickedPlace && placeCenter && <>
                    <PlaceMarker
                        center={placeCenter} name={pickedPlace.name} icon={pickedPlace.icon}
                        outline={placeOutline} isDarkTheme={layerData.isDarkTheme ?? false}
                    />
                    <PlacePanel
                        place={pickedPlace} isReadOnly={isReadOnly}
                        onAddMarker={keepPlaceAsMarker} onClose={() => pickPlace(null)}
                    />
                </>}
                <MapToolbar onLocationClick={showLocation} />
                <EditToolbar
                    isReadOnly={isReadOnly}
                    placing={placement?.mode === "new"}
                    onTogglePlacement={toggleNotePlacement}
                    drawingTool={placement?.mode === "draw" ? placement.tool : null}
                    onToggleDrawing={toggleDrawing}
                    onAddGpxTrack={addGpxTrack}
                />
                <Tooltips selectedNoteId={selection?.noteId ?? null} paneMaximized={paneMaximized} />
                {/* The preview under the pointer while a click is armed to mean a place — the note
                    being moved wearing its own pin, a note to be created wearing the one the map
                    would give it (see GhostPin). A drawing session previews itself, so no ghost
                    then. */}
                {placement && placement.mode !== "draw" && <GhostPin
                    parentNote={note}
                    note={placement.mode === "move"
                        ? notes.find((n) => n.noteId === placement.noteId)
                        : undefined}
                />}
                {placement?.mode === "draw" && <DrawShape tool={placement.tool} onFinish={finishShape} />}
                <DetailPane
                    notes={notes} parentNote={note} placing={!!placement} isReadOnly={isReadOnly}
                    selection={selection} onSelect={selectNote} onRelocate={startMarkerRelocation}
                    maximized={paneMaximized} onMaximizedChange={setPaneMaximized}
                />
                <ContextMenus parentNote={note} isReadOnly={isReadOnly} onRelocate={startMarkerRelocation} onCreateNote={createNoteAt} />
                {/* Stood up only while the view is leaned over, so the 3D button changes the map
                    and not merely the angle it is seen from. */}
                <Buildings isDarkTheme={layerData.isDarkTheme ?? false} />
                {/* The places the base map itself draws answer a click, which is a marker named and
                    placed without typing either (see Pois). */}
                <Pois placing={!!placement} onPick={pickPlace} />
                {/* The pane above is what a click on a marker opens now, so the markers no longer
                    open the note themselves — the two would otherwise both answer the same click,
                    raising the quick editor over the pane that had just opened behind it. */}
                <Markers notes={notes} hideLabels={hideLabels} isDarkTheme={layerData.isDarkTheme ?? false} clustered={clustered} placing={!!placement} opensNotes={false} selectedNoteId={selection?.noteId ?? null} />
                {notes.map(note => <NoteGpxTrackWrapper key={note.noteId} note={note} hideLabels={hideLabels} isDarkTheme={layerData.isDarkTheme ?? false} />)}
                {notes.map(note => <NoteShapeWrapper key={note.noteId} note={note} />)}
                <FitToNotes notes={notes} enabled={!viewConfig?.view} />
            </Map>}
        </div>
    );
}

/**
 * Rounds a coordinate to six decimals, the precision a place is named and stored at (see
 * `formatLocation` in Markers). A geolocation fix reports far more digits than that.
 */
function roundCoordinate(value: number) {
    return Number(value.toFixed(6));
}

/**
 * Asks the user for a GPX file, resolving to none where the dialog is dismissed.
 *
 * A detached input rather than one rendered somewhere: the browser only wants an input to open its
 * file dialog through, and a rendered one would be a piece of DOM standing around for the one
 * moment a button is pressed. The `cancel` event is how a file input reports the dialog closed
 * empty-handed; a browser old enough not to fire it leaves an already-forgotten promise unsettled,
 * which is the same nothing the caller does on null.
 */
function pickGpxFile(): Promise<File | null> {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".gpx,application/gpx+xml";
        input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
        input.addEventListener("cancel", () => resolve(null));
        input.click();
    });
}

function useLayerData(note: FNote) {
    const [ layerName ] = useNoteLabel(note, "map:style");
    // Whether the style is a dark one, which decides how a marker's title is drawn over it (see
    // Markers). Only the style itself can say, and a style named by URL says nothing to us: it is
    // fetched by the map, and its tiles are pictures besides. So the note is asked instead.
    const [ isDarkStyle ] = useNoteLabelBoolean(note, "map:darkStyle");
    const isSystemDark = useColorScheme() === "dark";
    // Memo is needed because it would generate unnecessary reloads due to layer change.
    const layerData = useMemo(() => {
        // Custom layers.
        if (layerName?.startsWith("http")) {
            return {
                name: "Custom",
                type: "raster",
                url: layerName,
                attribution: "",
                isDarkTheme: isDarkStyle
            } satisfies MapLayer;
        }

        // Built-in layers, which declare it for themselves. The label is still honoured over one, so
        // that setting it does something wherever it is set; it can only ever say that a style is
        // dark, never that it is light, so a built-in dark style keeps its own answer either way.
        const layerData = MAP_LAYERS[layerName ?? ""] ?? MAP_LAYERS[DEFAULT_MAP_LAYER_NAME];

        // Automatic dark/light style switching based on the system color scheme.
        if ("styleDark" in layerData) {
            return {
                ...layerData,
                style: isSystemDark ? (layerData.styleDark ?? layerData.style) : layerData.style,
                isDarkTheme: isSystemDark
            } satisfies MapLayer;
        }

        return isDarkStyle ? { ...layerData, isDarkTheme: true } : layerData;
    }, [ layerName, isDarkStyle, isSystemDark ]);

    return layerData;
}

/**
 * A GPX note's track, where the note is one.
 *
 * Only tracks are rendered a component apiece: a note that merely carries a location is drawn into
 * the shared symbol layer instead (see {@link Markers}).
 */
function NoteGpxTrackWrapper({ note, hideLabels, isDarkTheme }: { note: FNote, hideLabels: boolean, isDarkTheme: boolean }) {
    const mime = useNoteProperty(note, "mime");

    if (mime !== GPX_MIME) {
        return null;
    }

    return <NoteGpxTrack note={note} hideLabels={hideLabels} isDarkTheme={isDarkTheme} />;
}

function NoteGpxTrack({ note, hideLabels, isDarkTheme }: { note: FNote, hideLabels?: boolean, isDarkTheme?: boolean }) {
    const [ xmlString, setXmlString ] = useState<string>();
    const blob = useNoteBlob(note);

    useEffect(() => {
        if (!blob) return;
        server.get<string | Uint8Array>(`notes/${note.noteId}/open`, undefined, true).then(xmlResponse => {
            if (xmlResponse instanceof Uint8Array) {
                setXmlString(new TextDecoder().decode(xmlResponse));
            } else {
                setXmlString(xmlResponse);
            }
        });
    }, [ blob ]);

    // React to changes
    const [ color ] = useNoteLabel(note, "color");
    useNoteLabel(note, "iconClass");
    // The line is named after the note along its whole length, so a note being renamed has to reach
    // the map rather than leaving the old name written across the track.
    const title = useNoteProperty(note, "title") ?? "";

    return xmlString && <GpxTrack
        noteId={note.noteId}
        title={title}
        gpxXmlString={xmlString}
        trackColor={color ?? "blue"}
        // The colour and icon rather than anything built from them: the marks are rasterized into
        // the track's own symbol layer through the shared pin rasterizer (see GpxTrack), so the
        // start of a track wears exactly the pin its note would wear as a marker.
        pinColor={color ?? DEFAULT_MARKER_COLOR}
        iconClass={note.getIcon()}
        isDarkTheme={isDarkTheme}
        hideLabels={hideLabels}
    />;
}

/**
 * A note's drawn shape, where the note carries one — a shape written into its `#geoShape` label
 * (see shapes.ts). A label the shape cannot be read from draws nothing, the same nothing a note
 * with no shape at all draws: the label is user-editable like any other, and a map is no place to
 * report a parse error.
 */
function NoteShapeWrapper({ note }: { note: FNote }) {
    const [ shapeValue ] = useNoteLabel(note, SHAPE_ATTRIBUTE);
    const [ color ] = useNoteLabel(note, "color");

    const shape = shapeValue ? parseGeoShape(shapeValue) : null;
    if (!shape) {
        return null;
    }

    return <ShapeLayer
        noteId={note.noteId}
        shape={shape}
        color={color ?? "blue"}
    />;
}

/** What the instruction toast says while each tool is armed (see the placement toast above). */
function drawingToast(tool: DrawTool): { icon: string; title: string; message: string } {
    switch (tool) {
        case "line":
            return {
                icon: "vector",
                title: t("geo-map.draw-line-toast-title"),
                message: t("geo-map.draw-line-instruction")
            };
        case "polygon":
            return {
                icon: "shape-polygon",
                title: t("geo-map.draw-polygon-toast-title"),
                message: t("geo-map.draw-polygon-instruction")
            };
        case "rectangle":
            return {
                icon: "rectangle",
                title: t("geo-map.draw-rectangle-toast-title"),
                message: t("geo-map.draw-rectangle-instruction")
            };
        case "circle":
            return {
                icon: "shape-circle",
                title: t("geo-map.draw-circle-toast-title"),
                message: t("geo-map.draw-circle-instruction")
            };
    }
}

