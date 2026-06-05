import { OptionNames } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

interface FakeBus {
    listeners: Record<string, ((arg?: unknown) => void)[]>;
    addListener: (name: string, cb: (arg?: unknown) => void) => void;
    removeListener: (name: string, cb: (arg?: unknown) => void) => void;
    emit: (name: string, arg?: unknown) => void;
}

interface FakeInstance {
    nodes: HTMLElement;
    theme: unknown;
    bus: FakeBus;
    init: ReturnType<typeof vi.fn>;
    getData: ReturnType<typeof vi.fn>;
    getDataString: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    changeTheme: ReturnType<typeof vi.fn>;
    install: ReturnType<typeof vi.fn>;
}

// Shared, mutable state usable from both the hoisted vi.mock factories and the tests.
const mindMapState = vi.hoisted(() => ({
    instances: [] as unknown[],
    changeThemeThrows: false,
    LIGHT_THEME: { name: "light" },
    DARK_THEME: { name: "dark" },
    snapdomUrl: "data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E"
}));
const instances = mindMapState.instances as FakeInstance[];
const LIGHT_THEME = mindMapState.LIGHT_THEME;
const DARK_THEME = mindMapState.DARK_THEME;

// CSS side-effect imports — happy-dom can't parse these, so stub them out.
vi.mock("mind-elixir/style", () => ({}));
vi.mock("@mind-elixir/node-menu/dist/style.css", () => ({}));
vi.mock("./MindMap.css", () => ({}));

vi.mock("mind-elixir", () => {
    function makeBus(): FakeBus {
        const listeners: Record<string, ((arg?: unknown) => void)[]> = {};
        return {
            listeners,
            addListener(name, cb) { (listeners[name] ??= []).push(cb); },
            removeListener(name, cb) { listeners[name] = (listeners[name] ?? []).filter((l) => l !== cb); },
            emit(name, arg) { for (const l of listeners[name] ?? []) l(arg); }
        };
    }

    class VanillaMindElixir {
        nodes: HTMLElement;
        theme: unknown;
        bus: FakeBus;
        init = vi.fn();
        getData = vi.fn(() => ({ nodeData: { topic: "root" } }));
        getDataString = vi.fn(() => "{\"nodeData\":{\"topic\":\"root\"}}");
        destroy = vi.fn();
        changeTheme = vi.fn((theme: unknown) => {
            if (mindMapState.changeThemeThrows) throw new Error("theme failure");
            this.theme = theme;
        });
        install = vi.fn();

        constructor(opts: { theme?: unknown }) {
            const canvas = document.createElement("div");
            canvas.className = "map-canvas";
            this.nodes = canvas;
            this.theme = opts.theme;
            this.bus = makeBus();
            mindMapState.instances.push(this);
        }

        static new = vi.fn((topic: string) => ({ nodeData: { topic } }));
    }

    return {
        default: VanillaMindElixir,
        THEME: mindMapState.LIGHT_THEME,
        DARK_THEME: mindMapState.DARK_THEME
    };
});

vi.mock("@mind-elixir/node-menu", () => ({ default: { name: "node-menu-plugin" } }));

vi.mock("@zumer/snapdom", () => ({
    snapdom: vi.fn(async () => ({ url: mindMapState.snapdomUrl }))
}));

vi.mock("../../services/sanitize_content", () => ({
    sanitizeNoteContentHtml: vi.fn((html: string) => `clean:${html}`)
}));

import type NoteContext from "../../components/note_context";
import Component from "../../components/component";
import froca from "../../services/froca";
import options from "../../services/options";
import server from "../../services/server";
import utils from "../../services/utils";
import ws from "../../services/ws";
import { buildNote } from "../../test/easy-froca";
import { NoteContextContext, ParentComponent } from "../react/react_utils";
import { TypeWidgetProps } from "./type_widget";
import MindMap, { sanitizeMindMapData } from "./MindMap";

// --- Render harness for the component (drives Trilium events through a real parent) ----------------

interface MountResult {
    parent: Component;
    container: HTMLDivElement;
    fireEvent: (name: string, data: unknown) => void;
    unmount: () => void;
}

function mountMindMap(props: TypeWidgetProps, noteContext: NoteContext | null): MountResult {
    const parent = new Component();
    const container = document.createElement("div");
    document.body.appendChild(container);
    act(() => render((
        <ParentComponent.Provider value={parent}>
            <NoteContextContext.Provider value={noteContext}>
                <MindMap {...props} />
            </NoteContextContext.Provider>
        </ParentComponent.Provider>
    ), container));
    return {
        parent,
        container,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fireEvent: (name, data) => act(() => { (parent.handleEventInChildren as any)(name, data); }),
        unmount: () => act(() => { render(null, container); container.remove(); })
    };
}

