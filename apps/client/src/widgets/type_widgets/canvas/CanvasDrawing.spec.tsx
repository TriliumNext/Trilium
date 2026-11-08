import { readFileSync } from "node:fs";
import { join } from "node:path";

import { exportToSvg } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { type ComponentChildren, type RefObject, render, toChildArray, type VNode } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import Component from "../../../components/component";
import type { ContentEditor } from "../../../services/content_renderer";
import LoadResults from "../../../services/load_results";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import { getContentEmbedTools, getEmbedFindTarget } from "../text/content_embed_tools";

interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

vi.mock("@excalidraw/excalidraw", () => ({
    CaptureUpdateAction: { NEVER: "never", EVENTUALLY: "eventually" },
    exportToSvg: vi.fn(),
    getCommonBounds: (elements: Box[]) => [
        Math.min(...elements.map(({ x }) => x)),
        Math.min(...elements.map(({ y }) => y)),
        Math.max(...elements.map(({ x, width }) => x + width)),
        Math.max(...elements.map(({ y, height }) => y + height))
    ],
    // One line, 10 pixels for each character, from the index of the match.
    getMatchedLines: (_element: unknown, query: string, index: number) => [
        { offsetX: index * 10, offsetY: 0, width: query.length * 10, height: 20 }
    ],
    getSceneVersion: (elements: readonly { version?: number }[]) =>
        elements.reduce((sum, { version }) => sum + (version ?? 0), 0)
}));
// happy-dom lays nothing out: every element measures `measured`, 400 × 200 unless a test sets it.
vi.mock("../../react/hooks", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../react/hooks")>(),
    useElementSize: () => measured.size
}));
vi.mock("./Canvas", () => ({ CanvasEditor: MockCanvasEditor }));
vi.mock("./persistence", () => ({
    useCanvasDrawingPersistence: (...args: unknown[]) => {
        persistenceArgs(...args);
        return {};
    },
    parseContent: (content: string) => JSON.parse(content),
    loadDrawingFiles: async () => ({ files: {}, referencedFileIds: new Set() }),
    exportDrawingPicture,
    saveDrawingFrame
}));
const { detailEditor, exportDrawingPicture, measured, saveDrawingFrame } = vi.hoisted(() => ({
    detailEditor: { canEdit: () => true, release: vi.fn() },
    exportDrawingPicture: vi.fn(async (_scene: unknown, _files: unknown, _isDark: boolean) =>
        document.createElementNS("http://www.w3.org/2000/svg", "svg")),
    measured: { size: { width: 400, height: 200 } },
    saveDrawingFrame: vi.fn()
}));
vi.mock("../text/attachment_saves", () => ({
    useAttachmentEditor: () => detailEditor
}));

