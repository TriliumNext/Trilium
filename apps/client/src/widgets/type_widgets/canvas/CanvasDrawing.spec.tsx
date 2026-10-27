import { exportToSvg } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { type ComponentChildren, type RefObject, render, toChildArray, type VNode } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import type { ContentEditor } from "../../../services/content_renderer";
import LoadResults from "../../../services/load_results";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import { getContentEmbedTools } from "../text/content_embed_tools";

interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

vi.mock("@excalidraw/excalidraw", () => ({
    exportToSvg: vi.fn(),
    getCommonBounds: (elements: Box[]) => [
        Math.min(...elements.map(({ x }) => x)),
        Math.min(...elements.map(({ y }) => y)),
        Math.max(...elements.map(({ x, width }) => x + width)),
        Math.max(...elements.map(({ y, height }) => y + height))
    ]
}));
// happy-dom lays nothing out: every picture of a drawing has a box of 400 × 200.
vi.mock("../../react/hooks", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../react/hooks")>(),
    useElementSize: () => ({ width: 400, height: 200 })
}));
vi.mock("./Canvas", () => ({ CanvasEditor: MockCanvasEditor }));
vi.mock("./persistence", () => ({
    useCanvasDrawingPersistence: (...args: unknown[]) => {
        persistenceArgs(...args);
        return {};
    },
    parseContent: (content: string) => JSON.parse(content),
    loadDrawingFiles: async () => ({ files: {}, referencedFileIds: new Set() }),
    exportDrawingPicture
}));
const { detailEditor, exportDrawingPicture } = vi.hoisted(() => ({
    detailEditor: { canEdit: () => true, release: vi.fn() },
    exportDrawingPicture: vi.fn(async (_scene: unknown, _files: unknown, _isDark: boolean) =>
        document.createElementNS("http://www.w3.org/2000/svg", "svg"))
}));
vi.mock("../text/attachment_saves", () => ({
    useAttachmentEditor: () => detailEditor
}));

const canvasEditorProps = vi.fn();
const persistenceArgs = vi.fn();
const canvasApi = { scrollToContent: vi.fn() };

interface MockCanvasEditorProps {
    apiRef?: RefObject<unknown>;
    isDesktopLayout?: boolean;
    isReadOnly?: boolean;
    persistence?: { onChange?: (...args: unknown[]) => void };
    children?: ComponentChildren;
}

/** The options that `LiveDrawing` gives its persistence. */
interface PersistenceOptions {
    initialView?: unknown;
    onSceneShown?: () => void;
}

/** Renders Excalidraw's focusable container after a render, as once its language loads. */
function MockCanvasEditor(props: MockCanvasEditorProps) {
    canvasEditorProps(props);
    const [ isLoaded, setIsLoaded ] = useState(false);
    useEffect(() => setIsLoaded(true), []);
    return isLoaded ? <div className="excalidraw" tabIndex={0} /> : <span className="loading" />;
}

// happy-dom has no ResizeObserver; the spec runs the callback itself.
let resizeCallback: (() => void) | undefined;
globalThis.ResizeObserver = class {
    constructor(callback: () => void) {
        resizeCallback = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;

const {
    default: CanvasDrawing, CanvasDrawingDetail, renderCanvasDrawingPicture, useIsToolbarOverPanel,
    useNoteScrollingWheel, useSidePanels, useTopLayerContextMenu
} = await import("./CanvasDrawing");
const { default: CanvasDrawingMenu } = await import("./CanvasDrawingMenu");
const { default: CanvasEmbedTools } = await import("./CanvasEmbedTools");
const { getBoundedView } = await import("./drawing_view");

/** Horizontal edges by class name; happy-dom computes no layout. */
const edges: Record<string, { left: number; right: number }> = {
    "App-toolbar-container": { left: 200, right: 800 }
};

function Probe() {
    const rootRef = useRef<HTMLDivElement>(null);
    const isOver = useIsToolbarOverPanel(rootRef);
    return (
        <div ref={rootRef} className="probe" data-over={String(isOver)}>
            <div className="App-toolbar-container" />
        </div>
    );
}

describe("useIsToolbarOverPanel", () => {
    let container: HTMLElement;

    beforeEach(() => {
        vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
            const box = edges[this.className] ?? { left: 0, right: 0 };
            return { ...box, top: 0, bottom: 0, width: box.right - box.left, height: 0 } as DOMRect;
        });
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        vi.restoreAllMocks();
    });

    async function mountPanel(left: number) {
        edges["App-menu__left"] = { left, right: left + 210 };
        await act(async () => {
            render(<Probe />, container);
        });
        const root = container.querySelector(".probe");
        expect(root?.getAttribute("data-over")).toBe("false");

        const panel = document.createElement("div");
        panel.className = "App-menu__left";
        await act(async () => {
            root?.append(panel);
            await Promise.resolve();
        });
        return root;
    }

    it("tells when the panel that mounts sits under the toolbar", async () => {
        const root = await mountPanel(700);
        expect(root?.getAttribute("data-over")).toBe("true");
    });

    it("leaves the panel at the top while it clears the toolbar, and follows resizes", async () => {
        const root = await mountPanel(810);
        expect(root?.getAttribute("data-over")).toBe("false");

        edges["App-menu__left"] = { left: 790, right: 1000 };
        await act(async () => resizeCallback?.());
        expect(root?.getAttribute("data-over")).toBe("true");
    });
});

