import "./CanvasEmbedTools.css";

import { useI18n } from "@excalidraw/excalidraw";
import type {
    AppState, ExcalidrawImperativeAPI, NormalizedZoomValue, ToolType
} from "@excalidraw/excalidraw/types";
import noToolIcon from "boxicons/svg/regular/bx-block.svg?raw";
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
import { useEffect } from "preact/hooks";

import { t } from "../../../services/i18n";
import {
    type ContentEmbedTool,
    type ContentEmbedToolbarItem,
    type ContentEmbedToolProvider,
    needsFullscreenButton,
    showContentEmbedFullscreen
} from "../text/content_embed_tools";
import {
    type DrawingView, getBoundedView, getZoomToFitView, MAX_ZOOM, MIN_ZOOM, ZOOM_STEP
} from "./drawing_view";

/** The tools with a button of their own, in the order of their buttons. */
export const MAIN_TOOLS = [
    "hand", "selection", "rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text",
    "image", "eraser"
] as const satisfies readonly ToolType[];
/** The tools in the "More tools" menu. */
export const EXTRA_TOOLS = [ "frame", "embeddable" ] as const satisfies readonly ToolType[];
const TOOLS = [ ...MAIN_TOOLS, ...EXTRA_TOOLS ];
export const LOCK = "lock";
/** The button of {@link NO_TOOL}. */
export const NO_TOOL_ID = "noTool";
/**
 * No tool: the custom tool of Excalidraw, which takes nothing from the pointer. `CanvasDrawing`
 * leaves the touch over the drawing to the note with it.
 */
export const NO_TOOL = {
    type: "custom", customType: "none", locked: false, lastActiveTool: null
} as const satisfies AppState["activeTool"];
/** The button that opens the "More tools" menu, named by Excalidraw's `toolBar.extraTools`. */
export const MORE_TOOLS = "moreTools";
/** The name of Excalidraw's default sidebar, whose tabs are the library and the search. */
export const DEFAULT_SIDEBAR = "default";
export const SEARCH_TAB = "search";

/** A command after the tools in the "More tools" menu. */
interface MenuCommand {
    id: string;
    /** The key of Excalidraw's translation of the label, such as `search.title`. */
    label: string;
    /** The keystroke that Excalidraw binds to the command. */
    keystroke?: string;
    group: string;
    run(api: ExcalidrawImperativeAPI): void;
}

/** The commands after the tools in the "More tools" menu. */
export const MENU_COMMANDS: readonly MenuCommand[] = [
    {
        id: "exportImage",
        label: "buttons.exportImage",
        keystroke: "Ctrl+Shift+E",
        group: "export",
        run: (api) => api.updateScene({ appState: { openDialog: { name: "imageExport" } } })
    },
    {
        id: "searchMenu",
        label: "search.title",
        group: "canvas",
        run: (api) => api.toggleSidebar({ name: DEFAULT_SIDEBAR, tab: SEARCH_TAB, force: true })
    },
    {
        id: "library",
        label: "toolBar.library",
        group: "canvas",
        run: (api) => api.toggleSidebar({ name: DEFAULT_SIDEBAR })
    },
    {
        id: "help",
        label: "helpDialog.title",
        keystroke: "?",
        group: "canvas",
        run: (api) => api.updateScene({ appState: { openDialog: { name: "help" } } })
    }
];
/** Shows the embed in fullscreen, as the button of its title row does while the title is hidden. */
const FULLSCREEN = "fullscreen";
/** The commands that click Excalidraw's own `button-undo` and `button-redo`. */
export const HISTORY_ACTIONS = [ "undo", "redo" ] as const;

/** The zoom level, which opens a menu with {@link ZOOM_TO_FIT} and Reset zoom. */
const ZOOM_MENU = "zoomMenu";
const ZOOM_TO_FIT = "zoomToFit";
/** The zoom that each zoom command sets, from the current one. */
export const ZOOMS: Record<string, (zoom: number) => number> = {
    zoomOut: (zoom) => zoom - ZOOM_STEP,
    resetZoom: () => 1,
    zoomIn: (zoom) => zoom + ZOOM_STEP
};

