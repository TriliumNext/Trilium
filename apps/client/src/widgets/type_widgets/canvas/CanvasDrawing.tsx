import "./CanvasDrawing.css";

import { exportToSvg, getCommonBounds } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import clsx from "clsx";
import type { RefObject } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

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
import { registerEmbedFindTarget, useContentEmbedEvent } from "../text/content_embed_tools";
import { findTextEditorAround, useEditableEmbed } from "../text/editable_embed";
import { CanvasEditor } from "./Canvas";
import CanvasDrawingMenu from "./CanvasDrawingMenu";
import CanvasDrawingRail from "./CanvasDrawingRail";
import CanvasEmbedTools, { CanvasTools, isNoTool, NO_TOOL } from "./CanvasEmbedTools";
import {
    attachExcalidraw, DrawingFindTarget, type DrawingMatch, DrawingMatches, getSceneTransform
} from "./drawing_find";
import {
    type DrawingView, getBoundedView, getDrawingView, getFittedView, getZoomToFitView
} from "./drawing_view";
import {
    exportDrawingPicture, loadDrawingFiles, parseContent, useCanvasDrawingPersistence
} from "./persistence";

interface CanvasDrawingProps {
    attachment: FAttachment;
    /** Saves the changes. Without it, or for an attachment of another note, it is read-only. */
    editor?: ContentEditor;
}

/** What a drawing in an embed shows: Excalidraw while it is edited, otherwise a picture. */
type DrawingMode = "editor" | "picture";

/**
 * A canvas drawing saved in an attachment. While the Editable toggle of its embed is on, Excalidraw
 * edits it in place inside the note that shows it; otherwise it shows as a picture at the same
 * view.
 */
export default function CanvasDrawing({ attachment, editor }: CanvasDrawingProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<ExcalidrawImperativeAPI>(null);
    // The view of the box, which the picture and Excalidraw take over from each other. Fullscreen
    // shows a view of its own, and the box shows this one again after.
    const viewRef = useRef<DrawingView | null>(null);
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
        <div
            ref={rootRef}
            className={clsx(
                "canvas-drawing-editor",
                isToolbarOverPanel && "toolbar-over-panel",
                isRecentering && "recentering"
            )}
        >
            {(mode === "picture" || drawnMode === "picture") && (
                <DrawingPicture
                    attachment={attachment}
                    editor={editor}
                    colorScheme={colorScheme}
                    rootRef={rootRef}
                    viewRef={viewRef}
                    find={find}
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
                    tools={tools}
                    find={find}
                    isEditable={isEditing}
                    onDrawn={() => setDrawnMode("editor")}
                />
            )}
        </div>
    );
}

interface LiveDrawingProps {
    attachment: FAttachment;
    /** Saves the changes. */
    editor: ContentEditor | undefined;
    colorScheme: AppState["theme"];
    rootRef: RefObject<HTMLDivElement | null>;
    apiRef: RefObject<ExcalidrawImperativeAPI | null>;
    viewRef: RefObject<DrawingView | null>;
    tools: CanvasTools;
    /** Searches the drawing for "Search in note". */
    find: DrawingFindTarget;
    isEditable: boolean;
    /** Called on the frame after Excalidraw shows the drawing. */
    onDrawn: () => void;
}

/**
 * The drawing in Excalidraw, opened at the view of `viewRef`, which follows the view from then on.
 * Its persistence saves what is left to save before Excalidraw unmounts.
 */