describe("useSidePanels", () => {
    /** Boxes by class name, in pixels; happy-dom computes no layout. */
    const rects: Record<string, { left: number; top: number; right: number; bottom: number }> = {};
    let container: HTMLElement;
    let showPopover: ReturnType<typeof vi.fn>;

    function SidePanelProbe({ isEnabled, hasLibrary }: {
        isEnabled: boolean;
        hasLibrary: boolean;
    }) {
        const rootRef = useRef<HTMLDivElement>(null);
        useSidePanels(rootRef, isEnabled);
        return (
            <div className="scrolling-container">
                <div className="include-note-body active">
                    <div ref={rootRef} className="drawing">
                        {hasLibrary && <div className="Island sidebar default-sidebar" />}
                        <div className="App-menu__left" />
                    </div>
                </div>
            </div>
        );
    }

    beforeEach(() => {
        // A window of 1280 × 900 and a 1rem of 16px. The note area of the split is 750 × 700,
        // from 240 to 990 and from 100 to 800.
        Object.defineProperties(document.documentElement, {
            clientWidth: { value: 1280, configurable: true },
            clientHeight: { value: 900, configurable: true }
        });
        rects["scrolling-container"] = { left: 240, top: 100, right: 1000, bottom: 800 };
        rects.drawing = { left: 340, top: 200, right: 840, bottom: 520 };
        vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
            .mockImplementation(function (this: HTMLElement) {
                const { left, top, right, bottom } = rects[this.className] ?? rects.drawing;
                const size = { width: right - left, height: bottom - top };
                return { left, top, right, bottom, ...size } as DOMRect;
            });
        vi.spyOn(window, "getComputedStyle")
            .mockReturnValue({ fontSize: "16px" } as CSSStyleDeclaration);
        // happy-dom has no Popover API.
        showPopover = vi.fn();
        Object.defineProperty(HTMLElement.prototype, "showPopover", {
            value: showPopover,
            configurable: true
        });
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        vi.restoreAllMocks();
        Reflect.deleteProperty(HTMLElement.prototype, "showPopover");
        Reflect.deleteProperty(document.documentElement, "clientWidth");
        Reflect.deleteProperty(document.documentElement, "clientHeight");
        Reflect.deleteProperty(document, "fullscreenElement");
    });

    async function mount(panelHeight: number, hasLibrary = false) {
        await act(async () => {
            render(<SidePanelProbe isEnabled={false} hasLibrary={hasLibrary} />, container);
        });
        const viewport = container.querySelector(".scrolling-container");
        const body = container.querySelector(".include-note-body");
        const panel = container.querySelector<HTMLElement>(".App-menu__left");
        const library = container.querySelector<HTMLElement>(".default-sidebar");
        if (!viewport || !body || !panel) {
            throw new Error("Expected the probe.");
        }
        Object.defineProperties(viewport, {
            clientWidth: { value: 750 },
            clientHeight: { value: 700 }
        });
        Object.defineProperties(panel, {
            offsetWidth: { value: 200 },
            offsetHeight: { value: panelHeight, configurable: true }
        });
        if (library) {
            Object.defineProperty(library, "offsetWidth", { value: 200 });
        }

        await act(async () => {
            render(<SidePanelProbe isEnabled hasLibrary={hasLibrary} />, container);
        });
        return { viewport, body, panel, library };
    }

    /** The position of `panel` beside the drawing, or `false` while it is in the drawing. */
    function getPlacement(panel: HTMLElement | null) {
        const isPlaced = !!panel?.hasAttribute("data-side-panel");
        expect(panel?.getAttribute("popover") ?? null).toBe(isPlaced ? "manual" : null);
        return isPlaced && [ "left", "top", "max-height" ]
            .map((name) => panel?.style.getPropertyValue(`--side-panel-${name}`));
    }

    it("places the panel level with the drawing's top, on its right or else its left", async () => {
        const { viewport, panel } = await mount(300);
        expect(getPlacement(panel)).toEqual([ "848px", "200px", "884px" ]);

        rects.drawing = { left: 340, top: 200, right: 1100, bottom: 520 };
        viewport.dispatchEvent(new Event("scroll"));
        expect(getPlacement(panel)).toEqual([ "132px", "200px", "884px" ]);
        expect(showPopover).toHaveBeenCalledTimes(1);
    });

    it("places the library first, as tall as the drawing, the panel on a free side", async () => {
        const { viewport, panel, library } = await mount(300, true);
        expect(getPlacement(library)).toEqual([ "848px", "200px", "884px" ]);
        expect(library?.style.getPropertyValue("--side-panel-height")).toBe("320px");
        expect(getPlacement(panel)).toEqual([ "132px", "200px", "884px" ]);
        expect(panel.style.getPropertyValue("--side-panel-height")).toBe("");

        // A drawing of 160px gives the library its least height of 20rem.
        rects.drawing = { left: 340, top: 200, right: 1100, bottom: 360 };
        viewport.dispatchEvent(new Event("scroll"));
        expect(getPlacement(library)).toEqual([ "132px", "200px", "884px" ]);
        expect(library?.style.getPropertyValue("--side-panel-height")).toBe("320px");
        expect(getPlacement(panel)).toBe(false);

        rects.drawing = { left: 340, top: 100, right: 840, bottom: 1100 };
        viewport.dispatchEvent(new Event("scroll"));
        expect(getPlacement(library)).toEqual([ "848px", "8px", "884px" ]);
        expect(library?.style.getPropertyValue("--side-panel-height")).toBe("884px");
        expect(getPlacement(panel)).toEqual([ "132px", "100px", "884px" ]);
    });

    it("keeps the panel inside the window while the note scrolls", async () => {
        const { viewport, panel } = await mount(300);

        rects.drawing = { left: 340, top: -50, right: 840, bottom: 270 };
        viewport.dispatchEvent(new Event("scroll"));
        expect(getPlacement(panel)).toEqual([ "848px", "8px", "884px" ]);

        rects.drawing = { left: 340, top: 700, right: 840, bottom: 1020 };
        viewport.dispatchEvent(new Event("scroll"));
        expect(getPlacement(panel)).toEqual([ "848px", "592px", "884px" ]);

        Object.defineProperty(panel, "offsetHeight", { value: 1000 });
        viewport.dispatchEvent(new Event("scroll"));
        expect(getPlacement(panel)).toEqual([ "848px", "8px", "884px" ]);
    });

    it("keeps the panel in the drawing without room beside it or out of view", async () => {
        const { viewport, panel } = await mount(300);

        rects.drawing = { left: 100, top: 200, right: 1100, bottom: 520 };
        viewport.dispatchEvent(new Event("scroll"));
        expect(getPlacement(panel)).toBe(false);

        // Inside the window, but scrolled out of the note area.
        rects.drawing = { left: 340, top: 810, right: 840, bottom: 1130 };
        viewport.dispatchEvent(new Event("scroll"));
        expect(getPlacement(panel)).toBe(false);

        rects.drawing = { left: 340, top: -300, right: 840, bottom: 90 };
        viewport.dispatchEvent(new Event("scroll"));
        expect(getPlacement(panel)).toBe(false);

        rects.drawing = { left: 340, top: 200, right: 840, bottom: 520 };
        viewport.dispatchEvent(new Event("scroll"));
        expect(getPlacement(panel)).not.toBe(false);
        expect(showPopover).toHaveBeenCalledTimes(2);

        await act(async () => {
            render(<SidePanelProbe isEnabled={false} hasLibrary={false} />, container);
        });
        expect(getPlacement(panel)).toBe(false);
    });

    it("keeps the panel in the drawing without the focus or in fullscreen", async () => {
        const { body, panel } = await mount(300);

        await act(async () => body.classList.remove("active"));
        expect(getPlacement(panel)).toBe(false);

        await act(async () => body.classList.add("active"));
        expect(getPlacement(panel)).not.toBe(false);

        Object.defineProperty(document, "fullscreenElement", {
            value: container,
            configurable: true
        });
        document.dispatchEvent(new Event("fullscreenchange"));
        expect(getPlacement(panel)).toBe(false);
    });
});

