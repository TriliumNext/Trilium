import "./index.css";

import { divIcon, GPXOptions, LatLng, LeafletMouseEvent } from "leaflet";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIconShadow from "leaflet/dist/images/marker-shadow.png";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import FNote from "../../../entities/fnote";
import branches from "../../../services/branches";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import CollectionProperties from "../../note_bars/CollectionProperties";
import ActionButton from "../../react/ActionButton";
import { ButtonOrActionButton } from "../../react/Button";
import { useNoteBlob, useNoteLabel, useNoteLabelBoolean, useNoteProperty, useNoteTreeDrag, useSpacedUpdate, useTriliumEvent } from "../../react/hooks";
import { ParentComponent } from "../../react/react_utils";
import TouchBar, { TouchBarButton, TouchBarSlider } from "../../react/TouchBar";
import { ViewModeProps } from "../interface";
import { createNewNote, moveMarker } from "./api";
import openContextMenu, { openMapContextMenu } from "./context_menu";
import Map from "./map";
import { DEFAULT_MAP_LAYER_NAME, MAP_LAYERS, MapLayer } from "./map_layer";
import Marker, { GpxTrack } from "./marker";

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
    const [ hasScale ] = useNoteLabelBoolean(note, "map:scale");
    const [ hideLabels ] = useNoteLabelBoolean(note, "map:hideLabels");
    const [ isReadOnly ] = useNoteLabelBoolean(note, "readOnly");
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
            <CollectionProperties
                note={note}
                rightChildren={<>
                    <ToggleReadOnlyButton note={note} />
                    <ButtonOrActionButton
                        icon="bx bx-plus"
                        text={t("geo-map.create-child-note-text")}
                        title={t("geo-map.create-child-note-title")}
                        triggerCommand="geoMapCreateChildNote"
                        disabled={isReadOnly}
                    />
                </>}
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
                onContextMenu={onContextMenu}
                scale={hasScale}
            >
                {notes.map(note => <NoteWrapper note={note} isReadOnly={isReadOnly} hideLabels={hideLabels} />)}
            </Map>}
            <GeoMapTouchBar state={state} map={apiRef.current} />
        </div>
    );
}

function useLayerData(note: FNote) {
    const [ layerName ] = useNoteLabel(note, "map:style");
    // Memo is needed because it would generate unnecessary reloads due to layer change.
    const layerData = useMemo(() => {
        // Custom layers.
        if (layerName?.startsWith("http")) {
            return {
                name: "Custom",
                type: "raster",
                url: layerName,
                attribution: ""
            } satisfies MapLayer;
        }

        // Built-in layers.
        const layerData = MAP_LAYERS[layerName ?? ""] ?? MAP_LAYERS[DEFAULT_MAP_LAYER_NAME];
        return layerData;
    }, [ layerName ]);

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

function NoteWrapper({ note, isReadOnly, hideLabels }: {
    note: FNote,
    isReadOnly: boolean,
    hideLabels: boolean
}) {
    const mime = useNoteProperty(note, "mime");
    const [ location ] = useNoteLabel(note, LOCATION_ATTRIBUTE);

    if (mime === "application/gpx+xml") {
        return <NoteGpxTrack note={note} hideLabels={hideLabels} />;
    }

    if (location) {
        const latLng = location?.split(",", 2).map((el) => parseFloat(el)) as [ number, number ] | undefined;
        if (!latLng) return;
        return <NoteMarker note={note} editable={!isReadOnly} latLng={latLng} hideLabels={hideLabels} />;
    }
}

function NoteMarker({ note, editable, latLng, hideLabels }: { note: FNote, editable: boolean, latLng: [number, number], hideLabels: boolean }) {
    // React to changes
    const [ color ] = useNoteLabel(note, "color");
    const [ iconClass ] = useNoteLabel(note, "iconClass");
    const [ archived ] = useNoteLabelBoolean(note, "archived");

    const title = useNoteProperty(note, "title");
    const icon = useMemo(() => {
        const titleOrNone = hideLabels ? undefined : title;
        return buildIcon(note.getIcon(), note.getColorClass() ?? undefined, titleOrNone, note.noteId, archived);
    }, [ iconClass, color, title, note.noteId, archived, hideLabels ]);

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
    />;
}

function NoteGpxTrack({ note, hideLabels }: { note: FNote, hideLabels?: boolean }) {
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
            startIcon: buildIcon(note.getIcon(), note.getColorClass(), hideLabels ? undefined : note.title),
            endIcon: buildIcon("bxs-flag-checkered"),
            wptIcons: {
                "": buildIcon("bx bx-pin")
            }
        },
        polyline_options: {
            color: note.getLabelValue("color") ?? "blue"
        }
    }), [ color, iconClass, hideLabels ]);
    return xmlString && <GpxTrack gpxXmlString={xmlString} options={options} />;
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
    );
}
