import "./index.css";

import type { Map as MapLibreGL } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import branches from "../../../services/branches";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import toast from "../../../services/toast";
import CollectionProperties from "../../note_bars/CollectionProperties";
import ActionButton from "../../react/ActionButton";
import { ButtonOrActionButton } from "../../react/Button";
import { useCollectionTreeDrag, useNoteLabel, useNoteLabelBoolean, useSpacedUpdate, useTriliumEvent } from "../../react/hooks";
import { ViewModeProps } from "../interface";
import { createNewNote, moveMarker } from "./api";
import ContextMenus from "./ContextMenus";
import Map, { GeoMouseEvent } from "./map";
import { DEFAULT_MAP_LAYER_NAME, MAP_LAYERS, MapLayer } from "./map_layer";
import Markers from "./Markers";
import Tooltips from "./Tooltips";

const DEFAULT_COORDINATES: [number, number] = [3.878638227135724, 446.6630455551659];
const DEFAULT_ZOOM = 2;

interface MapData {
    view?: {
        center?: { lat: number; lng: number } | [number, number];
        zoom?: number;
    };
}

enum State {
    Normal,
    NewNote
}

export default function GeoView({ note, viewConfig, saveConfig }: ViewModeProps<MapData>) {
    const [ state, setState ] = useState(State.Normal);
    const [ coordinates, setCoordinates ] = useState(viewConfig?.view?.center);
    const [ zoom, setZoom ] = useState(viewConfig?.view?.zoom);
    const [ hasScale ] = useNoteLabelBoolean(note, "map:scale");
    const [ hideLabels ] = useNoteLabelBoolean(note, "map:hideLabels");
    const [ isReadOnly ] = useNoteLabelBoolean(note, "readOnly");
    const [ includeArchived ] = useNoteLabelBoolean(note, "includeArchived");
    const layerData = useLayerData(note);
    const spacedUpdate = useSpacedUpdate(() => {
        if (viewConfig) {
            saveConfig(viewConfig);
        }
    }, 5000);

    useEffect(() => {
        if (!note) return;
        setCoordinates(viewConfig?.view?.center ?? DEFAULT_COORDINATES);
        setZoom(viewConfig?.view?.zoom ?? DEFAULT_ZOOM);
    }, [ note, viewConfig ]);

    // Note creation. Scoped to this map instance via a local callback rather than the global
    // geoMapCreateChildNote command: embedded maps share no note context (no distinct ntxId), so a
    // broadcast command would arm placement mode on every map at once. The button is this command's
    // only trigger, so a direct handler keeps it isolated to the clicked map.
    const startNotePlacement = useCallback(() => setState(State.NewNote), []);

    // Placement mode (NewNote) is armed by the button. Tying the instruction toast and the global
    // Escape-to-cancel listener to the state (rather than the click handler) guarantees both are
    // torn down on cancel, on completion (map click) and on unmount — otherwise the listener leaks
    // and a fresh one accumulates on every placement cycle.
    useEffect(() => {
        if (state !== State.NewNote) return;

        toast.showPersistent({
            icon: "plus",
            id: "geo-new-note",
            title: t("geo-map.create-child-note-toast-title"),
            message: t("geo-map.create-child-note-instruction")
        });

        const globalKeyListener = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setState(State.Normal);
            }
        };
        window.addEventListener("keydown", globalKeyListener);

        return () => {
            window.removeEventListener("keydown", globalKeyListener);
            toast.closePersistent("geo-new-note");
        };
    }, [ state ]);

    useTriliumEvent("deleteFromMap", ({ noteId }) => {
        moveMarker(noteId, null);
    });

    const onClick = useCallback(async (e: GeoMouseEvent) => {
        if (state === State.NewNote) {
            // Leaving NewNote closes the instruction toast via the placement-mode effect cleanup.
            await createNewNote(note, e);
            setState(State.Normal);
        }
    }, [ note, state ]);

    // Dragging
    const containerRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<MapLibreGL | null>(null);
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
            const lngLat = api.unproject([x, y]);

            const targetNote = await froca.getNote(noteId, true);
            const parents = targetNote?.getParentNoteIds();
            if (parents?.includes(note.noteId)) {
                await moveMarker(noteId, { lat: lngLat.lat, lng: lngLat.lng });
                return [];
            }

            await branches.cloneNoteToParentNote(noteId, note.noteId);
            await moveMarker(noteId, { lat: lngLat.lat, lng: lngLat.lng });
            return [ noteId ];
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
                        onClick={startNotePlacement}
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
                scale={hasScale}
            >
                <Tooltips />
                <ContextMenus note={note} isReadOnly={isReadOnly} />
                <Markers note={note} hideLabels={hideLabels} />
            </Map>}
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
