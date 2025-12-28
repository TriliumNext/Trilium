import Map from "./map";
import "./index.css";
import { ViewModeProps } from "../interface";
import { useNoteBlob, useNoteLabel, useNoteLabelBoolean, useNoteProperty, useNoteTreeDrag, useSpacedUpdate, useTriliumEvent } from "../../react/hooks";
import { DEFAULT_MAP_LAYER_NAME } from "./map_layer";
import { divIcon, GPXOptions, LatLng, LeafletMouseEvent } from "leaflet";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import Marker, { GpxTrack } from "./marker";
import froca from "../../../services/froca";
import FNote from "../../../entities/fnote";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIconShadow from "leaflet/dist/images/marker-shadow.png";
import appContext from "../../../components/app_context";
import { createNewNote, moveMarker } from "./api";
import openContextMenu, { openMapContextMenu } from "./context_menu";
import toast from "../../../services/toast";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import branches from "../../../services/branches";
import TouchBar, { TouchBarButton, TouchBarLabel, TouchBarSlider } from "../../react/TouchBar";
import { ParentComponent } from "../../react/react_utils";

const DEFAULT_COORDINATES: [number, number] = [3.878638227135724, 446.6630455551659];
const DEFAULT_ZOOM = 2;
export const LOCATION_ATTRIBUTE = "geolocation";

interface MapData {
    view?: {
        center?: LatLng | [number, number];
        zoom?: number;
    };
}

enum State {
    Normal,
    NewNote
}

export default function GeoView({ note, noteIds, viewConfig, saveConfig }: ViewModeProps<MapData>) {
    const [ state, setState ] = useState(State.Normal);
    const [ coordinates, setCoordinates ] = useState(viewConfig?.view?.center);
    const [ zoom, setZoom ] = useState(viewConfig?.view?.zoom);
    const [ layerName ] = useNoteLabel(note, "map:style");
    const [ hasScale ] = useNoteLabelBoolean(note, "map:scale");
    const [ isReadOnly ] = useNoteLabelBoolean(note, "readOnly");
    const [ notes, setNotes ] = useState<FNote[]>([]);
    const spacedUpdate = useSpacedUpdate(() => {
        if (viewConfig) {
            saveConfig(viewConfig);
        }
    }, 5000);

    useEffect(() => { froca.getNotes(noteIds).then(setNotes) }, [ noteIds ]);

    useEffect(() => {
        if (!note) return;
        setCoordinates(viewConfig?.view?.center ?? DEFAULT_COORDINATES);
        setZoom(viewConfig?.view?.zoom ?? DEFAULT_ZOOM);
    }, [ note, viewConfig ]);

    // Note creation.
    useTriliumEvent("geoMapCreateChildNote", () => {
         toast.showPersistent({
            icon: "plus",
            id: "geo-new-note",
            title: "New note",
            message: t("geo-map.create-child-note-instruction")
        });

        setState(State.NewNote);

        const globalKeyListener: (this: Window, ev: KeyboardEvent) => any = (e) => {
            if (e.key === "Escape") {
                setState(State.Normal);

                window.removeEventListener("keydown", globalKeyListener);
                toast.closePersistent("geo-new-note");
            }
        };
        window.addEventListener("keydown", globalKeyListener);
    });

    useTriliumEvent("deleteFromMap", ({ noteId }) => {
        moveMarker(noteId, null);
    });

    const onClick = useCallback(async (e: LeafletMouseEvent) => {
        if (state === State.NewNote) {
            toast.closePersistent("geo-new-note");
            await createNewNote(note.noteId, e);
            setState(State.Normal);
        }
    }, [ state ]);

    const onContextMenu = useCallback((e: LeafletMouseEvent) => {
        openMapContextMenu(note.noteId, e, !isReadOnly);
    }, [ note.noteId, isReadOnly ]);

    // Dragging
    const containerRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<L.Map>(null);
    useNoteTreeDrag(containerRef, {
        dragEnabled: !isReadOnly,
        dragNotEnabledMessage: {
            icon: "bx bx-lock-alt",
            title: t("book.drag_locked_title"),
            message: t("book.drag_locked_message")
        },
        async callback(treeData, e) {
            const api = apiRef.current;
            if (!note || !api || isReadOnly) return;

            const { noteId } = treeData[0];

            const offset = containerRef.current?.getBoundingClientRect();
            const x = e.clientX - (offset?.left ?? 0);
            const y = e.clientY - (offset?.top ?? 0);
            const latlng = api.containerPointToLatLng([ x, y ]);

            const targetNote = await froca.getNote(noteId, true);
            const parents = targetNote?.getParentNoteIds();
            if (parents?.includes(note.noteId)) {
                await moveMarker(noteId, latlng);
            } else {
                await branches.cloneNoteToParentNote(noteId, noteId);
                await moveMarker(noteId, latlng);
            }
        }
    });

    return (
        <div className={`geo-view ${state === State.NewNote ? "placing-note" : ""}`}>
            { coordinates !== undefined && zoom !== undefined && <Map
                apiRef={apiRef} containerRef={containerRef}
                coordinates={coordinates}
                zoom={zoom}
                layerName={layerName ?? DEFAULT_MAP_LAYER_NAME}
                viewportChanged={(coordinates, zoom) => {
                    if (!viewConfig) viewConfig = {};
                    viewConfig.view = { center: coordinates, zoom };
                    spacedUpdate.scheduleUpdate();
                }}
                onClick={onClick}
                onContextMenu={onContextMenu}
                scale={hasScale}
            >
                {notes.map(note => <NoteWrapper note={note} isReadOnly={isReadOnly} />)}
            </Map>}
            <GeoMapTouchBar state={state} map={apiRef.current} />
        </div>
    );
}

