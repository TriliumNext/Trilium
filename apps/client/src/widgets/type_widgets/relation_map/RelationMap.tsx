import "./RelationMap.css";

import { CreateChildrenResponse, RelationMapPostResponse } from "@triliumnext/commons";
import { jsPlumbInstance, OnConnectionBindInfo } from "jsplumb";
import panzoom, { PanZoomOptions } from "panzoom";
import { RefObject } from "preact";
import { HTMLProps } from "preact/compat";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import attribute_autocomplete from "../../../services/attribute_autocomplete";
import dialog from "../../../services/dialog";
import { isExperimentalFeatureEnabled } from "../../../services/experimental_features";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import utils from "../../../services/utils";
import ActionButton from "../../react/ActionButton";
import { useEditorSpacedUpdate, useTriliumEvent, useTriliumEvents } from "../../react/hooks";
import { TypeWidgetProps } from "../type_widget";
import RelationMapApi, { ClientRelation, MapData, MapDataNoteEntry, RelationType } from "./api";
import { buildRelationContextMenuHandler } from "./context_menu";
import { JsPlumb } from "./jsplumb";
import { NoteBox } from "./NoteBox";
import setupOverlays, { uniDirectionalOverlays } from "./overlays";
import { getMousePosition, getZoom, idToNoteId, noteIdToId } from "./utils";

const isNewLayout = isExperimentalFeatureEnabled("new-layout");

interface Clipboard {
    noteId: string;
    title: string;
}

declare module "jsplumb" {

    interface Connection {
        canvas: HTMLCanvasElement;
        getType(): string;
        bind(event: string, callback: (obj: unknown, event: MouseEvent) => void): void;
    }

    interface Overlay {
        setLabel(label: string): void;
    }

    interface ConnectParams {
        type: RelationType;
    }
}

export default function RelationMap({ note, noteContext, ntxId, parentComponent }: TypeWidgetProps) {
    const [ data, setData ] = useState<MapData>();
    const containerRef = useRef<HTMLDivElement>(null);
    const mapApiRef = useRef<RelationMapApi>(null);
    const pbApiRef = useRef<jsPlumbInstance>(null);

    const spacedUpdate = useEditorSpacedUpdate({
        note,
        noteContext,
        noteType: "relationMap",
        getData() {
            return {
                content: JSON.stringify(data),
            };
        },
        onContentChange(content) {
            let newData: MapData | null = null;

            if (content) {
                try {
                    newData = JSON.parse(content);
                } catch (e) {
                    console.log("Could not parse content: ", e);
                }
            }

            if (!newData) {
                newData = {
                    notes: [],
                    // it is important to have this exact value here so that initial transform is the same as this
                    // which will guarantee note won't be saved on first conversion to the relation map note type
                    // this keeps the principle that note type change doesn't destroy note content unless user
                    // does some actual change
                    transform: {
                        x: 0,
                        y: 0,
                        scale: 1
                    }
                };
            }

            setData(newData);
            mapApiRef.current = new RelationMapApi(note, newData, (newData, refreshUi) => {
                if (refreshUi) {
                    setData(newData);
                }
                spacedUpdate.scheduleUpdate();
            });
        },
        dataSaved() {

        }
    });

    const onTransform = useCallback((pzInstance: PanZoom) => {
        if (!containerRef.current || !mapApiRef.current || !pbApiRef.current || !data) return;
        const zoom = getZoom(containerRef.current);
        mapApiRef.current.setTransform(pzInstance.getTransform());
        pbApiRef.current.setZoom(zoom);
    }, [ data ]);

    const clickCallback = useNoteCreation({
        containerRef,
        note,
        ntxId,
        mapApiRef
    });
    const dragProps = useNoteDragging({ containerRef, mapApiRef });

    const connectionCallback = useRelationCreation({ mapApiRef, jsPlumbApiRef: pbApiRef });

    usePanZoom({
        ntxId,
        containerRef,
        options: {
            maxZoom: 2,
            minZoom: 0.3,
            smoothScroll: false,
            //@ts-expect-error Upstream incorrectly mentions no arguments.
            filterKey (e: KeyboardEvent) {
                // if ALT is pressed, then panzoom should bubble the event up
                // this is to preserve ALT-LEFT, ALT-RIGHT navigation working
                return e.altKey;
            }
        },
        transformData: data?.transform,
        onTransform
    });

    useRelationData(note.noteId, data, mapApiRef, pbApiRef);

    return (
        <div
            className="relation-map-wrapper"
            onClick={clickCallback}
            {...dragProps}
        >
            <JsPlumb
                apiRef={pbApiRef}
                containerRef={containerRef}
                className="relation-map-container"
                props={{
                    Endpoint: ["Dot", { radius: 2 }],
                    Connector: "StateMachine",
                    ConnectionOverlays: uniDirectionalOverlays,
                    HoverPaintStyle: { stroke: "#777", strokeWidth: 1 },
                }}
                onInstanceCreated={setupOverlays}
                onConnection={connectionCallback}
            >
                {data?.notes.map(note => (
                    <NoteBox {...note} mapApiRef={mapApiRef} />
                ))}
            </JsPlumb>

            {isNewLayout && (
                <div className="btn-group btn-group-sm content-floating-buttons bottom-right">
                    <ActionButton
                        icon="bx bx-zoom-in"
                        text={t("relation_map_buttons.zoom_in_title")}
                        onClick={() => parentComponent?.triggerEvent("relationMapResetZoomIn", { ntxId })}
                        className="tn-tool-button"
                        noIconActionClass
                    />

                    <ActionButton
                        icon="bx bx-zoom-out"
                        text={t("relation_map_buttons.zoom_out_title")}
                        onClick={() => parentComponent?.triggerEvent("relationMapResetZoomOut", { ntxId })}
                        className="tn-tool-button"
                        noIconActionClass
                    />

                    <ActionButton
                        icon="bx bx-crop"
                        text={t("relation_map_buttons.reset_pan_zoom_title")}
                        onClick={() => parentComponent?.triggerEvent("relationMapResetPanZoom", { ntxId })}
                        className="tn-tool-button"
                        noIconActionClass
                    />
                </div>
            )}
        </div>
    );
}

