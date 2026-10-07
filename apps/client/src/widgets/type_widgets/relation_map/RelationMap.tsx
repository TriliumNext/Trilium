import "./RelationMap.css";

import { RelationMapPostResponse } from "@triliumnext/commons";
import clsx from "clsx";
import { jsPlumbInstance, OnConnectionBindInfo } from "jsplumb";
// The library's own types rather than the hand-written `PanZoom` in types.d.ts, which stops at the
// handful of calls the map made when it was written and knows nothing of the rest — the ends of the
// zoom range, or unsubscribing from a report.
import panzoom, { PanZoom, PanZoomOptions } from "panzoom";
import { HTMLAttributes, RefObject } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import { goToLinkExt } from "../../../services/link";
import note_create from "../../../services/note_create";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { isMobile } from "../../../services/utils";
import { useEditorSpacedUpdate, useNoteLabelBoolean, useTriliumEvent, useTriliumEvents } from "../../react/hooks";
import { TypeWidgetProps } from "../type_widget";
import RelationMapApi, { ClientRelation, MapData, MapDataNoteEntry, RelationType } from "./api";
import { buildRelationContextMenuHandler } from "./context_menu";
import { JsPlumb } from "./jsplumb";
import MapToolbar, { EditToolbar } from "./MapToolbar";
import { GhostNoteBox, NoteBox } from "./NoteBox";
import NotePane, { type NotePaneHandle, type PaneSelection } from "./NotePane";
import setupOverlays, { uniDirectionalOverlays } from "./overlays";
import RelationNamePopover, { type AskRelationName, useRelationNamePrompt } from "./RelationNamePopover";
import { getMousePosition, getZoom, idToNoteId, noteIdToId, revealOffset } from "./utils";

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
    const wrapperRef = useRef<HTMLDivElement>(null);
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

    const [ selection, setSelection ] = useState<PaneSelection | null>(null);
    const noteIdsOnMap = useMemo(() => data?.notes.map((entry) => entry.noteId) ?? [], [ data ]);
    const paneRef = useRef<NotePaneHandle>(null);
    const placement = useNotePlacement({
        containerRef,
        note,
        ntxId,
        mapApiRef,
        // The click that places the note has to reach the map, which the pane partly covers.
        onArm: () => paneRef.current?.close(),
        onCreated: (noteId) => setSelection({ noteId, isNew: true })
    });
    const clickProps = useCanvasClicks({
        containerRef,
        placing: placement.placing,
        onPlace: placement.placeAt,
        onSelectNote: (noteId) => setSelection({ noteId }),
        onClickEmpty: () => paneRef.current?.close(),
        onOpenNote: openNoteFromBox
    });
    const dragProps = useNoteDragging({ containerRef, mapApiRef });

    const relationNamePrompt = useRelationNamePrompt();
    const connectionCallback = useRelationCreation({ mapApiRef, jsPlumbApiRef: pbApiRef, askRelationName: relationNamePrompt.ask });

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

    useRevealSelectedBox({ wrapperRef, containerRef, panZoom, noteId: selection?.noteId });
    useRelationData(note.noteId, data, mapApiRef, pbApiRef);

    return (
        <div
            ref={wrapperRef}
            className={clsx("relation-map-wrapper", placement.placing && "placing-note")}
            onMouseMove={placement.followPointer}
            onMouseLeave={placement.hideGhost}
            {...clickProps}
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
                    <NoteBox {...note} mapApiRef={mapApiRef} selected={note.noteId === selection?.noteId} />
                ))}
                {placement.placing && <GhostNoteBox elementRef={placement.ghostRef} />}
            </JsPlumb>

            {/* Both groups stand on the map whatever layout the note is read in: what is done to a
                canvas belongs on the canvas, and the bar of buttons above the note is not where the
                reader is looking while dragging one. */}
            <EditToolbar
                isReadOnly={isReadOnly}
                placing={placement.placing}
                onTogglePlacement={() => parentComponent?.triggerEvent("relationMapCreateChildNote", { ntxId })}
            />

            <MapToolbar
                panZoom={panZoom}
                onCommand={(command) => parentComponent?.triggerEvent(command, { ntxId })}
            />

            <NotePane
                paneRef={paneRef}
                noteIdsOnMap={noteIdsOnMap}
                mapApiRef={mapApiRef}
                isReadOnly={isReadOnly}
                selection={selection}
                onSelect={setSelection}
            />

            {relationNamePrompt.request && (
                <RelationNamePopover
                    key={relationNamePrompt.request.id}
                    connection={relationNamePrompt.request.connection}
                    defaultValue={relationNamePrompt.request.defaultValue}
                    onAnswer={relationNamePrompt.answer}
                />
            )}
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
    containerRef: RefObject<HTMLDivElement | null>;
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

