import "./CanvasDrawing.css";

import { exportToSvg, getCommonBounds } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { DrawingFrame } from "@triliumnext/commons";
import clsx from "clsx";
import type { RefObject } from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import type NoteContext from "../../../components/note_context";
import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";
import { bindAttachmentEditor, type ContentEditor } from "../../../services/content_renderer";
import options from "../../../services/options";
import { getEffectiveThemeStyle } from "../../../services/theme";
import { isDesktop, isMobile } from "../../../services/utils";
import {
    useColorScheme, useEffectiveReadOnly, useElementSize, useFindShortcut, useTriliumEvent,
    useWhenShown
} from "../../react/hooks";
import { useAttachmentEditor } from "../text/attachment_saves";
import {
    isInFullscreen, registerEmbedFindTarget, useContentEmbedAttribute, useContentEmbedEvent,
    useContentEmbedResizing, useContentEmbedSize
} from "../text/content_embed_tools";
import { findTextEditorAround, useEditableEmbed } from "../text/editable_embed";
import { CanvasEditor } from "./Canvas";
import CanvasDrawingMenu from "./CanvasDrawingMenu";
import CanvasDrawingRail from "./CanvasDrawingRail";
import CanvasEmbedTools, { CanvasTools, isNoTool, NO_TOOL } from "./CanvasEmbedTools";
import {
    attachExcalidraw, DrawingFindTarget, type DrawingMatch, DrawingMatches, getSceneTransform
} from "./drawing_find";
import {
    applyDrawingView, type DrawingView, getBoundedView, getDrawingView, getFittedView, getFrame,
    getFrameView, getFrameViewAt, getRootElements, getWidenedFrame, getZoomToFitView, isSameFrame,
    MIN_FRAME_SCALE
} from "./drawing_view";
import {
    exportDrawingPicture, loadDrawingFiles, parseContent, saveDrawingFrame,
    useCanvasDrawingPersistence
} from "./persistence";

interface CanvasDrawingProps {
    attachment: FAttachment;
    /** Saves the changes. Without it, or for an attachment of another note, it is read-only. */
    editor?: ContentEditor;
}

/** What a drawing in an embed shows: Excalidraw while it is edited, otherwise a picture. */
type DrawingMode = "editor" | "picture";

/**
 * How the box is sized: `framed` by the frame, `include-note-box-height` by the embed while the
 * frame is unknown or the user resizes the box, `reframing` while the frame widens to a new box
 * size.
 */
type BoxSizing = "framed" | "include-note-box-height" | "reframing";

/**
 * A canvas drawing saved in an attachment. While the Editable toggle of its embed is on, Excalidraw
 * edits it in place inside the note that shows it; otherwise it shows as a picture at the same
 * view. The box shows the frame of the drawing: at its natural size at most, narrowed with the
 * box down to {@link MIN_FRAME_SCALE} of it, and cropped around its center below that.
 */
export default function CanvasDrawing({ attachment, editor }: CanvasDrawingProps) {
    const boxRef = useRef<HTMLDivElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<ExcalidrawImperativeAPI>(null);
    // The view of the box, which the picture and Excalidraw take over from each other. Fullscreen
    // shows a view of its own, and the box shows this one again after.
    const viewRef = useRef<DrawingView | null>(null);
    const [ frame, setFrame ] = useState<DrawingFrame | null>(null);
    // A frame reported from a resize observation sizes the box on the next animation frame, out
    // of the loop in which the observer delivers.
    const frameRequestRef = useRef(0);
    const onFrameChange = useCallback((changed: DrawingFrame) => {
        cancelAnimationFrame(frameRequestRef.current);
        frameRequestRef.current = requestAnimationFrame(() => setFrame(changed));
    }, []);
    useEffect(() => () => cancelAnimationFrame(frameRequestRef.current), []);
    const colorScheme = useColorScheme();
    const [ tools ] = useState(() => new CanvasTools(rootRef));
    const [ find ] = useState(() => new DrawingFindTarget(rootRef));
    const { isEditing } = useEditableEmbed(rootRef, {
        editor,
        note: null,
        tools,
        focusTarget: ".excalidraw"
    });
    const mode: DrawingMode = isEditing ? "editor" : "picture";
    // Stays until the other mode draws, so that switching shows no empty box.
    const [ drawnMode, setDrawnMode ] = useState<DrawingMode | null>(null);
    const isToolbarOverPanel = useIsToolbarOverPanel(rootRef);
    const isRecentering = useFullscreenView(rootRef, apiRef, viewRef);
    const isResizing = useContentEmbedResizing(rootRef);
    const reframing = useReframing({
        rootRef, apiRef, viewRef, frame, isResizing, attachment, editor, onFrame: onFrameChange
    });
    const isCropped = useCenteredCrop(boxRef, frame);
    const sizing: BoxSizing = !frame || isResizing || reframing === "handle"
        ? "include-note-box-height"
        : reframing === "box-size" ? "reframing" : "framed";
    useSidePanels(rootRef, isEditing);
    usePropertiesSheet(rootRef, isEditing && isMobile());
    useTopLayerContextMenu(rootRef, apiRef);
    useNoteScrollingWheel(rootRef);
    useFindShortcut(rootRef);
    useEffect(() => {
        const root = rootRef.current;
        return root ? registerEmbedFindTarget(root, find) : undefined;
    }, [ find ]);

    return (
        <div ref={boxRef} className={clsx("canvas-drawing-box", sizing)}>
            <div
                ref={rootRef}
                className={clsx(
                    "canvas-drawing-editor",
                    isToolbarOverPanel && "toolbar-over-panel",
                    isRecentering && "recentering"
                )}
                style={frame ? getFrameStyle(frame) : undefined}
            >
                {(mode === "picture" || drawnMode === "picture") && (
                    <DrawingPicture
                        attachment={attachment}
                        editor={editor}
                        colorScheme={colorScheme}
                        rootRef={rootRef}
                        viewRef={viewRef}
                        frame={frame}
                        isFramed={sizing === "framed"}
                        find={find}
                        onFrameChange={onFrameChange}
                        onDrawn={() => setDrawnMode("picture")}
                    />
                )}
                {(mode === "editor" || drawnMode === "editor") && (
                    <LiveDrawing
                        attachment={attachment}
                        editor={editor}
                        colorScheme={colorScheme}
                        rootRef={rootRef}
                        apiRef={apiRef}
                        viewRef={viewRef}
                        frame={frame}
                        isResizing={isResizing || reframing !== null}
                        isCropped={isCropped}
                        tools={tools}
                        find={find}
                        isEditable={isEditing}
                        onFrameChange={onFrameChange}
                        onDrawn={() => setDrawnMode("editor")}
                    />
                )}
            </div>
        </div>
    );
}

/** The size of `frame` on screen, which `CanvasDrawing.css` sizes the frame box from. */
function getFrameStyle(frame: DrawingFrame) {
    return {
        "--canvas-drawing-natural-width": `${frame.width * frame.scale}px`,
        "--canvas-drawing-natural-height": `${frame.height * frame.scale}px`,
        "--canvas-drawing-frame-ratio": `${frame.width / frame.height}`
    };
}

