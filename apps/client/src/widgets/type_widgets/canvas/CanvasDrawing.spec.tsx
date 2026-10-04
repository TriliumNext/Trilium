import { exportToSvg } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { type ComponentChildren, type RefObject, render, toChildArray, type VNode } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AttachmentEditor } from "../../../services/content_renderer";
import { buildNote } from "../../../test/easy-froca";

vi.mock("@excalidraw/excalidraw", () => ({ exportToSvg: vi.fn() }));
vi.mock("./Canvas", () => ({ CanvasEditor: MockCanvasEditor }));
vi.mock("./persistence", () => ({
    useCanvasDrawingPersistence: (...args: unknown[]) => {
        persistenceArgs(...args);
        return {};
    },
    parseContent: (content: string) => JSON.parse(content),
    getInlineFiles: () => ({})
}));
const { detailEditor, attachmentEditorMounts, canvasEditorMounts } = vi.hoisted(() => ({
    detailEditor: { canEdit: () => true, release: () => {} },
    attachmentEditorMounts: vi.fn(),
    canvasEditorMounts: vi.fn()
}));
vi.mock("../text/attachment_saves", () => ({
    useAttachmentEditor: () => {
        useEffect(() => attachmentEditorMounts(), []);
        return detailEditor;
    }
}));

const canvasEditorProps = vi.fn();
const persistenceArgs = vi.fn();
const canvasApi = { scrollToContent: vi.fn() };

interface MockCanvasEditorProps {
    apiRef?: RefObject<unknown>;
    isDesktopLayout?: boolean;
    isReadOnly?: boolean;
    children?: ComponentChildren;
}

/** Renders Excalidraw's focusable container after a render, as once its language loads. */
function MockCanvasEditor(props: MockCanvasEditorProps) {
    canvasEditorProps(props);
    const [ isLoaded, setIsLoaded ] = useState(false);
    useEffect(() => setIsLoaded(true), []);
    useEffect(() => canvasEditorMounts(), []);
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
    useSidePanels, useTopLayerContextMenu
} = await import("./CanvasDrawing");
const { default: CanvasDrawingMenu } = await import("./CanvasDrawingMenu");
const { default: CanvasEmbedTools } = await import("./CanvasEmbedTools");

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

describe("CanvasDrawing", () => {
    const ATTACHMENT = { attachmentId: "a1" } as never;
    let box: HTMLElement;

    beforeEach(() => {
        box = document.createElement("div");
        box.className = "include-note-content";
        box.tabIndex = -1;
        document.body.appendChild(box);
    });

    afterEach(() => {
        render(null, box);
        box.remove();
    });

    async function mount(editor?: AttachmentEditor) {
        await act(async () => {
            render(<CanvasDrawing attachment={ATTACHMENT} editor={editor} />, box);
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

    it("follows the Editable toggle of its embed, saving all along", async () => {
        const editor = { canEdit: () => true, release: vi.fn() } as unknown as AttachmentEditor;
        const embed = document.createElement("figure");
        embed.className = "include-note";
        embed.setAttribute("data-editable", "true");
        embed.append(box);
        document.body.append(embed);

        await mount(editor);
        expect(getEditingState()).toEqual({ isReadOnly: false, menu: true, tools: true });

        await setEmbedEditable(embed, false);
        expect(getEditingState()).toEqual({ isReadOnly: true, menu: false, tools: false });
        expect(persistenceArgs).toHaveBeenLastCalledWith(
            ATTACHMENT, editor, expect.anything(), expect.anything()
        );

        await setEmbedEditable(embed, true);
        expect(getEditingState()).toEqual({ isReadOnly: false, menu: true, tools: true });

        // An attachment that the note cannot save is read-only, with no toggle to offer.
        render(null, box);
        await mount({ canEdit: () => false } as unknown as AttachmentEditor);
        expect(getEditingState()).toEqual({ isReadOnly: true, menu: false, tools: undefined });
        expect(persistenceArgs).toHaveBeenLastCalledWith(
            ATTACHMENT, undefined, expect.anything(), expect.anything()
        );
        embed.remove();
    });

    it("is editable outside an embed, which has no Editable toggle", async () => {
        await mount({ canEdit: () => true, release: vi.fn() } as unknown as AttachmentEditor);
        expect(getEditingState()).toEqual({ isReadOnly: false, menu: true, tools: true });
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

    it("loads the drawing again for each revision, keeping its detail editor", async () => {
        const note = buildNote({ title: "Owner" });
        const mountDetail = (revision: number) => act(async () => {
            render(
                <CanvasDrawingDetail attachment={ATTACHMENT} note={note} revision={revision} />,
                box
            );
        });
        attachmentEditorMounts.mockClear();
        canvasEditorMounts.mockClear();

        await mountDetail(0);
        await mountDetail(1);
        expect(canvasEditorMounts).toHaveBeenCalledTimes(2);
        expect(attachmentEditorMounts).toHaveBeenCalledOnce();
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
        expect(persistenceArgs).toHaveBeenLastCalledWith(
            ATTACHMENT, detailEditor, expect.anything(), expect.anything()
        );

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
            expect.objectContaining({ isDesktopLayout: true })
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
        vi.mocked(exportToSvg).mockImplementation(async () =>
            document.createElementNS("http://www.w3.org/2000/svg", "svg"));
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
        expect(vi.mocked(exportToSvg).mock.calls.map(([ { appState } ]) => appState?.exportWithDarkMode))
            .toEqual([ true, false, false ]);
    });
});