type Tool = typeof TOOLS[number];
type HistoryAction = typeof HISTORY_ACTIONS[number];
/** Excalidraw's `t()`, for a key such as `toolBar.rectangle`. */
export type Translate = (key: string) => string;

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
    rootRef: RefObject<HTMLElement | null>;
    apiRef: RefObject<ExcalidrawImperativeAPI | null>;
    /** The tools of the drawing, which the drawing adds to the toolbar of its embed. */
    tools: CanvasTools;
    /** Whether the Editable toggle of the embed is on. A read-only drawing offers the zoom only. */
    isEditable: boolean;
}

/**
 * Gives `tools` Excalidraw's tools, undo and redo, and zoom, while Excalidraw shows the drawing.
 * Renders inside `<Excalidraw>`, for its translations.
 */
export default function CanvasEmbedTools({
    rootRef, apiRef, tools, isEditable
}: CanvasEmbedToolsProps) {
    const { t, langCode } = useExcalidrawTranslation();

    useEffect(() => tools.setTranslate(t), [ tools, t, langCode ]);
    useEffect(() => tools.setEditable(isEditable), [ tools, isEditable ]);

    useEffect(() => {
        const root = rootRef.current;
        const api = apiRef.current;
        if (!root || !api) return;

        const disconnect = tools.connect(api);
        // `CanvasDrawing.css` hides Excalidraw's own controls while these replace them.
        root.setAttribute("data-embed-tools", "");
        return () => {
            root.removeAttribute("data-embed-tools");
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

/**
 * Excalidraw's tools and commands, as buttons of the toolbar of the embed with the drawing. Without
 * Excalidraw, as while the drawing shows as a picture, only fullscreen.
 */
export class CanvasTools implements ContentEmbedToolProvider {
    readonly toolbarTitle = t("note_types.canvas");
    readonly hiddenToolbarItems: readonly ContentEmbedToolbarItem[] = [
        "contentEmbedBoxSizeDropdown", "contentEmbedPositionDropdown"
    ];
    readonly hiddenToolbarItemsWhileEditable: readonly ContentEmbedToolbarItem[] = [
        "toggleContentEmbedEditable"
    ];
    readonly hasEditableFlag = true;
    readonly hasPositions = true;
    private api: ExcalidrawImperativeAPI | null = null;
    private translate: Translate | null = null;
    /** Whether the drawing can be edited, which adds the drawing tools and the history. */
    private isEditable = true;
    private listeners = new Set<() => void>();
    /** The tools as last notified, to notify the listeners only when they change. */
    private shownTools = "";

    constructor(private readonly rootRef: RefObject<HTMLElement | null>) {}

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
        const api = this.api;
        const appState = api?.getAppState();
        if (!api || !appState) {
            return this.getFullscreenTools();
        }

        const zoomTools = [
            ...this.getZoomTools(appState.zoom.value, api.getSceneElements().length > 0),
            ...this.getFullscreenTools()
        ];
        return this.isEditable
            ? [ ...this.getEditingTools(appState.activeTool), ...zoomTools ]
            : zoomTools;
    }

    execute(id: string) {
        // The embed covers the drawing with a backdrop until the drawing has the focus.
        const container = this.rootRef.current?.querySelector<HTMLElement>(".excalidraw-container");
        if (container && !container.contains(document.activeElement)) {
            container.focus({ preventScroll: true });
        }

        if (id === FULLSCREEN) {
            showContentEmbedFullscreen(this.rootRef.current);
            return;
        }

        const api = this.api;
        if (!api) return;

        const appState = api.getAppState();
        const getZoom = ZOOMS[id];
        if (getZoom) {
            showView(api, appState, getZoomState(appState, getZoom(appState.zoom.value)));
        } else if (id === ZOOM_TO_FIT) {
            const view = getZoomToFitView(api.getSceneElements(), appState.width, appState.height);
            if (view) {
                showView(api, appState, view);
            }
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

    /** The lock, no tool, the drawing tools with the menu commands, undo and redo. */
    private getEditingTools(activeTool: AppState["activeTool"]): ContentEmbedTool[] {
        return [
            {
                id: LOCK,
                label: this.t("toolBar.lock"),
                icon: ICONS[LOCK],
                isOn: activeTool.locked,
                group: "lock"
            },
            {
                id: NO_TOOL_ID,
                label: t("canvas.no_tool"),
                icon: noToolIcon,
                isOn: isNoTool(activeTool),
                group: "tools"
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
                children: [
                    ...EXTRA_TOOLS.map((type) => ({
                        id: type,
                        label: this.t(`toolBar.${type}`),
                        icon: ICONS[type],
                        isOn: activeTool.type === type
                    })),
                    ...MENU_COMMANDS.map(({ id, label, keystroke, group }) => ({
                        id, label: this.t(label), keystroke, group
                    }))
                ]
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
        if (!needsFullscreenButton(this.rootRef.current?.closest<HTMLElement>(".include-note"))) {
            return [];
        }

        return [
            { id: FULLSCREEN, label: t("common.fullscreen"), icon: fullscreenIcon, group: "zoom" }
        ];
    }

    /**
     * Zoom out, the zoom level with its menu, and zoom in. Zoom to fit is enabled while the drawing
     * `hasContent`.
     */
    private getZoomTools(zoom: number, hasContent: boolean): ContentEmbedTool[] {
        return [
            {
                id: "zoomOut",
                label: this.t("buttons.zoomOut"),
                icon: zoomOutIcon,
                isEnabled: zoom > MIN_ZOOM,
                group: "zoom"
            },
            {
                id: ZOOM_MENU,
                label: t("canvas.zoom"),
                text: `${Math.round(zoom * 100)}%`,
                class: "canvas-drawing-zoom-level",
                group: "zoom",
                children: [
                    { id: ZOOM_TO_FIT, label: t("canvas.zoom_to_fit"), isEnabled: hasContent },
                    { id: "resetZoom", label: this.t("buttons.resetZoom") }
                ]
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

    /** Runs the lock, no tool, a drawing tool, a menu command, undo or redo. */
    private runEditingTool(api: ExcalidrawImperativeAPI, appState: AppState, id: string) {
        const command = MENU_COMMANDS.find((menuCommand) => menuCommand.id === id);
        if (command) {
            command.run(api);
        } else if (id === "undo" || id === "redo") {
            this.getHistoryButton(id)?.click();
        } else if (id === LOCK) {
            const locked = !appState.activeTool.locked;
            api.updateScene({ appState: { activeTool: { ...appState.activeTool, locked } } });
        } else if (id === NO_TOOL_ID) {
            api.setActiveTool(NO_TOOL);
        } else if (isTool(id)) {
            api.setActiveTool({ type: id });
        }
    }

    /**
     * Undo or redo, enabled while Excalidraw's button is. In a text note, the button undoes and
     * redoes the changes of the note (`DrawingHistory`).
     */
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

/** Whether `activeTool` is {@link NO_TOOL}. */
export function isNoTool(activeTool: AppState["activeTool"]) {
    return activeTool.type === "custom" && activeTool.customType === NO_TOOL.customType;
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

/** Shows `view` of the drawing, kept inside the locked image under it, if any. */
function showView(api: ExcalidrawImperativeAPI, appState: AppState, view: DrawingView) {
    const boundedView = getBoundedView(api.getSceneElements(), { ...appState, ...view });
    api.updateScene({ appState: boundedView ?? view });
}
