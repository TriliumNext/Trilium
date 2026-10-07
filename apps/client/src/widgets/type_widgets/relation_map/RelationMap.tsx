import "./RelationMap.css";

import { RelationMapPostResponse } from "@triliumnext/commons";
import clsx from "clsx";
import { ComponentChildren, HTMLAttributes, RefObject } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { type ReactZoomPanPinchRef, TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";

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
import { useZoomPanPinch, useZoomPanWheel } from "../../react/zoom_pan";
import { useZoomPanKeyboard, ZOOM_PAN_VIEWPORT_CLASS } from "../../react/zoom_pan_keyboard";
import { TypeWidgetProps } from "../type_widget";
import RelationMapApi, { ClientRelation, MapData, MapDataNoteEntry, MapTransform } from "./api";
import Connections from "./Connections";
import { showRelationContextMenu } from "./context_menu";
import { useBoxDragging, useRelationDrawing } from "./drags";
import type { Box } from "./geometry";
import MapToolbar, { EditToolbar } from "./MapToolbar";
import { GhostNoteBox, NoteBox } from "./NoteBox";
import NotePane, { type NotePaneHandle, type PaneSelection } from "./NotePane";
import RelationNamePopover, { useRelationNamePrompt } from "./RelationNamePopover";
import { CLICK_TOLERANCE, getMousePosition, idToNoteId, noteIdToId, revealOffset } from "./utils";

export default function RelationMap({ note, noteContext, ntxId, parentComponent }: TypeWidgetProps) {
    const [ data, setData ] = useState<MapData>();
    // The same read-only the note's own bar of actions read while the + stood there.
    const [ isReadOnly ] = useNoteLabelBoolean(note, "readOnly");
    const wrapperRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const mapApiRef = useRef<RelationMapApi>(null);
    const [ viewport, setViewport ] = useState<HTMLDivElement | null>(null);
    const [ loadedTransform, setLoadedTransform ] = useState<MapTransform>();

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
            setLoadedTransform({ ...(newData as MapData).transform });
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

    const mapZoom = useMapZoom({ ntxId, viewport, loadedTransform, mapApiRef });
    const { getScale } = mapZoom;
    const [ selection, setSelection ] = useState<PaneSelection | null>(null);
    const noteIdsOnMap = useMemo(() => data?.notes.map((entry) => entry.noteId) ?? [], [ data ]);
    const paneRef = useRef<NotePaneHandle>(null);
    const placement = useNotePlacement({
        containerRef,
        getScale,
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
    const dragProps = useNoteDragging({ containerRef, mapApiRef, getScale });

    const relationNamePrompt = useRelationNamePrompt();
    const { dragged, startDrag } = useBoxDragging({ containerRef, mapApiRef, getScale });
    const { pending, startDrawing } = useRelationDrawing({ containerRef, mapApiRef, getScale, askRelationName: relationNamePrompt.ask });
    const { boxes, onBoxResize } = useBoxes(data?.notes, dragged);

    useRevealSelectedBox({ wrapperRef, containerRef, moveBy: mapZoom.moveBy, noteId: selection?.noteId });
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
            <MapViewport zoom={mapZoom} viewportRef={setViewport}>
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
            </MapViewport>

            {/* Both groups stand on the map whatever layout the note is read in: what is done to a
                canvas belongs on the canvas, and the bar of buttons above the note is not where the
                reader is looking while dragging one. */}
            <EditToolbar
                isReadOnly={isReadOnly}
                placing={placement.placing}
                onTogglePlacement={() => parentComponent?.triggerEvent("relationMapCreateChildNote", { ntxId })}
            />

            <MapToolbar
                zoom={mapZoom}
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
 * Pans and zooms the map with react-zoom-pan-pinch, as the image viewer does, on a canvas without
 * bounds. Restores `loadedTransform` whenever the note's content loads, saves every change to the
 * map's data, and answers the zoom commands, which scripts can trigger too. The wheel zooms without
 * the map being focused, since the map fills its pane and has no page to scroll.
 */
export function useMapZoom({ ntxId, viewport, loadedTransform, mapApiRef }: {
    ntxId: string | null | undefined;
    /** The focusable element the keyboard and the wheel act on. */
    viewport: HTMLDivElement | null;
    loadedTransform: MapTransform | undefined;
    mapApiRef: RefObject<RelationMapApi | null>;
}) {
    const zoom = useZoomPanPinch({ minScale: MIN_SCALE, maxScale: MAX_SCALE });
    const { ref } = zoom;
    useZoomPanKeyboard(ref, viewport);
    useZoomPanWheel(ref, viewport);

    useEffect(() => {
        if (!loadedTransform) return;
        ref.current?.setTransform(loadedTransform.x, loadedTransform.y, loadedTransform.scale, 0);
    }, [ ref, loadedTransform ]);

    const onTransform = useCallback((api: ReactZoomPanPinchRef, state: { scale: number; positionX: number; positionY: number }) => {
        zoom.onTransform(api, state);
        mapApiRef.current?.setTransform({ x: state.positionX, y: state.positionY, scale: state.scale });
    }, [ zoom.onTransform, mapApiRef ]);

    const getScale = useCallback(() => ref.current?.instance.state.scale ?? 1, [ ref ]);

    const moveBy = useCallback((dx: number, dy: number) => {
        const api = ref.current;
        if (!api) return;
        const { positionX, positionY, scale } = api.instance.state;
        api.setTransform(positionX + dx, positionY + dy, scale, REVEAL_ANIMATION_MS);
    }, [ ref ]);

    useTriliumEvents([ "relationMapResetPanZoom", "relationMapResetZoomIn", "relationMapResetZoomOut" ], ({ ntxId: eventNtxId }, eventName) => {
        if (eventNtxId !== ntxId) return;

        if (eventName === "relationMapResetPanZoom") {
            ref.current?.setTransform(0, 0, 1);
        } else if (eventName === "relationMapResetZoomIn") {
            zoom.zoomIn();
        } else {
            zoom.zoomOut();
        }
    });

    return { ...zoom, onTransform, getScale, moveBy };
}

/**
 * The focusable area of the map that pans and zooms its `children`. A press on a box, a label or a
 * relation starts no pan, since those are dragged or clicked themselves.
 */
export function MapViewport({ zoom, viewportRef, children }: {
    zoom: ReturnType<typeof useMapZoom>;
    viewportRef(element: HTMLDivElement | null): void;
    children: ComponentChildren;
}) {
    return (
        <div ref={viewportRef} className={clsx("relation-map-viewport", ZOOM_PAN_VIEWPORT_CLASS)} tabIndex={0}>
            <TransformWrapper
                ref={zoom.ref}
                minScale={MIN_SCALE}
                maxScale={MAX_SCALE}
                limitToBounds={false}
                wheel={zoom.wheel}
                panning={{ excluded: PAN_EXCLUDED }}
                doubleClick={{ excluded: PAN_EXCLUDED }}
                onTransform={zoom.onTransform}
            >
                <TransformComponent wrapperClass="relation-map-transform" contentClass="relation-map-content">
                    {children}
                </TransformComponent>
            </TransformWrapper>
        </div>
    );
}

/** The zoom range of the map. */
const MIN_SCALE = 0.3;
const MAX_SCALE = 2;

const PAN_EXCLUDED = [ "note-box", "connection-label", "relation-map-connection-hit" ];

/** How long panning a selected box into view takes. */
const REVEAL_ANIMATION_MS = 300;

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
function useNotePlacement({ ntxId, note, containerRef, getScale, mapApiRef, onArm, onCreated }: {
    ntxId: string | null | undefined;
    note: FNote;
    containerRef: RefObject<HTMLDivElement | null>;
    getScale(): number;
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

        const { x, y } = boxPositionAt(e, container, getScale());
        ghost.style.left = `${x}px`;
        ghost.style.top = `${y}px`;
        // Hides the ghost over the toolbars, where a click does not place a note.
        ghost.classList.toggle("visible", isOnCanvas(e, container));
    }, [ containerRef, getScale ]);

    const hideGhost = useCallback(() => ghostRef.current?.classList.remove("visible"), []);

    const placeAt = useCallback(async (e: MouseEvent) => {
        const container = containerRef.current;
        if (!container) return;

        // Leaves placement mode first, so the map does not stay in it if creating the note fails.
        setPlacing(false);
        const position = boxPositionAt(e, container, getScale());

        const { note: created } = await note_create.createNote(note.noteId, {
            content: "",
            type: "text",
            activate: false,
            isProtected: note.isProtected
        });
        if (!created || !mapApiRef.current) return;

        mapApiRef.current.createItem({ noteId: created.noteId, ...position });
        onCreated(created.noteId);
    }, [ note, containerRef, getScale, mapApiRef, onCreated ]);

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
export function useRevealSelectedBox({ wrapperRef, containerRef, moveBy, noteId }: {
    wrapperRef: RefObject<HTMLDivElement | null>;
    containerRef: RefObject<HTMLDivElement | null>;
    /** Pans the map by a distance in page pixels, animated. */
    moveBy(dx: number, dy: number): void;
    noteId: string | undefined;
}) {
    useEffect(() => {
        const wrapper = wrapperRef.current;
        const container = containerRef.current;
        if (!noteId || !wrapper || !container || isMobile()) return;

        const id = noteIdToId(noteId);
        const findBox = () => [ ...container.children ].find((child) => child.id === id);
        const reveal = (box: Element) => {
            const offset = revealOffset(box.getBoundingClientRect(), wrapper.getBoundingClientRect(), glob.isRtl);
            if (offset) {
                moveBy(offset.dx, offset.dy);
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
    }, [ wrapperRef, containerRef, moveBy, noteId ]);
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
function boxPositionAt(e: MouseEvent, container: HTMLDivElement, scale: number) {
    const { x, y } = getMousePosition(e, container, scale);
    return { x: x - PLACEMENT_OFFSET.x, y: y - PLACEMENT_OFFSET.y };
}

/** Whether the event target is the map canvas rather than an element over it. */
function isOnCanvas(e: MouseEvent, container: HTMLDivElement) {
    return e.target === e.currentTarget || (e.target instanceof Node && container.contains(e.target));
}

function useNoteDragging({ containerRef, mapApiRef, getScale }: {
    containerRef: RefObject<HTMLDivElement | null>;
    getScale(): number;
    mapApiRef: RefObject<RelationMapApi | null>;
}): Pick<HTMLAttributes<HTMLDivElement>, "onDrop" | "onDragOver"> {
    const dragProps = useMemo(() => ({
        onDrop(ev: DragEvent) {
            const container = containerRef.current;
            if (!container) return;

            const dragData = ev.dataTransfer?.getData("text");
            if (!dragData) return;
            const notes = JSON.parse(dragData);

            let { x, y } = getMousePosition(ev, container, getScale());
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
    }), [ containerRef, mapApiRef, getScale ]);

    return dragProps;
}