describe("useTopLayerContextMenu", () => {
    type ContextMenuState = { top: number; left: number } | null;

    let container: HTMLElement;
    let showPopover: ReturnType<typeof vi.fn>;
    let contextMenu: ContextMenuState;
    let drawing: { left: number; top: number };
    let menuSize: { width: number; height: number };
    const api = {
        getAppState: () => ({ contextMenu }),
        updateScene: vi.fn(({ appState }: { appState: { contextMenu: ContextMenuState } }) => {
            contextMenu = appState.contextMenu;
        })
    };

    function ContextMenuProbe() {
        const rootRef = useRef<HTMLDivElement>(null);
        const apiRef = useRef(api as unknown as ExcalidrawImperativeAPI);
        useTopLayerContextMenu(rootRef, apiRef);
        return (
            <div className="scrolling-container">
                <div ref={rootRef}>
                    <div className="excalidraw excalidraw-container" tabIndex={0} />
                </div>
            </div>
        );
    }

    beforeEach(async () => {
        // A window of 1280 × 900 and a 1rem of 16px.
        Object.defineProperties(document.documentElement, {
            clientWidth: { value: 1280, configurable: true },
            clientHeight: { value: 900, configurable: true }
        });
        contextMenu = null;
        drawing = { left: 340, top: 200 };
        menuSize = { width: 200, height: 500 };
        vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
            .mockImplementation(function (this: HTMLElement) {
                const box = this.classList.contains("popover")
                    ? { left: 0, top: 0, ...menuSize }
                    : { ...drawing, width: 500, height: 320 };
                const edges = { right: box.left + box.width, bottom: box.top + box.height };
                return { ...box, ...edges } as DOMRect;
            });
        vi.spyOn(window, "getComputedStyle")
            .mockReturnValue({ fontSize: "16px" } as CSSStyleDeclaration);
        // happy-dom has no Popover API.
        showPopover = vi.fn();
        Object.defineProperty(HTMLElement.prototype, "showPopover", {
            value: showPopover,
            configurable: true
        });
        api.updateScene.mockClear();
        container = document.createElement("div");
        document.body.appendChild(container);
        await act(async () => {
            render(<ContextMenuProbe />, container);
        });
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        vi.restoreAllMocks();
        Reflect.deleteProperty(HTMLElement.prototype, "showPopover");
        Reflect.deleteProperty(document.documentElement, "clientWidth");
        Reflect.deleteProperty(document.documentElement, "clientHeight");
    });

    /** Opens the menu at `left` and `top` in the drawing, as fitted in it by Excalidraw. */
    async function openMenu(left: number, top: number) {
        container.querySelector(".popover")?.remove();
        contextMenu = { left, top };
        const menu = document.createElement("div");
        menu.className = "popover";
        menu.tabIndex = -1;
        menu.style.cssText = `left: ${left}px; top: 10px; height: 300px; overflow-y: scroll;`;
        menu.innerHTML = `<ul class="context-menu"><li></li></ul>`;
        await act(async () => {
            container.querySelector(".excalidraw-container")?.append(menu);
            await Promise.resolve();
        });
        return menu;
    }

    /** The place and the size of `menu`, empty where Excalidraw's own style is gone. */
    function getStyle(menu: HTMLElement) {
        expect(menu.getAttribute("popover")).toBe("manual");
        const { left, top, width, height, overflowX, overflowY } = menu.style;
        return { left, top, width, height, overflowX, overflowY };
    }

    const FREE = { width: "", height: "", overflowX: "", overflowY: "" };

    it("shows the menu at its point in the window, moved up or left into the window", async () => {
        const menu = await openMenu(100, 50);
        expect(getStyle(menu)).toEqual({ left: "440px", top: "250px", ...FREE });
        expect(showPopover).toHaveBeenCalledTimes(1);

        // 450 + 500 reaches past the bottom edge of 892.
        expect(getStyle(await openMenu(450, 250)))
            .toEqual({ left: "790px", top: "392px", ...FREE });

        drawing = { left: 1000, top: 200 };
        expect(getStyle(await openMenu(250, 50)))
            .toEqual({ left: "1072px", top: "250px", ...FREE });
        expect(showPopover).toHaveBeenCalledTimes(3);
    });

    it("places the menu once for each opening, which Excalidraw can render in place", async () => {
        const menu = await openMenu(100, 50);
        menu.style.left = "0px";
        await act(async () => {
            menu.querySelector("ul")?.append(document.createElement("li"));
            await Promise.resolve();
        });
        expect(menu.style.left).toBe("0px");

        contextMenu = { left: 200, top: 50 };
        await act(async () => {
            menu.querySelector("ul")?.append(document.createElement("li"));
            await Promise.resolve();
        });
        expect(getStyle(menu)).toEqual({ left: "540px", top: "250px", ...FREE });
    });

    it("shrinks a menu larger than the window, and scrolls it", async () => {
        menuSize = { width: 1300, height: 1000 };
        expect(getStyle(await openMenu(100, 50))).toEqual({
            left: "8px",
            top: "8px",
            width: "1264px",
            height: "884px",
            overflowX: "auto",
            overflowY: "auto"
        });
    });

    it("closes the menu when the note scrolls, keeping the focus in the drawing", async () => {
        const menu = await openMenu(100, 50);
        menu.focus();
        const elsewhere = document.createElement("div");
        document.body.append(elsewhere);

        menu.dispatchEvent(new Event("scroll"));
        elsewhere.dispatchEvent(new Event("scroll"));
        expect(api.updateScene).not.toHaveBeenCalled();

        container.querySelector(".scrolling-container")?.dispatchEvent(new Event("scroll"));
        expect(api.updateScene)
            .toHaveBeenCalledExactlyOnceWith({ appState: { contextMenu: null } });
        expect(document.activeElement).toBe(container.querySelector(".excalidraw-container"));

        // Nothing is left to close.
        document.dispatchEvent(new Event("scroll"));
        expect(api.updateScene).toHaveBeenCalledTimes(1);
        elsewhere.remove();
    });
});