function NoteWrapper({ note, isReadOnly }: { note: FNote, isReadOnly: boolean }) {
    const mime = useNoteProperty(note, "mime");
    const [ location ] = useNoteLabel(note, LOCATION_ATTRIBUTE);

    if (mime === "application/gpx+xml") {
        return <NoteGpxTrack note={note} />;
    }

    if (location) {
        const latLng = location?.split(",", 2).map((el) => parseFloat(el)) as [ number, number ] | undefined;
        if (!latLng) return;
        return <NoteMarker note={note} editable={!isReadOnly} latLng={latLng} />;
    }
}

function NoteMarker({ note, editable, latLng }: { note: FNote, editable: boolean, latLng: [number, number] }) {
    // React to changes
    const [ color ] = useNoteLabel(note, "color");
    const [ iconClass ] = useNoteLabel(note, "iconClass");
    const [ archived ] = useNoteLabelBoolean(note, "archived");

    const title = useNoteProperty(note, "title");
    const icon = useMemo(() => {
        return buildIcon(note.getIcon(), note.getColorClass() ?? undefined, title, note.noteId, archived);
    }, [ iconClass, color, title, note.noteId, archived]);

    const onClick = useCallback(() => {
        appContext.triggerCommand("openInPopup", { noteIdOrPath: note.noteId });
    }, [ note.noteId ]);

    // Middle click to open in new tab
    const onMouseDown = useCallback((e: MouseEvent) => {
        if (e.button === 1) {
            const hoistedNoteId = appContext.tabManager.getActiveContext()?.hoistedNoteId;
            appContext.tabManager.openInNewTab(note.noteId, hoistedNoteId);
            return true;
        }
    }, [ note.noteId ]);

    const onDragged = useCallback((newCoordinates: LatLng) => {
        moveMarker(note.noteId, newCoordinates);
    }, [ note.noteId ]);

    const onContextMenu = useCallback((e: LeafletMouseEvent) => openContextMenu(note.noteId, e, editable), [ note.noteId, editable ]);

    return latLng && <Marker
        coordinates={latLng}
        icon={icon}
        draggable={editable}
        onMouseDown={onMouseDown}
        onDragged={editable ? onDragged : undefined}
        onClick={!editable ? onClick : undefined}
        onContextMenu={onContextMenu}
    />
}

function NoteGpxTrack({ note }: { note: FNote }) {
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
    const color = useNoteLabel(note, "color");
    const iconClass = useNoteLabel(note, "iconClass");

    const options = useMemo<GPXOptions>(() => ({
        markers: {
            startIcon: buildIcon(note.getIcon(), note.getColorClass(), note.title),
            endIcon: buildIcon("bxs-flag-checkered"),
            wptIcons: {
                "": buildIcon("bx bx-pin")
            }
        },
        polyline_options: {
            color: note.getLabelValue("color") ?? "blue"
        }
    }), [ color, iconClass ]);
    return xmlString && <GpxTrack gpxXmlString={xmlString} options={options} />
}

function buildIcon(bxIconClass: string, colorClass?: string, title?: string, noteIdLink?: string, archived?: boolean) {
    let html = /*html*/`\
        <img class="icon" src="${markerIcon}" />
        <img class="icon-shadow" src="${markerIconShadow}" />
        <span class="bx ${bxIconClass} ${colorClass ?? ""}"></span>
        <span class="title-label">${title ?? ""}</span>`;

    if (noteIdLink) {
        html = `<div data-href="#root/${noteIdLink}" class="${archived ? "archived" : ""}">${html}</div>`;
    }

    return divIcon({
        html,
        iconSize: [25, 41],
        iconAnchor: [12, 41]
    });
}

function GeoMapTouchBar({ state, map }: { state: State, map: L.Map | null | undefined }) {
    const [ currentZoom, setCurrentZoom ] = useState<number>();
    const parentComponent = useContext(ParentComponent);

    useEffect(() => {
        if (!map) return;

        function onZoomChanged() {
            setCurrentZoom(map?.getZoom());
        }

        map.on("zoom", onZoomChanged);
        return () => map.off("zoom", onZoomChanged);
    }, [ map ]);

    return map && currentZoom && (
        <TouchBar>
            <TouchBarSlider
                label="Zoom"
                value={currentZoom}
                minValue={map.getMinZoom()}
                maxValue={map.getMaxZoom()}
                onChange={(newValue) => {
                    setCurrentZoom(newValue);
                    map.setZoom(newValue);
                }}
            />
            <TouchBarButton
                label="New geo note"
                click={() => parentComponent?.triggerCommand("geoMapCreateChildNote")}
                enabled={state === State.Normal}
            />
        </TouchBar>
    )
}
