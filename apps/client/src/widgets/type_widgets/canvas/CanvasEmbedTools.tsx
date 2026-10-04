import "./CanvasEmbedTools.css";

import { useI18n } from "@excalidraw/excalidraw";
import type {
    AppState, ExcalidrawImperativeAPI, NormalizedZoomValue, ToolType
} from "@excalidraw/excalidraw/types";
import moreToolsIcon from "boxicons/svg/regular/bx-category.svg?raw";
import ellipseIcon from "boxicons/svg/regular/bx-circle.svg?raw";
import eraserIcon from "boxicons/svg/regular/bx-eraser.svg?raw";
import textIcon from "boxicons/svg/regular/bx-font.svg?raw";
import fullscreenIcon from "boxicons/svg/regular/bx-fullscreen.svg?raw";
import imageIcon from "boxicons/svg/regular/bx-image.svg?raw";
import lockIcon from "boxicons/svg/regular/bx-lock-open-alt.svg?raw";
import lineIcon from "boxicons/svg/regular/bx-minus.svg?raw";
import drawIcon from "boxicons/svg/regular/bx-pencil.svg?raw";
import selectionIcon from "boxicons/svg/regular/bx-pointer.svg?raw";
import rectangleIcon from "boxicons/svg/regular/bx-rectangle.svg?raw";
import redoIcon from "boxicons/svg/regular/bx-redo.svg?raw";
import arrowIcon from "boxicons/svg/regular/bx-right-arrow-alt.svg?raw";
import squareIcon from "boxicons/svg/regular/bx-square.svg?raw";
import undoIcon from "boxicons/svg/regular/bx-undo.svg?raw";
import zoomInIcon from "boxicons/svg/regular/bx-zoom-in.svg?raw";
import zoomOutIcon from "boxicons/svg/regular/bx-zoom-out.svg?raw";
import handIcon from "boxicons/svg/solid/bxs-hand.svg?raw";
import type { RefObject } from "preact";
import { useEffect, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import {
    type ContentEmbedTool,
    type ContentEmbedToolbarItem,
    type ContentEmbedToolProvider,
    registerContentEmbedTools,
    showContentEmbedFullscreen
} from "../text/content_embed_tools";

/** The tools with a button of their own, in the order of their buttons. */
export const MAIN_TOOLS = [
    "hand", "selection", "rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text",
    "image", "eraser"
] as const satisfies readonly ToolType[];
/** The tools in the "More tools" menu. */
export const EXTRA_TOOLS = [ "frame", "embeddable" ] as const satisfies readonly ToolType[];
const TOOLS = [ ...MAIN_TOOLS, ...EXTRA_TOOLS ];
export const LOCK = "lock";
/** The button that opens the "More tools" menu, named by Excalidraw's `toolBar.extraTools`. */
export const MORE_TOOLS = "moreTools";
/** Shows the embed in fullscreen, as the button of its title row does while the title is hidden. */
const FULLSCREEN = "fullscreen";
/** The commands that click Excalidraw's own `button-undo` and `button-redo`. */
export const HISTORY_ACTIONS = [ "undo", "redo" ] as const;

/** Excalidraw's zoom step and limits, from its own zoom buttons. */
export const ZOOM_STEP = 0.1;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 30;
/** The zoom that each zoom button sets, from the current one. */
export const ZOOMS: Record<string, (zoom: number) => number> = {
    zoomOut: (zoom) => zoom - ZOOM_STEP,
    resetZoom: () => 1,
    zoomIn: (zoom) => zoom + ZOOM_STEP
};

type Tool = typeof TOOLS[number];
type HistoryAction = typeof HISTORY_ACTIONS[number];
/** Excalidraw's `t()`, for a key such as `toolBar.rectangle`. */
type Translate = (key: string) => string;

/** Boxicons' square turned by 45°, and scaled down to stay inside the box of the icon. */
const diamondIcon = squareIcon.replace(
    "<path ",
    "<path transform=\"translate(12 12) rotate(45) scale(0.8) translate(-12 -12)\" "
);

/** The icons of the tools, for their buttons and their entries in the "More tools" menu. */
const ICONS: Partial<Record<Tool | typeof LOCK, string>> = {
    [LOCK]: lockIcon,
    hand: handIcon,
    selection: selectionIcon,
    rectangle: rectangleIcon,
    diamond: diamondIcon,
    ellipse: ellipseIcon,
    arrow: arrowIcon,
    line: lineIcon,
    freedraw: drawIcon,
    text: textIcon,
    image: imageIcon,
    eraser: eraserIcon
};

interface CanvasEmbedToolsProps {
    /** The element of the drawing, inside the embed whose toolbar shows the tools. */
    rootRef: RefObject<HTMLElement>;
    apiRef: RefObject<ExcalidrawImperativeAPI>;
    /** Whether the Editable toggle of the embed is on. A read-only drawing offers the zoom only. */
    isEditable: boolean;
}

/**
 * Adds Excalidraw's tools, undo and redo, and zoom to the toolbar of the embed that shows the
 * drawing. Renders inside `<Excalidraw>`, for its translations.
 */
export default function CanvasEmbedTools({ rootRef, apiRef, isEditable }: CanvasEmbedToolsProps) {
    const { t, langCode } = useExcalidrawTranslation();
    const [ tools ] = useState(() => new CanvasTools(rootRef));

    useEffect(() => tools.setTranslate(t), [ tools, t, langCode ]);
    useEffect(() => tools.setEditable(isEditable), [ tools, isEditable ]);

    useEffect(() => {
        const root = rootRef.current;
        const api = apiRef.current;
        if (!root || !api) return;

        const disconnect = tools.connect(api);
        const unregister = registerContentEmbedTools(root, tools);
        // `CanvasDrawing.css` hides Excalidraw's own controls while these replace them.
        root.setAttribute("data-embed-tools", "");
        return () => {
            root.removeAttribute("data-embed-tools");
            unregister();
            disconnect();
        };
    }, [ tools, rootRef, apiRef ]);

    return null;
}

/** Excalidraw's `t()` and language, for a component that renders inside `<Excalidraw>`. */
export function useExcalidrawTranslation() {
    // Excalidraw types the key of `t()` as a union that TypeScript cannot check a string against.
    return useI18n() as unknown as { t: Translate; langCode: string };
}

/** Excalidraw's tools and commands, as buttons of the toolbar of the embed with the drawing. */
export class CanvasTools implements ContentEmbedToolProvider {
    readonly hiddenToolbarItems: readonly ContentEmbedToolbarItem[] = [
        "contentEmbedBoxSizeDropdown", "toggleContentEmbedTitle", "convertEmbedToLink"
    ];
    readonly hasEditableFlag = true;
    private api: ExcalidrawImperativeAPI | null = null;
    private translate: Translate | null = null;
    /** Whether the drawing can be edited, which adds the drawing tools and the history. */
    private isEditable = true;
    private listeners = new Set<() => void>();
    /** The tools as last notified, to notify the listeners only when they change. */
    private shownTools = "";

    constructor(private readonly rootRef: RefObject<HTMLElement>) {}

    /** Follows `api` and its undo and redo buttons, until the returned function is called. */
    connect(api: ExcalidrawImperativeAPI) {
        this.api = api;
        const unsubscribe = api.onChange(() => this.update());
        // Excalidraw enables its undo and redo buttons once it renders them again.
        const observer = new MutationObserver(() => this.update());
        const root = this.rootRef.current;
        if (root) {
            observer.observe(root, {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: [ "disabled" ]
            });
        }
        this.update();

        return () => {
            unsubscribe();
            observer.disconnect();
            this.api = null;
            this.update();
        };
    }

    setTranslate(translate: Translate) {
        this.translate = translate;
        this.update();
    }

    setEditable(isEditable: boolean) {
        this.isEditable = isEditable;
        this.update();
    }

    getTools(): ContentEmbedTool[] {
        const appState = this.api?.getAppState();
        if (!appState) {
            return [];
        }

        const zoomTools = [
            ...this.getZoomTools(appState.zoom.value),
            ...this.getFullscreenTools()
        ];
        return this.isEditable
            ? [ ...this.getEditingTools(appState.activeTool), ...zoomTools ]
            : zoomTools;
    }

    execute(id: string) {
        const api = this.api;
        if (!api) return;

        // The embed covers the drawing with a backdrop until the drawing has the focus.
        const container = this.rootRef.current?.querySelector<HTMLElement>(".excalidraw-container");
        if (container && !container.contains(document.activeElement)) {
            container.focus({ preventScroll: true });
        }

        const appState = api.getAppState();
        const getZoom = ZOOMS[id];
        if (id === FULLSCREEN) {
            showContentEmbedFullscreen(this.rootRef.current);
        } else if (getZoom) {
            api.updateScene({ appState: getZoomState(appState, getZoom(appState.zoom.value)) });
        } else if (this.isEditable) {
            this.runEditingTool(api, appState, id);
        }
    }

    subscribe(callback: () => void) {
        this.listeners.add(callback);
        return () => {
            this.listeners.delete(callback);
        };
    }

    private update() {
        const shownTools = JSON.stringify(this.getTools());
        if (shownTools !== this.shownTools) {
            this.shownTools = shownTools;
            for (const listener of this.listeners) {
                listener();
            }
        }
    }

    private t(key: string) {
        return this.translate?.(key) ?? key;
    }

    /** The lock, the drawing tools, undo and redo. */
    private getEditingTools(activeTool: AppState["activeTool"]): ContentEmbedTool[] {
        return [
            {
                id: LOCK,
                label: this.t("toolBar.lock"),
                icon: ICONS[LOCK],
                isOn: activeTool.locked,
                group: "lock"
            },
            ...MAIN_TOOLS.map((type) => ({
                id: type,
                label: this.t(`toolBar.${type}`),
                icon: ICONS[type],
                isOn: activeTool.type === type,
                group: "tools"
            })),
            {
                id: MORE_TOOLS,
                label: this.t("toolBar.extraTools"),
                icon: moreToolsIcon,
                isOn: EXTRA_TOOLS.some((type) => activeTool.type === type),
                group: MORE_TOOLS,
                children: EXTRA_TOOLS.map((type) => ({
                    id: type,
                    label: this.t(`toolBar.${type}`),
                    icon: ICONS[type],
                    isOn: activeTool.type === type
                }))
            },
            this.getHistoryTool("undo", undoIcon),
            this.getHistoryTool("redo", redoIcon)
        ];
    }

    /**
     * Fullscreen, while the title of the embed is hidden at a box size whose title row has a button
     * for it.
     */
    private getFullscreenTools(): ContentEmbedTool[] {
        const embed = this.rootRef.current?.closest<HTMLElement>(".include-note");
        const { hideTitle, boxSize } = embed?.dataset ?? {};
        if (hideTitle !== "true" || (boxSize !== "medium" && boxSize !== "full")) {
            return [];
        }

        return [
            { id: FULLSCREEN, label: t("common.fullscreen"), icon: fullscreenIcon, group: "zoom" }
        ];
    }

    /** Zoom out, the zoom level that resets it, and zoom in. */
    private getZoomTools(zoom: number): ContentEmbedTool[] {
        return [
            {
                id: "zoomOut",
                label: this.t("buttons.zoomOut"),
                icon: zoomOutIcon,
                isEnabled: zoom > MIN_ZOOM,
                group: "zoom"
            },
            {
                id: "resetZoom",
                label: this.t("buttons.resetZoom"),
                text: `${Math.round(zoom * 100)}%`,
                class: "canvas-drawing-zoom-level",
                group: "zoom"
            },
            {
                id: "zoomIn",
                label: this.t("buttons.zoomIn"),
                icon: zoomInIcon,
                isEnabled: zoom < MAX_ZOOM,
                group: "zoom"
            }
        ];
    }

    /** Runs the lock, a drawing tool, undo or redo. */
    private runEditingTool(api: ExcalidrawImperativeAPI, appState: AppState, id: string) {
        if (id === "undo" || id === "redo") {
            this.getHistoryButton(id)?.click();
        } else if (id === LOCK) {
            const locked = !appState.activeTool.locked;
            api.updateScene({ appState: { activeTool: { ...appState.activeTool, locked } } });
        } else if (isTool(id)) {
            api.setActiveTool({ type: id });
        }
    }

    /** Undo or redo, enabled while Excalidraw's own button is: Excalidraw keeps the history. */
    private getHistoryTool(id: HistoryAction, icon: string): ContentEmbedTool {
        const button = this.getHistoryButton(id);
        return {
            id,
            label: this.t(`buttons.${id}`),
            icon,
            isEnabled: !!button && !button.disabled,
            group: "history"
        };
    }

    /** Excalidraw's undo or redo button, which the canvas layout hides. */
    private getHistoryButton(id: HistoryAction) {
        return this.rootRef.current
            ?.querySelector<HTMLButtonElement>(`[data-testid="button-${id}"]`) ?? null;
    }
}

function isTool(id: string): id is Tool {
    return (TOOLS as readonly string[]).includes(id);
}

/**
 * The scroll and the zoom that zoom the view to `zoom` around its center, as Excalidraw's own
 * zoom buttons compute them.
 */
function getZoomState(appState: AppState, zoom: number) {
    const value = Math.min(Math.max(Math.round(zoom * 1e6) / 1e6, MIN_ZOOM), MAX_ZOOM);
    const centerX = appState.width / 2;
    const centerY = appState.height / 2;
    return {
        scrollX: appState.scrollX + centerX / value - centerX / appState.zoom.value,
        scrollY: appState.scrollY + centerY / value - centerY / appState.zoom.value,
        zoom: { value: value as NormalizedZoomValue }
    };
}
