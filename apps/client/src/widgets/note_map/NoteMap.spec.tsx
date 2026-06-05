import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// --- Module mocks (hoisted above the component import) ---------------------------------------------

/** Records every chainable call so tests can drive the captured graph callbacks. */
interface FakeGraph {
    container: HTMLElement;
    nodeClick?: (node: { id?: string | null }) => void;
    nodeRightClick?: (node: { id?: string | null }, e: unknown) => void;
    dragEnd?: (node: Record<string, unknown>) => void;
    distance: Mock<(value: number) => unknown>;
    width: Mock<(value: number) => unknown>;
    height: Mock<(value: number) => unknown>;
    graphData: Mock<(data: unknown) => unknown>;
}

const graphs: FakeGraph[] = [];

vi.mock("force-graph", () => {
    class FakeForceGraph {
        instance: FakeGraph;
        constructor(container: HTMLElement) {
            this.instance = {
                container,
                distance: vi.fn(),
                width: vi.fn().mockReturnThis(),
                height: vi.fn().mockReturnThis(),
                graphData: vi.fn()
            };
            graphs.push(this.instance);
        }
        onNodeClick(cb: FakeGraph["nodeClick"]) { this.instance.nodeClick = cb; return this; }
        onNodeRightClick(cb: FakeGraph["nodeRightClick"]) { this.instance.nodeRightClick = cb; return this; }
        onNodeDragEnd(cb: FakeGraph["dragEnd"]) { this.instance.dragEnd = cb; return this; }
        d3Force() { return { distance: this.instance.distance }; }
        width(w: number) { this.instance.width(w); return this; }
        height(h: number) { this.instance.height(h); return this; }
        graphData(d: unknown) { this.instance.graphData(d); return this; }
    }
    return { default: FakeForceGraph };
});

const loadNotesAndRelations = vi.fn();
vi.mock("./data", () => ({ loadNotesAndRelations: (...args: unknown[]) => loadNotesAndRelations(...args) }));

const setupRendering = vi.fn();
vi.mock("./rendering", () => ({ setupRendering: (...args: unknown[]) => setupRendering(...args) }));

vi.mock("../../services/theme", () => ({ getEffectiveThemeStyle: vi.fn(() => "light") }));

const openContextMenu = vi.fn();
vi.mock("../../menus/link_context_menu", () => ({ default: { openContextMenu: (...a: unknown[]) => openContextMenu(...a) } }));

vi.mock("../../services/keyboard_actions", () => ({
    default: { getAction: vi.fn(async () => ({ effectiveShortcuts: [] })) }
}));

// Stub the bootstrap tooltip hook used by ActionButton, but keep the real data hooks.
vi.mock("../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../react/hooks")>()),
    useStaticTooltip: vi.fn(),
    useElementSize: vi.fn(() => ({ width: 800, height: 600 }))
}));

import appContext from "../../components/app_context";
import Component from "../../components/component";
import attributes from "../../services/attributes";
import froca from "../../services/froca";
import hoisted_note from "../../services/hoisted_note";
import noteAttributeCache from "../../services/note_attribute_cache";
import { buildNote } from "../../test/easy-froca";
import { ParentComponent } from "../react/react_utils";
import NoteMap from "./NoteMap";
import type { NotesAndRelationsData } from "./data";

// --- Helpers --------------------------------------------------------------------------------------

function makeData(nodeCount: number): NotesAndRelationsData {
    return {
        nodes: Array.from({ length: nodeCount }, (_, i) => ({ id: `n${i}`, name: `N${i}`, type: "text", color: "" })),
        links: [],
        noteIdToSizeMap: {}
    };
}

let container: HTMLDivElement | undefined;
let parent: Component;

function renderNoteMap(props: { noteId: string; widgetMode: "ribbon" | "hoisted" | "type"; labels?: Record<string, string> }) {
    const note = buildNote({ id: props.noteId, title: "Map", ...(props.labels ?? {}) });
    const parentEl = document.createElement("div");
    const parentRef = { current: parentEl };
    const target = document.createElement("div");
    container = target;
    document.body.appendChild(target);

    act(() => render((
        <ParentComponent.Provider value={parent}>
            <NoteMap note={note} widgetMode={props.widgetMode} parentRef={parentRef} />
        </ParentComponent.Provider>
    ), target));

    return { note, container: target };
}

function fireEvent(name: string, data: unknown) {
    act(() => { (parent.handleEventInChildren as (n: string, d: unknown) => void)(name, data); });
}

async function flush() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

beforeEach(() => {
    parent = new Component();
    graphs.length = 0;
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    vi.clearAllMocks();
    loadNotesAndRelations.mockResolvedValue(makeData(2));
    Object.assign(appContext, { tabManager: { getActiveContext: () => null } });
});

