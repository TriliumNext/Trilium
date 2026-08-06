import "./index.css";

import type { Map as MapLibreGLMap } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import branches from "../../../services/branches";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import CollectionProperties from "../../note_bars/CollectionProperties";
import ActionButton from "../../react/ActionButton";
import { useCollectionTreeDrag, useNoteBlob, useNoteLabel, useNoteLabelBoolean, useNoteProperty, useSpacedUpdate } from "../../react/hooks";
import { ViewModeProps } from "../interface";
import { createNewNote, importGpxTrack, moveMarker } from "./api";
import ContextMenus from "./ContextMenus";
import DetailPane, { PaneSelection } from "./DetailPane";
import EditToolbar from "./EditToolbar";
import GhostPin from "./GhostPin";
import { GPX_MIME, GpxTrack } from "./GpxTrack";
import Map, { DEFAULT_ZOOM, GeoMouseEvent } from "./map";
import { DEFAULT_MAP_LAYER_NAME, MAP_LAYERS, MapLayer } from "./map_layer";
import MapToolbar from "./MapToolbar";
import Markers, { DEFAULT_MARKER_COLOR, LOCATION_ATTRIBUTE } from "./Markers";
import Tooltips from "./Tooltips";

const DEFAULT_COORDINATES: [number, number] = [3.878638227135724, 446.6630455551659];

/**
 * The instruction toast that says what the map is waiting for. One id for both kinds of placement:
 * only one of them can be armed at a time, and reusing the id means arming the other while one is up
 * rewrites that toast rather than stacking a second one under it.
 */
const PLACEMENT_TOAST_ID = "geo-placement";

export { LOCATION_ATTRIBUTE };

interface MapData {
    view?: {
        center?: { lat: number; lng: number } | [number, number];
        zoom?: number;
    };
}

/**
 * What the next click on the map is for, where it is for anything at all: a new note is to be created
 * there, or the marker of the note named here is to be moved there. `undefined` is a map that is only
 * being looked at, which is every map most of the time.
 *
 * The two are one state rather than two because they are alternatives — a click cannot mean both — and
 * because the note being moved has nowhere else to be kept where it could not go missing.
 */
type Placement =
    | { mode: "new" }
    | { mode: "move"; noteId: string };

export default function GeoView({ note, noteIds, viewConfig, saveConfig }: ViewModeProps<MapData>) {
    const [ placement, setPlacement ] = useState<Placement>();
    // Which marker the detail pane stands for. Held here rather than in the pane so that creating a
    // note can open the pane on it (see createNoteAt below).
    const [ selection, setSelection ] = useState<PaneSelection | null>(null);
    const [ coordinates, setCoordinates ] = useState(viewConfig?.view?.center);
    const [ zoom, setZoom ] = useState(viewConfig?.view?.zoom);
    const [ hasScale ] = useNoteLabelBoolean(note, "map:scale");
    const [ hideLabels ] = useNoteLabelBoolean(note, "map:hideLabels");
    const [ clustered ] = useNoteLabelBoolean(note, "map:cluster");
    const [ isReadOnly ] = useNoteLabelBoolean(note, "readOnly");
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
    const toggleNotePlacement = useCallback(() => {
        setPlacement((current) => current?.mode === "new" ? undefined : { mode: "new" });
    }, []);
    const startMarkerRelocation = useCallback((noteId: string) => setPlacement({ mode: "move", noteId }), []);

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
        setSelection({ noteId: created.noteId, isNew: true });
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
        setSelection({ noteId: created.noteId });
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
                : {
                    icon: "move",
                    title: t("geo-map.move-marker-toast-title"),
                    message: t("geo-map.move-marker-instruction")
                })
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
        if (!placement) return;

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
            {/* Only the lock at its end: adding a note lives on the map itself now (see
                EditToolbar), where it survives the map going fullscreen without this bar. */}
            <CollectionProperties
                note={note}
                rightChildren={<ToggleReadOnlyButton note={note} />}
            />
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
                <MapToolbar />
                <EditToolbar
                    isReadOnly={isReadOnly}
                    placing={placement?.mode === "new"}
                    onTogglePlacement={toggleNotePlacement}
                    onAddGpxTrack={addGpxTrack}
                />
                <Tooltips selectedNoteId={selection?.noteId ?? null} />
                {/* The preview under the pointer while a click is armed to mean a place — the note
                    being moved wearing its own pin, a note to be created wearing the pin it will be
                    given (see api.ts). */}
                {placement && <GhostPin note={placement.mode === "move" ? notes.find((n) => n.noteId === placement.noteId) : undefined} />}
                <DetailPane notes={notes} parentNote={note} placing={!!placement} isReadOnly={isReadOnly} selection={selection} onSelect={setSelection} onRelocate={startMarkerRelocation} />
                <ContextMenus parentNote={note} isReadOnly={isReadOnly} onRelocate={startMarkerRelocation} onCreateNote={createNoteAt} />
                {/* The pane above is what a click on a marker opens now, so the markers no longer
                    open the note themselves — the two would otherwise both answer the same click,
                    raising the quick editor over the pane that had just opened behind it. */}
                <Markers notes={notes} hideLabels={hideLabels} isDarkTheme={layerData.isDarkTheme ?? false} clustered={clustered} placing={!!placement} opensNotes={false} selectedNoteId={selection?.noteId ?? null} />
                {notes.map(note => <NoteGpxTrackWrapper note={note} hideLabels={hideLabels} isDarkTheme={layerData.isDarkTheme ?? false} />)}
            </Map>}
        </div>
    );
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
        return isDarkStyle ? { ...layerData, isDarkTheme: true } : layerData;
    }, [ layerName, isDarkStyle ]);

    return layerData;
}

function ToggleReadOnlyButton({ note }: { note: FNote }) {
    const [ isReadOnly, setReadOnly ] = useNoteLabelBoolean(note, "readOnly");

    return <ActionButton
        text={isReadOnly ? t("toggle_read_only_button.unlock-editing") : t("toggle_read_only_button.lock-editing")}
        icon={isReadOnly ? "bx bx-lock-open-alt" : "bx bx-lock-alt"}
        onClick={() => setReadOnly(!isReadOnly)}
    />;
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