function usePanZoom({ ntxId, containerRef, options, transformData, onTransform }: {
    ntxId: string | null | undefined;
    containerRef: RefObject<HTMLDivElement>;
    options: PanZoomOptions;
    transformData: MapData["transform"] | undefined;
    onTransform: (pzInstance: PanZoom) => void
}) {
    const apiRef = useRef<PanZoom>(null);

    useEffect(() => {
        if (!containerRef.current) return;
        const pzInstance = panzoom(containerRef.current, options);
        apiRef.current = pzInstance;

        if (transformData) {
            pzInstance.zoomTo(0, 0, transformData.scale);
            pzInstance.moveTo(transformData.x, transformData.y);
        } else {
            // set to initial coordinates
            pzInstance.moveTo(0, 0);
        }

        if (onTransform) {
            apiRef.current!.on("transform", () => onTransform(pzInstance));
        }

        return () => pzInstance.dispose();
    }, [ containerRef, onTransform ]);

    useTriliumEvents([ "relationMapResetPanZoom", "relationMapResetZoomIn", "relationMapResetZoomOut" ], ({ ntxId: eventNtxId }, eventName) => {
        const pzInstance = apiRef.current;
        if (eventNtxId !== ntxId || !pzInstance) return;

        if (eventName === "relationMapResetPanZoom" && containerRef.current) {
            const zoom = getZoom(containerRef.current);
            pzInstance.zoomTo(0, 0, 1 / zoom);
            pzInstance.moveTo(0, 0);
        } else if (eventName === "relationMapResetZoomIn") {
            pzInstance.zoomTo(0, 0, 1.2);
        } else if (eventName === "relationMapResetZoomOut") {
            pzInstance.zoomTo(0, 0, 0.8);
        }
    });
}

async function useRelationData(noteId: string, mapData: MapData | undefined, mapApiRef: RefObject<RelationMapApi>, jsPlumbRef: RefObject<jsPlumbInstance>) {
    const noteIds = mapData?.notes.map((note) => note.noteId);
    const [ relations, setRelations ] = useState<ClientRelation[]>();
    const [ inverseRelations, setInverseRelations ] = useState<RelationMapPostResponse["inverseRelations"]>();

    async function refresh() {
        const api = mapApiRef.current;
        if (!noteIds || !api) return;

        const data = await server.post<RelationMapPostResponse>("relation-map", { noteIds, relationMapNoteId: noteId });
        const relations: ClientRelation[] = [];

        for (const _relation of data.relations) {
            const relation = _relation as ClientRelation;   // we inject a few variables.
            const match = relations.find(
                (rel) =>
                    rel.name === data.inverseRelations[relation.name] &&
                    ((rel.sourceNoteId === relation.sourceNoteId && rel.targetNoteId === relation.targetNoteId) ||
                        (rel.sourceNoteId === relation.targetNoteId && rel.targetNoteId === relation.sourceNoteId))
            );

            if (match) {
                match.type = relation.type = relation.name === data.inverseRelations[relation.name] ? "biDirectional" : "inverse";
                relation.render = false; // don't render second relation
            } else {
                relation.type = "uniDirectional";
                relation.render = true;
            }

            relations.push(relation);
            setInverseRelations(data.inverseRelations);
        }

        setRelations(relations);
        api.loadRelations(relations);
        api.cleanupOtherNotes(Object.keys(data.noteTitles));
    }

    useEffect(() => {
        refresh();
    }, [ noteId, mapData, jsPlumbInstance ]);

    // Refresh on the canvas.
    useEffect(() => {
        const jsPlumbInstance = jsPlumbRef.current;
        if (!jsPlumbInstance) return;

        jsPlumbInstance.batch(async () => {
            if (!mapData || !relations) {
                return;
            }

            jsPlumbInstance.deleteEveryEndpoint();

            for (const relation of relations) {
                if (!relation.render) {
                    continue;
                }

                const connection = jsPlumbInstance.connect({
                    source: noteIdToId(relation.sourceNoteId),
                    target: noteIdToId(relation.targetNoteId),
                    type: relation.type
                });
                if (!connection) return;

                // TODO: Does this actually do anything.
                //@ts-expect-error
                connection.id = relation.attributeId;

                if (relation.type === "inverse") {
                    connection.getOverlay("label-source").setLabel(relation.name);
                    connection.getOverlay("label-target").setLabel(inverseRelations?.[relation.name] ?? "");
                } else {
                    connection.getOverlay("label").setLabel(relation.name);
                }

                connection.canvas.setAttribute("data-connection-id", connection.id);
            }
        });
    }, [ relations, mapData ]);
}