afterEach(() => {
    if (container) { render(null, container); container.remove(); container = undefined; }
    vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------------------------------

describe("NoteMap", () => {
    it("renders the widget chrome and sets up the graph in ribbon mode", async () => {
        const { container } = renderNoteMap({ noteId: "ribbonNote", widgetMode: "ribbon" });
        await flush();

        // Chrome: two map-type switchers, fix-nodes button + slider, container + resolver.
        expect(container.querySelector(".note-map-widget")).toBeTruthy();
        expect(container.querySelector(".note-map-container")).toBeTruthy();
        expect(container.querySelector(".style-resolver")).toBeTruthy();
        expect(container.querySelector("input[type=range]")).toBeTruthy();

        // A graph was created and configured via the (normal, under-threshold) path.
        expect(graphs.length).toBe(1);
        expect(setupRendering).toHaveBeenCalledTimes(1);
        const graph = graphs[0];
        expect(graph.graphData).toHaveBeenCalled();
        expect(graph.width).toHaveBeenCalledWith(800);
        expect(graph.height).toHaveBeenCalledWith(600);

        // loadNotesAndRelations was called with the ribbon note id as the root and the "link" map type.
        expect(loadNotesAndRelations).toHaveBeenCalledWith("ribbonNote", [], [], "link");
    });

    it("forwards node click to the active context and right-click to the context menu, guarding empty ids", async () => {
        const setNote = vi.fn();
        Object.assign(appContext, { tabManager: { getActiveContext: () => ({ setNote, parentNoteId: null }) } });
        renderNoteMap({ noteId: "clickNote", widgetMode: "ribbon" });
        await flush();

        const graph = graphs[0];
        graph.nodeClick?.({ id: "target1" });
        expect(setNote).toHaveBeenCalledWith("target1");
        graph.nodeClick?.({ id: null });           // no id → ignored
        expect(setNote).toHaveBeenCalledTimes(1);

        const evt = { pageX: 5 };
        graph.nodeRightClick?.({ id: "target2" }, evt);
        expect(openContextMenu).toHaveBeenCalledWith("target2", evt);
        graph.nodeRightClick?.({ id: null }, evt);  // no id → ignored
        expect(openContextMenu).toHaveBeenCalledTimes(1);
    });

    it("shows the too-many-notes placeholder and reveals the graph when bypassing the limit", async () => {
        loadNotesAndRelations.mockResolvedValue(makeData(1500));
        const { container } = renderNoteMap({ noteId: "bigNote", widgetMode: "ribbon" });
        await flush();

        // Over threshold → placeholder with the "show anyway" button; no graph chrome.
        const button = container.querySelector("button.btn-primary");
        expect(button).toBeTruthy();
        expect(container.querySelector(".note-map-container")).toBeNull();
        expect(setupRendering).not.toHaveBeenCalled();

        // Clicking "show anyway" sets bypassLimit → re-runs the effect and renders the graph.
        act(() => { button?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        await flush();
        expect(container.querySelector(".note-map-container")).toBeTruthy();
        expect(setupRendering).toHaveBeenCalledTimes(1);
    });

    it("resolves the map root from the hoisted label", async () => {
        vi.spyOn(hoisted_note, "getHoistedNoteId").mockReturnValue("hoistedRoot");
        renderNoteMap({ noteId: "hoistedNote", widgetMode: "hoisted", labels: { "#mapRootNoteId": "hoisted" } });
        await flush();
        expect(loadNotesAndRelations).toHaveBeenCalledWith("hoistedRoot", [], [], "link");
    });

    it("resolves the map root from an explicit label", async () => {
        renderNoteMap({ noteId: "explicitNote", widgetMode: "hoisted", labels: { "#mapRootNoteId": "customRoot" } });
        await flush();
        expect(loadNotesAndRelations).toHaveBeenCalledWith("customRoot", [], [], "link");
    });

    it("falls back to the active context parent note id when no root label is present", async () => {
        Object.assign(appContext, { tabManager: { getActiveContext: () => ({ parentNoteId: "ctxParent", setNote: vi.fn() }) } });
        renderNoteMap({ noteId: "fallbackNote", widgetMode: "hoisted" });
        await flush();
        expect(loadNotesAndRelations).toHaveBeenCalledWith("ctxParent", [], [], "link");
    });

    it("does not build a graph when no map root can be resolved", async () => {
        Object.assign(appContext, { tabManager: { getActiveContext: () => null } });
        renderNoteMap({ noteId: "noRootNote", widgetMode: "hoisted" });
        await flush();
        expect(graphs.length).toBe(0);
        expect(loadNotesAndRelations).not.toHaveBeenCalled();
    });

    it("passes exclude/include relation labels and uses the tree map type when configured", async () => {
        renderNoteMap({
            noteId: "treeNote",
            widgetMode: "ribbon",
            labels: { "#mapType": "tree", "#mapExcludeRelation": "ex1", "#mapIncludeRelation": "in1" }
        });
        await flush();
        expect(loadNotesAndRelations).toHaveBeenCalledWith("treeNote", [ "ex1" ], [ "in1" ], "tree");
        // setupRendering receives the resolved tree map type.
        expect(setupRendering).toHaveBeenCalled();
        const callArg = setupRendering.mock.calls[0]?.[1] as { mapType: string } | undefined;
        expect(callArg?.mapType).toBe("tree");
    });

    it("switches the map type when a MapTypeSwitcher is activated", async () => {
        const setLabel = vi.spyOn(attributes, "setLabel").mockImplementation(() => undefined as never);
        const { container } = renderNoteMap({ noteId: "switchNote", widgetMode: "ribbon" });
        await flush();

        const switchers = container.querySelectorAll(".map-type-switcher button");
        expect(switchers.length).toBe(2);
        const treeButton = switchers[1];
        act(() => { treeButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        expect(setLabel).toHaveBeenCalledWith("switchNote", "mapType", "tree");
    });

    it("toggles fix-nodes and applies the captured drag-end handler in both branches", async () => {
        const { container } = renderNoteMap({ noteId: "fixNote", widgetMode: "ribbon" });
        await flush();

        const graph = graphs[0];
        // Initial (fixNodes=false) drag handler clears fx/fy.
        const node1: Record<string, unknown> = { x: 1, y: 2, fx: 9, fy: 9 };
        graph.dragEnd?.(node1);
        expect(node1.fx).toBeUndefined();
        expect(node1.fy).toBeUndefined();

        // Click the lock button (first fixnodes-type-switcher button) → fixNodes=true.
        const lockButton = container.querySelector(".fixnodes-type-switcher button");
        act(() => { lockButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        expect(lockButton?.className).toContain("active");

        const node2: Record<string, unknown> = { x: 3, y: 4 };
        graph.dragEnd?.(node2);
        expect(node2.fx).toBe(3);
        expect(node2.fy).toBe(4);
    });

    it("updates the link distance via the slider, applying it to the graph forces", async () => {
        const { container } = renderNoteMap({ noteId: "distNote", widgetMode: "ribbon" });
        await flush();

        const graph = graphs[0];
        graph.distance.mockClear();
        graph.graphData.mockClear();

        const slider = container.querySelector("input[type=range]");
        if (slider instanceof HTMLInputElement) {
            slider.value = "70";
            // Preact delegates a range input's onChange to the native "input" event.
            act(() => { slider.dispatchEvent(new Event("input", { bubbles: true })); });
        }
        await flush();
        expect(graph.distance).toHaveBeenCalledWith(70);
        expect(graph.graphData).toHaveBeenCalled();
    });

    it("reacts to a mapType label change fired via entitiesReloaded", async () => {
        // Start with an explicit "link" label so the underlying froca attribute exists.
        renderNoteMap({ noteId: "evtNote", widgetMode: "ribbon", labels: { "#mapType": "link" } });
        await flush();
        loadNotesAndRelations.mockClear();
        setupRendering.mockClear();

        // useNoteLabel reads the value straight from the note, so mutate the cached attribute
        // and then fire entitiesReloaded to trigger the re-render + build effect re-run.
        const cachedAttr = noteAttributeCache.attributes["evtNote"]?.find((a: { name: string }) => a.name === "mapType");
        if (cachedAttr) {
            cachedAttr.value = "tree";
        }
        fireEvent("entitiesReloaded", {
            loadResults: {
                getAttributeRows: () => [ { type: "label", name: "mapType", value: "tree", noteId: "evtNote", isDeleted: false } ],
                getBranchRows: () => [],
                getOptionNames: () => [],
                isNoteReloaded: () => false,
                isNoteContentReloaded: () => false,
                getEntityRow: () => undefined
            }
        });
        await flush();
        // The mapType change re-runs the build effect with the tree map type.
        expect(loadNotesAndRelations).toHaveBeenCalledWith("evtNote", [], [], "tree");
    });

    it("bails out of the load handler when the component unmounts before the data resolves", async () => {
        // Defer the load so the component can unmount (detaching the refs) before `.then` runs.
        let resolveLoad: (data: NotesAndRelationsData) => void = () => undefined;
        loadNotesAndRelations.mockReturnValue(new Promise<NotesAndRelationsData>((resolve) => { resolveLoad = resolve; }));

        renderNoteMap({ noteId: "unmountNote", widgetMode: "ribbon" });
        expect(graphs.length).toBe(1);

        // Unmount → the build effect cleanup runs and containerRef.current becomes null.
        const mounted = container;
        if (mounted) { act(() => { render(null, mounted); }); mounted.remove(); container = undefined; }

        // Now resolve the load: the `.then` guard sees the detached refs and returns early.
        resolveLoad(makeData(3));
        await flush();
        expect(setupRendering).not.toHaveBeenCalled();
    });
});