/** How the user is changing the size of the box: with its handle, or with its box size. */
type Reframing = "handle" | "box-size" | null;

interface ReframingOptions {
    rootRef: RefObject<HTMLElement | null>;
    apiRef: RefObject<ExcalidrawImperativeAPI | null>;
    viewRef: RefObject<DrawingView | null>;
    frame: DrawingFrame | null;
    isResizing: boolean;
    attachment: FAttachment;
    editor: ContentEditor | undefined;
    onFrame: (frame: DrawingFrame) => void;
}

/**
 * Saves the frame again from the box once the user resized it with its handle, at the view it
 * kept, or changed its box size, which widens the frame around its center. An undo or a reset of
 * the size counts as a resize with the handle. Returns which change is under way, from the change
 * until the frame is taken from the new size of the box.
 */
function useReframing({
    rootRef, apiRef, viewRef, frame, isResizing, attachment, editor, onFrame
}: ReframingOptions): Reframing {
    const boxSize = useContentEmbedAttribute(rootRef, "data-box-size");
    const savedSize = useContentEmbedSize(rootRef);
    const [ reframing, setReframing ] = useState<Reframing>(null);
    const previousRef = useRef<BoxState | null>(null);
    // A change of the box size draws the content again: the drawing before this one in the embed
    // saw the box size to compare with.
    let previous = previousRef.current;
    if (!previous && boxSize !== null) {
        const embed = rootRef.current?.closest(".include-note");
        previous = {
            isResizing, boxSize: (embed && lastBoxes.get(embed)?.boxSize) ?? boxSize, savedSize
        };
    }
    if (boxSize !== null) previousRef.current = { isResizing, boxSize, savedSize };
    // Known in this render already, so that the box keeps its new size until it is measured.
    const started = getReframing(previous, { isResizing, boxSize, savedSize });

    // The record changes once the frame is taken from the box, so that a drawing that the change
    // draws again still sees the change.
    useEffect(() => {
        const embed = rootRef.current?.closest(".include-note");
        if (!embed || boxSize === null) return;
        const last = lastBoxes.get(embed);
        if (!frame && last?.frame) onFrame(last.frame);
        if (!started && !reframing) {
            lastBoxes.set(embed, { boxSize, frame: frame ?? last?.frame ?? null });
        }
    }, [ rootRef, boxSize, frame, started, reframing ]);
    useEffect(() => {
        if (started) setReframing(started);
    }, [ started ]);

    const requestRef = useRef(0);
    useEffect(() => () => cancelAnimationFrame(requestRef.current), []);
    useEffect(() => {
        // Widening to a box size waits for the frame.
        if (!reframing || (reframing === "box-size" && !frame)) return;
        // The box has its new size once it is laid out.
        cancelAnimationFrame(requestRef.current);
        requestRef.current = requestAnimationFrame(() => {
            requestRef.current = requestAnimationFrame(() => {
                setReframing(null);
                const size = rootRef.current?.getBoundingClientRect();
                if (!size?.width || !size.height) return;

                let reframed: DrawingFrame;
                if (reframing === "box-size" && frame) {
                    reframed = getWidenedFrame(frame, size.width);
                    viewRef.current = getFrameView(reframed);
                    const api = apiRef.current;
                    if (api) applyDrawingView(api, viewRef.current);
                } else {
                    const view = viewRef.current;
                    if (!view) return;
                    reframed = getFrame(view, size.width, size.height);
                }
                onFrame(reframed);
                if (editor?.canEdit()) void saveDrawingFrame(attachment, editor, reframed);
            });
        });
    }, [ reframing, frame ]);

    return started ?? reframing;
}

/** What `useReframing()` compares between two renders. */
interface BoxState {
    isResizing: boolean;
    boxSize: string | null;
    /** What `useContentEmbedSize()` reports. */
    savedSize: string | null;
}

/** The change of the box from `previous` to `current` that the frame follows, if any. */
function getReframing(previous: BoxState | null, current: BoxState): Reframing {
    if (!previous) return null;
    if (previous.isResizing && !current.isResizing) return "handle";
    if (current.boxSize !== null && current.boxSize !== previous.boxSize) return "box-size";
    // An undo, a redo or a reset changes the size without a drag of the handle.
    const isSizeChanged = previous.savedSize !== null && current.savedSize !== null
        && current.savedSize !== previous.savedSize;
    return isSizeChanged && !current.isResizing ? "handle" : null;
}

/**
 * The box size and the frame that the last drawing in each embed saw. A change of the box size
 * draws the content of the embed again, so the next drawing reads them from here.
 */
const lastBoxes = new WeakMap<Element, { boxSize: string; frame: DrawingFrame | null }>();

/**
 * Whether the box crops the frame, which is wider than the box at the least scale of the frame.
 * The crop is kept centered as the box changes its size.
 */
function useCenteredCrop(boxRef: RefObject<HTMLElement | null>, frame: DrawingFrame | null) {
    const size = useElementSize(boxRef);
    const isCropped = !!frame && !!size?.width
        && frame.width * frame.scale * MIN_FRAME_SCALE > size.width + 0.5;

    useLayoutEffect(() => {
        const box = boxRef.current;
        if (box && isCropped) {
            box.scrollLeft = (box.scrollWidth - box.clientWidth) / 2;
        }
    }, [ boxRef, isCropped, size?.width, frame ]);

    return isCropped;
}

interface LiveDrawingProps {
    attachment: FAttachment;
    /** Saves the changes. */
    editor: ContentEditor | undefined;
    colorScheme: AppState["theme"];
    rootRef: RefObject<HTMLDivElement | null>;
    apiRef: RefObject<ExcalidrawImperativeAPI | null>;
    viewRef: RefObject<DrawingView | null>;
    frame: DrawingFrame | null;
    /** Whether the box is being resized, by its handle or by a change of its box size. */
    isResizing: boolean;
    /** Whether the box crops the frame, which a move of the view then leaves alone. */
    isCropped: boolean;
    tools: CanvasTools;
    /** Searches the drawing for "Search in note". */
    find: DrawingFindTarget;
    isEditable: boolean;
    onFrameChange: (frame: DrawingFrame) => void;
    /** Called on the frame after Excalidraw shows the drawing at the view of the box. */
    onDrawn: () => void;
}

/**
 * The drawing in Excalidraw, opened at the view of `viewRef`, which follows the view from then on.
 * Its persistence saves what is left to save before Excalidraw unmounts.
 */