function fakeNoteContext(overrides: Record<string, unknown> = {}): NoteContext {
    return {
        ntxId: "ntx1",
        hoistedNoteId: "root",
        notePath: "root/mm",
        viewScope: { viewMode: "default", readOnlyTemporarilyDisabled: false },
        isReadOnly: vi.fn(async () => false),
        setContextData: vi.fn(),
        getContextData: vi.fn(),
        clearContextData: vi.fn(),
        ...overrides
    } as unknown as NoteContext;
}

function makeProps(note: ReturnType<typeof buildNote>, ntxId: string | null | undefined = "ntx1"): TypeWidgetProps {
    return {
        note,
        ntxId,
        viewScope: undefined,
        parentComponent: undefined,
        noteContext: fakeNoteContext({ ntxId })
    } as unknown as TypeWidgetProps;
}

async function flush() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

/** The instance the component's apiRef currently points at (the last one created). */
function latestInstance(): FakeInstance {
    const inst = instances[instances.length - 1];
    if (!inst) throw new Error("no mind-elixir instance was created");
    return inst;
}

beforeEach(() => {
    instances.length = 0;
    mindMapState.changeThemeThrows = false;
    mindMapState.snapdomUrl = "data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E";
    options.load({ locale: "en" } as Record<OptionNames, string>);
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    vi.clearAllMocks();
    Object.assign(server, { put: vi.fn(async () => undefined), upload: vi.fn(async () => undefined) });
    Object.assign(ws, { logError: vi.fn() });
    const glob = window.glob as unknown as Record<string, unknown>;
    glob.getThemeStyle = () => "light";
});

afterEach(async () => {
    await act(async () => {});
    vi.restoreAllMocks();
});

// --- sanitizeMindMapData (pure) -------------------------------------------------------------------

describe("sanitizeMindMapData", () => {
    it("sanitizes dangerouslySetInnerHTML anywhere in the tree and returns the same object", () => {
        const data = {
            nodeData: {
                topic: "root",
                dangerouslySetInnerHTML: "<img src=x>",
                children: [
                    { topic: "a", dangerouslySetInnerHTML: "<b>hi</b>" },
                    { topic: "b" }
                ]
            },
            arrows: [ { dangerouslySetInnerHTML: "<i>x</i>" } ]
        };
        const result = sanitizeMindMapData(data);
        expect(result).toBe(data);
        expect(data.nodeData.dangerouslySetInnerHTML).toBe("clean:<img src=x>");
        expect(data.nodeData.children[0].dangerouslySetInnerHTML).toBe("clean:<b>hi</b>");
        expect(data.arrows[0].dangerouslySetInnerHTML).toBe("clean:<i>x</i>");
    });

    it("leaves non-string dangerouslySetInnerHTML and primitives/null untouched", () => {
        const data = {
            nodeData: { topic: "root", dangerouslySetInnerHTML: 123, nested: null, flag: true },
            list: [ "string", 5, null ]
        };
        const result = sanitizeMindMapData(data);
        expect(result.nodeData.dangerouslySetInnerHTML).toBe(123);
        expect(result.nodeData.nested).toBeNull();
        // Primitive inputs pass straight through.
        expect(sanitizeMindMapData("plain")).toBe("plain");
        expect(sanitizeMindMapData(null)).toBeNull();
    });
});

// --- Component rendering & lifecycle --------------------------------------------------------------