describe("useNoteScrollingWheel", () => {
    let container: HTMLElement;

    function WheelProbe() {
        const rootRef = useRef<HTMLDivElement>(null);
        useNoteScrollingWheel(rootRef);
        return <div ref={rootRef}><div className="excalidraw-container"><canvas /></div></div>;
    }

    beforeEach(async () => {
        container = document.createElement("div");
        document.body.append(container);
        await act(async () => render(<WheelProbe />, container));
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        Reflect.deleteProperty(document, "fullscreenElement");
    });

    /** Whether Excalidraw's container gets a wheel over the drawing that the page can scroll. */
    function reachesDrawing(init: WheelEventInit = {}) {
        const excalidraw = container.querySelector(".excalidraw-container");
        const canvas = container.querySelector("canvas");
        if (!excalidraw || !canvas) {
            throw new Error("Expected the drawing.");
        }
        const listener = vi.fn();
        excalidraw.addEventListener("wheel", listener);
        const event = new WheelEvent("wheel", {
            bubbles: true, cancelable: true, deltaY: 100, ...init
        });
        // happy-dom's `WheelEvent` extends `UIEvent`, which has no modifier keys.
        Object.defineProperties(event, {
            ctrlKey: { value: !!init.ctrlKey },
            metaKey: { value: !!init.metaKey },
            shiftKey: { value: !!init.shiftKey }
        });
        canvas.dispatchEvent(event);
        excalidraw.removeEventListener("wheel", listener);
        expect(event.defaultPrevented).toBe(false);
        return listener.mock.calls.length > 0;
    }

    it("gives the wheel over the drawing to the note, with any modifier key", () => {
        expect(reachesDrawing()).toBe(false);
        expect(reachesDrawing({ shiftKey: true, deltaY: 0, deltaX: 100 })).toBe(false);
        expect(reachesDrawing({ ctrlKey: true })).toBe(false);
        expect(reachesDrawing({ metaKey: true })).toBe(false);
    });

    it("leaves the wheel to a drawing in fullscreen", () => {
        Object.defineProperty(document, "fullscreenElement", {
            value: container.firstElementChild,
            configurable: true
        });
        expect(reachesDrawing()).toBe(true);
        expect(reachesDrawing({ ctrlKey: true })).toBe(true);
    });
});