function LiveDrawing({
    attachment, editor, colorScheme, rootRef, apiRef, viewRef, frame, isResizing, isCropped, tools,
    find, isEditable, onFrameChange, onDrawn
}: LiveDrawingProps) {
    const drawRequestRef = useRef(0);
    const stopFindingRef = useRef<(() => void) | null>(null);
    const boxStateRef = useRef({ isResizing, isCropped });
    boxStateRef.current = { isResizing, isCropped };
    const persistence = useCanvasDrawingPersistence(attachment, editor, apiRef, colorScheme, {
        initialView: viewRef.current,
        // A touch over the drawing scrolls the note until a tool is picked.
        initialTool: isMobile() ? NO_TOOL : undefined,
        rootRef,
        isFrameBox: true,
        frame,
        isResizing: () => boxStateRef.current.isResizing,
        canReframe: () => !boxStateRef.current.isCropped,
        onFrameChange,
        onViewChange: (view) => {
            viewRef.current = view;
        },
        onSceneShown: () => {
            const api = apiRef.current;
            if (api) {
                stopFindingRef.current?.();
                stopFindingRef.current = attachExcalidraw(find, api, rootRef.current);
            }
        },
        onViewReady: () => {
            rootRef.current?.removeAttribute("data-view-pending");
            drawRequestRef.current = requestAnimationFrame(onDrawn);
        }
    });
    useNoToolOutsideEditing(rootRef, apiRef, isEditable);
    useLayoutEffect(() => {
        // `CanvasDrawing.css` hides Excalidraw until it shows the view of the box.
        rootRef.current?.setAttribute("data-view-pending", "");
        return () => {
            cancelAnimationFrame(drawRequestRef.current);
            stopFindingRef.current?.();
            rootRef.current?.removeAttribute("data-no-tool");
            rootRef.current?.removeAttribute("data-view-pending");
            apiRef.current = null;
        };
    }, [ apiRef, rootRef ]);

    return (
        <CanvasEditor
            apiRef={apiRef}
            isReadOnly={!isEditable}
            colorScheme={colorScheme}
            persistence={{
                ...persistence,
                onChange: (elements, appState, files) => {
                    persistence.onChange?.(elements, appState, files);
                    // `CanvasDrawing.css` leaves the touch over the drawing to the note.
                    rootRef.current?.toggleAttribute("data-no-tool", isNoTool(appState.activeTool));
                }
            }}
            constrainView={getBoundedView}
            isEmbedded
            isDesktopLayout={isDesktop()}
        >
            <CanvasDrawingMenu apiRef={apiRef} isEditable={isEditable} />
            <CanvasEmbedTools
                rootRef={rootRef}
                apiRef={apiRef}
                tools={tools}
                isEditable={isEditable}
            />
            {isMobile() && <CanvasDrawingRail rootRef={rootRef} apiRef={apiRef} />}
        </CanvasEditor>
    );
}

interface DrawingPictureProps {
    attachment: FAttachment;
    /** Holds the changes not saved yet, which the picture shows. */
    editor: ContentEditor | undefined;
    colorScheme: AppState["theme"];
    rootRef: RefObject<HTMLElement | null>;
    viewRef: RefObject<DrawingView | null>;
    frame: DrawingFrame | null;
    /** Whether the box is sized by the frame, which the picture then fills at the box's width. */
    isFramed: boolean;
    /** Searches the drawing for "Search in note". */
    find: DrawingFindTarget;
    onFrameChange: (frame: DrawingFrame) => void;
    /** Called on the frame after the picture shows. */
    onDrawn: () => void;
}

/**
 * The drawing as a picture, filling the frame box with the frame, or at the view of `viewRef`,
 * else at the saved view, else fit in the box. It is gray until it is drawn, and drawn again after
 * each save, once `rootRef` is shown. Fullscreen shows the whole drawing, and the box shows its
 * view again after.
 */
function DrawingPicture({
    attachment, editor, colorScheme, rootRef, viewRef, frame, isFramed, find, onFrameChange, onDrawn
}: DrawingPictureProps) {
    const layerRef = useRef<HTMLDivElement>(null);
    const matchesRef = useRef<SVGGElement>(null);
    const [ scene, setScene ] = useState<PictureScene | null>(null);
    const sceneRef = useRef<PictureScene | null>(null);
    const [ shownMatches, setShownMatches ] = useState<ShownMatches>(NO_MATCHES);
    const [ revision, setRevision ] = useState(0);
    /** Whether the picture shown is older than the drawing, or not drawn yet. */
    const [ isStale, setIsStale ] = useState(true);
    // Each move of the view places the picture again.
    const [ placements, setPlacements ] = useState(0);
    const renderedKeyRef = useRef<string | null>(null);
    const placedSizeRef = useRef<{ width: number; height: number } | null>(null);
    /** The frame of the scene shown last, `undefined` before the first. */
    const shownFrameRef = useRef<DrawingFrame | null | undefined>(undefined);
    const size = useElementSize(layerRef);
    const whenShown = useWhenShown(rootRef);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const rows = loadResults.getAttachmentRows();
        if (rows.some((row) => row.attachmentId === attachment.attachmentId)) {
            setIsStale(true);
            whenShown(() => setRevision((count) => count + 1));
        }
    });

    useEffect(() => {
        let isCurrent = true;
        // Starts on the next frame, so that a drawing whose embed turns out editable renders none.
        const frame = requestAnimationFrame(async () => {
            const content = editor?.getUnsavedContent()
                ?? (await attachment.getBlob())?.content ?? "";
            const key = `${colorScheme}\n${content}`;
            if (key === renderedKeyRef.current) {
                if (isCurrent) setIsStale(false);
                return;
            }

            const rendered = await renderPictureScene(attachment, content, colorScheme === "dark");
            if (isCurrent) {
                renderedKeyRef.current = key;
                setScene(rendered);
                setIsStale(false);
            }
        });
        return () => {
            isCurrent = false;
            cancelAnimationFrame(frame);
        };
    }, [ attachment, editor, colorScheme, revision ]);

    const place = (view: DrawingView) => {
        viewRef.current = view;
        setPlacements((count) => count + 1);
    };
    const boxViewRef = useRef<DrawingView | null>(null);
    useContentEmbedEvent(rootRef, "fullscreenChangeStart", () => {
        if (isInFullscreen(rootRef.current)) {
            boxViewRef.current = viewRef.current;
        } else if (boxViewRef.current) {
            place(boxViewRef.current);
        }
    });
    useContentEmbedEvent(rootRef, "enterFullscreen", () => {
        const box = layerRef.current?.getBoundingClientRect();
        const fitted = scene && box && getZoomToFitView(scene.elements, box.width, box.height);
        if (fitted) place(fitted);
    });

    useLayoutEffect(() => find.attach({
        getElements: () => sceneRef.current?.elements ?? [],
        getView: () => viewRef.current,
        setView: place,
        showMatches: (matches, current) => setShownMatches({ matches, current })
    }), [ find, viewRef ]);

    useEffect(() => {
        sceneRef.current = scene;
        find.update();
    }, [ find, scene ]);

    useLayoutEffect(() => {
        const layer = layerRef.current;
        if (!layer || !scene || !size?.width || !size.height) return;

        // A frame box of a new size shows the frame at the width of the box, as does a frame
        // that another view of the drawing saved since the last scene.
        const placed = placedSizeRef.current;
        const isResized = placed?.width !== size.width || placed.height !== size.height;
        placedSizeRef.current = { width: size.width, height: size.height };
        const savedFrame = getFrameSavedElsewhere(scene, shownFrameRef.current, frame);
        shownFrameRef.current = scene.frame ?? null;
        if (savedFrame) onFrameChange(savedFrame);
        const boxFrame = savedFrame ?? frame;
        const framed = boxFrame && isFramed && (isResized || savedFrame || !viewRef.current)
            ? getFrameViewAt(boxFrame, size.width)
            : null;
        const view = framed ?? getPictureView(scene, size.width, size.height, viewRef.current);
        viewRef.current = view;
        if (view && !frame) {
            onFrameChange(scene.frame ?? getFrame(view, size.width, size.height));
        }
        if (scene.picture && view) {
            placePicture(scene.picture, view);
        }
        if (view) {
            matchesRef.current?.setAttribute("transform", getSceneTransform(view));
        }
        layer.replaceChildren(...(scene.picture ? [ scene.picture.svg ] : []));
        const request = requestAnimationFrame(onDrawn);
        return () => cancelAnimationFrame(request);
    }, [ scene, size, placements, frame, isFramed ]);

    return (
        <>
            <div
                ref={layerRef}
                className={clsx(
                    "canvas-drawing-view",
                    colorScheme === "dark" && "theme-dark",
                    isStale && "stale"
                )}
                style={scene?.background
                    ? { "--canvas-drawing-view-background": scene.background }
                    : undefined}
            />
            <DrawingMatches
                matches={shownMatches.matches}
                current={shownMatches.current}
                theme={colorScheme}
                layerRef={matchesRef}
            />
        </>
    );
}