function useNoteCreation({ ntxId, note, containerRef, mapApiRef }: {
    ntxId: string | null | undefined;
    note: FNote;
    containerRef: RefObject<HTMLDivElement>;
    mapApiRef: RefObject<RelationMapApi>;
}) {
    const clipboardRef = useRef<Clipboard>(null);
    useTriliumEvent("relationMapCreateChildNote", async ({ ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId) return;
        const title = await dialog.prompt({ message: t("relation_map.enter_title_of_new_note"), defaultValue: t("relation_map.default_new_note_title") });
        if (!title?.trim()) return;

        const { note: createdNote } = await server.post<CreateChildrenResponse>(`notes/${note.noteId}/children?target=into`, {
            title,
            content: "",
            type: "text"
        });

        toast.showMessage(t("relation_map.click_on_canvas_to_place_new_note"));
        clipboardRef.current = {
            noteId: createdNote.noteId,
            title
        };
    });
    const onClickHandler = useCallback((e: MouseEvent) => {
        const clipboard = clipboardRef.current;
        if (clipboard && containerRef.current && mapApiRef.current) {
            const zoom = getZoom(containerRef.current);
            let { x, y } = getMousePosition(e, containerRef.current, zoom);

            // modifying position so that the cursor is on the top-center of the box
            x -= 80;
            y -= 15;

            mapApiRef.current.createItem({ noteId: clipboard.noteId, x, y });
            clipboardRef.current = null;
        }
    }, []);
    return onClickHandler;
}

function useNoteDragging({ containerRef, mapApiRef }: {
    containerRef: RefObject<HTMLDivElement>;
    mapApiRef: RefObject<RelationMapApi>;
}): Pick<HTMLProps<HTMLDivElement>, "onDrop" | "onDragOver"> {
    const dragProps = useMemo(() => ({
        onDrop(ev: DragEvent) {
            const container = containerRef.current;
            if (!container) return;

            const dragData = ev.dataTransfer?.getData("text");
            if (!dragData) return;
            const notes = JSON.parse(dragData);

            let { x, y } = getMousePosition(ev, container, getZoom(container));
            const entries: (MapDataNoteEntry & { title: string })[] = [];

            for (const note of notes) {
                entries.push({
                    ...note,
                    x, y
                });

                if (x > 1000) {
                    y += 100;
                    x = 0;
                } else {
                    x += 200;
                }
            }

            mapApiRef.current?.addMultipleNotes(entries);
        },
        onDragOver(ev) {
            ev.preventDefault();
        }
    }), [ containerRef, mapApiRef ]);

    return dragProps;
}

function useRelationCreation({ mapApiRef, jsPlumbApiRef }: { mapApiRef: RefObject<RelationMapApi>, jsPlumbApiRef: RefObject<jsPlumbInstance> }) {
    const connectionCallback = useCallback(async (info: OnConnectionBindInfo, originalEvent: Event) => {
        const connection = info.connection;

        // Called whenever a connection is created, either initially or manually when added by the user.
        const handler = buildRelationContextMenuHandler(connection, mapApiRef);
        connection.bind("contextmenu", handler);

        // if there's no event, then this has been triggered programmatically
        if (!originalEvent || !mapApiRef.current) return;

        const name = await dialog.prompt({
            message: t("relation_map.specify_new_relation_name"),
            shown: ({ $answer }) => {
                if (!$answer) {
                    return;
                }

                $answer.on("keyup", () => {
                    // invalid characters are simply ignored (from user perspective they are not even entered)
                    const attrName = utils.filterAttributeName($answer.val() as string);

                    $answer.val(attrName);
                });

                attribute_autocomplete.initAttributeNameAutocomplete({
                    $el: $answer,
                    attributeType: "relation",
                    open: true
                });
            }
        });

        // Delete the newly created connection if the dialog was dismissed.
        if (!name || !name.trim()) {
            jsPlumbApiRef.current?.deleteConnection(connection);
            return;
        }

        const targetNoteId = idToNoteId(connection.target.id);
        const sourceNoteId = idToNoteId(connection.source.id);
        const result = await mapApiRef.current.connect(name, sourceNoteId, targetNoteId);
        if (!result) {
            await dialog.info(t("relation_map.connection_exists", { name }));
            jsPlumbApiRef.current?.deleteConnection(connection);
        }
    }, []);

    return connectionCallback;
}