function LiveDrawing({
    attachment, editor, colorScheme, rootRef, apiRef, viewRef, tools, find, isEditable, onDrawn
}: LiveDrawingProps) {
    const isShownRef = useRef(false);
    const frameRef = useRef(0);
    const stopFindingRef = useRef<(() => void) | null>(null);
    const persistence = useCanvasDrawingPersistence(attachment, editor, apiRef, colorScheme, {
        initialView: viewRef.current,
        // A touch over the drawing scrolls the note until a tool is picked.
        initialTool: isMobile() ? NO_TOOL : undefined,
        rootRef,
        // A save made in fullscreen keeps the view of the box.
        getSavedView: () => isInFullscreen(rootRef.current) ? viewRef.current : null,
        onSceneShown: () => {
            isShownRef.current = true;
            frameRef.current = requestAnimationFrame(onDrawn);
            const api = apiRef.current;
            if (api) {
                stopFindingRef.current?.();
                stopFindingRef.current = attachExcalidraw(find, api, rootRef.current);
            }
        }
    });
    useNoToolOutsideEditing(rootRef, apiRef, isEditable);
    useLayoutEffect(() => () => {
        cancelAnimationFrame(frameRef.current);
        stopFindingRef.current?.();
        rootRef.current?.removeAttribute("data-no-tool");
        apiRef.current = null;
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
                    if (isShownRef.current && !isInFullscreen(rootRef.current)) {
                        viewRef.current = getDrawingView(appState);
                    }
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
    /** Searches the drawing for "Search in note". */
    find: DrawingFindTarget;
    /** Called on the frame after the picture shows. */
    onDrawn: () => void;
}

/**
 * The drawing as a picture, at the view of `viewRef`, else at the saved view, else fit in the box.
 * It renders again after each save, once `rootRef` is shown. Fullscreen shows the whole drawing,
 * and the box shows its view again after.
 */
function DrawingPicture({
    attachment, editor, colorScheme, rootRef, viewRef, find, onDrawn
}: DrawingPictureProps) {
    const layerRef = useRef<HTMLDivElement>(null);
    const matchesRef = useRef<SVGGElement>(null);
    const [ scene, setScene ] = useState<PictureScene | null>(null);
    const sceneRef = useRef<PictureScene | null>(null);
    const [ shownMatches, setShownMatches ] = useState<ShownMatches>(NO_MATCHES);
    const [ revision, setRevision ] = useState(0);
    // Each move of the view places the picture again.
    const [ placements, setPlacements ] = useState(0);
    const renderedKeyRef = useRef<string | null>(null);
    const size = useElementSize(layerRef);
    const whenShown = useWhenShown(rootRef);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const rows = loadResults.getAttachmentRows();
        if (rows.some((row) => row.attachmentId === attachment.attachmentId)) {
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
            if (key === renderedKeyRef.current) return;

            const rendered = await renderPictureScene(attachment, content, colorScheme === "dark");
            if (isCurrent) {
                renderedKeyRef.current = key;
                setScene(rendered);
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

        const view = getPictureView(scene, size.width, size.height, viewRef.current);
        viewRef.current = view;
        if (scene.picture && view) {
            placePicture(scene.picture, view);
        }
        if (view) {
            matchesRef.current?.setAttribute("transform", getSceneTransform(view));
        }
        layer.replaceChildren(...(scene.picture ? [ scene.picture.svg ] : []));
        const frame = requestAnimationFrame(onDrawn);
        return () => cancelAnimationFrame(frame);
    }, [ scene, size, placements ]);

    return (
        <>
            <div
                ref={layerRef}
                className={clsx("canvas-drawing-view", colorScheme === "dark" && "theme-dark")}
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
    const savedView = zoom && scrollX !== undefined && scrollY !== undefined
        ? { zoom, scrollX, scrollY }
        : null;
    const background = viewBackgroundColor && viewBackgroundColor !== "transparent"
        ? viewBackgroundColor
        : null;
    if (!elements.length) {
        return { picture: null, elements, savedView, background };
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
        background
    };
}

/**
 * The shapes that Excalidraw's export takes the size of: those outside frames, and the frames,
 * which clip what they hold.
 */
function getRootElements(elements: readonly ExcalidrawElement[]) {
    const frameIds = new Set(elements
        .filter((element) => element.type === "frame" || element.type === "magicframe")
        .map((element) => element.id));
    return elements.filter((element) => !element.frameId || !frameIds.has(element.frameId));
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
            api.updateScene({ appState: viewRef.current });
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
            if (view) api.updateScene({ appState: view });
        }
        show();
    });
    useContentEmbedEvent(rootRef, "leaveFullscreen", show);
    useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

    return isRecentering;
}

/** Whether `element` is in the content box that is shown fullscreen. */
function isInFullscreen(element: Element | null) {
    return !!element && !!document.fullscreenElement?.contains(element);
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

/** The panels of Excalidraw that go beside the drawing, in the order in which they take a side. */
const SIDE_PANELS = [
    // The item list of the library fills the height it is given and has none of its own.
    { selector: ".default-sidebar", hasDrawingHeight: true },
    { selector: ".App-menu__left", hasDrawingHeight: false }
];

type Side = "left" | "right";

/**
 * Shows Excalidraw's library and properties panel beside the drawing while the drawing has the
 * focus, in the top layer so that no clip or stacking of the note covers them, and clear of the
 * toolbar of the embed. A panel there has `data-side-panel`, and its position in
 * `--side-panel-*`.
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

        // The panels mount when they open, and the properties panel takes the height of the
        // properties of the selection.
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
            if (isChanged) update();
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