/** The picture of the content of a drawing, and where it sits in the scene. */
interface ScenePicture {
    svg: SVGSVGElement;
    x: number;
    y: number;
    width: number;
    height: number;
}

/** The matches of "Search in note" that the picture shows, and the index of the current one. */
interface ShownMatches {
    matches: DrawingMatch[];
    current: number | null;
}

const NO_MATCHES: ShownMatches = { matches: [], current: null };

interface PictureScene {
    /** The picture of the content, or `null` for an empty drawing. */
    picture: ScenePicture | null;
    /** The shapes that are not deleted. */
    elements: ExcalidrawElement[];
    savedView: DrawingView | null;
    /** The part that the box shows, as the drawing saved it. */
    frame: DrawingFrame | null;
    /** The background picked for the drawing, or `null` while it shows the note's. */
    background: string | null;
}

/** The picture of the drawing in `content`, the content of `attachment`. */
async function renderPictureScene(
    attachment: FAttachment,
    content: string,
    isDark: boolean
): Promise<PictureScene> {
    const scene = parseContent(content, attachment);
    const elements = (scene.elements ?? []).filter((element) => !element.isDeleted);
    const { zoom, scrollX, scrollY, viewBackgroundColor } = scene.appState ?? {};
    const savedCamera = zoom && scrollX !== undefined && scrollY !== undefined
        ? { zoom, scrollX, scrollY }
        : null;
    const savedView = scene.frame ? getFrameView(scene.frame) : savedCamera;
    const background = viewBackgroundColor && viewBackgroundColor !== "transparent"
        ? viewBackgroundColor
        : null;
    if (!elements.length) {
        return { picture: null, elements, savedView, frame: scene.frame ?? null, background };
    }

    const svg = await exportToSvg({
        elements,
        appState: { ...scene.appState, exportBackground: false, exportWithDarkMode: isDark },
        files: (await loadDrawingFiles(attachment, scene)).files,
        exportPadding: 0
    });
    const width = Number(svg.getAttribute("width"));
    const height = Number(svg.getAttribute("height"));
    // The picture starts at the top left of the shapes and of the names of the frames, which sit
    // above the frames, so it is placed by the bottom right corner of the shapes.
    const [ , , maxX, maxY ] = getCommonBounds(getRootElements(elements));
    return {
        picture: { svg, x: maxX - width, y: maxY - height, width, height },
        elements,
        savedView,
        frame: scene.frame ?? null,
        background
    };
}

/**
 * The frame of `scene` when another view of the drawing saved it: one that differs from `shown`,
 * the frame of the scene shown before, and from `frame`, the frame of the box. `null` otherwise,
 * and before the first scene, when `shown` is `undefined`.
 */
function getFrameSavedElsewhere(
    scene: PictureScene,
    shown: DrawingFrame | null | undefined,
    frame: DrawingFrame | null
): DrawingFrame | null {
    const saved = scene.frame ?? null;
    if (!saved || shown === undefined || !frame) return null;
    if (shown && isSameFrame(shown, saved)) return null;
    return isSameFrame(frame, saved) ? null : saved;
}

/**
 * The view of the picture of a drawing `width` by `height`: `view`, else the saved one, else the
 * content fit, kept inside the image of an image canvas. `null` without either.
 */
function getPictureView(
    scene: PictureScene,
    width: number,
    height: number,
    view: DrawingView | null
): DrawingView | null {
    const shown = view ?? scene.savedView ?? getFittedView(scene.elements, width, height);
    if (!shown) return null;

    return getBoundedView(scene.elements, { ...shown, width, height } as AppState) ?? shown;
}

/** Places `picture` where Excalidraw would draw its content at `view`. */
function placePicture({ svg, x, y, width, height }: ScenePicture, view: DrawingView) {
    const zoom = view.zoom.value;
    svg.style.left = `${(x + view.scrollX) * zoom}px`;
    svg.style.top = `${(y + view.scrollY) * zoom}px`;
    svg.style.width = `${width * zoom}px`;
    svg.style.height = `${height * zoom}px`;
}

/** A picture of the canvas drawing saved in `entity`, or `null` for an empty drawing. */
export async function renderCanvasDrawingPicture(entity: FNote | FAttachment) {
    const blob = await entity.getBlob();
    const content = parseContent(blob?.content ?? "", entity);
    // Follows the theme as the editor does, except in print, which stays light.
    const isDark = glob.device !== "print" && getEffectiveThemeStyle() === "dark";
    const files = (await loadDrawingFiles(entity, content)).files;
    const svg = await exportDrawingPicture(content, files, isDark);
    svg?.classList.add("canvas-drawing-picture");
    return svg;
}

interface CanvasDrawingDetailProps {
    attachment: FAttachment;
    /** The note that owns the attachment. */
    note: FNote;
    noteContext?: NoteContext;
}

/**
 * A canvas drawing saved in an attachment, edited in the full detail of the attachment. It is
 * read-only while its note is.
 */
