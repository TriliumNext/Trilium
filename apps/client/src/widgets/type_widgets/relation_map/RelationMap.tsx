import "./RelationMap.css";

import { RelationMapPostResponse } from "@triliumnext/commons";
import clsx from "clsx";
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
import RelationMapApi, { ClientRelation, MapData, MapDataNoteEntry } from "./api";
import Connections from "./Connections";
import { showRelationContextMenu } from "./context_menu";
import { useBoxDragging, useRelationDrawing } from "./drags";
import type { Box } from "./geometry";
import MapToolbar, { EditToolbar } from "./MapToolbar";
import { GhostNoteBox, NoteBox } from "./NoteBox";
import NotePane, { type NotePaneHandle, type PaneSelection } from "./NotePane";
import RelationNamePopover, { useRelationNamePrompt } from "./RelationNamePopover";
import { CLICK_TOLERANCE, getMousePosition, getZoom, idToNoteId, noteIdToId, revealOffset } from "./utils";

export default function RelationMap({ note, noteContext, ntxId, parentComponent }: TypeWidgetProps) {
    const [ data, setData ] = useState<MapData>();
    // The same read-only the note's own bar of actions read while the + stood there.
    const [ isReadOnly ] = useNoteLabelBoolean(note, "readOnly");
    const wrapperRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const mapApiRef = useRef<RelationMapApi>(null);

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
        if (!mapApiRef.current || !data) return;
        mapApiRef.current.setTransform(pzInstance.getTransform());
    }, [ data ]);

    const [ selection, setSelection ] = useState<PaneSelection | null>(null);
    const noteIdsOnMap = useMemo(() => data?.notes.map((entry) => entry.noteId) ?? [], [ data ]);
    const paneRef = useRef<NotePaneHandle>(null);
    const placement = useNotePlacement({
        containerRef,
        note,
        ntxId,
        mapApiRef,
        // Closes the pane, which covers part of the map where the note might be placed.
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
    const { dragged, startDrag } = useBoxDragging({ containerRef, mapApiRef });
    const { pending, startDrawing } = useRelationDrawing({ containerRef, mapApiRef, askRelationName: relationNamePrompt.ask });
    const { boxes, onBoxResize } = useBoxes(data?.notes, dragged);

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
    const hoveredNoteId = useHoveredBox(containerRef);
    const [ hoveredRelationId, setHoveredRelationId ] = useState<string | null>(null);
    const { relations, inverseRelations } = useRelationData(note.noteId, data, mapApiRef);
    const drawnRelations = useMemo(() => relations?.filter((relation) => relation.render) ?? [], [ relations ]);
    const hoveredRelation = drawnRelations.find((relation) => relation.attributeId === hoveredRelationId);

    const onRelationContextMenu = useCallback((relation: ClientRelation, e: MouseEvent) => {
        const anchor = () => containerRef.current?.querySelector(`[data-connection-id="${CSS.escape(relation.attributeId)}"]`);
        showRelationContextMenu(e, relation, mapApiRef, (defaultValue) => relationNamePrompt.ask(anchor, defaultValue));
    }, [ relationNamePrompt.ask ]);

    return (
        <div
            ref={wrapperRef}
            className={clsx("relation-map-wrapper", placement.placing && "placing-note")}
            onMouseMove={placement.followPointer}
            onMouseLeave={placement.hideGhost}
            {...clickProps}
            {...dragProps}
        >
            <div ref={containerRef} className="relation-map-container">
                <Connections
                    relations={drawnRelations}
                    inverseRelations={inverseRelations}
                    boxes={boxes}
                    hoveredNoteId={hoveredNoteId}
                    hoveredRelationId={hoveredRelationId}
                    pending={pending}
                    onHoverRelation={setHoveredRelationId}
                    onContextMenu={onRelationContextMenu}
                />
                {data?.notes.map((entry) => {
                    const position = dragged?.noteId === entry.noteId ? dragged : entry;
                    return (
                        <NoteBox
                            key={entry.noteId}
                            {...position}
                            mapApiRef={mapApiRef}
                            selected={entry.noteId === selection?.noteId}
                            highlighted={entry.noteId === hoveredRelation?.sourceNoteId || entry.noteId === hoveredRelation?.targetNoteId}
                            dropTarget={entry.noteId === pending?.targetNoteId}
                            isReadOnly={isReadOnly}
                            onPointerDown={(e) => {
                                if (e.target instanceof Element && e.target.closest(".endpoint")) {
                                    startDrawing(e, entry.noteId);
                                } else {
                                    startDrag(e, position);
                                }
                            }}
                            onResize={onBoxResize}
                        />
                    );
                })}
                {placement.placing && <GhostNoteBox elementRef={placement.ghostRef} />}
            </div>

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
                    anchor={relationNamePrompt.request.anchor}
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

function useRelationData(noteId: string, mapData: MapData | undefined, mapApiRef: RefObject<RelationMapApi | null>) {
    const [ relations, setRelations ] = useState<ClientRelation[]>();
    const [ inverseRelations, setInverseRelations ] = useState<RelationMapPostResponse["inverseRelations"]>();

    useEffect(() => {
        const api = mapApiRef.current;
        const noteIds = mapData?.notes.map((note) => note.noteId);
        if (!noteIds || !api) return;

        let isCurrent = true;
        server.post<RelationMapPostResponse>("relation-map", { noteIds, relationMapNoteId: noteId }).then((data) => {
            if (!isCurrent) return;

            const relations = pairInverseRelations(data.relations, data.inverseRelations);
            setRelations(relations);
            setInverseRelations(data.inverseRelations);
            api.loadRelations(relations);
            api.cleanupOtherNotes(Object.keys(data.noteTitles));
        });
        return () => {
            isCurrent = false;
        };
    }, [ noteId, mapData, mapApiRef ]);

    return { relations, inverseRelations };
}

/**
 * Gives each relation its `type`. A relation whose inverse also runs between the same two notes is
 * drawn once, as `biDirectional` when it is its own inverse and as `inverse` otherwise; the second
 * of the pair gets `render: false`.
 */
function pairInverseRelations(serverRelations: RelationMapPostResponse["relations"], inverseRelations: Record<string, string>) {
    const relations: ClientRelation[] = [];

    for (const serverRelation of serverRelations) {
        const relation: ClientRelation = { ...serverRelation, type: "uniDirectional", render: true };
        const match = relations.find(
            (rel) =>
                rel.name === inverseRelations[relation.name] &&
                ((rel.sourceNoteId === relation.sourceNoteId && rel.targetNoteId === relation.targetNoteId) ||
                    (rel.sourceNoteId === relation.targetNoteId && rel.targetNoteId === relation.sourceNoteId))
        );

        if (match) {
            match.type = relation.type = relation.name === inverseRelations[relation.name] ? "biDirectional" : "inverse";
            relation.render = false;
        }

        relations.push(relation);
    }

    return relations;
}

/**
 * The boxes on the map by note ID, for drawing the relations: each note's position, with `dragged`
 * overriding the saved one, and the size its `NoteBox` reports through `onBoxResize`. A box that
 * has not reported its size yet is left out.
 */
function useBoxes(notes: MapDataNoteEntry[] | undefined, dragged: MapDataNoteEntry | null) {
    const [ sizes, setSizes ] = useState<Record<string, { width: number; height: number }>>({});

    const onBoxResize = useCallback((noteId: string, size: { width: number; height: number }) => {
        setSizes((sizes) => {
            const current = sizes[noteId];
            if (current?.width === size.width && current.height === size.height) return sizes;
            return { ...sizes, [noteId]: size };
        });
    }, []);

    const boxes = useMemo(() => {
        const boxes = new Map<string, Box>();
        for (const entry of notes ?? []) {
            const size = sizes[entry.noteId];
            if (!size) continue;
            const { x, y } = dragged?.noteId === entry.noteId ? dragged : entry;
            boxes.set(entry.noteId, { x, y, ...size });
        }
        return boxes;
    }, [ notes, sizes, dragged ]);

    return { boxes, onBoxResize };
}

/**
 * Puts the map in placement mode, where the next click creates a note at the clicked position.
 *
 * Pressing the button again or Escape leaves placement mode. While it is on, a translucent box
 * follows the pointer (see {@link GhostNoteBox}). The note is created without a title, so it gets
 * the default title (or the map's `#titleTemplate`), and the pane opens on it with the title
 * selected.
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

    // Depends on `placing` rather than on the code that turned placement mode on, so the toast and
    // the listener are removed on cancel, after placement and on unmount.
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
        // Hides the ghost over the toolbars, where a click does not place a note.
        ghost.classList.toggle("visible", isOnCanvas(e, container));
    }, [ containerRef ]);

    const hideGhost = useCallback(() => ghostRef.current?.classList.remove("visible"), []);

    const placeAt = useCallback(async (e: MouseEvent) => {
        const container = containerRef.current;
        if (!container) return;

        // Leaves placement mode first, so the map does not stay in it if creating the note fails.
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
 * Handles clicks on the map. In placement mode, a click places a new note. Otherwise a click on a
 * box selects it, and a click on empty canvas closes the pane. A Ctrl, Shift or middle click on a box
 * opens its note as a link would (new tab or new window). Clicks that end a pan or a drag are
 * ignored, as are clicks on elements over the map (toolbars, the pane, the relation name popover).
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

    /** Whether the click targets the map canvas, with the pointer moved no more than
     *  `CLICK_TOLERANCE` since the press. */
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
 * Pans the map so that the note pane and the map's edges do not cover the selected note's box (see
 * {@link revealOffset}). Does nothing on mobile, where the note opens in a full-screen dialog.
 *
 * The box of a just-placed note is not in the DOM yet, because `NoteBox` renders only after the
 * note loads, so the hook waits for it with a `MutationObserver`.
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

/** The note of the box under the pointer, or `null` while the pointer is over no box. */
export function useHoveredBox(containerRef: RefObject<HTMLDivElement | null>) {
    const [ hoveredNoteId, setHoveredNoteId ] = useState<string | null>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const onMouseOver = (e: MouseEvent) => {
            const box = e.target instanceof Element
                ? e.target.closest(".note-box:not(.relation-map-ghost-note)")
                : null;
            setHoveredNoteId(box ? idToNoteId(box.id) : null);
        };
        const onMouseLeave = () => setHoveredNoteId(null);

        container.addEventListener("mouseover", onMouseOver);
        container.addEventListener("mouseleave", onMouseLeave);
        return () => {
            container.removeEventListener("mouseover", onMouseOver);
            container.removeEventListener("mouseleave", onMouseLeave);
        };
    }, [ containerRef ]);

    return hoveredNoteId;
}

/** Offset of the pointer from the top-left corner of a box being placed, near the box's top center. */
const PLACEMENT_OFFSET = { x: 80, y: 15 };

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

/** Whether the event target is the map canvas rather than an element over it. */
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