describe("MindMap component", () => {
    it("renders the container and initializes a mind-elixir instance with content", async () => {
        const note = buildNote({ id: "mm1", title: "Map", type: "mindMap", content: "{\"nodeData\":{\"topic\":\"hi\"}}" });
        const result = mountMindMap(makeProps(note), fakeNoteContext());
        await flush();

        expect(result.container.querySelector(".mind-map-container")).toBeTruthy();
        expect(instances.length).toBeGreaterThanOrEqual(1);
        // editable (not read-only) → node-menu plugin installed and light theme.
        const inst = latestInstance();
        expect(inst.install).toHaveBeenCalled();
        expect(inst.theme).toBe(LIGHT_THEME);
        // onContentChange parsed the JSON and re-initialized.
        expect(inst.init).toHaveBeenCalled();
        result.unmount();
        expect(inst.destroy).toHaveBeenCalled();
    });

    it("initializes a brand-new map when the note has no content", async () => {
        const note = buildNote({ id: "mm2", title: "Empty", type: "mindMap", content: "" });
        const result = mountMindMap(makeProps(note), fakeNoteContext());
        await flush();
        expect(latestInstance().init).toHaveBeenCalled();
        result.unmount();
    });

    it("warns and skips init on invalid JSON content", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
        const note = buildNote({ id: "mm3", title: "Bad", type: "mindMap", content: "{not json" });
        const result = mountMindMap(makeProps(note), fakeNoteContext());
        await flush();
        expect(warn).toHaveBeenCalled();
        expect(debug).toHaveBeenCalled();
        result.unmount();
    });

    it("renders read-only (no node-menu plugin) when the note has #readOnly", async () => {
        const note = buildNote({ id: "mm4", title: "RO", type: "mindMap", content: "", "#readOnly": "true" });
        const result = mountMindMap(makeProps(note), fakeNoteContext({ viewScope: { readOnlyTemporarilyDisabled: false } }));
        await flush();
        for (const inst of instances) {
            expect(inst.install).not.toHaveBeenCalled();
        }
        result.unmount();
    });
});

// --- Trilium events -------------------------------------------------------------------------------

describe("MindMap Trilium events", () => {
    it("executeWithContentElement resolves the map canvas for the matching context", async () => {
        const note = buildNote({ id: "mmE1", title: "M", type: "mindMap", content: "" });
        const result = mountMindMap(makeProps(note, "ntxA"), fakeNoteContext({ ntxId: "ntxA" }));
        await flush();

        const resolve = vi.fn();
        result.fireEvent("executeWithContentElement", { resolve, ntxId: "ntxA" });
        expect(resolve).toHaveBeenCalledTimes(1);

        // Mismatched context → ignored.
        const resolve2 = vi.fn();
        result.fireEvent("executeWithContentElement", { resolve: resolve2, ntxId: "other" });
        expect(resolve2).not.toHaveBeenCalled();
        result.unmount();
    });

    it("exportSvg / exportPng download for the matching context and ignore mismatches", async () => {
        const downloadAsSvg = vi.spyOn(utils, "downloadAsSvg").mockResolvedValue(undefined);
        const downloadAsPng = vi.spyOn(utils, "downloadAsPng").mockResolvedValue(undefined);
        const note = buildNote({ id: "mmE2", title: "Exp", type: "mindMap", content: "" });
        const result = mountMindMap(makeProps(note, "ntxB"), fakeNoteContext({ ntxId: "ntxB" }));
        await flush();

        result.fireEvent("exportSvg", { ntxId: "ntxB" });
        await flush();
        expect(downloadAsSvg).toHaveBeenCalledWith("Exp", expect.anything());

        result.fireEvent("exportPng", { ntxId: "ntxB" });
        await flush();
        expect(downloadAsPng).toHaveBeenCalledWith("Exp", expect.anything());

        // Mismatched context → neither is called again.
        downloadAsSvg.mockClear();
        result.fireEvent("exportSvg", { ntxId: "nope" });
        await flush();
        expect(downloadAsSvg).not.toHaveBeenCalled();
        result.unmount();
    });

    it("schedules + saves: operation bus events trigger onChange and getData builds the svg attachment", async () => {
        const note = buildNote({ id: "mmE3", title: "Save", type: "mindMap", content: "" });
        const result = mountMindMap(makeProps(note, "ntxC"), fakeNoteContext({ ntxId: "ntxC" }));
        await flush();

        const inst = latestInstance();
        // A non-beginEdit operation on the bus → onChange → spacedUpdate.scheduleUpdate().
        act(() => inst.bus.emit("operation", { name: "addChild" }));
        // beginEdit must be ignored (no onChange).
        act(() => inst.bus.emit("operation", { name: "beginEdit" }));
        // changeDirection also triggers onChange.
        act(() => inst.bus.emit("changeDirection"));
        await flush();

        // Flush the scheduled update by closing the note context → updateNowIfNecessary → getData → server.put.
        result.fireEvent("beforeNoteContextRemove", { ntxIds: [ "ntxC" ] });
        await flush();

        // getData ran: it serialized the map and built a decoded svg attachment.
        expect(inst.getDataString).toHaveBeenCalled();
        expect(server.put).toHaveBeenCalled();
        const putBody = (server.put as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
            content: string;
            attachments: { content: string; mime: string; role: string; title: string }[];
        };
        expect(putBody.attachments[0]?.mime).toBe("image/svg+xml");
        // "%3Csvg%3E%3C%2Fsvg%3E" → "<svg></svg>" via decodeURIComponent.
        expect(putBody.attachments[0]?.content).toBe("<svg></svg>");

        result.unmount();
        await flush();
    });
});