export function CanvasDrawingDetail({ attachment, note, noteContext }: CanvasDrawingDetailProps) {
    const apiRef = useRef<ExcalidrawImperativeAPI>(null);
    const colorScheme = useColorScheme();
    const attachmentEditor = useAttachmentEditor(note, noteContext);
    const editor = useMemo(
        () => bindAttachmentEditor(attachmentEditor, attachment),
        [ attachmentEditor, attachment ]
    );
    const isNoteReadOnly = useEffectiveReadOnly(note, noteContext);
    const canEdit = editor.canEdit() && !isNoteReadOnly
        && !options.is("databaseReadonly");
    const persistence = useCanvasDrawingPersistence(
        attachment,
        canEdit ? editor : undefined,
        apiRef,
        colorScheme
    );

    return (
        <CanvasEditor
            apiRef={apiRef}
            isReadOnly={!canEdit}
            colorScheme={colorScheme}
            persistence={persistence}
            constrainView={getBoundedView}
        >
            <CanvasDrawingMenu apiRef={apiRef} isEditable={canEdit} />
        </CanvasEditor>
    );
}

/**
 * Gives fullscreen a view of its own: the whole drawing at first, then the view it was left at.
 * `viewRef`, the view of the box, shows again as fullscreen ends. Returns whether the drawing is
 * hidden for the change of view: from the start of the switch until the new view is drawn.
 */
function useFullscreenView(
    rootRef: RefObject<HTMLElement | null>,
    apiRef: RefObject<ExcalidrawImperativeAPI | null>,
    viewRef: RefObject<DrawingView | null>
) {
    const [ isRecentering, setIsRecentering ] = useState(false);
    const fullscreenViewRef = useRef<DrawingView | null>(null);
    const frameRef = useRef(0);

    useContentEmbedEvent(rootRef, "fullscreenChangeStart", () => {
        cancelAnimationFrame(frameRef.current);
        setIsRecentering(true);
        const api = apiRef.current;
        // On leave, the box view is restored before Excalidraw resizes to the box.
        if (api && viewRef.current && !isInFullscreen(rootRef.current)) {
            fullscreenViewRef.current = getDrawingView(api.getAppState());
            applyDrawingView(api, viewRef.current);
        }
    });

    const show = () => {
        // Excalidraw draws the new view on the next frame.
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = requestAnimationFrame(() => setIsRecentering(false));
        });
    };
    useContentEmbedEvent(rootRef, "enterFullscreen", () => {
        const api = apiRef.current;
        const size = rootRef.current?.getBoundingClientRect();
        if (api && size) {
            const view = fullscreenViewRef.current
                ?? getZoomToFitView(api.getSceneElements(), size.width, size.height);
            if (view) applyDrawingView(api, view);
        }
        show();
    });
    useContentEmbedEvent(rootRef, "leaveFullscreen", show);
    useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

    return isRecentering;
}

/**
 * Gives the drawing no tool as it loses the focus in the mobile layout, so that a touch over it
 * scrolls the note again, and the selection tool in fullscreen, where no tool has no use.
 */
function useNoToolOutsideEditing(
    rootRef: RefObject<HTMLElement | null>,
    apiRef: RefObject<ExcalidrawImperativeAPI | null>,
    isEnabled: boolean
) {
    useContentEmbedEvent(rootRef, "enterFullscreen", () => {
        const api = apiRef.current;
        if (api && isNoTool(api.getAppState().activeTool)) {
            api.setActiveTool({ type: "selection" });
        }
    });

    useEffect(() => {
        const embedBody = rootRef.current?.closest(".include-note-body");
        if (!embedBody || !isEnabled || !isMobile()) return;

        // `ContentEmbed` marks the body active while the drawing has the focus.
        let wasActive = embedBody.classList.contains("active");
        const observer = new MutationObserver(() => {
            const isActive = embedBody.classList.contains("active");
            if (wasActive && !isActive) {
                apiRef.current?.setActiveTool(NO_TOOL);
            }
            wasActive = isActive;
        });
        observer.observe(embedBody, { attributes: true, attributeFilter: [ "class" ] });
        return () => observer.disconnect();
    }, [ rootRef, apiRef, isEnabled ]);
}

/**
 * Gives the wheel over the drawing to the note, as over the text around it, so that the drawing
 * zooms and pans with the buttons and the Hand tool of its toolbar only. In fullscreen, where
 * Excalidraw shows its own controls, the wheel stays the drawing's.
 */
export function useNoteScrollingWheel(rootRef: RefObject<HTMLElement | null>) {
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        // Runs before Excalidraw's own listener on its container, which prevents the scroll.
        const onWheel = (event: WheelEvent) => {
            if (!isInFullscreen(root)) {
                event.stopPropagation();
            }
        };
        root.addEventListener("wheel", onWheel, { capture: true });
        return () => root.removeEventListener("wheel", onWheel, { capture: true });
    }, [ rootRef ]);
}

/**
 * Whether Excalidraw's toolbar reaches over the column of the properties panel, which then starts
 * below the toolbar instead of at the top of the canvas.
 */
export function useIsToolbarOverPanel(rootRef: RefObject<HTMLElement | null>) {
    const [ isOver, setIsOver ] = useState(false);

    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        // Compares the horizontal edges only, which do not depend on where the panel starts.
        const update = () => {
            const toolbar = root.querySelector(".App-toolbar-container")?.getBoundingClientRect();
            const panel = root.querySelector(".App-menu__left")?.getBoundingClientRect();
            if (toolbar && panel) {
                setIsOver(panel.left < toolbar.right && panel.right > toolbar.left);
            }
        };
        const resizeObserver = new ResizeObserver(update);
        resizeObserver.observe(root);
        // The panel mounts when a shape is selected or a tool is picked.
        const mutationObserver = new MutationObserver(update);
        mutationObserver.observe(root, { childList: true, subtree: true });

        return () => {
            resizeObserver.disconnect();
            mutationObserver.disconnect();
        };
    }, [ rootRef ]);

    return isOver;
}

/**
 * The space between the drawing, the panels beside it and the edges of the window, which the
 * context menu keeps too, in rem.
 */
const WINDOW_GAP_REM = 0.5;
/** The least height of a panel as tall as the drawing, in rem. */
const SIDE_PANEL_MIN_HEIGHT_REM = 20;
/** The time without scroll events after which a scroll ends where `scrollend` does not fire. */
const SCROLL_END_DELAY_MS = 150;

/** The properties panel of Excalidraw's desktop layout, which opens the pickers. */
const SIDE_PROPERTIES_PANEL_SELECTOR = ".App-menu__left";
/** The panels of Excalidraw that go beside the drawing, in the order in which they take a side. */
const SIDE_PANELS = [
    // The item list of the library fills the height it is given and has none of its own.
    { selector: ".default-sidebar", hasDrawingHeight: true },
    { selector: SIDE_PROPERTIES_PANEL_SELECTOR, hasDrawingHeight: false }
];

type Side = "left" | "right";

/**
 * Shows Excalidraw's library and properties panel beside the drawing while the drawing has the
 * focus, in the top layer so that no clip or stacking of the note covers them, and clear of the
 * toolbar of the embed. A panel there has `data-side-panel`, and its position in
 * `--side-panel-*`. The pickers that the properties panel opens go into the top layer after it.
 */