async function useRelationData(noteId: string, mapData: MapData | undefined, mapApiRef: RefObject<RelationMapApi | null>, jsPlumbRef: RefObject<jsPlumbInstance | null>) {
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
    }, [ relations, mapData ]);
}

/**
 * Arms the map for the next click to place a new note, and creates the note where it lands.
 *
 * Pressing the button again disarms the map, as Escape does. A translucent box follows the pointer
 * while the map is armed (see {@link GhostNoteBox}). The note is created without a title, so it takes
 * the name any new note takes (or the map's `#titleTemplate`), and the pane opens on it with that
 * name selected.
 */
function useNotePlacement({ ntxId, note, containerRef, mapApiRef, onArm, onCreated }: {
    ntxId: string | null | undefined;
    note: FNote;
    containerRef: RefObject<HTMLDivElement | null>;
    mapApiRef: RefObject<RelationMapApi | null>;
    onArm(): void;
    onCreated(noteId: string): void;
}) {
    const [ placing, setPlacing ] = useState(false);
    const ghostRef = useRef<HTMLDivElement>(null);

    useTriliumEvent("relationMapCreateChildNote", ({ ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId) return;
        if (!placing) onArm();
        setPlacing(!placing);
    });

    // Tied to the state rather than to what armed it, so the toast and the listener go on cancel,
    // on placement and on unmount alike.
    useEffect(() => {
        if (!placing) return;

        const toastId = `relation-map-placement-${ntxId}`;
        toast.showPersistent({
            id: toastId,
            icon: "plus",
            title: t("relation_map.add_note_toast_title"),
            message: t("relation_map.add_note_instruction")
        });

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") setPlacing(false);
        };
        window.addEventListener("keydown", onKeyDown);

        return () => {
            window.removeEventListener("keydown", onKeyDown);
            toast.closePersistent(toastId);
        };
    }, [ placing, ntxId ]);

    const followPointer = useCallback((e: MouseEvent) => {
        const ghost = ghostRef.current;
        const container = containerRef.current;
        if (!ghost || !container) return;

        const { x, y } = boxPositionAt(e, container);
        ghost.style.left = `${x}px`;
        ghost.style.top = `${y}px`;
        // Hidden over the toolbars, which a click does not place a note through.
        ghost.classList.toggle("visible", isOnCanvas(e, container));
    }, [ containerRef ]);

    const hideGhost = useCallback(() => ghostRef.current?.classList.remove("visible"), []);

    const placeAt = useCallback(async (e: MouseEvent) => {
        const container = containerRef.current;
        if (!container) return;

        // Disarmed first, so a failure to create the note does not leave the map armed.
        setPlacing(false);
        const position = boxPositionAt(e, container);

        const { note: created } = await note_create.createNote(note.noteId, {
            content: "",
            type: "text",
            activate: false,
            isProtected: note.isProtected
        });
        if (!created || !mapApiRef.current) return;

        mapApiRef.current.createItem({ noteId: created.noteId, ...position });
        onCreated(created.noteId);
    }, [ note, containerRef, mapApiRef, onCreated ]);

    return { placing, ghostRef, followPointer, hideGhost, placeAt };
}

/**
 * Routes a click on the map: it places a new note while the map is armed, selects the box it lands
 * on, or closes the pane when it lands on empty canvas. A modified or middle click on a box opens its
 * note the way a link would (a new tab, a new window). A click that ends a pan or a drag counts as
 * none of these, and clicks on whatever stands over the map (toolbars, the pane, the relation name
 * popover) are left alone.
 */
export function useCanvasClicks({ containerRef, placing, onPlace, onSelectNote, onClickEmpty, onOpenNote }: {
    containerRef: RefObject<HTMLDivElement | null>;
    placing: boolean;
    onPlace(e: MouseEvent): void;
    onSelectNote(noteId: string): void;
    onClickEmpty(): void;
    onOpenNote(noteId: string, e: MouseEvent): void;
}): Pick<HTMLAttributes<HTMLDivElement>, "onPointerDownCapture" | "onClickCapture" | "onAuxClickCapture"> {
    const pressedAt = useRef<{ x: number; y: number }>(null);

    /** Whether the click happened on the map itself, without the pointer moving since the press. */
    const isPlainClickOnCanvas = (e: MouseEvent, container: HTMLDivElement) => {
        const pressed = pressedAt.current;
        return isOnCanvas(e, container)
            && !(pressed && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > CLICK_TOLERANCE);
    };
    const boxAt = (e: MouseEvent) => e.target instanceof Element ? e.target.closest<HTMLElement>(".note-box") : null;

    return {
        onPointerDownCapture(e) {
            pressedAt.current = { x: e.clientX, y: e.clientY };
        },
        onAuxClickCapture(e) {
            const container = containerRef.current;
            const box = boxAt(e);
            if (!container || e.button !== 1 || placing || !box || !isPlainClickOnCanvas(e, container)) return;

            e.preventDefault();
            e.stopPropagation();
            onOpenNote(idToNoteId(box.id), e);
        },
        onClickCapture(e) {
            const container = containerRef.current;
            if (!container || e.button !== 0 || !isPlainClickOnCanvas(e, container)) return;

            if (placing) {
                e.preventDefault();
                e.stopPropagation();
                onPlace(e);
                return;
            }

            const box = boxAt(e);
            if (!box) {
                onClickEmpty();
                return;
            }

            e.preventDefault();
            e.stopPropagation();
            if (e.ctrlKey || e.metaKey || e.shiftKey) {
                onOpenNote(idToNoteId(box.id), e);
            } else {
                onSelectNote(idToNoteId(box.id));
            }
        }
    };
}