// --- Theme & locale reactions ---------------------------------------------------------------------

describe("MindMap theme/locale", () => {
    it("starts in dark theme when the global theme is dark", async () => {
        const glob = window.glob as unknown as Record<string, unknown>;
        glob.getThemeStyle = () => "dark";
        const note = buildNote({ id: "mmT1", title: "Dark", type: "mindMap", content: "" });
        const result = mountMindMap(makeProps(note), fakeNoteContext());
        await flush();
        expect(latestInstance().theme).toBe(DARK_THEME);
        result.unmount();
    });

    it("changes theme on color-scheme change, skips when unchanged, and survives errors", async () => {
        const listeners = new Set<(e: { matches: boolean }) => void>();
        const matchMedia = vi.fn(() => ({
            matches: false,
            addEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.add(l),
            removeEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.delete(l)
        }));
        Object.assign(window, { matchMedia });
        const glob = window.glob as unknown as Record<string, unknown>;
        glob.getThemeStyle = () => "auto";

        const note = buildNote({ id: "mmT2", title: "Auto", type: "mindMap", content: "" });
        const result = mountMindMap(makeProps(note), fakeNoteContext());
        await flush();
        const inst = latestInstance();

        // light → dark triggers changeTheme.
        act(() => listeners.forEach((l) => l({ matches: true })));
        await flush();
        expect(inst.changeTheme).toHaveBeenCalledWith(DARK_THEME);

        // Firing again with the same scheme is a no-op (theme already equals newTheme).
        const callsAfterDark = inst.changeTheme.mock.calls.length;
        act(() => listeners.forEach((l) => l({ matches: true })));
        await flush();
        expect(inst.changeTheme.mock.calls.length).toBe(callsAfterDark);

        // Error path: changeTheme throws → caught & warned.
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        mindMapState.changeThemeThrows = true;
        act(() => listeners.forEach((l) => l({ matches: false })));
        await flush();
        expect(warn).toHaveBeenCalled();
        result.unmount();
    });

    it("reinitializes preserving data when locale changes", async () => {
        const note = buildNote({ id: "mmT3", title: "Loc", type: "mindMap", content: "" });
        const result = mountMindMap(makeProps(note), fakeNoteContext());
        await flush();
        const before = instances.length;

        options.load({ locale: "de" } as Record<OptionNames, string>);
        result.fireEvent("entitiesReloaded", {
            loadResults: {
                getAttributeRows: () => [],
                getBranchRows: () => [],
                getOptionNames: () => [ "locale" ],
                isNoteReloaded: () => false,
                isNoteContentReloaded: () => false,
                getEntityRow: () => undefined
            }
        });
        await flush();
        // A new instance is created on locale change, and existing data is re-applied.
        expect(instances.length).toBeGreaterThan(before);
        const latest = instances[instances.length - 1];
        expect(latest.init).toHaveBeenCalled();
        result.unmount();
    });
});

// --- Keyboard handling ----------------------------------------------------------------------------

describe("MindMap keyboard", () => {
    it("stops propagation for F1 and ctrl-zoom keys, leaves others alone", async () => {
        const note = buildNote({ id: "mmK1", title: "K", type: "mindMap", content: "" });
        const result = mountMindMap(makeProps(note), fakeNoteContext());
        await flush();
        const container = result.container.querySelector(".mind-map-container");
        expect(container).toBeTruthy();
        if (!container) {
            result.unmount();
            return;
        }

        function dispatchKey(init: KeyboardEventInit) {
            const ev = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
            const spy = vi.spyOn(ev, "stopPropagation");
            container?.dispatchEvent(ev);
            return spy;
        }

        expect(dispatchKey({ key: "F1" })).toHaveBeenCalled();
        expect(dispatchKey({ key: "-", ctrlKey: true })).toHaveBeenCalled();
        expect(dispatchKey({ key: "=", ctrlKey: true })).toHaveBeenCalled();
        expect(dispatchKey({ key: "0", ctrlKey: true })).toHaveBeenCalled();
        // ctrl+alt should NOT stop propagation (isCtrl is false).
        expect(dispatchKey({ key: "-", ctrlKey: true, altKey: true })).not.toHaveBeenCalled();
        // A plain key is left alone.
        expect(dispatchKey({ key: "a" })).not.toHaveBeenCalled();
        result.unmount();
    });
});
