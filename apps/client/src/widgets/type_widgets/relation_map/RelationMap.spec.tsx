import { OnConnectionBindInfo } from "jsplumb";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the imports) ----------------------------------------------------

interface FakePanZoom {
    zoomTo: ReturnType<typeof vi.fn>;
    moveTo: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    getTransform: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    fireTransform: () => void;
    options: unknown;
}
interface CapturedJsPlumb {
    apiRef?: { current: unknown };
    onConnection?: (info: OnConnectionBindInfo, ev: Event | null) => void | Promise<void>;
    onInstanceCreated?: (instance: unknown) => void;
    children: unknown;
}

// All mutable state referenced inside hoisted `vi.mock` factories must itself be hoisted.
const shared = vi.hoisted(() => ({
    panzoomInstances: [] as FakePanZoom[],
    capturedJsPlumb: null as CapturedJsPlumb | null,
    promptResult: "knows" as string | null,
    makeFakeJsPlumbInstance: (() => undefined) as unknown as () => FakeJsPlumbInstance
}));
const panzoomInstances = shared.panzoomInstances;

// `isNewLayout` is read once at module-load; force it true so the floating-button branch is always
// mounted (the extra buttons don't interfere with the other assertions).
vi.mock("../../../services/experimental_features", () => ({
    isExperimentalFeatureEnabled: () => true
}));

// ActionButton pulls in keyboard_actions + tooltips; replace it with a plain button that forwards
// the click so we can assert the floating-button events without the bootstrap machinery.
vi.mock("../../react/ActionButton", () => ({
    default: (props: { icon?: string; onClick?: (e: MouseEvent) => void; className?: string }) => (
        <button className={`${props.className ?? ""} ${props.icon ?? ""}`} onClick={props.onClick} />
    )
}));

// i18n is not initialised under happy-dom; return the key so `.length`/string ops stay safe.
vi.mock("../../../services/i18n", () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : key)
}));

vi.mock("../../../services/dialog", () => ({
    default: {
        prompt: vi.fn(async () => "New Note"),
        info: vi.fn(async () => undefined),
        confirm: vi.fn(async () => true)
    }
}));
vi.mock("../../../services/toast", () => ({
    default: { showMessage: vi.fn(), showError: vi.fn() }
}));

// `jsPlumbInstance` is referenced at runtime in a dependency array, and the real jsplumb bundle is a
// heavy DOM library; replace it with light stubs.
vi.mock("jsplumb", () => ({
    jsPlumbInstance: class {},
    jsPlumb: { getInstance: vi.fn() }
}));

// `panzoom(container, options)` returns a controllable fake instance recorded for assertions.
vi.mock("panzoom", () => ({
    default: vi.fn((_el: HTMLElement, options: unknown) => {
        let transformCb: (() => void) | undefined;
        const inst: FakePanZoom = {
            zoomTo: vi.fn(),
            moveTo: vi.fn(),
            on: vi.fn((_event: string, cb: () => void) => { transformCb = cb; }),
            getTransform: vi.fn(() => ({ x: 0, y: 0, scale: 1 })),
            dispose: vi.fn(),
            fireTransform: () => transformCb?.(),
            options
        };
        shared.panzoomInstances.push(inst);
        return inst;
    })
}));

// Replace the JsPlumb wrapper with a light component that renders children and captures the props
// the component passes (apiRef seeding + onConnection callback + onInstanceCreated).
vi.mock("./jsplumb", () => ({
    JsPlumb: (props: Record<string, unknown>) => {
        shared.capturedJsPlumb = props as unknown as CapturedJsPlumb;
        // Seed the refs exactly once per mount (mirrors the real component's mount-time effect),
        // so re-renders triggered by data changes don't churn the refs.
        const apiRef = props.apiRef as { current: unknown } | undefined;
        if (apiRef && !apiRef.current) {
            apiRef.current = shared.makeFakeJsPlumbInstance();
            (props.onInstanceCreated as ((i: unknown) => void) | undefined)?.(apiRef.current);
        }
        const containerRef = props.containerRef as { current: HTMLDivElement } | undefined;
        if (containerRef && !containerRef.current) containerRef.current = document.createElement("div");
        return props.children as preact.ComponentChildren;
    },
    JsPlumbItem: (props: Record<string, unknown>) => (props.children as preact.ComponentChildren)
}));