export function useSidePanels(rootRef: RefObject<HTMLElement | null>, isEnabled: boolean) {
    useEffect(() => {
        const root = rootRef.current;
        const viewport = root?.closest<HTMLElement>(".scrolling-container");
        const embedBody = root?.closest<HTMLElement>(".include-note-body");
        if (!root || !viewport || !embedBody || !isEnabled) return;

        const panels = new Map<string, HTMLElement>();
        const balloon = findEditorBalloon(root);
        // The max height of each placed panel, which it keeps while the note scrolls.
        const maxHeights = new Map<HTMLElement, number>();
        let isScrolling = false;
        let scrollEndTimeout = 0;

        const update = () => {
            // `ContentEmbed` marks the body active while the drawing has the focus.
            const isShown = embedBody.classList.contains("active")
                && !isInFullscreen(root);
            const layout = isShown ? getSideLayout(root, viewport, balloon) : null;
            const takenSides = new Set<Side>();
            for (const { selector, hasDrawingHeight } of SIDE_PANELS) {
                const panel = panels.get(selector);
                if (!panel) continue;

                const heldMaxHeight = isScrolling ? maxHeights.get(panel) : undefined;
                const position = layout && getSidePanelPosition(
                    layout, panel, hasDrawingHeight, takenSides, heldMaxHeight
                );
                if (position) {
                    takenSides.add(position.side);
                    maxHeights.set(panel, position.maxHeight);
                } else {
                    maxHeights.delete(panel);
                }
                placePanel(panel, position || null);
            }
            placePickers();
        };
        // Radix renders the pickers in the drawing, under the properties panel beside it.
        const placePickers = () => {
            const isRaised = !!panels.get(SIDE_PROPERTIES_PANEL_SELECTOR)
                ?.hasAttribute("data-side-panel");
            for (const picker of root.querySelectorAll<HTMLElement>(PICKER_SELECTOR)) {
                setTopLayer(picker, isRaised);
            }
        };
        // A panel that changes height lays out and paints its contents again, so while the note
        // scrolls, the panels only move.
        const onScroll = () => {
            isScrolling = true;
            clearTimeout(scrollEndTimeout);
            scrollEndTimeout = window.setTimeout(onScrollEnd, SCROLL_END_DELAY_MS);
            update();
        };
        const onScrollEnd = () => {
            clearTimeout(scrollEndTimeout);
            isScrolling = false;
            update();
        };

        const resizeObserver = new ResizeObserver(update);
        resizeObserver.observe(root);
        resizeObserver.observe(viewport);
        const attributeObserver = new MutationObserver(update);
        attributeObserver.observe(embedBody, { attributes: true, attributeFilter: [ "class" ] });
        // CKEditor shows, hides and moves the balloon by its classes and its inline position.
        if (balloon) {
            resizeObserver.observe(balloon);
            attributeObserver.observe(balloon, {
                attributes: true,
                attributeFilter: [ "class", "style" ]
            });
        }

        // The panels and the pickers mount when they open, and the properties panel takes the
        // height of the properties of the selection.
        const watchPanels = () => {
            let isChanged = false;
            for (const { selector } of SIDE_PANELS) {
                const current = root.querySelector<HTMLElement>(selector);
                const previous = panels.get(selector);
                if (current === previous) continue;

                isChanged = true;
                if (previous) resizeObserver.unobserve(previous);
                if (current) {
                    panels.set(selector, current);
                    resizeObserver.observe(current);
                } else {
                    panels.delete(selector);
                }
            }
            if (isChanged) {
                update();
            } else {
                placePickers();
            }
        };
        const mutationObserver = new MutationObserver(watchPanels);
        mutationObserver.observe(root, { childList: true, subtree: true });
        viewport.addEventListener("scroll", onScroll, { passive: true });
        viewport.addEventListener("scrollend", onScrollEnd);
        document.addEventListener("fullscreenchange", update);
        watchPanels();
        update();

        return () => {
            clearTimeout(scrollEndTimeout);
            resizeObserver.disconnect();
            attributeObserver.disconnect();
            mutationObserver.disconnect();
            viewport.removeEventListener("scroll", onScroll);
            viewport.removeEventListener("scrollend", onScrollEnd);
            document.removeEventListener("fullscreenchange", update);
            for (const panel of panels.values()) {
                placePanel(panel, null);
            }
            placePickers();
        };
    }, [ rootRef, isEnabled ]);
}

/**
 * The contextual balloon of the text editor around `element`, which shows the toolbar of its
 * embed.
 */
function findEditorBalloon(element: HTMLElement) {
    return findTextEditorAround(element)?.plugins.get("ContextualBalloon").view.element ?? null;
}

interface SideLayout {
    drawing: DOMRect;
    /** The window, which the panels stay inside. */
    area: VisibleArea;
    /** The balloon of the text editor while it shows, which the panels keep clear of. */
    balloon: DOMRect | null;
    gap: number;
    /** The least height of a panel as tall as the drawing. */
    minHeight: number;
}

/** The layout of the panels beside `root`, or `null` while it is scrolled out of `viewport`. */
function getSideLayout(
    root: HTMLElement,
    viewport: HTMLElement,
    balloon: HTMLElement | null
): SideLayout | null {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const drawing = root.getBoundingClientRect();
    const noteArea = getVisibleArea(viewport);
    if (drawing.bottom <= noteArea.top || drawing.top >= noteArea.bottom) {
        return null;
    }

    return {
        drawing,
        area: getWindowArea(),
        balloon: balloon?.classList.contains("ck-balloon-panel_visible")
            ? balloon.getBoundingClientRect()
            : null,
        gap: WINDOW_GAP_REM * rem,
        minHeight: SIDE_PANEL_MIN_HEIGHT_REM * rem
    };
}

/**
 * The position of `panel` beside the drawing: on its right when the window has room there and
 * no other panel took that side, otherwise on its left, level with the top of the drawing, inside
 * the window and clear of the balloon. `null` when no free side has room. A `heldMaxHeight`
 * replaces the room that the window and the balloon leave, so the panel can reach past the window.
 */
function getSidePanelPosition(
    layout: SideLayout,
    panel: HTMLElement,
    hasDrawingHeight: boolean,
    takenSides: ReadonlySet<Side>,
    heldMaxHeight?: number
) {
    const { drawing, area, gap, minHeight } = layout;
    const width = panel.offsetWidth;
    const placement = getSidePanelLeft(drawing, area, width, gap, takenSides);
    if (!placement) {
        return null;
    }

    const range = getSidePanelRange(layout, placement.left, width);
    const maxHeight = heldMaxHeight ?? range.bottom - range.top;
    const contentHeight = hasDrawingHeight
        ? Math.max(drawing.height, minHeight)
        : panel.offsetHeight;
    const height = Math.min(contentHeight, maxHeight);
    const top = Math.max(range.top, Math.min(drawing.top, range.bottom - height));
    return { ...placement, top, maxHeight, height: hasDrawingHeight ? height : null };
}

