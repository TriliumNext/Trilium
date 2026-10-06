import "./CanvasDrawing.css";

import { exportToSvg } from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import clsx from "clsx";
import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import type NoteContext from "../../../components/note_context";
import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";
import type { AttachmentEditor } from "../../../services/content_renderer";
import options from "../../../services/options";
import { getEffectiveThemeStyle } from "../../../services/theme";
import { isDesktop } from "../../../services/utils";
import { useColorScheme, useEffectiveReadOnly } from "../../react/hooks";
import { useAttachmentEditor } from "../text/attachment_saves";
import { useContentEmbedEvent, useIsContentEmbedEditable } from "../text/content_embed_tools";
import { CanvasEditor } from "./Canvas";
import CanvasDrawingMenu from "./CanvasDrawingMenu";
import CanvasEmbedTools from "./CanvasEmbedTools";
import { getInlineFiles, parseContent, useCanvasDrawingPersistence } from "./persistence";

interface CanvasDrawingProps {
    attachment: FAttachment;
    /** Saves the changes. Without it, or for an attachment of another note, it is read-only. */
    editor?: AttachmentEditor;
}

/**
 * A canvas drawing saved in an attachment, edited in place inside the note that shows it while
 * the Editable toggle of its embed is on.
 */
export default function CanvasDrawing({ attachment, editor }: CanvasDrawingProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<ExcalidrawImperativeAPI>(null);
    const colorScheme = useColorScheme();
    const canEdit = !!editor?.canEdit(attachment) && !options.is("databaseReadonly");
    const isEmbedEditable = useIsContentEmbedEditable(rootRef);
    const isEditable = canEdit && isEmbedEditable;
    // Follows `canEdit` rather than the toggle, so that turning editing off keeps a pending save.
    const persistence = useCanvasDrawingPersistence(
        attachment,
        canEdit ? editor : undefined,
        apiRef,
        colorScheme
    );
    const isToolbarOverPanel = useIsToolbarOverPanel(rootRef);
    useFocusFromEmbedBox(rootRef);
    const isRecentering = useRecenteringOnFullscreen(rootRef, apiRef);
    useSidePanels(rootRef, isEditable);
    useTopLayerContextMenu(rootRef, apiRef);

    return (
        <div
            ref={rootRef}
            className={clsx(
                "canvas-drawing-editor",
                isToolbarOverPanel && "toolbar-over-panel",
                isRecentering && "recentering"
            )}
        >
            <CanvasEditor
                apiRef={apiRef}
                isReadOnly={!isEditable}
                colorScheme={colorScheme}
                persistence={persistence}
                isEmbedded
                isDesktopLayout={isDesktop()}
            >
                <CanvasDrawingMenu apiRef={apiRef} isEditable={isEditable} />
                {canEdit && (
                    <CanvasEmbedTools rootRef={rootRef} apiRef={apiRef} isEditable={isEditable} />
                )}
            </CanvasEditor>
        </div>
    );
}

/** A picture of the canvas drawing saved in `entity`, or `null` for an empty drawing. */
export async function renderCanvasDrawingPicture(entity: FNote | FAttachment) {
    const blob = await entity.getBlob();
    const content = parseContent(blob?.content ?? "", entity);
    const elements = (content.elements ?? []).filter((element) => !element.isDeleted);
    if (!elements.length) {
        return null;
    }

    const svg = await exportToSvg({
        elements,
        appState: {
            ...content.appState,
            exportBackground: true,
            // Follows the theme as the editor does, except in print, which stays light.
            exportWithDarkMode: glob.device !== "print" && getEffectiveThemeStyle() === "dark"
        },
        files: getInlineFiles(content),
        exportPadding: 5
    });
    svg.classList.add("canvas-drawing-picture");
    return svg;
}

interface CanvasDrawingDetailProps {
    attachment: FAttachment;
    /** The note that owns the attachment. */
    note: FNote;
    noteContext?: NoteContext;
    /** Counts the changes to the drawing saved elsewhere, each of which loads it again. */
    revision?: number;
}

/**
 * A canvas drawing saved in an attachment, edited in the full detail of the attachment. It is
 * read-only while its note is.
 */
export function CanvasDrawingDetail({
    attachment, note, noteContext, revision
}: CanvasDrawingDetailProps) {
    // Outlives the drawing loaded again for each revision, which starts from its unsaved changes.
    const editor = useAttachmentEditor(note, noteContext);

    return (
        <DetailDrawing
            key={revision}
            attachment={attachment}
            note={note}
            noteContext={noteContext}
            editor={editor}
        />
    );
}

interface DetailDrawingProps extends Omit<CanvasDrawingDetailProps, "revision"> {
    editor: AttachmentEditor;
}

/** The drawing of `CanvasDrawingDetail`, saved by `editor`. */
function DetailDrawing({ attachment, note, noteContext, editor }: DetailDrawingProps) {
    const apiRef = useRef<ExcalidrawImperativeAPI>(null);
    const colorScheme = useColorScheme();
    const isNoteReadOnly = useEffectiveReadOnly(note, noteContext);
    const canEdit = editor.canEdit(attachment) && !isNoteReadOnly
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
        >
            <CanvasDrawingMenu apiRef={apiRef} isEditable={canEdit} />
        </CanvasEditor>
    );
}

/**
 * Centers the drawing once fullscreen changed its size, which moves the view off center. Returns
 * whether the drawing is hidden for it: from the start of the change until it is drawn centered.
 */