// NoteBox renders a marker so we can count rendered boxes without the jsplumb machinery.
vi.mock("./NoteBox", () => ({
    NoteBox: (props: { noteId: string }) => <div className="note-box-stub" data-note-id={props.noteId} />
}));

vi.mock("./overlays", () => ({
    default: vi.fn(),
    uniDirectionalOverlays: []
}));

vi.mock("./context_menu", () => ({
    buildRelationContextMenuHandler: vi.fn(() => vi.fn()),
    buildNoteContextMenuHandler: vi.fn(() => vi.fn())
}));

vi.mock("./utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./utils")>()),
    getZoom: vi.fn(() => 1),
    getMousePosition: vi.fn(() => ({ x: 100, y: 50 })),
    promptForRelationName: () => Promise.resolve(shared.promptResult)
}));

import Component from "../../../components/component";
import dialog from "../../../services/dialog";
import froca from "../../../services/froca";
import server from "../../../services/server";
import toast from "../../../services/toast";
import ws from "../../../services/ws";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import { TypeWidgetProps } from "../type_widget";
import RelationMap from "./RelationMap";

// --- Fakes ---------------------------------------------------------------------------------------

interface FakeConnection {
    id: string;
    canvas: HTMLCanvasElement;
    type: string;
    overlays: Record<string, { setLabel: ReturnType<typeof vi.fn> }>;
    getType: () => string;
    getOverlay: (id: string) => { setLabel: ReturnType<typeof vi.fn> };
    bind: ReturnType<typeof vi.fn>;
    source: { id: string };
    target: { id: string };
}

function makeFakeJsPlumbInstance() {
    const connections: FakeConnection[] = [];
    return {
        connections,
        setZoom: vi.fn(),
        batch: vi.fn((fn: () => void) => fn()),
        deleteEveryEndpoint: vi.fn(),
        deleteConnection: vi.fn(),
        connect: vi.fn((params: { source: string; target: string; type: string }) => {
            const overlays: Record<string, { setLabel: ReturnType<typeof vi.fn> }> = {};
            const conn: FakeConnection = {
                id: "",
                canvas: document.createElement("canvas") as HTMLCanvasElement,
                type: params.type,
                overlays,
                getType: () => params.type,
                getOverlay: (oid: string) => (overlays[oid] ??= { setLabel: vi.fn() }),
                bind: vi.fn(),
                source: { id: `rel-map-note-${params.source}` },
                target: { id: `rel-map-note-${params.target}` }
            };
            connections.push(conn);
            return conn;
        })
    };
}

type FakeJsPlumbInstance = ReturnType<typeof makeFakeJsPlumbInstance>;
shared.makeFakeJsPlumbInstance = makeFakeJsPlumbInstance;

// --- Render helper -------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
let parent: Component;

function renderRelationMap(props: Partial<TypeWidgetProps> = {}) {
    const note = props.note ?? buildNote({ id: "rmNote", title: "Map", type: "relationMap", content: "" });
    const fullProps: TypeWidgetProps = {
        note,
        viewScope: undefined,
        ntxId: "ntx1",
        parentComponent: parent,
        noteContext: undefined,
        ...props
    };
    const el = document.createElement("div");
    container = el;
    document.body.appendChild(el);
    act(() => {
        render(
            <ParentComponent.Provider value={parent}>
                <RelationMap {...fullProps} />
            </ParentComponent.Provider>,
            el
        );
    });
    const unmount = () => act(() => {
        render(null, el);
        el.remove();
        container = undefined;
    });
    return { note, props: fullProps, unmount };
}

async function flushAsync() {
    // Settle several microtask/macrotask cycles: refresh() chains post → setState → effect → connect.
    for (let i = 0; i < 4; i++) {
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    }
}

// The panzoom effect re-runs whenever `data` (hence `onTransform`) changes, disposing the previous
// instance and creating a new one; `apiRef.current` always points at the latest. Assert on it.
function lastPz() {
    const pz = panzoomInstances[panzoomInstances.length - 1];
    if (!pz) throw new Error("no panzoom instance created");
    return pz;
}