/**
 * The top and bottom of the part of the window that holds a panel at `left`, `width` wide. While
 * the balloon reaches over the panel's column, that part is on the side of the balloon where the
 * drawing shows.
 */
function getSidePanelRange(
    { drawing, area, balloon, gap }: SideLayout,
    left: number,
    width: number
) {
    let top = area.top + gap;
    let bottom = area.bottom - gap;
    if (balloon && balloon.left < left + width && balloon.right > left) {
        const drawingMiddle = (Math.max(drawing.top, area.top)
            + Math.min(drawing.bottom, area.bottom)) / 2;
        if (drawingMiddle > (balloon.top + balloon.bottom) / 2) {
            top = Math.max(top, balloon.bottom + gap);
        } else {
            bottom = Math.min(bottom, balloon.top - gap);
        }
    }
    return { top, bottom: Math.max(top, bottom) };
}

type SidePanelPosition = NonNullable<ReturnType<typeof getSidePanelPosition>>;

/** Moves `panel` to `position` beside the drawing, or back into the drawing for `null`. */
function placePanel(panel: HTMLElement, position: SidePanelPosition | null) {
    panel.toggleAttribute("data-side-panel", !!position);
    if (position) {
        panel.style.setProperty("--side-panel-left", `${position.left}px`);
        panel.style.setProperty("--side-panel-top", `${position.top}px`);
        panel.style.setProperty("--side-panel-max-height", `${position.maxHeight}px`);
        if (position.height === null) {
            panel.style.removeProperty("--side-panel-height");
        } else {
            panel.style.setProperty("--side-panel-height", `${position.height}px`);
        }
    }
    setTopLayer(panel, !!position);
}

/**
 * Moves `element` into the top layer, or back into the drawing. The `popover` attribute is present
 * exactly while the element is in the top layer; removing it hides the popover.
 */
function setTopLayer(element: HTMLElement, isMoved: boolean) {
    if (isMoved === element.hasAttribute("popover")) return;

    if (isMoved) {
        element.setAttribute("popover", "manual");
        element.showPopover();
    } else {
        element.removeAttribute("popover");
    }
}