function useRecenteringOnFullscreen(
    rootRef: RefObject<HTMLElement | null>,
    apiRef: RefObject<ExcalidrawImperativeAPI | null>
) {
    const [ isRecentering, setIsRecentering ] = useState(false);
    const frameRef = useRef(0);

    useContentEmbedEvent(rootRef, "fullscreenChangeStart", () => {
        cancelAnimationFrame(frameRef.current);
        setIsRecentering(true);
    });

    const recenter = () => {
        apiRef.current?.scrollToContent();
        // Excalidraw draws the centered view on the next frame.
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = requestAnimationFrame(() => setIsRecentering(false));
        });
    };
    useContentEmbedEvent(rootRef, "enterFullscreen", recenter);
    useContentEmbedEvent(rootRef, "leaveFullscreen", recenter);
    useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

    return isRecentering;
}

/**
 * Moves the focus into Excalidraw when the embed box around the drawing holds it. Excalidraw
 * renders its container only once its language loads, which can be after the box took the focus.
 */
function useFocusFromEmbedBox(rootRef: RefObject<HTMLElement | null>) {
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        // Returns whether the container exists, after which there is nothing left to wait for.
        const forwardFocus = () => {
            const container = root.querySelector<HTMLElement>(".excalidraw");
            if (container && document.activeElement === container.closest(".include-note-content")) {
                container.focus();
            }
            return !!container;
        };
        if (forwardFocus()) return;

        const observer = new MutationObserver(() => {
            if (forwardFocus()) {
                observer.disconnect();
            }
        });
        observer.observe(root, { childList: true, subtree: true });
        return () => observer.disconnect();
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

/** The panels of Excalidraw that go beside the drawing, in the order in which they take a side. */
const SIDE_PANELS = [
    // The item list of the library fills the height it is given and has none of its own.
    { selector: ".default-sidebar", hasDrawingHeight: true },
    { selector: ".App-menu__left", hasDrawingHeight: false }
];

type Side = "left" | "right";

/**
 * Shows Excalidraw's library and properties panel beside the drawing while the drawing has the
 * focus, in the top layer so that no clip or stacking of the note covers them. A panel there has
 * `data-side-panel`, and its position in `--side-panel-*`.
 */
export function useSidePanels(rootRef: RefObject<HTMLElement | null>, isEnabled: boolean) {
    useEffect(() => {
        const root = rootRef.current;
        const viewport = root?.closest<HTMLElement>(".scrolling-container");
        const embedBody = root?.closest<HTMLElement>(".include-note-body");
        if (!root || !viewport || !embedBody || !isEnabled) return;

        const panels = new Map<string, HTMLElement>();

        const update = () => {
            // `ContentEmbed` marks the body active while the drawing has the focus.
            const isShown = embedBody.classList.contains("active")
                && !document.fullscreenElement?.contains(root);
            const layout = isShown ? getSideLayout(root, viewport) : null;
            const takenSides = new Set<Side>();
            for (const { selector, hasDrawingHeight } of SIDE_PANELS) {
                const panel = panels.get(selector);
                if (!panel) continue;

                const position = layout
                    && getSidePanelPosition(layout, panel, hasDrawingHeight, takenSides);
                if (position) {
                    takenSides.add(position.side);
                }
                placePanel(panel, position || null);
            }
        };

        const resizeObserver = new ResizeObserver(update);
        resizeObserver.observe(root);
        resizeObserver.observe(viewport);
        const activeObserver = new MutationObserver(update);
        activeObserver.observe(embedBody, { attributes: true, attributeFilter: [ "class" ] });

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
        viewport.addEventListener("scroll", update, { passive: true });
        document.addEventListener("fullscreenchange", update);
        watchPanels();
        update();

        return () => {
            resizeObserver.disconnect();
            activeObserver.disconnect();
            mutationObserver.disconnect();
            viewport.removeEventListener("scroll", update);
            document.removeEventListener("fullscreenchange", update);
            for (const panel of panels.values()) {
                placePanel(panel, null);
            }
        };
    }, [ rootRef, isEnabled ]);
}

interface SideLayout {
    drawing: DOMRect;
    /** The window, which the panels stay inside. */
    area: VisibleArea;
    gap: number;
    /** The least height of a panel as tall as the drawing. */
    minHeight: number;
}

/** The layout of the panels beside `root`, or `null` while it is scrolled out of `viewport`. */
function getSideLayout(root: HTMLElement, viewport: HTMLElement): SideLayout | null {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const drawing = root.getBoundingClientRect();
    const noteArea = getVisibleArea(viewport);
    if (drawing.bottom <= noteArea.top || drawing.top >= noteArea.bottom) {
        return null;
    }

    return {
        drawing,
        area: getWindowArea(),
        gap: WINDOW_GAP_REM * rem,
        minHeight: SIDE_PANEL_MIN_HEIGHT_REM * rem
    };
}

/**
 * The position of `panel` beside the drawing: on its right when the window has room there and
 * no other panel took that side, otherwise on its left, level with the top of the drawing and
 * inside the window. `null` when no free side has room.
 */
function getSidePanelPosition(
    { drawing, area, gap, minHeight }: SideLayout,
    panel: HTMLElement,
    hasDrawingHeight: boolean,
    takenSides: ReadonlySet<Side>
) {
    const placement = getSidePanelLeft(drawing, area, panel.offsetWidth, gap, takenSides);
    if (!placement) {
        return null;
    }

    const maxHeight = area.bottom - area.top - 2 * gap;
    const contentHeight = hasDrawingHeight
        ? Math.max(drawing.height, minHeight)
        : panel.offsetHeight;
    const height = Math.min(contentHeight, maxHeight);
    const top = Math.max(area.top + gap, Math.min(drawing.top, area.bottom - gap - height));
    return { ...placement, top, maxHeight, height: hasDrawingHeight ? height : null };
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