describe("CanvasDrawing", () => {
    const SCENE = JSON.stringify({ elements: [ { x: 50, y: 30, width: 200, height: 100 } ] });
    const ATTACHMENT = {
        attachmentId: "a1",
        getBlob: async () => ({ content: sceneContent })
    } as never;
    const EDITOR = {
        canEdit: () => true,
        release: vi.fn(),
        getUnsavedContent: () => undefined
    } as unknown as ContentEditor;
    let box: HTMLElement;
    let sceneContent: string;

    beforeEach(() => {
        sceneContent = SCENE;
        vi.mocked(exportToSvg).mockReset().mockImplementation(async () => {
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("width", "200");
            svg.setAttribute("height", "100");
            return svg;
        });
        box = document.createElement("div");
        box.className = "include-note-content";
        box.tabIndex = -1;
        document.body.appendChild(box);
    });

    afterEach(() => {
        render(null, box);
        box.remove();
    });

    /** Mounts the drawing, which `editor` saves, or none for `null`. */
    async function mount(editor: ContentEditor | null = EDITOR) {
        await act(async () => {
            render(<CanvasDrawing attachment={ATTACHMENT} editor={editor ?? undefined} />, box);
        });
        return box.querySelector(".excalidraw");
    }

    /** Whether the last `CanvasEditor` is read-only, and what its menu and its tools can edit. */
    function getEditingState() {
        const props = canvasEditorProps.mock.lastCall?.[0] as MockCanvasEditorProps | undefined;
        const children = toChildArray(props?.children) as VNode<{ isEditable?: boolean }>[];
        const getIsEditable = (type: unknown) =>
            children.find((child) => child.type === type)?.props.isEditable;
        return {
            isReadOnly: props?.isReadOnly,
            menu: getIsEditable(CanvasDrawingMenu),
            tools: getIsEditable(CanvasEmbedTools)
        };
    }

    /** Sets or removes `data-editable`, as the Editable toggle of the embed does. */
    async function setEmbedEditable(embed: HTMLElement, isEditable: boolean) {
        await act(async () => {
            if (isEditable) {
                embed.setAttribute("data-editable", "true");
            } else {
                embed.removeAttribute("data-editable");
            }
            await Promise.resolve();
        });
    }

    it("edits in Excalidraw while its embed is editable, else shows a picture", async () => {
        const embed = document.createElement("figure");
        embed.className = "include-note";
        embed.setAttribute("data-editable", "true");
        embed.append(box);
        document.body.append(embed);
        const getPicture = () => box.querySelector(".canvas-drawing-view");
        const getExcalidraw = () => box.querySelector(".excalidraw");
        sceneContent = JSON.stringify({
            elements: [ { x: 50, y: 30, width: 200, height: 100 } ],
            appState: { zoom: { value: 1 }, scrollX: 0, scrollY: 0 }
        });

        await mount();
        expect(getEditingState()).toEqual({ isReadOnly: false, menu: true, tools: true });
        expect(getPicture()).toBeNull();
        await new Promise(requestAnimationFrame);
        expect(exportToSvg).not.toHaveBeenCalled();
        expect(getContentEmbedTools(embed)?.hasEditableFlag).toBe(true);

        // Excalidraw stays, read-only, until the picture of the drawing shows at the same view.
        const options = persistenceArgs.mock.lastCall?.[4] as PersistenceOptions;
        // Excalidraw counts as drawn on the frame after it shows the scene.
        await act(async () => {
            options.onSceneShown?.();
            await new Promise(requestAnimationFrame);
        });
        const { onChange } = (canvasEditorProps.mock.lastCall?.[0] as MockCanvasEditorProps)
            .persistence ?? {};
        onChange?.([], { zoom: { value: 2 }, scrollX: 10, scrollY: 20 }, {});
        await setEmbedEditable(embed, false);
        expect(getEditingState().isReadOnly).toBe(true);
        expect(getPicture()).not.toBeNull();
        await vi.waitFor(() => expect(getExcalidraw()).toBeNull());
        expect(box.querySelector<SVGElement>(".canvas-drawing-view > svg")?.style.left)
            .toBe("120px");
        expect(getContentEmbedTools(embed)?.hasEditableFlag).toBe(true);

        // The picture stays until Excalidraw shows the drawing, opened at the view of the picture.
        await setEmbedEditable(embed, true);
        expect(getExcalidraw()).not.toBeNull();
        expect(getPicture()).not.toBeNull();
        const reopened = persistenceArgs.mock.lastCall?.[4] as PersistenceOptions;
        expect(reopened.initialView).toEqual({ zoom: { value: 2 }, scrollX: 10, scrollY: 20 });
        await act(async () => reopened.onSceneShown?.());
        await vi.waitFor(() => expect(getPicture()).toBeNull());

        // An attachment that the note cannot save shows as a picture, with no toggle to offer.
        render(null, box);
        persistenceArgs.mockClear();
        await mount({ ...EDITOR, canEdit: () => false });
        await vi.waitFor(() => expect(box.querySelector(".canvas-drawing-view > svg"))
            .not.toBeNull());
        expect(getExcalidraw()).toBeNull();
        expect(persistenceArgs).not.toHaveBeenCalled();
        expect(getContentEmbedTools(embed)).toBeNull();
        embed.remove();
    });

    it("shows the picture at the saved view, else fit, on the drawing's background", async () => {
        sceneContent = JSON.stringify({
            elements: [ { x: 50, y: 30, width: 200, height: 100 } ],
            appState: {
                zoom: { value: 2 }, scrollX: 10, scrollY: 20, viewBackgroundColor: "#ffc9c9"
            }
        });
        await mount(null);
        const layer = box.querySelector<HTMLElement>(".canvas-drawing-view");
        const svg = await vi.waitFor(() => {
            const shown = box.querySelector<SVGElement>(".canvas-drawing-view > svg");
            if (!shown) throw new Error("Expected the picture.");
            return shown;
        });
        // At (50 + 10) × 2 and (30 + 20) × 2, twice the 200 × 100 of the shapes.
        expect([ svg.style.left, svg.style.top, svg.style.width, svg.style.height ])
            .toEqual([ "120px", "100px", "400px", "200px" ]);
        expect(layer?.style.getPropertyValue("--canvas-drawing-view-background")).toBe("#ffc9c9");
        expect(vi.mocked(exportToSvg)).toHaveBeenLastCalledWith(expect.objectContaining({
            appState: expect.objectContaining({ exportBackground: false }),
            exportPadding: 0
        }));

        // Without a saved view, fit in the 400 × 200 box, centered.
        render(null, box);
        sceneContent = JSON.stringify({ elements: [ { x: 50, y: 30, width: 200, height: 100 } ] });
        await mount(null);
        await vi.waitFor(() => expect(box.querySelector<SVGElement>(".canvas-drawing-view > svg")
            ?.style.left).toBe("0px"));
        const fitted = box.querySelector<SVGElement>(".canvas-drawing-view > svg");
        expect([ fitted?.style.top, fitted?.style.width, fitted?.style.height ])
            .toEqual([ "0px", "400px", "200px" ]);

        // A saved view past the left edge of the image of an image canvas moves back inside it.
        render(null, box);
        sceneContent = JSON.stringify({
            elements: [ { type: "image", locked: true, x: 0, y: 0, width: 800, height: 400 } ],
            appState: { zoom: { value: 1 }, scrollX: 100, scrollY: 0 }
        });
        await mount(null);
        await vi.waitFor(() => expect(box.querySelector<SVGElement>(".canvas-drawing-view > svg")
            ?.style.left).toBe("600px"));
    });

    it("centers the picture once fullscreen changes its size, as Excalidraw does", async () => {
        sceneContent = JSON.stringify({
            elements: [ { x: 50, y: 30, width: 200, height: 100 } ],
            appState: { zoom: { value: 2 }, scrollX: 10, scrollY: 20 }
        });
        await mount(null);
        const getSvg = () => box.querySelector<SVGElement>(".canvas-drawing-view > svg");
        await vi.waitFor(() => expect(getSvg()?.style.left).toBe("120px"));
        vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
            .mockReturnValue({ width: 400, height: 200 } as DOMRect);

        await act(async () => {
            box.dispatchEvent(new Event("enterFullscreen", { bubbles: true }));
        });

        // The center of the shapes, (150, 80), in the middle of the 400 × 200 box at zoom 2.
        expect([ getSvg()?.style.left, getSvg()?.style.top ]).toEqual([ "0px", "0px" ]);
        vi.restoreAllMocks();
    });

    it("renders the picture again when the drawing saves, and not for other saves", async () => {
        const parent = new Component();
        await act(async () => {
            render(
                <ParentComponent.Provider value={parent}>
                    <CanvasDrawing attachment={ATTACHMENT} />
                </ParentComponent.Provider>,
                box
            );
        });
        await vi.waitFor(() => expect(exportToSvg).toHaveBeenCalledTimes(1));

        const save = async (attachmentId: string) => {
            const loadResults = new LoadResults([]);
            loadResults.addAttachmentRow({ attachmentId } as never, "any");
            await act(async () => {
                await parent.handleEvent("entitiesReloaded", { loadResults });
            });
        };
        await save("other");
        sceneContent = JSON.stringify({ elements: [ { x: 0, y: 0, width: 10, height: 10 } ] });
        await save("a1");
        await vi.waitFor(() => expect(exportToSvg).toHaveBeenCalledTimes(2));
        await save("a1");
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(exportToSvg).toHaveBeenCalledTimes(2);
    });

    it("is editable outside an embed, which has no Editable toggle", async () => {
        await mount({ canEdit: () => true, release: vi.fn() } as unknown as ContentEditor);
        expect(getEditingState()).toEqual({ isReadOnly: false, menu: true, tools: true });
    });

    it("gives the wheel over the drawing to the note", async () => {
        await mount();
        const excalidraw = box.querySelector(".excalidraw");
        if (!excalidraw) {
            throw new Error("Expected the editor.");
        }
        const listener = vi.fn();
        excalidraw.addEventListener("wheel", listener);

        excalidraw.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 100 }));

        expect(listener).not.toHaveBeenCalled();
    });

    it("centers the drawing after a change of fullscreen, hidden until then", async () => {
        await mount();
        const root = box.querySelector(".canvas-drawing-editor");
        const isHidden = () => !!root?.classList.contains("recentering");
        const { apiRef } = canvasEditorProps.mock.lastCall?.[0] as MockCanvasEditorProps;
        if (!apiRef) {
            throw new Error("Expected the API reference of the editor.");
        }
        apiRef.current = canvasApi;
        canvasApi.scrollToContent.mockClear();
        const other = document.createElement("div");
        document.body.append(other);

        for (const name of [ "enterFullscreen", "leaveFullscreen" ]) {
            await act(async () => {
                other.dispatchEvent(new Event("fullscreenChangeStart", { bubbles: true }));
            });
            expect(isHidden()).toBe(false);
            await act(async () => {
                box.dispatchEvent(new Event("fullscreenChangeStart", { bubbles: true }));
            });
            expect(isHidden()).toBe(true);

            await act(async () => {
                box.dispatchEvent(new Event(name, { bubbles: true }));
                other.dispatchEvent(new Event(name, { bubbles: true }));
            });
            // Shown again once Excalidraw drew the centered view, on the next frame.
            expect(isHidden()).toBe(true);
            await vi.waitFor(() => expect(isHidden()).toBe(false));
        }
        expect(canvasApi.scrollToContent).toHaveBeenCalledTimes(2);
        expect(canvasApi.scrollToContent).toHaveBeenCalledWith();
        apiRef.current = null;
        other.remove();
    });

    it("takes the focus that its embed box holds once Excalidraw renders", async () => {
        box.focus();
        const excalidraw = await mount();
        expect(excalidraw).not.toBeNull();
        await vi.waitFor(() => expect(document.activeElement).toBe(excalidraw));
    });

    it("leaves the focus anywhere else alone", async () => {
        const editable = document.createElement("div");
        editable.tabIndex = 0;
        document.body.appendChild(editable);
        editable.focus();

        await mount();
        expect(document.activeElement).toBe(editable);
        editable.remove();
    });

    it("edits the drawing in the detail of its attachment unless its note is read-only", async () => {
        async function mountDetail(title: string, labels: Record<string, string> = {}) {
            const note = buildNote({ title, ...labels });
            await act(async () => {
                render(<CanvasDrawingDetail attachment={ATTACHMENT} note={note} />, box);
            });
        }

        await mountDetail("Owner");
        expect(getEditingState()).toEqual({ isReadOnly: false, menu: true, tools: undefined });
        expect(canvasEditorProps).toHaveBeenLastCalledWith(
            expect.objectContaining({ constrainView: getBoundedView })
        );
        const detailDrawingEditor = persistenceArgs.mock.lastCall?.[1] as ContentEditor;
        detailDrawingEditor.release();
        expect(detailEditor.release).toHaveBeenCalledWith("a1");

        render(null, box);
        await mountDetail("Locked owner", { "#readOnly": "" });
        expect(getEditingState()).toEqual({ isReadOnly: true, menu: false, tools: undefined });
        expect(persistenceArgs).toHaveBeenLastCalledWith(
            ATTACHMENT, undefined, expect.anything(), expect.anything()
        );
    });

    it("keeps the desktop layout of Excalidraw in the desktop layout of Trilium only", async () => {
        const device = window.glob.device;
        await mount();
        expect(canvasEditorProps).toHaveBeenLastCalledWith(
            expect.objectContaining({ isDesktopLayout: true, constrainView: getBoundedView })
        );

        render(null, box);
        window.glob.device = "mobile";
        await mount();
        window.glob.device = device;
        expect(canvasEditorProps).toHaveBeenLastCalledWith(
            expect.objectContaining({ isDesktopLayout: false })
        );
    });
});

describe("renderCanvasDrawingPicture", () => {
    it("draws in the dark colors of a dark theme on screen, and in the light ones in print", async () => {
        const content = JSON.stringify({ elements: [ { id: "e1" } ], appState: {} });
        const drawing = { getBlob: async () => ({ content }) } as never;
        const { theme, device } = window.glob;

        window.glob.theme = "next-dark";
        const picture = await renderCanvasDrawingPicture(drawing);
        window.glob.device = "print";
        await renderCanvasDrawingPicture(drawing);
        window.glob.theme = "next-light";
        window.glob.device = device;
        await renderCanvasDrawingPicture(drawing);
        window.glob.theme = theme;

        expect(picture?.classList.contains("canvas-drawing-picture")).toBe(true);
        expect(exportDrawingPicture.mock.calls.map(([ , , isDark ]) => isDark))
            .toEqual([ true, false, false ]);
    });
});