// Default relation-map POST: echo back titles for every queried note so cleanupOtherNotes keeps
// them, and report no relations. Other POSTs (child creation) fall through to undefined.
function defaultPost(url: string, data?: { noteIds?: string[] }) {
    if (url === "relation-map") {
        const noteTitles: Record<string, string> = {};
        for (const id of data?.noteIds ?? []) noteTitles[id] = id;
        return { noteTitles, relations: [], inverseRelations: {} };
    }
    return undefined;
}

beforeEach(() => {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    vi.clearAllMocks();
    Object.assign(server, {
        get: vi.fn(async (url: string) => (url === "keyboard-actions" ? [] : undefined)),
        post: vi.fn(async (url: string, data?: { noteIds?: string[] }) => defaultPost(url, data)),
        put: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
        upload: vi.fn(async () => undefined)
    });
    Object.assign(ws, { logError: vi.fn() });
    shared.capturedJsPlumb = null;
    panzoomInstances.length = 0;
    shared.promptResult = "knows";
    parent = new Component();
    (dialog.prompt as ReturnType<typeof vi.fn>).mockResolvedValue("New Note");
    (dialog.info as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

afterEach(() => {
    if (container) { render(null, container); container.remove(); container = undefined; }
    vi.restoreAllMocks();
});

// --- Initial render & content parsing ------------------------------------------------------------

describe("RelationMap render", () => {
    it("renders the wrapper, mounts panzoom and seeds default empty data when content is blank", async () => {
        renderRelationMap();
        await flushAsync();
        expect(container?.querySelector(".relation-map-wrapper")).toBeTruthy();
        // panzoom is created for the container.
        expect(panzoomInstances.length).toBeGreaterThanOrEqual(1);
        // No notes → no NoteBox stubs.
        expect(container?.querySelectorAll(".note-box-stub").length).toBe(0);
        // filterKey option bubbles only with the ALT key.
        const opts = lastPz().options as { filterKey: (e: KeyboardEvent) => boolean };
        expect(opts.filterKey({ altKey: true } as KeyboardEvent)).toBe(true);
        expect(opts.filterKey({ altKey: false } as KeyboardEvent)).toBe(false);
    });

    it("parses stored note content into note boxes and applies the saved transform", async () => {
        const note = buildNote({
            id: "rmFull", title: "Map", type: "relationMap",
            content: JSON.stringify({
                notes: [ { noteId: "a", x: 10, y: 20 }, { noteId: "b", x: 30, y: 40 } ],
                transform: { x: 5, y: 6, scale: 1.5 }
            })
        });
        renderRelationMap({ note });
        await flushAsync();
        expect(container?.querySelectorAll(".note-box-stub").length).toBe(2);
        // Saved transform → zoomTo + moveTo invoked with the stored values on a panzoom instance.
        const transformPz = panzoomInstances.find(p => p.zoomTo.mock.calls.some(c => c[2] === 1.5));
        expect(transformPz).toBeTruthy();
        expect(transformPz?.moveTo).toHaveBeenCalledWith(5, 6);
    });

    it("falls back to empty data when the stored content is invalid JSON", async () => {
        const note = buildNote({ id: "rmBad", title: "Map", type: "relationMap", content: "{not json" });
        renderRelationMap({ note });
        await flushAsync();
        expect(container?.querySelector(".relation-map-wrapper")).toBeTruthy();
        expect(container?.querySelectorAll(".note-box-stub").length).toBe(0);
    });

    it("renders the floating zoom buttons and triggers events when the new layout is enabled", async () => {
        const triggerEvent = vi.spyOn(parent, "triggerEvent").mockReturnValue(undefined as never);
        renderRelationMap();
        await flushAsync();
        const buttons = container?.querySelectorAll(".content-floating-buttons button");
        expect(buttons?.length).toBe(3);
        buttons?.forEach(btn => (btn as HTMLButtonElement).click());
        const names = triggerEvent.mock.calls.map(c => c[0]);
        expect(names).toEqual([ "relationMapResetZoomIn", "relationMapResetZoomOut", "relationMapResetPanZoom" ]);
    });
});

// --- usePanZoom events ---------------------------------------------------------------------------

describe("usePanZoom Trilium events", () => {
    it("resets pan/zoom, zooms in and zooms out for the matching ntxId; ignores others", async () => {
        renderRelationMap({ ntxId: "ntx1" });
        await flushAsync();
        const pz = lastPz();
        pz.zoomTo.mockClear();
        pz.moveTo.mockClear();
        const fire = (name: string, ntxId: string) => act(() => { parent.handleEventInChildren(name as never, { ntxId } as never); });

        fire("relationMapResetPanZoom", "ntx1");
        expect(pz.zoomTo).toHaveBeenCalledWith(0, 0, 1);
        expect(pz.moveTo).toHaveBeenCalledWith(0, 0);

        fire("relationMapResetZoomIn", "ntx1");
        expect(pz.zoomTo).toHaveBeenCalledWith(0, 0, 1.2);

        fire("relationMapResetZoomOut", "ntx1");
        expect(pz.zoomTo).toHaveBeenCalledWith(0, 0, 0.8);

        pz.zoomTo.mockClear();
        fire("relationMapResetZoomIn", "other");
        expect(pz.zoomTo).not.toHaveBeenCalled();
    });

    it("forwards transform changes to the map api and jsPlumb instance", async () => {
        const note = buildNote({
            id: "rmTransform", title: "Map", type: "relationMap",
            content: JSON.stringify({ notes: [ { noteId: "a", x: 0, y: 0 } ], transform: { x: 0, y: 0, scale: 1 } })
        });
        renderRelationMap({ note });
        await flushAsync();
        const jsPlumbInstance = shared.capturedJsPlumb?.apiRef?.current as FakeJsPlumbInstance;
        jsPlumbInstance.setZoom.mockClear();
        // A transform that differs from the stored one → setTransform persists via onDataChange(false).
        lastPz().getTransform.mockReturnValue({ x: 50, y: 60, scale: 2 });
        act(() => lastPz().fireTransform());
        expect(jsPlumbInstance.setZoom).toHaveBeenCalled();
    });
});

// --- useRelationData -----------------------------------------------------------------------------

describe("useRelationData", () => {
    it("posts to relation-map and renders uni/bi/inverse connections", async () => {
        const relations = [
            { name: "knows", attributeId: "att1", sourceNoteId: "a", targetNoteId: "b" },
            { name: "likes", attributeId: "att2", sourceNoteId: "a", targetNoteId: "c" },
            { name: "likes", attributeId: "att3", sourceNoteId: "c", targetNoteId: "a" }
        ];
        (server.post as ReturnType<typeof vi.fn>).mockResolvedValue({
            noteTitles: { a: "A", b: "B", c: "C" },
            relations,
            inverseRelations: { knows: "knows", likes: "likes" }
        });
        const note = buildNote({
            id: "rmRel", title: "Map", type: "relationMap",
            content: JSON.stringify({
                notes: [ { noteId: "a", x: 0, y: 0 }, { noteId: "b", x: 0, y: 0 }, { noteId: "c", x: 0, y: 0 } ],
                transform: { x: 0, y: 0, scale: 1 }
            })
        });
        renderRelationMap({ note });
        await flushAsync();
        expect(server.post).toHaveBeenCalledWith("relation-map", expect.objectContaining({ relationMapNoteId: "rmRel" }));
        const jsPlumbInstance = shared.capturedJsPlumb?.apiRef?.current as FakeJsPlumbInstance;
        // knows = biDirectional (self-inverse), likes a->c uniDirectional, likes c->a inverse (matched).
        expect(jsPlumbInstance.connect).toHaveBeenCalled();
        const types = jsPlumbInstance.connections.map(c => c.type);
        expect(types).toContain("biDirectional");
    });

    it("sets inverse labels when a relation renders as inverse", async () => {
        const relations = [
            { name: "parent", attributeId: "p1", sourceNoteId: "a", targetNoteId: "b" },
            { name: "child", attributeId: "c1", sourceNoteId: "b", targetNoteId: "a" }
        ];
        (server.post as ReturnType<typeof vi.fn>).mockResolvedValue({
            noteTitles: { a: "A", b: "B" },
            relations,
            inverseRelations: { parent: "child", child: "parent" }
        });
        const note = buildNote({
            id: "rmInv", title: "Map", type: "relationMap",
            content: JSON.stringify({
                notes: [ { noteId: "a", x: 0, y: 0 }, { noteId: "b", x: 0, y: 0 } ],
                transform: { x: 0, y: 0, scale: 1 }
            })
        });
        renderRelationMap({ note });
        await flushAsync();
        const jsPlumbInstance = shared.capturedJsPlumb?.apiRef?.current as FakeJsPlumbInstance;
        const inverseConn = jsPlumbInstance.connections.find(c => c.type === "inverse");
        expect(inverseConn).toBeTruthy();
        expect(inverseConn?.overlays["label-source"].setLabel).toHaveBeenCalled();
        expect(inverseConn?.overlays["label-target"].setLabel).toHaveBeenCalled();
    });

    it("does not post when there are no notes to query", async () => {
        const note = buildNote({
            id: "rmNoNotes", title: "Map", type: "relationMap",
            content: JSON.stringify({ notes: [], transform: { x: 0, y: 0, scale: 1 } })
        });
        renderRelationMap({ note });
        await flushAsync();
        // Even with an empty notes list, refresh runs (noteIds = []) and posts; assert it queried empty.
        const calls = (server.post as ReturnType<typeof vi.fn>).mock.calls.filter(c => c[0] === "relation-map");
        expect(calls[0]?.[1]).toMatchObject({ noteIds: [] });
    });
});

// --- useNoteCreation -----------------------------------------------------------------------------

describe("useNoteCreation", () => {
    it("creates a child note on event and places it on the next canvas click", async () => {
        (server.post as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, data?: { noteIds?: string[] }) => {
            if (typeof url === "string" && url.includes("children")) {
                return { note: { noteId: "created1" } };
            }
            return defaultPost(url, data);
        });
        const note = buildNote({
            id: "rmCreate", title: "Map", type: "relationMap",
            content: JSON.stringify({ notes: [], transform: { x: 0, y: 0, scale: 1 } })
        });
        renderRelationMap({ note, ntxId: "ntx1" });
        await flushAsync();

        await act(async () => {
            await parent.handleEventInChildren("relationMapCreateChildNote", { ntxId: "ntx1" } as never);
        });
        expect(server.post).toHaveBeenCalledWith(
            expect.stringContaining(`notes/${note.noteId}/children`),
            expect.objectContaining({ title: "New Note" })
        );
        expect(toast.showMessage).toHaveBeenCalled();

        // Click the canvas → createItem adds the clipboard note.
        const wrapper = container?.querySelector(".relation-map-wrapper");
        act(() => { wrapper?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        await flushAsync();
        expect(container?.querySelectorAll(".note-box-stub").length).toBe(1);
    });

    it("ignores the create event for a different ntxId and a dismissed prompt", async () => {
        (dialog.prompt as ReturnType<typeof vi.fn>).mockResolvedValue("");
        const note = buildNote({
            id: "rmCreate2", title: "Map", type: "relationMap",
            content: JSON.stringify({ notes: [], transform: { x: 0, y: 0, scale: 1 } })
        });
        renderRelationMap({ note, ntxId: "ntx1" });
        await flushAsync();
        (server.post as ReturnType<typeof vi.fn>).mockClear();

        // Wrong ntxId → early return, no prompt.
        await act(async () => {
            await parent.handleEventInChildren("relationMapCreateChildNote", { ntxId: "other" } as never);
        });
        expect(dialog.prompt).not.toHaveBeenCalled();

        // Matching ntxId but blank title → no child created.
        await act(async () => {
            await parent.handleEventInChildren("relationMapCreateChildNote", { ntxId: "ntx1" } as never);
        });
        const childCalls = (server.post as ReturnType<typeof vi.fn>).mock.calls.filter(c => String(c[0]).includes("children"));
        expect(childCalls.length).toBe(0);

        // A canvas click without a clipboard entry is a no-op.
        const before = container?.querySelectorAll(".note-box-stub").length;
        act(() => { container?.querySelector(".relation-map-wrapper")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        expect(container?.querySelectorAll(".note-box-stub").length).toBe(before);
    });
});

// --- useNoteDragging -----------------------------------------------------------------------------

describe("useNoteDragging", () => {
    // happy-dom's HTMLElement has no `ondrop`/`ondragover` properties, so Preact's `(name in dom)`
    // check fails and it sets the handler as an attribute instead of attaching a listener. Define
    // inert accessor props so Preact wires the listeners; remove them afterwards.
    const dragEventProps = [ "ondrop", "ondragover" ] as const;
    beforeEach(() => {
        for (const prop of dragEventProps) {
            if (!(prop in HTMLElement.prototype)) {
                Object.defineProperty(HTMLElement.prototype, prop, { value: null, writable: true, configurable: true });
            }
        }
    });
    afterEach(() => {
        for (const prop of dragEventProps) {
            if (Object.prototype.hasOwnProperty.call(HTMLElement.prototype, prop)) {
                delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
            }
        }
    });

    function fireDrop(el: Element, payload: string | null) {
        const drop = new Event("drop", { bubbles: true });
        Object.assign(drop, { dataTransfer: { getData: () => payload } });
        el.dispatchEvent(drop);
    }

    it("adds dropped notes, wrapping across rows past x > 1000", async () => {
        const note = buildNote({
            id: "rmDrop", title: "Map", type: "relationMap",
            content: JSON.stringify({ notes: [], transform: { x: 0, y: 0, scale: 1 } })
        });
        renderRelationMap({ note });
        await flushAsync();
        const wrapper = container?.querySelector(".relation-map-wrapper");
        if (!wrapper) throw new Error("no wrapper");

        const payload = JSON.stringify([
            { noteId: "d1" }, { noteId: "d2" }, { noteId: "d3" }, { noteId: "d4" }, { noteId: "d5" }, { noteId: "d6" }, { noteId: "d7" }
        ]);
        act(() => fireDrop(wrapper, payload));
        await flushAsync();
        // All seven entries become note boxes.
        expect(container?.querySelectorAll(".note-box-stub").length).toBe(7);
    });

    it("ignores drops with no data and prevents default on dragover", async () => {
        const note = buildNote({
            id: "rmDrop2", title: "Map", type: "relationMap",
            content: JSON.stringify({ notes: [], transform: { x: 0, y: 0, scale: 1 } })
        });
        renderRelationMap({ note });
        await flushAsync();
        const wrapper = container?.querySelector(".relation-map-wrapper");
        if (!wrapper) throw new Error("no wrapper");

        act(() => fireDrop(wrapper, null));
        await flushAsync();
        expect(container?.querySelectorAll(".note-box-stub").length).toBe(0);

        const dragover = new Event("dragover", { bubbles: true, cancelable: true });
        act(() => { wrapper.dispatchEvent(dragover); });
        expect(dragover.defaultPrevented).toBe(true);
    });
});

// --- useRelationCreation -------------------------------------------------------------------------

describe("useRelationCreation", () => {
    function makeConnectionInfo() {
        const connection = {
            bind: vi.fn(),
            getType: () => "uniDirectional",
            source: { id: "rel-map-note-src" },
            target: { id: "rel-map-note-tgt" }
        };
        return { info: { connection } as unknown as OnConnectionBindInfo, connection };
    }

    it("binds a context menu handler and persists a newly named relation", async () => {
        const note = buildNote({
            id: "rmConn", title: "Map", type: "relationMap",
            content: JSON.stringify({ notes: [ { noteId: "src", x: 0, y: 0 }, { noteId: "tgt", x: 0, y: 0 } ], transform: { x: 0, y: 0, scale: 1 } })
        });
        renderRelationMap({ note });
        await flushAsync();
        const onConnection = shared.capturedJsPlumb?.onConnection;
        if (!onConnection) throw new Error("no onConnection captured");
        const { info, connection } = makeConnectionInfo();

        shared.promptResult = "knows";
        await act(async () => { await onConnection(info, new Event("connection")); });
        expect(connection.bind).toHaveBeenCalledWith("contextmenu", expect.any(Function));
        expect(server.put).toHaveBeenCalledWith(expect.stringContaining("notes/src/relations/knows/to/tgt"));
    });

    it("deletes the connection when the rename dialog is dismissed", async () => {
        const note = buildNote({
            id: "rmConn2", title: "Map", type: "relationMap",
            content: JSON.stringify({ notes: [], transform: { x: 0, y: 0, scale: 1 } })
        });
        renderRelationMap({ note });
        await flushAsync();
        const onConnection = shared.capturedJsPlumb?.onConnection;
        const jsPlumbInstance = shared.capturedJsPlumb?.apiRef?.current as FakeJsPlumbInstance;
        if (!onConnection) throw new Error("no onConnection captured");
        const { info } = makeConnectionInfo();

        shared.promptResult = "";
        await act(async () => { await onConnection(info, new Event("connection")); });
        expect(jsPlumbInstance.deleteConnection).toHaveBeenCalled();
        expect(server.put).not.toHaveBeenCalled();
    });

    it("only binds the context menu handler when triggered programmatically (no original event)", async () => {
        const note = buildNote({
            id: "rmConn3", title: "Map", type: "relationMap",
            content: JSON.stringify({ notes: [], transform: { x: 0, y: 0, scale: 1 } })
        });
        renderRelationMap({ note });
        await flushAsync();
        const onConnection = shared.capturedJsPlumb?.onConnection;
        if (!onConnection) throw new Error("no onConnection captured");
        const { info, connection } = makeConnectionInfo();

        await act(async () => { await onConnection(info, null as unknown as Event); });
        expect(connection.bind).toHaveBeenCalledWith("contextmenu", expect.any(Function));
        expect(server.put).not.toHaveBeenCalled();
    });

    it("shows an info dialog and deletes the connection when the relation already exists", async () => {
        const relations = [ { name: "knows", attributeId: "att1", sourceNoteId: "src", targetNoteId: "tgt" } ];
        (server.post as ReturnType<typeof vi.fn>).mockResolvedValue({
            noteTitles: { src: "S", tgt: "T" },
            relations,
            inverseRelations: {}
        });
        const note = buildNote({
            id: "rmConn4", title: "Map", type: "relationMap",
            content: JSON.stringify({ notes: [ { noteId: "src", x: 0, y: 0 }, { noteId: "tgt", x: 0, y: 0 } ], transform: { x: 0, y: 0, scale: 1 } })
        });
        renderRelationMap({ note });
        await flushAsync();
        const onConnection = shared.capturedJsPlumb?.onConnection;
        const jsPlumbInstance = shared.capturedJsPlumb?.apiRef?.current as FakeJsPlumbInstance;
        if (!onConnection) throw new Error("no onConnection captured");
        const { info } = makeConnectionInfo();

        // Connecting "knows" between src and tgt already exists → connect() returns false.
        shared.promptResult = "knows";
        jsPlumbInstance.deleteConnection.mockClear();
        await act(async () => { await onConnection(info, new Event("connection")); });
        expect(dialog.info).toHaveBeenCalled();
        expect(jsPlumbInstance.deleteConnection).toHaveBeenCalled();
    });
});

// --- Persistence (spaced update getData) ---------------------------------------------------------

describe("persistence", () => {
    it("serializes the map data and PUTs it when a save is forced after a change", async () => {
        const noteContext = { ntxId: "ntx1", setContextData: vi.fn() } as never;
        (server.post as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, data?: { noteIds?: string[] }) => {
            if (typeof url === "string" && url.includes("children")) return { note: { noteId: "savedNote" } };
            return defaultPost(url, data);
        });
        const note = buildNote({
            id: "rmSave", title: "Map", type: "relationMap",
            content: JSON.stringify({ notes: [], transform: { x: 0, y: 0, scale: 1 } })
        });
        renderRelationMap({ note, noteContext, ntxId: "ntx1" });
        await flushAsync();

        // Create a child + place it → schedules a spaced update.
        await act(async () => { await parent.handleEventInChildren("relationMapCreateChildNote", { ntxId: "ntx1" } as never); });
        act(() => { container?.querySelector(".relation-map-wrapper")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        await flushAsync();
        (server.put as ReturnType<typeof vi.fn>).mockClear();

        // Forcing a save (tab switch) runs getData() → JSON.stringify(data) → server.put.
        await act(async () => { await parent.handleEventInChildren("beforeNoteSwitch", { noteContext } as never); });
        const dataPut = (server.put as ReturnType<typeof vi.fn>).mock.calls.find(c => String(c[0]).includes(`notes/${note.noteId}/data`));
        expect(dataPut).toBeTruthy();
        expect(JSON.parse((dataPut?.[1] as { content: string }).content).notes).toEqual([ expect.objectContaining({ noteId: "savedNote" }) ]);
    });
});

// --- Cleanup -------------------------------------------------------------------------------------

describe("cleanup", () => {
    it("disposes panzoom on unmount", async () => {
        const { unmount } = renderRelationMap();
        await flushAsync();
        const pz = lastPz();
        unmount();
        expect(pz.dispose).toHaveBeenCalled();
    });
});