interface VisibleArea {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** The part of `viewport` that shows the note, without its scrollbars. */
function getVisibleArea(viewport: HTMLElement): VisibleArea {
    const rect = viewport.getBoundingClientRect();
    const left = rect.left + viewport.clientLeft;
    const top = rect.top + viewport.clientTop;
    return {
        left,
        top,
        right: left + viewport.clientWidth,
        bottom: top + viewport.clientHeight
    };
}

/** The window, without its scrollbars. */
function getWindowArea(): VisibleArea {
    const { clientWidth, clientHeight } = document.documentElement;
    return { left: 0, top: 0, right: clientWidth, bottom: clientHeight };
}

/**
 * The side and the left edge of a panel `width` wide in the margin right of `drawing`, else in
 * the margin left of it, or `null` when no side outside `takenSides` fits the panel with a `gap`
 * on both sides.
 */
function getSidePanelLeft(
    drawing: DOMRect,
    area: VisibleArea,
    width: number,
    gap: number,
    takenSides: ReadonlySet<Side>
): { side: Side; left: number } | null {
    const rightOfDrawing = drawing.right + gap;
    if (!takenSides.has("right") && rightOfDrawing + width + gap <= area.right) {
        return { side: "right", left: rightOfDrawing };
    }

    const leftOfDrawing = drawing.left - gap - width;
    if (!takenSides.has("left") && leftOfDrawing >= area.left + gap) {
        return { side: "left", left: leftOfDrawing };
    }
    return null;
}

/** The share of the note's height that the properties sheet can take. */
const SHEET_MAX_HEIGHT_SHARE = 0.5;
/** The island at the bottom of Excalidraw's phone layout, which holds the properties panel. */
const BOTTOM_ISLAND_SELECTOR = ".App-bottom-bar > .Island";
/** The properties panel of Excalidraw's phone layout, inside the bottom island. */
export const PROPERTIES_PANEL_CLASS = "App-mobile-menu";
/** The wrapper in which Radix renders the pickers of the properties (colors, fonts). */
export const PICKER_SELECTOR = "[data-radix-popper-content-wrapper]";
/**
 * The custom property on `body` with the distance from the bottom of the window to the top of the
 * properties sheet. `CanvasDrawingRail.css` keeps the rail above the sheet with it.
 */
const SHEET_INSET_PROPERTY = "--canvas-drawing-sheet-inset";

/**
 * Shows the properties panel of Excalidraw's phone layout as a sheet across the bottom of the
 * note, above the formatting toolbar, while the drawing has the focus. The sheet and the pickers
 * that it opens go into the top layer, so that no clip or stacking of the note covers them. The
 * sheet has `data-properties-sheet`, and its position in `--properties-sheet-*`.
 */
export function usePropertiesSheet(rootRef: RefObject<HTMLElement | null>, isEnabled: boolean) {
    useEffect(() => {
        const root = rootRef.current;
        const viewport = root?.closest<HTMLElement>(".scrolling-container, .popup-editor-scroll");
        const embedBody = root?.closest<HTMLElement>(".include-note-body");
        if (!root || !viewport || !embedBody || !isEnabled) return;

        // The formatting toolbar of the mobile layout floats over the bottom of the note.
        const toolbar = viewport.parentElement
            ?.querySelector<HTMLElement>(":scope > .classic-toolbar-outer-container") ?? null;
        let island: HTMLElement | null = null;
        let hasInset = false;

        const resizeObserver = new ResizeObserver(() => update());
        const update = () => {
            const current = root.querySelector<HTMLElement>(BOTTOM_ISLAND_SELECTOR);
            if (current !== island) {
                if (island) {
                    resizeObserver.unobserve(island);
                    placeSheet(island, null);
                }
                if (current) {
                    resizeObserver.observe(current);
                }
                island = current;
            }

            // `ContentEmbed` marks the body active while the drawing has the focus.
            const isShown = !!island?.querySelector(`:scope > .${PROPERTIES_PANEL_CLASS}`)
                && embedBody.classList.contains("active")
                && !isInFullscreen(root);
            const position = isShown ? getSheetPosition(root, viewport, toolbar) : null;
            if (island) {
                placeSheet(island, position);
            }
            for (const picker of root.querySelectorAll<HTMLElement>(PICKER_SELECTOR)) {
                setTopLayer(picker, !!position);
            }

            if (island && position) {
                const inset = getWindowArea().bottom - island.getBoundingClientRect().top;
                document.body.style.setProperty(SHEET_INSET_PROPERTY, `${inset}px`);
                hasInset = true;
            } else if (hasInset) {
                document.body.style.removeProperty(SHEET_INSET_PROPERTY);
                hasInset = false;
            }
        };

        resizeObserver.observe(root);
        resizeObserver.observe(viewport);
        const attributeObserver = new MutationObserver(update);
        attributeObserver.observe(embedBody, { attributes: true, attributeFilter: [ "class" ] });
        if (toolbar) {
            attributeObserver.observe(toolbar, { attributes: true, attributeFilter: [ "class" ] });
        }
        // The panel mounts when it opens, and the pickers when one of its buttons opens them.
        const mutationObserver = new MutationObserver(update);
        mutationObserver.observe(root, { childList: true, subtree: true });
        viewport.addEventListener("scroll", update, { passive: true });
        document.addEventListener("fullscreenchange", update);
        update();

        return () => {
            resizeObserver.disconnect();
            attributeObserver.disconnect();
            mutationObserver.disconnect();
            viewport.removeEventListener("scroll", update);
            document.removeEventListener("fullscreenchange", update);
            if (island) {
                placeSheet(island, null);
            }
            for (const picker of root.querySelectorAll<HTMLElement>(PICKER_SELECTOR)) {
                setTopLayer(picker, false);
            }
            if (hasInset) {
                document.body.style.removeProperty(SHEET_INSET_PROPERTY);
            }
        };
    }, [ rootRef, isEnabled ]);
}

/**
 * The position of the properties sheet: across the visible note, inside the gap of the formatting
 * toolbar, and above the toolbar while it shows. `null` while the drawing is scrolled out of the
 * note.
 */
function getSheetPosition(root: HTMLElement, viewport: HTMLElement, toolbar: HTMLElement | null) {
    const area = getVisibleArea(viewport);
    const drawing = root.getBoundingClientRect();
    if (drawing.bottom <= area.top || drawing.top >= area.bottom) {
        return null;
    }

    const gap = getToolbarGap();
    const toolbarTop = toolbar?.classList.contains("active")
        ? toolbar.querySelector(".classic-toolbar-island")?.getBoundingClientRect().top
        : undefined;
    const bottom = Math.min(area.bottom, toolbarTop ?? area.bottom) - gap;
    return {
        left: area.left + gap,
        width: area.right - area.left - 2 * gap,
        bottom: getWindowArea().bottom - bottom,
        maxHeight: (bottom - area.top) * SHEET_MAX_HEIGHT_SHARE
    };
}

/** The gap around the formatting toolbar of the mobile layout, from `mobile_editor_toolbar.css`. */
function getToolbarGap() {
    const style = getComputedStyle(document.body);
    const gap = parseFloat(style.getPropertyValue("--mobile-toolbar-gap"));
    if (!Number.isNaN(gap)) {
        return gap;
    }
    return WINDOW_GAP_REM * parseFloat(getComputedStyle(document.documentElement).fontSize);
}

type SheetPosition = NonNullable<ReturnType<typeof getSheetPosition>>;

/** Moves `island` to `position` at the bottom of the note, or back into the drawing for `null`. */
function placeSheet(island: HTMLElement, position: SheetPosition | null) {
    island.toggleAttribute("data-properties-sheet", !!position);
    if (position) {
        island.style.setProperty("--properties-sheet-left", `${position.left}px`);
        island.style.setProperty("--properties-sheet-width", `${position.width}px`);
        island.style.setProperty("--properties-sheet-bottom", `${position.bottom}px`);
        island.style.setProperty("--properties-sheet-max-height", `${position.maxHeight}px`);
    }
    setTopLayer(island, !!position);
}

/** The inline styles with which Excalidraw fits its context menu in the drawing. */
export const FITTED_MENU_STYLES = [
    "left", "top", "width", "height", "overflowX", "overflowY"
] as const;

/**
 * Shows Excalidraw's context menu in the top layer, so that no clip of the note cuts it, fitted
 * in the window instead of the drawing. Closes it when the note scrolls.
 */
export function useTopLayerContextMenu(
    rootRef: RefObject<HTMLElement | null>,
    apiRef: RefObject<ExcalidrawImperativeAPI | null>
) {
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        let menu: HTMLElement | null = null;
        // Excalidraw sets a new `contextMenu` each time the menu opens.
        let placedState: AppState["contextMenu"] = null;

        const watchMenu = () => {
            menu = root.querySelector(".context-menu")?.closest<HTMLElement>(".popover") ?? null;
            const state = apiRef.current?.getAppState().contextMenu ?? null;
            const container = root.querySelector(".excalidraw-container");
            if (!menu || !state || !container || state === placedState) return;

            placedState = state;
            placeContextMenu(menu, state, container.getBoundingClientRect());
        };

        const closeOnScroll = (event: Event) => {
            const api = apiRef.current;
            const isDrawingMoved = event.target instanceof Node && event.target.contains(root);
            if (!isDrawingMoved || !api?.getAppState().contextMenu) return;

            // Excalidraw also focuses its container when the menu closes.
            if (menu?.contains(document.activeElement)) {
                root.querySelector<HTMLElement>(".excalidraw-container")
                    ?.focus({ preventScroll: true });
            }
            api.updateScene({ appState: { contextMenu: null } });
        };

        const observer = new MutationObserver(watchMenu);
        observer.observe(root, { childList: true, subtree: true });
        // Scroll events do not bubble, so the capture phase sees those of every ancestor.
        document.addEventListener("scroll", closeOnScroll, { capture: true, passive: true });

        return () => {
            observer.disconnect();
            document.removeEventListener("scroll", closeOnScroll, { capture: true });
            if (menu) setTopLayer(menu, false);
        };
    }, [ rootRef, apiRef ]);
}

/**
 * Moves Excalidraw's context `menu` into the top layer, at the point where Excalidraw opened it in
 * the `drawing`. A menu that reaches past the window moves back into it, and one larger than the
 * window shrinks to it and scrolls.
 */
function placeContextMenu(
    menu: HTMLElement,
    point: { left: number; top: number },
    drawing: DOMRect
) {
    for (const property of FITTED_MENU_STYLES) {
        menu.style[property] = "";
    }
    setTopLayer(menu, true);
    // Measured at the corner of the window, where nothing narrows the menu.
    menu.style.left = "0px";
    menu.style.top = "0px";
    const { width, height } = menu.getBoundingClientRect();

    const area = getWindowArea();
    const gap = WINDOW_GAP_REM * parseFloat(getComputedStyle(document.documentElement).fontSize);
    const x = fitSpan(drawing.left + point.left, width, area.left + gap, area.right - gap);
    const y = fitSpan(drawing.top + point.top, height, area.top + gap, area.bottom - gap);
    menu.style.left = `${x.start}px`;
    menu.style.top = `${y.start}px`;
    if (x.size !== null) {
        menu.style.width = `${x.size}px`;
        menu.style.overflowX = "auto";
    }
    if (y.size !== null) {
        menu.style.height = `${y.size}px`;
        menu.style.overflowY = "auto";
    }
}

/**
 * Where a span `size` long from `start` fits between `min` and `max`: moved back from `max` when it
 * reaches past it, and shrunk to the space between them when longer. `size` is `null` while the
 * span keeps its own.
 */
function fitSpan(start: number, size: number, min: number, max: number) {
    const fittedSize = Math.min(size, max - min);
    return {
        start: Math.max(min, Math.min(start, max - fittedSize)),
        size: fittedSize < size ? fittedSize : null
    };
}
