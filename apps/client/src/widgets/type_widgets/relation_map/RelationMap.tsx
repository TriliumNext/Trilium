import "./RelationMap.css";

import { CreateChildrenResponse, RelationMapPostResponse, RelationMapReification } from "@triliumnext/commons";
import { jsPlumbInstance, OnConnectionBindInfo } from "jsplumb";
// The library's own types rather than the hand-written `PanZoom` in types.d.ts, which stops at the
// handful of calls the map made when it was written and knows nothing of the rest — the ends of the
// zoom range, or unsubscribing from a report.
import panzoom, { PanZoom, PanZoomOptions } from "panzoom";
import { RefObject } from "preact";
import { HTMLProps } from "preact/compat";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import dialog from "../../../services/dialog";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { useEditorSpacedUpdate, useNoteLabelBoolean, useTriliumEvent, useTriliumEvents } from "../../react/hooks";
import { TypeWidgetProps } from "../type_widget";
import RelationMapApi, { ClientRelation, MapData, MapDataNoteEntry, RelationType } from "./api";
import { buildRelationContextMenuHandler, showRelationMenu, type RelationMenuActions } from "./context_menu";
import { JsPlumb } from "./jsplumb";
import MapToolbar, { EditToolbar } from "./MapToolbar";
import { NoteBox } from "./NoteBox";
import { ReificationToken } from "./ReificationToken";
import { projectRelationMap, relationSurvivesFold } from "./reification_layout";
import setupOverlays, { uniDirectionalOverlays } from "./overlays";
import { getMousePosition, getZoom, idToNoteId, noteIdToId, promptForRelationName } from "./utils";

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
    // The same read-only the note's own bar of actions read while the + stood there.
    const [ isReadOnly ] = useNoteLabelBoolean(note, "readOnly");
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
            let newData: Partial<MapData> | null = null;

            if (content) {
                try {
                    newData = JSON.parse(content);
                } catch (e) {
                    console.log("Could not parse content: ", e);
                }
            }

            if (!newData || !newData.notes || !newData.transform) {
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

            setData(newData as MapData);
            mapApiRef.current = new RelationMapApi(note, newData as MapData, (newData, refreshUi) => {
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

    const panZoom = usePanZoom({
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

    const [ focusStack, setFocusStack ] = useState<string[]>([]);
    const [ collapsed, setCollapsed ] = useState<ReadonlySet<string>>(() => new Set());
    const focusNoteId = focusStack.at(-1) ?? null;
    const relationActionsRef = useRef<RelationMenuActions>({
        isCollapsed: () => false,
        goTo: () => {},
        toggleCollapse: () => {}
    });
    relationActionsRef.current = {
        isCollapsed(attributeId) {
            return collapsed.has(attributeId);
        },
        async goTo(attributeId) {
            const existing = mapApiRef.current?.reificationFor(attributeId);
            const noteId = existing?.noteId ?? await mapApiRef.current?.reifyRelation(attributeId);
            if (!noteId) {
                return;
            }
            setFocusStack((stack) => stack.at(-1) === noteId ? stack : [ ...stack, noteId ]);
        },
        async toggleCollapse(attributeId) {
            if (collapsed.has(attributeId)) {
                setCollapsed((current) => {
                    const next = new Set(current);
                    next.delete(attributeId);
                    return next;
                });
                return;
            }
            const existing = mapApiRef.current?.reificationFor(attributeId);
            if (!existing) {
                const noteId = await mapApiRef.current?.reifyRelation(attributeId);
                if (!noteId) {
                    return;
                }
            }
            setCollapsed((current) => {
                const next = new Set(current);
                next.add(attributeId);
                return next;
            });
        }
    };
    const connectionCallback = useRelationCreation({ mapApiRef, jsPlumbApiRef: pbApiRef, relationActionsRef });
    useEffect(() => {
        setFocusStack([]);
        setCollapsed(new Set());
    }, [ note.noteId ]);
    const { circles, tokens, folds } = useRelationData(note.noteId, data, mapApiRef, pbApiRef, focusNoteId, collapsed);
    const unfoldFor = (noteId: string) => {
        const fold = folds.find((item) => item.noteId === noteId);
        if (fold) {
            return () => {
                void relationActionsRef.current.toggleCollapse(fold.attributeId);
            };
        }
        if (focusNoteId === noteId && mapApiRef.current?.isReificationNote(noteId)) {
            return () => setFocusStack((stack) => stack.slice(0, -1));
        }
        return undefined;
    };

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
                {circles.map(note => (
                    <NoteBox
                        key={note.noteId}
                        {...note}
                        mapApiRef={mapApiRef}
                        onFocus={(noteId, event) => {
                            const fold = folds.find((item) => item.noteId === noteId);
                            if (fold) {
                                showRelationMenu(event, fold.attributeId, mapApiRef, relationActionsRef.current);
                                return;
                            }
                            setFocusStack((stack) => stack.at(-1) === noteId ? stack : [ ...stack, noteId ]);
                        }}
                        onUnfold={unfoldFor(note.noteId)}
                    />
                ))}
                {tokens.map(token => (
                    <ReificationToken
                        key={token.noteId}
                        {...token}
                        onCollapse={(attributeId) => relationActionsRef.current.toggleCollapse(attributeId)}
                        onOpenMenu={(attributeId, event) => showRelationMenu(event, attributeId, mapApiRef, relationActionsRef.current)}
                    />
                ))}
            </JsPlumb>

            {/* Both groups stand on the map whatever layout the note is read in: what is done to a
                canvas belongs on the canvas, and the bar of buttons above the note is not where the
                reader is looking while dragging one. */}
            <EditToolbar
                isReadOnly={isReadOnly}
                onAddNote={() => parentComponent?.triggerEvent("relationMapCreateChildNote", { ntxId })}
                onShowWholeMap={focusStack.length > 0 ? () => setFocusStack((stack) => stack.slice(0, -1)) : undefined}
            />

            <MapToolbar
                panZoom={panZoom}
                onCommand={(command) => parentComponent?.triggerEvent(command, { ntxId })}
            />
        </div>
    );
}

/**
 * Sets the map up to be panned and zoomed, answers the commands that drive it, and hands the
 * instance back so that the controls over the map can read it — as state rather than as the ref the
 * commands are answered from, so that they are drawn afresh when the map is rebuilt under a new one.
 */
function usePanZoom({ ntxId, containerRef, options, transformData, onTransform }: {
    ntxId: string | null | undefined;
    containerRef: RefObject<HTMLDivElement>;
    options: PanZoomOptions;
    transformData: MapData["transform"] | undefined;
    onTransform: (pzInstance: PanZoom) => void
}) {
    const apiRef = useRef<PanZoom>(null);
    const [ panZoom, setPanZoom ] = useState<PanZoom>();

    useEffect(() => {
        if (!containerRef.current) return;
        const pzInstance = panzoom(containerRef.current, options);
        apiRef.current = pzInstance;
        setPanZoom(pzInstance);

        if (transformData) {
            pzInstance.zoomTo(0, 0, transformData.scale);
            pzInstance.moveTo(transformData.x, transformData.y);
        } else {
            // set to initial coordinates
            pzInstance.moveTo(0, 0);
        }

        if (onTransform) {
            pzInstance.on("transform", () => onTransform(pzInstance));
        }

        return () => {
            setPanZoom(undefined);
            pzInstance.dispose();
        };
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

    return panZoom;
}

function useRelationData(
    noteId: string,
    mapData: MapData | undefined,
    mapApiRef: RefObject<RelationMapApi>,
    jsPlumbRef: RefObject<jsPlumbInstance>,
    focusNoteId: string | null,
    collapsed: ReadonlySet<string>
) {
    const noteIds = mapData?.notes.map((note) => note.noteId);
    const [ relations, setRelations ] = useState<ClientRelation[]>();
    const [ reifications, setReifications ] = useState<RelationMapReification[]>([]);
    const [ inverseRelations, setInverseRelations ] = useState<RelationMapPostResponse["inverseRelations"]>();
    // Until the relations have loaded, keep the whole board. Focusing early would
    // hide every note but the one that was clicked.
    const projection = useMemo(
        () => projectRelationMap(
            mapData?.notes ?? [],
            reifications,
            relations ?? [],
            relations ? focusNoteId : null,
            collapsed
        ),
        [ mapData, reifications, relations, focusNoteId, collapsed ]
    );
    const { circles, tokens, represent, folds } = projection;

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
        setReifications(data.reifications ?? []);
        api.loadRelations(relations);
        api.loadReifications(data.reifications ?? []);
        api.cleanupOtherNotes(Object.keys(data.noteTitles));
    }

    useEffect(() => {
        refresh();
    }, [ noteId, mapData, jsPlumbRef ]);

    // Refresh on the canvas.
    useEffect(() => {
        const jsPlumbInstance = jsPlumbRef.current;
        if (!jsPlumbInstance) return;

        const drawnIds = new Set([
            ...circles.map((note) => note.noteId),
            ...tokens.map((token) => token.noteId)
        ]);

        jsPlumbInstance.batch(async () => {
            if (!mapData || !relations) {
                return;
            }

            jsPlumbInstance.deleteEveryEndpoint();

            const reificationNoteIds = new Set(reifications.map((item) => item.noteId));
            for (const relation of relations) {
                if (!relation.render || !relationSurvivesFold(relation, represent, reificationNoteIds, collapsed)) {
                    continue;
                }
                const sourceId = represent(relation.sourceNoteId);
                const targetId = represent(relation.targetNoteId);
                if (sourceId === targetId) {
                    continue;
                }
                if (!drawnIds.has(sourceId) || !drawnIds.has(targetId)) {
                    continue;
                }

                const connection = jsPlumbInstance.connect({
                    source: noteIdToId(sourceId),
                    target: noteIdToId(targetId),
                    type: relation.type
                });
                if (!connection) continue;

                // Stash the attributeId on the connection so api.ts can map a clicked connection
                // back to its relation (see the `rel.attributeId === connection.id` lookups there),
                // and so it can be exposed as data-connection-id below.
                //@ts-expect-error jsPlumb's Connection type has no writable `id` property.
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
    }, [ relations, reifications, mapData, circles, tokens, collapsed, represent ]);

    return { circles, tokens, folds };
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

function useRelationCreation({ mapApiRef, jsPlumbApiRef, relationActionsRef }: {
    mapApiRef: RefObject<RelationMapApi>;
    jsPlumbApiRef: RefObject<jsPlumbInstance>;
    relationActionsRef: RefObject<RelationMenuActions>;
}) {
    const connectionCallback = useCallback(async (info: OnConnectionBindInfo, originalEvent: Event) => {
        const connection = info.connection;

        // A click folds the two ends and this arrow into one circle. A right click
        // is where that circle can be opened, renamed, or removed.
        const actions = () => relationActionsRef.current;
        connection.bind("contextmenu", (_: unknown, event: MouseEvent) => {
            const current = actions();
            if (!current) {
                return;
            }
            buildRelationContextMenuHandler(connection, mapApiRef, current)(_, event);
        });
        connection.bind("click", (_: unknown, event: MouseEvent) => {
            if (connection.getType().includes("link")) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            actions()?.toggleCollapse(connection.id);
        });

        // if there's no event, then this has been triggered programmatically
        if (!originalEvent || !mapApiRef.current) return;

        const name = await promptForRelationName();

        // Delete the newly created connection if the dialog was dismissed.
        if (!name || !name.trim()) {
            jsPlumbApiRef.current?.deleteConnection(connection);
            return;
        }

        const targetNoteId = idToNoteId(connection.target.id);
        const sourceNoteId = idToNoteId(connection.source.id);
        const result = await mapApiRef.current.connect(name, sourceNoteId, targetNoteId);
        if (!result) {
            toast.showError(t("relation_map.connection_exists", { name }));
            jsPlumbApiRef.current?.deleteConnection(connection);
        }
    }, []);

    return connectionCallback;
}