const SELECTION_TOOL = {
    type: "selection", customType: null, locked: false, lastActiveTool: null
} as const;
const canvasEditorProps = vi.fn();
const persistenceArgs = vi.fn();
const canvasApi = {
    getSceneElements: () => [],
    getAppState: () => ({ activeTool: SELECTION_TOOL })
};

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
    initialTool?: unknown;
    isFrameBox?: boolean;
    frame?: unknown;
    isResizing?: () => boolean;
    canReframe?: () => boolean;
    onSceneShown?: () => void;
    onViewReady?: () => void;
    onViewChange?: (view: unknown) => void;
    onFrameChange?: (frame: unknown) => void;
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
    useNoteScrollingWheel, usePropertiesSheet, useSidePanels, useTopLayerContextMenu
} = await import("./CanvasDrawing");
const { default: CanvasDrawingMenu } = await import("./CanvasDrawingMenu");
const { default: CanvasEmbedTools, NO_TOOL } = await import("./CanvasEmbedTools");
const { MATCH_COLORS } = await import("./drawing_find");
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

    function SidePanelProbe({ isEnabled, hasLibrary, hasPicker = false }: {
        isEnabled: boolean;
        hasLibrary: boolean;
        hasPicker?: boolean;
    }) {
        const rootRef = useRef<HTMLDivElement>(null);
        useSidePanels(rootRef, isEnabled);
        return (
            <div className="scrolling-container">
                <div className="ck-editor__editable">
                    <div className="include-note-body active">
                        <div ref={rootRef} className="drawing">
                            {hasLibrary && <div className="Island sidebar default-sidebar" />}
                            <div className="App-menu__left" />
                            {hasPicker && (
                                <div className="picker" data-radix-popper-content-wrapper="" />
                            )}
                        </div>
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
                const { left, top, right, bottom } = rects[this.classList[0]] ?? rects.drawing;
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

    /** Mounts the probe, in a text editor whose contextual balloon is `balloon`, if given. */
    async function mount(panelHeight: number, hasLibrary = false, balloon?: HTMLElement) {
        await act(async () => {
            render(<SidePanelProbe isEnabled={false} hasLibrary={hasLibrary} />, container);
        });
        const viewport = container.querySelector(".scrolling-container");
        const editable = container.querySelector(".ck-editor__editable");
        const body = container.querySelector(".include-note-body");
        const panel = container.querySelector<HTMLElement>(".App-menu__left");
        const library = container.querySelector<HTMLElement>(".default-sidebar");
        if (!viewport || !editable || !body || !panel) {
            throw new Error("Expected the probe.");
        }
        if (balloon) {
            Object.assign(editable, {
                ckeditorInstance: { plugins: { get: () => ({ view: { element: balloon } }) } }
            });
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

    /** A contextual balloon of the text editor, hidden until `showBalloon()`. */
    function createBalloon() {
        const balloon = document.createElement("div");
        balloon.className = "ck-balloon-panel";
        document.body.append(balloon);
        onTestFinished(() => balloon.remove());
        return balloon;
    }

    /** Shows `balloon` at `rect`, or hides it, as CKEditor does. */
    async function showBalloon(
        balloon: HTMLElement,
        rect: (typeof rects)[string],
        isVisible = true
    ) {
        rects["ck-balloon-panel"] = rect;
        await act(async () => {
            balloon.style.top = `${rect.top}px`;
            balloon.classList.toggle("ck-balloon-panel_visible", isVisible);
        });
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

    it("keeps the panel above or below the toolbar of the embed that reaches over it", async () => {
        const balloon = createBalloon();
        const { panel } = await mount(300, false, balloon);

        // Above a drawing at the bottom of the window, with the panel below it and shorter.
        rects.drawing = { left: 340, top: 700, right: 840, bottom: 1020 };
        await showBalloon(balloon, { left: 500, top: 650, right: 1100, bottom: 690 });
        expect(getPlacement(panel)).toEqual([ "848px", "698px", "194px" ]);

        // Below a drawing at the top of the window, with the panel above it.
        rects.drawing = { left: 340, top: 200, right: 840, bottom: 520 };
        Object.defineProperty(panel, "offsetHeight", { value: 600 });
        await showBalloon(balloon, { left: 500, top: 530, right: 1100, bottom: 570 });
        expect(getPlacement(panel)).toEqual([ "848px", "8px", "514px" ]);

        // At the top of the window, over a drawing that starts above it.
        rects.drawing = { left: 340, top: -300, right: 840, bottom: 800 };
        Object.defineProperty(panel, "offsetHeight", { value: 300 });
        await showBalloon(balloon, { left: 500, top: 100, right: 1100, bottom: 140 });
        expect(getPlacement(panel)).toEqual([ "848px", "148px", "744px" ]);

        await showBalloon(balloon, { left: 340, top: 101, right: 840, bottom: 141 });
        expect(getPlacement(panel)).toEqual([ "848px", "8px", "884px" ]);

        await showBalloon(balloon, { left: 500, top: 100, right: 1100, bottom: 140 }, false);
        expect(getPlacement(panel)).toEqual([ "848px", "8px", "884px" ]);
    });

    it("keeps the height of the panel while the note scrolls, and fits it after", async () => {
        const balloon = createBalloon();
        const { viewport, panel } = await mount(600, false, balloon);

        // A toolbar above a drawing at the bottom of the window leaves the panel 194px.
        rects.drawing = { left: 340, top: 700, right: 840, bottom: 1020 };
        await showBalloon(balloon, { left: 500, top: 650, right: 1100, bottom: 690 });
        expect(getPlacement(panel)).toEqual([ "848px", "698px", "194px" ]);

        // Scrolled up by 300px, they leave it 494px.
        rects.drawing = { left: 340, top: 400, right: 840, bottom: 720 };
        rects["ck-balloon-panel"] = { left: 500, top: 350, right: 1100, bottom: 390 };
        viewport.dispatchEvent(new Event("scroll"));
        expect(getPlacement(panel)).toEqual([ "848px", "400px", "194px" ]);

        viewport.dispatchEvent(new Event("scrollend"));
        expect(getPlacement(panel)).toEqual([ "848px", "398px", "494px" ]);

        // Without `scrollend`, a scroll ends once no scroll event comes for a while.
        vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout" ] });
        onTestFinished(() => {
            vi.useRealTimers();
        });
        rects.drawing = { left: 340, top: 700, right: 840, bottom: 1020 };
        rects["ck-balloon-panel"] = { left: 500, top: 650, right: 1100, bottom: 690 };
        viewport.dispatchEvent(new Event("scroll"));
        expect(getPlacement(panel)).toEqual([ "848px", "698px", "494px" ]);

        vi.advanceTimersByTime(150);
        expect(getPlacement(panel)).toEqual([ "848px", "698px", "194px" ]);
    });

    it("declares the properties that place a panel as not inherited", () => {
        const styles = readFileSync(join(__dirname, "CanvasDrawing.css"), "utf8");
        const used = new Set(styles.match(/(?<=var\()--side-panel-[\w-]+/g));
        const declared = [ ...styles.matchAll(/@property (--side-panel-[\w-]+) \{([^}]*)\}/g) ]
            .filter(([ , , body ]) => /inherits:\s*false/.test(body))
            .map(([ , name ]) => name);

        expect(used.size).toBe(4);
        expect(new Set(declared)).toEqual(used);
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

    it("raises the pickers that the panel opens above it, and puts them back with it", async () => {
        const { viewport, panel } = await mount(300);
        await act(async () => {
            render(<SidePanelProbe isEnabled hasLibrary={false} hasPicker />, container);
            await Promise.resolve();
        });
        const picker = container.querySelector<HTMLElement>(".picker");
        expect(picker?.getAttribute("popover")).toBe("manual");
        expect(showPopover.mock.contexts).toEqual([ panel, picker ]);

        rects.drawing = { left: 100, top: 200, right: 1100, bottom: 520 };
        viewport.dispatchEvent(new Event("scroll"));
        expect(getPlacement(panel)).toBe(false);
        expect(picker?.hasAttribute("popover")).toBe(false);

        rects.drawing = { left: 340, top: 200, right: 840, bottom: 520 };
        viewport.dispatchEvent(new Event("scroll"));
        expect(showPopover.mock.contexts).toEqual([ panel, picker, panel, picker ]);

        await act(async () => {
            render(<SidePanelProbe isEnabled={false} hasLibrary={false} hasPicker />, container);
        });
        expect(getPlacement(panel)).toBe(false);
        expect(picker?.hasAttribute("popover")).toBe(false);
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

describe("usePropertiesSheet", () => {
    /** Boxes by class name, in pixels; happy-dom computes no layout. */
    const rects: Record<string, { left: number; top: number; right: number; bottom: number }> = {};
    let container: HTMLElement;
    /** The elements that went into the top layer, in order. */
    let raised: HTMLElement[];

    interface SheetProbeProps {
        isOpen: boolean;
        hasPicker?: boolean;
    }

    /** A drawing in the phone layout, in a note above the formatting toolbar. */
    function SheetProbe({ isOpen, hasPicker }: SheetProbeProps) {
        const rootRef = useRef<HTMLDivElement>(null);
        // `CanvasDrawing` runs both hooks on a phone.
        useSidePanels(rootRef, true);
        usePropertiesSheet(rootRef, true);
        return (
            <div className="note-split">
                <div className="scrolling-container">
                    <div className="include-note-body active">
                        <div ref={rootRef} className="drawing">
                            <div className="App-bottom-bar">
                                <div className="Island">
                                    {isOpen && <section className="App-mobile-menu" />}
                                    <footer className="App-toolbar" />
                                </div>
                            </div>
                            {hasPicker && (
                                <div className="picker" data-radix-popper-content-wrapper="" />
                            )}
                        </div>
                    </div>
                </div>
                <div className="classic-toolbar-outer-container visible">
                    <div className="classic-toolbar-island" />
                </div>
            </div>
        );
    }

    beforeEach(() => {
        // A phone of 400 × 900, whose note area spans from 100 to 800, above a toolbar from 740.
        Object.defineProperties(document.documentElement, {
            clientWidth: { value: 400, configurable: true },
            clientHeight: { value: 900, configurable: true }
        });
        rects["scrolling-container"] = { left: 0, top: 100, right: 400, bottom: 800 };
        rects["classic-toolbar-island"] = { left: 6, top: 740, right: 394, bottom: 786 };
        rects.Island = { left: 6, top: 500, right: 394, bottom: 734 };
        rects.drawing = { left: 0, top: 200, right: 400, bottom: 400 };
        vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
            .mockImplementation(function (this: HTMLElement) {
                const { left, top, right, bottom } = rects[this.classList[0]] ?? rects.drawing;
                const size = { width: right - left, height: bottom - top };
                return { left, top, right, bottom, ...size } as DOMRect;
            });
        vi.spyOn(window, "getComputedStyle").mockReturnValue({
            fontSize: "16px",
            getPropertyValue: (name: string) => name === "--mobile-toolbar-gap" ? "6px" : ""
        } as CSSStyleDeclaration);
        // happy-dom has no Popover API.
        raised = [];
        Object.defineProperty(HTMLElement.prototype, "showPopover", {
            value(this: HTMLElement) {
                raised.push(this);
            },
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
    });

    async function show(props: SheetProbeProps) {
        await act(async () => render(<SheetProbe {...props} />, container));
        const viewport = element(".scrolling-container");
        if (viewport) {
            Object.defineProperties(viewport, {
                clientWidth: { value: 400, configurable: true },
                clientHeight: { value: 700, configurable: true }
            });
        }
        // Places the sheet again, with the size of the note.
        await scrollNote();
    }

    const element = (selector: string) => container.querySelector<HTMLElement>(selector);

    async function scrollNote() {
        await act(async () => {
            element(".scrolling-container")?.dispatchEvent(new Event("scroll"));
        });
    }

    /** Where the sheet is, or `false` while the island is in the drawing. */
    function getSheet() {
        const island = element(".Island");
        const isPlaced = !!island?.hasAttribute("data-properties-sheet");
        expect(island?.getAttribute("popover") ?? null).toBe(isPlaced ? "manual" : null);
        return isPlaced && [ "left", "width", "bottom", "max-height" ]
            .map((name) => island?.style.getPropertyValue(`--properties-sheet-${name}`));
    }

    const getRailInset = () =>
        document.body.style.getPropertyValue("--canvas-drawing-sheet-inset");

    it("shows the open properties above the note's bottom, or above the toolbar", async () => {
        await show({ isOpen: false });
        expect(getSheet()).toBe(false);
        expect(getRailInset()).toBe("");

        // Inside the 6px gap of the toolbar, and at most half of the note above it.
        await show({ isOpen: true });
        expect(getSheet()).toEqual([ "6px", "388px", "106px", "347px" ]);
        // The rail keeps above the top of the sheet, 400px above the bottom of the window.
        expect(getRailInset()).toBe("400px");

        await act(async () => element(".classic-toolbar-outer-container")?.classList.add("active"));
        expect(getSheet()).toEqual([ "6px", "388px", "166px", "317px" ]);

        await show({ isOpen: false });
        expect(getSheet()).toBe(false);
        expect(getRailInset()).toBe("");
    });

    it("raises the pickers above the sheet, and puts both back without the focus", async () => {
        await show({ isOpen: true, hasPicker: true });
        expect(raised).toEqual([ element(".Island"), element(".picker") ]);
        expect(element(".picker")?.getAttribute("popover")).toBe("manual");

        await act(async () => element(".include-note-body")?.classList.remove("active"));
        expect(getSheet()).toBe(false);
        expect(element(".picker")?.hasAttribute("popover")).toBe(false);
        expect(getRailInset()).toBe("");

        await act(async () => element(".include-note-body")?.classList.add("active"));
        expect(getSheet()).not.toBe(false);
        rects.drawing = { left: 0, top: -300, right: 400, bottom: 90 };
        await scrollNote();
        expect(getSheet()).toBe(false);

        rects.drawing = { left: 0, top: 200, right: 400, bottom: 400 };
        await scrollNote();
        expect(getSheet()).not.toBe(false);
        await act(async () => render(null, container));
        expect(getRailInset()).toBe("");
    });

    it("keeps the pickers above the sheet while the note scrolls and after", async () => {
        await show({ isOpen: true, hasPicker: true });
        const picker = element(".picker");
        await scrollNote();
        expect(raised).toEqual([ element(".Island"), picker ]);

        await act(async () => {
            element(".scrolling-container")?.dispatchEvent(new Event("scrollend"));
        });
        expect(getSheet()).not.toBe(false);
        expect(picker?.getAttribute("popover")).toBe("manual");
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
        // Excalidraw counts as drawn on the frame after it shows the view of the box.
        const root = box.querySelector(".canvas-drawing-editor");
        expect(root?.hasAttribute("data-view-pending")).toBe(true);
        await act(async () => {
            options.onSceneShown?.();
            options.onViewReady?.();
            await new Promise(requestAnimationFrame);
        });
        expect(root?.hasAttribute("data-view-pending")).toBe(false);
        options.onViewChange?.({ zoom: { value: 2 }, scrollX: 10, scrollY: 20 });
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
        await act(async () => {
            reopened.onSceneShown?.();
            reopened.onViewReady?.();
        });
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

        // A frame places the picture, over the camera saved beside it.
        render(null, box);
        sceneContent = JSON.stringify({
            elements: [ { x: 50, y: 30, width: 200, height: 100 } ],
            appState: { zoom: { value: 1 }, scrollX: 0, scrollY: 0 },
            frame: { x: -10, y: -20, width: 200, height: 100, scale: 2 }
        });
        await mount(null);
        await vi.waitFor(() => expect(box.querySelector<SVGElement>(".canvas-drawing-view > svg")
            ?.style.left).toBe("120px"));
    });

    /** Puts `box` in an embed that the user can resize, with the box size `boxSize`. */
    function embedBox(boxSize = "resizable") {
        const embed = document.createElement("figure");
        embed.className = "include-note";
        embed.setAttribute("data-editable", "true");
        embed.setAttribute("data-box-size", boxSize);
        embed.append(box);
        document.body.append(embed);
        onTestFinished(() => {
            embed.remove();
            measured.size = { width: 400, height: 200 };
        });
        return embed;
    }

    /** Sets or removes the class that marks the embed while the user drags its resize handle. */
    async function setEmbedResizing(embed: HTMLElement, isResizing: boolean) {
        await act(async () => {
            embed.classList.toggle("ck-widget_resizing", isResizing);
            await Promise.resolve();
        });
    }

    /** Waits for the frames in which the box takes its new size and is measured, rendering each. */
    async function waitForLayout() {
        for (let i = 0; i < 4; i++) {
            await new Promise(requestAnimationFrame);
            await act(async () => {});
        }
    }

    /** Reports `frame` to the drawing as its persistence does, and waits for the box to take it. */
    async function reportFrame(options: PersistenceOptions, frame: object) {
        await act(async () => {
            options.onFrameChange?.(frame);
            await new Promise(requestAnimationFrame);
        });
    }

    it("sizes its box from the frame, else from the embed, also during a resize", async () => {
        const embed = embedBox();
        measured.size = { width: 1000, height: 500 };
        await mount();
        const outer = box.querySelector(".canvas-drawing-box");
        const root = box.querySelector<HTMLElement>(".canvas-drawing-editor");
        const options = persistenceArgs.mock.lastCall?.[4] as PersistenceOptions;
        expect(options.isFrameBox).toBe(true);
        expect(outer?.className).toBe("canvas-drawing-box include-note-box-height");
        expect(root?.style.getPropertyValue("--canvas-drawing-natural-width")).toBe("");

        const frame = { x: 10, y: 20, width: 500, height: 250, scale: 2 };
        await reportFrame(options, frame);
        expect(outer?.className).toBe("canvas-drawing-box framed");
        const variables = [
            "--canvas-drawing-natural-width", "--canvas-drawing-natural-height",
            "--canvas-drawing-frame-ratio"
        ];
        expect(variables.map((name) => root?.style.getPropertyValue(name)))
            .toEqual([ "1000px", "500px", "2" ]);
        expect(options.canReframe?.()).toBe(true);

        // Narrower than three quarters of the frame, the box crops it: a move leaves the frame.
        measured.size = { width: 400, height: 200 };
        await reportFrame(options, { ...frame });
        expect(options.canReframe?.()).toBe(false);

        // The embed sizes the box while the user drags its resize handle.
        await setEmbedResizing(embed, true);
        expect(outer?.className).toBe("canvas-drawing-box include-note-box-height");
        expect(options.isResizing?.()).toBe(true);
    });

    it("saves the frame again once the box is resized by its handle or its box size", async () => {
        const embed = embedBox();
        measured.size = { width: 1000, height: 500 };
        await mount();
        const outer = box.querySelector(".canvas-drawing-box");
        const options = persistenceArgs.mock.lastCall?.[4] as PersistenceOptions;
        const { apiRef } = canvasEditorProps.mock.lastCall?.[0] as MockCanvasEditorProps;
        const updateScene = vi.fn();
        if (apiRef) apiRef.current = { ...canvasApi, updateScene };
        const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
            .mockReturnValue({ width: 800, height: 400 } as DOMRect);
        onTestFinished(() => {
            vi.restoreAllMocks();
            if (apiRef) apiRef.current = null;
        });
        saveDrawingFrame.mockClear();
        await reportFrame(options, { x: 10, y: 20, width: 500, height: 250, scale: 2 });
        options.onViewChange?.({ zoom: { value: 2 }, scrollX: -10, scrollY: -20 });

        // The handle: the box keeps its new size until the frame is taken from it, at its view.
        await setEmbedResizing(embed, true);
        await setEmbedResizing(embed, false);
        expect(outer?.className).toBe("canvas-drawing-box include-note-box-height");
        await waitForLayout();
        const resized = { x: 10, y: 20, width: 400, height: 200, scale: 2 };
        expect(saveDrawingFrame).toHaveBeenCalledExactlyOnceWith(ATTACHMENT, EDITOR, resized);
        expect(outer?.className).toBe("canvas-drawing-box framed");
        expect(updateScene).not.toHaveBeenCalled();

        // The box size: the frame widens around its center at its scale, and the view follows.
        rect.mockReturnValue({ width: 1200, height: 400 } as DOMRect);
        await act(async () => {
            embed.setAttribute("data-box-size", "full");
            await Promise.resolve();
        });
        expect(outer?.className).toBe("canvas-drawing-box reframing");
        await waitForLayout();
        expect(saveDrawingFrame).toHaveBeenLastCalledWith(ATTACHMENT, EDITOR, {
            x: -90, y: 20, width: 600, height: 200, scale: 2
        });
        expect(updateScene).toHaveBeenCalledExactlyOnceWith({
            appState: { zoom: { value: 2 }, scrollX: 90, scrollY: -20 }, captureUpdate: "never"
        });
        expect(outer?.className).toBe("canvas-drawing-box framed");
    });

    it("saves the frame again once an undo or a reset changes the size of the box", async () => {
        const embed = embedBox();
        measured.size = { width: 1000, height: 500 };
        await mount();
        const outer = box.querySelector(".canvas-drawing-box");
        const options = persistenceArgs.mock.lastCall?.[4] as PersistenceOptions;
        const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
            .mockReturnValue({ width: 800, height: 400 } as DOMRect);
        onTestFinished(() => {
            vi.restoreAllMocks();
        });
        await reportFrame(options, { x: 10, y: 20, width: 500, height: 250, scale: 2 });
        options.onViewChange?.({ zoom: { value: 2 }, scrollX: -10, scrollY: -20 });
        saveDrawingFrame.mockClear();
        const setEmbedStyle = (style: string | null) => act(async () => {
            if (style === null) embed.removeAttribute("style");
            else embed.setAttribute("style", style);
            await Promise.resolve();
        });

        // An undo restores the height of the embed without a drag of its handle.
        await setEmbedStyle("--include-note-height:20em");
        expect(outer?.className).toBe("canvas-drawing-box include-note-box-height");
        await waitForLayout();
        expect(saveDrawingFrame).toHaveBeenCalledExactlyOnceWith(ATTACHMENT, EDITOR, {
            x: 10, y: 20, width: 400, height: 200, scale: 2
        });
        expect(outer?.className).toBe("canvas-drawing-box framed");

        // A double click on the handle removes the size.
        rect.mockReturnValue({ width: 800, height: 300 } as DOMRect);
        await setEmbedStyle(null);
        await waitForLayout();
        expect(saveDrawingFrame).toHaveBeenLastCalledWith(ATTACHMENT, EDITOR, {
            x: 10, y: 20, width: 400, height: 150, scale: 2
        });
        expect(saveDrawingFrame).toHaveBeenCalledTimes(2);
    });

    it("widens the frame to a box size that draws the drawing again", async () => {
        const embed = embedBox();
        measured.size = { width: 1000, height: 500 };
        await mount();
        const options = persistenceArgs.mock.lastCall?.[4] as PersistenceOptions;
        const frame = { x: 10, y: 20, width: 500, height: 250, scale: 2 };
        await reportFrame(options, frame);
        options.onViewChange?.({ zoom: { value: 2 }, scrollX: -10, scrollY: -20 });
        saveDrawingFrame.mockClear();

        // The box size changes, which the drawing sees, and the embed draws its content again,
        // in the wider box, before the drawing takes the frame from the box.
        await act(async () => {
            embed.setAttribute("data-box-size", "full");
            await Promise.resolve();
        });
        await act(async () => render(null, box));
        vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
            .mockReturnValue({ width: 1200, height: 500 } as DOMRect);
        onTestFinished(() => {
            vi.restoreAllMocks();
        });
        await mount();
        const outer = box.querySelector(".canvas-drawing-box");
        const root = box.querySelector<HTMLElement>(".canvas-drawing-editor");
        const reopened = persistenceArgs.mock.lastCall?.[4] as PersistenceOptions;
        expect(reopened.initialView).toBeNull();

        // The frame of the drawing before widens to the box, keeping its height.
        await vi.waitFor(() => expect(saveDrawingFrame).toHaveBeenCalledOnce(), { timeout: 2000 });
        expect(saveDrawingFrame).toHaveBeenCalledWith(ATTACHMENT, EDITOR, {
            x: -40, y: 20, width: 600, height: 250, scale: 2
        });
        await waitForLayout();
        expect(outer?.className).toBe("canvas-drawing-box framed");
        const variables = [
            "--canvas-drawing-natural-width", "--canvas-drawing-natural-height",
            "--canvas-drawing-frame-ratio"
        ];
        expect(variables.map((name) => root?.style.getPropertyValue(name)))
            .toEqual([ "1200px", "500px", "2.4" ]);
        expect(reopened.isResizing?.()).toBe(false);
    });

    it("shows the picture gray until it is drawn, and fills its box with the frame", async () => {
        sceneContent = JSON.stringify({
            elements: [ { x: 50, y: 30, width: 200, height: 100 } ],
            appState: { zoom: { value: 1 }, scrollX: 0, scrollY: 0 },
            frame: { x: -10, y: -20, width: 200, height: 100, scale: 2 }
        });
        const parent = new Component();
        onTestFinished(() => {
            measured.size = { width: 400, height: 200 };
        });
        await act(async () => {
            render(
                <ParentComponent.Provider value={parent}>
                    <CanvasDrawing attachment={ATTACHMENT} />
                </ParentComponent.Provider>,
                box
            );
        });
        const layer = box.querySelector(".canvas-drawing-view");
        const outer = box.querySelector(".canvas-drawing-box");
        const root = box.querySelector<HTMLElement>(".canvas-drawing-editor");
        const getSvg = () => box.querySelector<SVGElement>(".canvas-drawing-view > svg");
        expect(layer?.classList.contains("stale")).toBe(true);
        expect(outer?.className).toBe("canvas-drawing-box include-note-box-height");
        await vi.waitFor(() => expect(getSvg()?.style.left).toBe("120px"));
        expect(layer?.classList.contains("stale")).toBe(false);
        await vi.waitFor(() => expect(outer?.className).toBe("canvas-drawing-box framed"));
        expect(root?.style.getPropertyValue("--canvas-drawing-natural-width")).toBe("400px");

        // A save grays the picture until it is drawn again, here in a narrower box.
        measured.size = { width: 300, height: 150 };
        const loadResults = new LoadResults([]);
        loadResults.addAttachmentRow({ attachmentId: "a1" } as never, "any");
        await act(async () => {
            await parent.handleEvent("entitiesReloaded", { loadResults });
        });
        expect(layer?.classList.contains("stale")).toBe(true);
        await vi.waitFor(() => expect(layer?.classList.contains("stale")).toBe(false));
        // The 200 units of the frame fill 300 pixels at zoom 1.5: the picture at (50 + 10) × 1.5.
        expect([ getSvg()?.style.left, getSvg()?.style.width ]).toEqual([ "90px", "300px" ]);
    });

    it("sizes its box and places the picture by a frame that another view saved", async () => {
        const elements = [ { x: 50, y: 30, width: 200, height: 100 } ];
        sceneContent = JSON.stringify({
            elements, appState: { zoom: { value: 2 }, scrollX: 10, scrollY: 20 },
            frame: { x: -10, y: -20, width: 200, height: 100, scale: 2 }
        });
        const parent = new Component();
        await act(async () => {
            render(
                <ParentComponent.Provider value={parent}>
                    <CanvasDrawing attachment={ATTACHMENT} />
                </ParentComponent.Provider>,
                box
            );
        });
        const outer = box.querySelector(".canvas-drawing-box");
        const root = box.querySelector<HTMLElement>(".canvas-drawing-editor");
        const getSvg = () => box.querySelector<SVGElement>(".canvas-drawing-view > svg");
        await vi.waitFor(() => expect(outer?.className).toBe("canvas-drawing-box framed"));
        expect(getSvg()?.style.left).toBe("120px");

        // Another view saves a wider frame: the box takes its size, the picture its place. The
        // 250 units of the frame fill the 400 pixels of the box at zoom 1.6.
        sceneContent = JSON.stringify({
            elements, appState: { zoom: { value: 2 }, scrollX: -30, scrollY: -10 },
            frame: { x: 30, y: 10, width: 250, height: 100, scale: 2 }
        });
        const loadResults = new LoadResults([]);
        loadResults.addAttachmentRow({ attachmentId: "a1" } as never, "any");
        await act(async () => {
            await parent.handleEvent("entitiesReloaded", { loadResults });
        });
        await vi.waitFor(() => expect(getSvg()?.style.left).toBe("32px"));
        await vi.waitFor(() =>
            expect(root?.style.getPropertyValue("--canvas-drawing-natural-width")).toBe("500px"));
        expect(saveDrawingFrame).not.toHaveBeenCalled();
    });

    it("takes a frame from the view and the box of a drawing that saved none", async () => {
        sceneContent = JSON.stringify({
            elements: [ { x: 50, y: 30, width: 200, height: 100 } ],
            appState: { zoom: { value: 2 }, scrollX: 10, scrollY: 20 }
        });
        await mount(null);
        const outer = box.querySelector(".canvas-drawing-box");
        const root = box.querySelector<HTMLElement>(".canvas-drawing-editor");
        await vi.waitFor(() => expect(outer?.className).toBe("canvas-drawing-box framed"));
        const variables = [
            "--canvas-drawing-natural-width", "--canvas-drawing-natural-height",
            "--canvas-drawing-frame-ratio"
        ];
        expect(variables.map((name) => root?.style.getPropertyValue(name)))
            .toEqual([ "400px", "200px", "2" ]);
    });

    it("shows the whole picture in fullscreen, and its view again after", async () => {
        sceneContent = JSON.stringify({
            elements: [ { x: 50, y: 30, width: 200, height: 100 } ],
            appState: { zoom: { value: 2 }, scrollX: 10, scrollY: 20 }
        });
        await mount(null);
        const getPlacement = () => {
            const svg = box.querySelector<SVGElement>(".canvas-drawing-view > svg");
            return [ svg?.style.left, svg?.style.top, svg?.style.width ];
        };
        await vi.waitFor(() => expect(getPlacement()).toEqual([ "120px", "100px", "400px" ]));
        vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
            .mockReturnValue({ width: 400, height: 200 } as DOMRect);
        onTestFinished(() => {
            vi.restoreAllMocks();
            Reflect.deleteProperty(document, "fullscreenElement");
        });

        Object.defineProperty(document, "fullscreenElement", { value: box, configurable: true });
        await act(async () => {
            box.dispatchEvent(new Event("fullscreenChangeStart", { bubbles: true }));
        });
        await act(async () => {
            box.dispatchEvent(new Event("enterFullscreen", { bubbles: true }));
        });
        // Zoomed to fit the 400 × 200 screen, up to 100%: the shapes centered at zoom 1.
        expect(getPlacement()).toEqual([ "100px", "50px", "200px" ]);

        Reflect.deleteProperty(document, "fullscreenElement");
        await act(async () => {
            box.dispatchEvent(new Event("fullscreenChangeStart", { bubbles: true }));
        });
        await act(async () => {
            box.dispatchEvent(new Event("leaveFullscreen", { bubbles: true }));
        });
        expect(getPlacement()).toEqual([ "120px", "100px", "400px" ]);
    });

    it("finds its text, moving the picture to a match out of view and back", async () => {
        const embed = document.createElement("figure");
        embed.className = "include-note";
        embed.append(box);
        document.body.append(embed);
        sceneContent = JSON.stringify({
            elements: [ {
                id: "text", type: "text", x: 50, y: 500, width: 200, height: 100, angle: 0,
                version: 1, originalText: "Find me", text: "Find me"
            } ],
            appState: { zoom: { value: 1 }, scrollX: 0, scrollY: 0 }
        });
        await mount(null);
        const getSvg = () => box.querySelector<SVGElement>(".canvas-drawing-view > svg");
        await vi.waitFor(() => expect(getSvg()?.style.top).toBe("500px"));
        vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
            .mockReturnValue({ left: 0, top: 0, width: 400, height: 200 } as DOMRect);

        const target = getEmbedFindTarget(embed);
        expect(target).not.toBeNull();
        let count = 0;
        await act(async () => {
            count = await target?.find("me", { matchCase: false, wholeWord: false }) ?? 0;
        });
        expect(count).toBe(1);

        // The match at y = 500 moves to the middle of the 200 pixels of the box.
        await act(async () => target?.highlight(0));
        expect(getSvg()?.style.top).toBe("90px");
        const layer = box.querySelector(".canvas-drawing-find > g");
        expect(layer?.getAttribute("transform")).toBe("scale(1) translate(0 -410)");
        const match = layer?.querySelector("rect");
        expect([ match?.getAttribute("x"), match?.getAttribute("y") ]).toEqual([ "100", "500" ]);
        expect(match?.parentElement?.getAttribute("fill")).toBe(MATCH_COLORS.light.current);

        await act(async () => target?.highlight(null));
        expect(getSvg()?.style.top).toBe("500px");
        expect(match?.parentElement?.getAttribute("fill")).toBe(MATCH_COLORS.light.other);
        vi.restoreAllMocks();
        embed.remove();
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

    it("shows the whole drawing in fullscreen, and the view of the box again after", async () => {
        await mount();
        const root = box.querySelector(".canvas-drawing-editor");
        const isHidden = () => !!root?.classList.contains("recentering");
        const { apiRef } = canvasEditorProps.mock.lastCall?.[0] as MockCanvasEditorProps;
        const options = persistenceArgs.mock.lastCall?.[4] as PersistenceOptions;
        if (!apiRef) {
            throw new Error("Expected the API reference of the editor.");
        }
        const updateScene = vi.fn();
        let appState = { activeTool: SELECTION_TOOL, zoom: { value: 2 }, scrollX: 10, scrollY: 20 };
        apiRef.current = {
            ...canvasApi,
            updateScene,
            registerAction: vi.fn(),
            onChange: vi.fn(() => () => {}),
            getAppState: () => appState,
            getSceneElements: () => [ { x: 50, y: 30, width: 200, height: 100 } ]
        };
        vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
            .mockReturnValue({ width: 800, height: 400 } as DOMRect);
        const other = document.createElement("div");
        document.body.append(other);
        onTestFinished(() => {
            vi.restoreAllMocks();
            Reflect.deleteProperty(document, "fullscreenElement");
            apiRef.current = null;
            other.remove();
        });
        const boxView = { zoom: { value: 2 }, scrollX: 10, scrollY: 20 };
        // Excalidraw shows the drawing at the view of the box.
        options.onSceneShown?.();
        options.onViewChange?.(boxView);

        await act(async () => {
            other.dispatchEvent(new Event("fullscreenChangeStart", { bubbles: true }));
        });
        expect(isHidden()).toBe(false);

        // Hidden from the start of the switch until the frame after the new view is drawn.
        Object.defineProperty(document, "fullscreenElement", { value: box, configurable: true });
        await act(async () => {
            box.dispatchEvent(new Event("fullscreenChangeStart", { bubbles: true }));
        });
        expect(isHidden()).toBe(true);
        await act(async () => {
            box.dispatchEvent(new Event("enterFullscreen", { bubbles: true }));
        });
        // Zoomed to fit the 800 × 400 screen, up to 100%: the shapes centered at zoom 1.
        expect(updateScene).toHaveBeenCalledExactlyOnceWith({
            appState: { zoom: { value: 1 }, scrollX: 250, scrollY: 120 }, captureUpdate: "never"
        });
        expect(isHidden()).toBe(true);
        await vi.waitFor(() => expect(isHidden()).toBe(false));

        // The view that the user zooms and pans to in fullscreen is kept for fullscreen alone.
        appState = { ...appState, zoom: { value: 3 }, scrollX: -5, scrollY: -7 };
        Reflect.deleteProperty(document, "fullscreenElement");
        await act(async () => {
            box.dispatchEvent(new Event("fullscreenChangeStart", { bubbles: true }));
        });
        expect(updateScene).toHaveBeenLastCalledWith({ appState: boxView, captureUpdate: "never" });
        expect(isHidden()).toBe(true);
        await act(async () => {
            box.dispatchEvent(new Event("leaveFullscreen", { bubbles: true }));
        });
        await vi.waitFor(() => expect(isHidden()).toBe(false));

        // Fullscreen opens again at the view it was left at.
        Object.defineProperty(document, "fullscreenElement", { value: box, configurable: true });
        await act(async () => {
            box.dispatchEvent(new Event("fullscreenChangeStart", { bubbles: true }));
            box.dispatchEvent(new Event("enterFullscreen", { bubbles: true }));
        });
        expect(updateScene).toHaveBeenLastCalledWith({
            appState: { zoom: { value: 3 }, scrollX: -5, scrollY: -7 }, captureUpdate: "never"
        });
    });

    it("leaves the drawing to the note while no tool is active", async () => {
        await mount();
        const root = box.querySelector(".canvas-drawing-editor");
        const { onChange } = (canvasEditorProps.mock.lastCall?.[0] as MockCanvasEditorProps)
            .persistence ?? {};

        onChange?.([], { activeTool: NO_TOOL }, {});
        expect(root?.hasAttribute("data-no-tool")).toBe(true);

        onChange?.([], { activeTool: SELECTION_TOOL }, {});
        expect(root?.hasAttribute("data-no-tool")).toBe(false);
    });

    it("starts with no tool in the mobile layout, back to it as the focus leaves", async () => {
        const device = window.glob.device;
        const body = document.createElement("div");
        body.className = "include-note-body active";
        body.append(box);
        document.body.append(body);
        onTestFinished(() => {
            window.glob.device = device;
            body.remove();
        });
        const setActiveTool = vi.fn();
        const api = { ...canvasApi, setActiveTool, getAppState: () => ({ activeTool: NO_TOOL }) };
        const getApiRef = () => {
            const { apiRef } = canvasEditorProps.mock.lastCall?.[0] as MockCanvasEditorProps;
            if (!apiRef) {
                throw new Error("Expected the API reference of the editor.");
            }
            return apiRef;
        };
        const getInitialTool = () =>
            (persistenceArgs.mock.lastCall?.[4] as PersistenceOptions).initialTool;

        window.glob.device = "mobile";
        await mount();
        expect(getInitialTool()).toEqual(NO_TOOL);
        getApiRef().current = api;
        await act(async () => body.classList.remove("active"));
        expect(setActiveTool).toHaveBeenCalledWith(NO_TOOL);
        await act(async () => body.classList.add("active"));
        await act(async () => body.classList.remove("active"));
        expect(setActiveTool).toHaveBeenCalledTimes(2);

        render(null, box);
        setActiveTool.mockClear();
        body.classList.add("active");
        window.glob.device = "desktop";
        await mount();
        expect(getInitialTool()).toBeUndefined();
        getApiRef().current = api;
        await act(async () => body.classList.remove("active"));
        expect(setActiveTool).not.toHaveBeenCalled();
    });

    it("switches from no tool to the selection tool in fullscreen", async () => {
        await mount();
        const { apiRef } = canvasEditorProps.mock.lastCall?.[0] as MockCanvasEditorProps;
        if (!apiRef) {
            throw new Error("Expected the API reference of the editor.");
        }
        const setActiveTool = vi.fn();
        let activeTool: unknown = NO_TOOL;
        apiRef.current = { ...canvasApi, setActiveTool, getAppState: () => ({ activeTool }) };

        await act(async () => {
            box.dispatchEvent(new Event("enterFullscreen", { bubbles: true }));
        });
        expect(setActiveTool).toHaveBeenCalledWith({ type: "selection" });

        activeTool = SELECTION_TOOL;
        await act(async () => {
            box.dispatchEvent(new Event("enterFullscreen", { bubbles: true }));
        });
        expect(setActiveTool).toHaveBeenCalledTimes(1);
        apiRef.current = null;
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