/**
 * Pans the map so the box of the selected note stands clear of the note pane and the edges of the
 * map (see {@link revealOffset}). A phone shows the note as a dialog over the whole screen, so the
 * map is left where it is there.
 *
 * The box of a note placed a moment ago is not on the map yet: `NoteBox` renders it once the note
 * has loaded, so the pan waits for it to appear in the container.
 */
export function useRevealSelectedBox({ wrapperRef, containerRef, panZoom, noteId }: {
    wrapperRef: RefObject<HTMLDivElement | null>;
    containerRef: RefObject<HTMLDivElement | null>;
    panZoom: PanZoom | undefined;
    noteId: string | undefined;
}) {
    useEffect(() => {
        const wrapper = wrapperRef.current;
        const container = containerRef.current;
        if (!noteId || !wrapper || !container || !panZoom || isMobile()) return;

        const id = noteIdToId(noteId);
        const findBox = () => [ ...container.children ].find((child) => child.id === id);
        const reveal = (box: Element) => {
            const offset = revealOffset(box.getBoundingClientRect(), wrapper.getBoundingClientRect(), glob.isRtl);
            if (offset) {
                panZoom.moveBy(offset.dx, offset.dy, true);
            }
        };

        const box = findBox();
        if (box) {
            reveal(box);
            return;
        }

        const observer = new MutationObserver(() => {
            const box = findBox();
            if (!box) return;
            observer.disconnect();
            reveal(box);
        });
        observer.observe(container, { childList: true });
        return () => observer.disconnect();
    }, [ wrapperRef, containerRef, panZoom, noteId ]);
}

/** Where the pointer stands on a box being placed: the top centre of its title. */
const PLACEMENT_OFFSET = { x: 80, y: 15 };

/** How far, in pixels, the pointer can move between press and release for the click to count. */
const CLICK_TOLERANCE = 4;

/**
 * Opens the note of a box the way a link to it opens: Ctrl or the middle button in a new tab, Shift
 * in a new window (see `goToLinkExt`).
 */
function openNoteFromBox(noteId: string, e: MouseEvent) {
    const hoistedNoteId = appContext.tabManager.getActiveContext()?.hoistedNoteId;
    const notePath = froca.getNoteFromCache(noteId)?.getBestNotePathString(hoistedNoteId);
    goToLinkExt(e, `#${notePath || noteId}`);
}

/** The map position, in unzoomed map pixels, of a box placed under the pointer. */
function boxPositionAt(e: MouseEvent, container: HTMLDivElement) {
    const { x, y } = getMousePosition(e, container, getZoom(container));
    return { x: x - PLACEMENT_OFFSET.x, y: y - PLACEMENT_OFFSET.y };
}

/** Whether the event happened on the map itself, rather than on something standing over it. */
function isOnCanvas(e: MouseEvent, container: HTMLDivElement) {
    return e.target === e.currentTarget || (e.target instanceof Node && container.contains(e.target));
}

function useNoteDragging({ containerRef, mapApiRef }: {
    containerRef: RefObject<HTMLDivElement | null>;
    mapApiRef: RefObject<RelationMapApi | null>;
}): Pick<HTMLAttributes<HTMLDivElement>, "onDrop" | "onDragOver"> {
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

function useRelationCreation({ mapApiRef, jsPlumbApiRef, askRelationName }: {
    mapApiRef: RefObject<RelationMapApi | null>,
    jsPlumbApiRef: RefObject<jsPlumbInstance | null>,
    askRelationName: AskRelationName
}) {
    const connectionCallback = useCallback(async (info: OnConnectionBindInfo, originalEvent: Event) => {
        const connection = info.connection;

        // Called whenever a connection is created, either initially or manually when added by the user.
        const handler = buildRelationContextMenuHandler(connection, mapApiRef, askRelationName);
        connection.bind("contextmenu", handler);

        // if there's no event, then this has been triggered programmatically
        if (!originalEvent || !mapApiRef.current) return;

        const name = await askRelationName(connection);

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
    }, [ askRelationName ]);

    return connectionCallback;
}

