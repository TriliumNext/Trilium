import { OptionNames } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the hook import) -------------------------------------------------

vi.mock("bootstrap", () => {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        config: unknown;
        constructor(el: Element, config?: unknown) { this.element = el; this.config = config; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
    }
    return { Tooltip, default: { Tooltip } };
});
vi.mock("../../services/math", () => ({ default: { render: vi.fn() } }));
vi.mock("../../services/keyboard_actions", () => ({
    default: {
        getAction: vi.fn(async () => ({ effectiveShortcuts: [ "ctrl+k" ] })),
        setupActionsForElement: vi.fn(async () => [])
    }
}));
vi.mock("../../services/shortcuts", () => ({
    default: { bindGlobalShortcut: vi.fn(), removeGlobalShortcut: vi.fn() },
    removeIndividualBinding: vi.fn()
}));
vi.mock("../../services/toast", () => ({ default: { showPersistent: vi.fn(), closePersistent: vi.fn() } }));
vi.mock("../../services/protected_session_holder", () => ({
    default: { touchProtectedSessionIfNecessary: vi.fn(), isProtectedSessionAvailable: vi.fn(() => true) }
}));
vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    reloadFrontendApp: vi.fn()
}));

import appContext from "../../components/app_context";
import Component from "../../components/component";
import type NoteContext from "../../components/note_context";
import attributes from "../../services/attributes";
import froca from "../../services/froca";
import keyboard_actions from "../../services/keyboard_actions";
import math from "../../services/math";
import options from "../../services/options";
import protected_session_holder from "../../services/protected_session_holder";
import server from "../../services/server";
import shortcuts, { removeIndividualBinding } from "../../services/shortcuts";
import toast from "../../services/toast";
import tree from "../../services/tree";
import { reloadFrontendApp } from "../../services/utils";
import ws from "../../services/ws";
import { buildNote } from "../../test/easy-froca";
import { flush, makeLoadResults, renderHook } from "../../test/render-hook";
import BasicWidget from "../basic_widget";
import NoteContextAwareWidget from "../note_context_aware_widget";
import { ParentComponent } from "./react_utils";
import {
    useActiveNoteContext, useChildNotes, useColorScheme, useContentElement, useEditorSpacedUpdate,
    useEffectiveReadOnly, useElementSize, useGetContextData, useGetContextDataFrom, useGlobalShortcut,
    useImperativeSearchHighlighlighting, useIsNoteReadOnly, useKeyboardShortcuts, useLauncherVisibility,
    useLegacyImperativeHandlers, useLegacyWidget, useLongPressContextMenu, useMathRendering, useNote,
    useNoteBlob, useNoteColorClass, useNoteContext, useNoteIcon, useNoteLabel, useNoteLabelBoolean,
    useNoteLabelInt, useNoteLabelOptionalBool, useNoteLabelWithDefault, useNoteProperty, useNoteRelation,
    useNoteRelationTarget, useNoteSavedData, useNoteTitle, useNoteTreeDrag, useResizeObserver,
    useSetContextData, useSpacedUpdate, useStaticTooltip, useStaticTooltipWithKeyboardShortcut,
    useBlobEditorSpacedUpdate, useSyncedRef, useTextEditor, useTooltip, useTriliumEvent, useTriliumEvents,
    useTriliumOption, useTriliumOptionBool, useTriliumOptionInt, useTriliumOptionJson, useTriliumOptions,
    useUniqueName, useWindowSize
} from "./hooks";
import { noteSavedDataStore } from "./NoteStore";

// --- Shared helpers -------------------------------------------------------------------------------

function setOptions(values: Record<string, string>) {
    options.load(values as Record<OptionNames, string>);
}

/** A minimal `NoteContext`-shaped object; cast through `unknown` since hooks only touch a few fields. */
function fakeNoteContext(overrides: Record<string, unknown> = {}): NoteContext {
    return {
        ntxId: "ntx1",
        hoistedNoteId: "root",
        notePath: "root/note1",
        viewScope: { viewMode: "default", isReadOnly: false },
        setContextData: vi.fn(),
        getContextData: vi.fn(),
        clearContextData: vi.fn(),
        isReadOnly: vi.fn(async () => false),
        ...overrides
    } as unknown as NoteContext;
}

beforeEach(() => {
    setOptions({});
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    vi.clearAllMocks();
    // The auto-mocked server (test/setup.ts) only defines get/post — add the write verbs hooks use.
    Object.assign(server, { put: vi.fn(async () => undefined), upload: vi.fn(async () => undefined) });
    Object.assign(ws, { logError: vi.fn() });
    // Re-establish module-mock defaults that individual tests override (clearAllMocks keeps impls).
    (protected_session_holder.isProtectedSessionAvailable as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (keyboard_actions.setupActionsForElement as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (keyboard_actions.getAction as ReturnType<typeof vi.fn>).mockResolvedValue({ effectiveShortcuts: [ "ctrl+k" ] });
});

afterEach(async () => {
    await act(async () => {});
    vi.restoreAllMocks(); // undo per-test vi.spyOn (froca/tree/attributes) so spies never leak across tests
});

// --- Event subscription ---------------------------------------------------------------------------

describe("useTriliumEvent / useTriliumEvents", () => {
    it("registers a handler, fires it, and removes it on unmount", () => {
        const handler = vi.fn();
        const harness = renderHook(() => useTriliumEvent("noteSwitched", handler));
        harness.fireEvent("noteSwitched", { ntxId: "x" });
        expect(handler).toHaveBeenCalledTimes(1);

        harness.unmount();
        harness.fireEvent("noteSwitched", { ntxId: "y" });
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("registers multiple events and reports the event name", () => {
        const handler = vi.fn();
        const harness = renderHook(() => useTriliumEvents([ "noteSwitched", "frocaReloaded" ], handler));
        harness.fireEvent("noteSwitched", { a: 1 });
        harness.fireEvent("frocaReloaded", { b: 2 });
        expect(handler).toHaveBeenCalledTimes(2);
        expect(handler).toHaveBeenNthCalledWith(1, { a: 1 }, "noteSwitched");
        expect(handler).toHaveBeenNthCalledWith(2, { b: 2 }, "frocaReloaded");
    });
});

// --- Options --------------------------------------------------------------------------------------

describe("useTriliumOption family", () => {
    it("reads, updates externally, saves, and reverts on error", async () => {
        setOptions({ theme: "dark" });
        const harness = renderHook(() => useTriliumOption("theme" as OptionNames));
        expect(harness.result.current[0]).toBe("dark");

        // External change via entitiesReloaded.
        setOptions({ theme: "light" });
        harness.fireEvent("entitiesReloaded", { loadResults: makeLoadResults({ optionNames: [ "theme" ] }) });
        expect(harness.result.current[0]).toBe("light");

        // An unrelated option change is ignored.
        harness.fireEvent("entitiesReloaded", { loadResults: makeLoadResults({ optionNames: [ "other" ] }) });
        expect(harness.result.current[0]).toBe("light");

        // Setter persists and updates state.
        await act(async () => { await harness.result.current[1]("blue"); });
        expect(server.put).toHaveBeenCalledTimes(1);
        expect(harness.result.current[0]).toBe("blue");
    });

    it("reverts and logs when saving fails", async () => {
        setOptions({ theme: "dark" });
        Object.assign(server, { put: vi.fn(async () => { throw new Error("boom"); }) });
        const harness = renderHook(() => useTriliumOption("theme" as OptionNames));
        await act(async () => { await harness.result.current[1]("green"); });
        expect(ws.logError).toHaveBeenCalled();
        expect(harness.result.current[0]).toBe("dark");
    });

    it("reloads the frontend when needsRefresh is set", async () => {
        setOptions({ theme: "dark" });
        const harness = renderHook(() => useTriliumOption("theme" as OptionNames, true));
        await act(async () => { await harness.result.current[1]("x"); });
        expect(reloadFrontendApp).toHaveBeenCalled();
    });

    it("bool/int/json variants convert in both directions", async () => {
        setOptions({ flag: "true", count: "42", payload: JSON.stringify({ a: 1 }) });
        const boolH = renderHook(() => useTriliumOptionBool("flag" as OptionNames));
        const intH = renderHook(() => useTriliumOptionInt("count" as OptionNames));
        const jsonH = renderHook(() => useTriliumOptionJson<{ a: number }>("payload" as OptionNames));
        expect(boolH.result.current[0]).toBe(true);
        expect(intH.result.current[0]).toBe(42);
        expect(jsonH.result.current[0]).toEqual({ a: 1 });

        await act(async () => { await boolH.result.current[1](false); });
        await act(async () => { await intH.result.current[1](7); });
        await act(async () => { await jsonH.result.current[1]({ a: 2 }); });
        expect(server.put).toHaveBeenCalledTimes(3);
    });

    it("useTriliumOptions reads many and exposes saveMany", () => {
        setOptions({ a: "1", b: "2" });
        const harness = renderHook(() => useTriliumOptions("a" as OptionNames, "b" as OptionNames));
        expect(harness.result.current[0]).toEqual({ a: "1", b: "2" });
        expect(typeof harness.result.current[1]).toBe("function");
    });
});

// --- Small / pure ---------------------------------------------------------------------------------

describe("small hooks", () => {
    it("useUniqueName: prefix + random suffix, and bare", () => {
        expect(renderHook(() => useUniqueName("box")).result.current).toMatch(/^box-[a-zA-Z0-9]{10}$/);
        expect(renderHook(() => useUniqueName()).result.current).toMatch(/^[a-zA-Z0-9]{10}$/);
    });

    it("useSyncedRef: syncs to function and object external refs, and tolerates none", () => {
        const fnRef = vi.fn();
        renderHook(() => useSyncedRef(fnRef));
        expect(fnRef).toHaveBeenCalled();

        const div = document.createElement("div");
        const objRef = { current: null as HTMLDivElement | null };
        const harness = renderHook(() => useSyncedRef<HTMLDivElement>(objRef, div));
        expect(harness.result.current.current).toBe(div);
        expect(objRef.current).toBe(div);

        renderHook(() => useSyncedRef()); // no external ref → neither branch taken
    });

    it("useNoteSavedData: reads the store and reacts to writes", () => {
        noteSavedDataStore.set("n1", "first");
        const harness = renderHook(() => useNoteSavedData("n1"));
        expect(harness.result.current).toBe("first");
        act(() => noteSavedDataStore.set("n1", "second"));
        expect(harness.result.current).toBe("second");
        expect(renderHook(() => useNoteSavedData(undefined)).result.current).toBeUndefined();
    });

    it("useColorScheme: honors explicit theme and auto + media changes", () => {
        const listeners = new Set<(e: { matches: boolean }) => void>();
        const matchMedia = vi.fn(() => ({
            matches: false,
            addEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.add(l),
            removeEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.delete(l)
        }));
        Object.assign(window, { matchMedia });
        const glob = window.glob as unknown as Record<string, unknown>;

        glob.getThemeStyle = () => "dark";
        expect(renderHook(() => useColorScheme()).result.current).toBe("dark");

        glob.getThemeStyle = () => "auto";
        const harness = renderHook(() => useColorScheme());
        expect(harness.result.current).toBe("light");
        act(() => listeners.forEach(l => l({ matches: true })));
        expect(harness.result.current).toBe("dark");
    });
});

// --- Note data (froca) ----------------------------------------------------------------------------

describe("note data hooks", () => {
    it("useNote: undefined id, cached note, and async load", async () => {
        expect(renderHook(() => useNote(undefined)).result.current).toBeUndefined();

        buildNote({ id: "cached1", title: "Cached" });
        expect(renderHook(() => useNote("cached1")).result.current?.noteId).toBe("cached1");

        const lazy = buildNote({ id: "lazy1", title: "Lazy" });
        vi.spyOn(froca, "getNoteFromCache").mockReturnValue(undefined);
        vi.spyOn(froca, "getNote").mockResolvedValue(lazy);
        const harness = renderHook(() => useNote("lazy1"));
        await flush();
        expect(harness.result.current?.noteId).toBe("lazy1");
    });

    it("useNote: picks up a note that lands in cache after mount", async () => {
        const note = buildNote({ id: "effCache", title: "EC" });
        vi.spyOn(froca, "getNoteFromCache").mockReturnValueOnce(undefined).mockReturnValue(note);
        const harness = renderHook(() => useNote("effCache"));
        await flush();
        expect(harness.result.current?.noteId).toBe("effCache");
    });

    it("useNoteBlob: loads blob, reacts to content reload and deletion", async () => {
        const note = buildNote({ id: "blobNote", title: "Blob", content: "hello" });
        const harness = renderHook(() => useNoteBlob(note));
        await flush();
        expect(harness.result.current?.content).toBe("hello");

        harness.fireEvent("entitiesReloaded", { loadResults: makeLoadResults({ contentReloadedNoteIds: [ "blobNote" ] }) });
        await flush();
        expect(harness.result.current?.content).toBe("hello");

        harness.fireEvent("entitiesReloaded", { loadResults: makeLoadResults({ entities: { notes: { blobNote: { isDeleted: 1 } } } }) });
        expect(harness.result.current).toBeNull();
    });

    it("useNoteTitle: resolves title and refreshes on events", async () => {
        vi.spyOn(tree, "getNoteTitle").mockResolvedValue("Resolved Title");
        const harness = renderHook(() => useNoteTitle("t1", "p1"));
        await flush();
        expect(harness.result.current).toBe("Resolved Title");

        harness.fireEvent("protectedSessionStarted", {});
        await flush();
        harness.fireEvent("entitiesReloaded", { loadResults: makeLoadResults({ reloadedNoteIds: [ "t1" ] }) });
        await flush();
        expect(tree.getNoteTitle).toHaveBeenCalled();
    });

    it("useChildNotes: resolves children and refreshes on branch changes", async () => {
        buildNote({ id: "parentC", title: "P", children: [ { id: "c1", title: "C1" }, { id: "c2", title: "C2" } ] });
        const harness = renderHook(() => useChildNotes("parentC"));
        await flush();
        expect(harness.result.current.map(n => n.noteId).sort()).toEqual([ "c1", "c2" ]);

        harness.fireEvent("frocaReloaded", {});
        await flush();
        harness.fireEvent("entitiesReloaded", { loadResults: makeLoadResults({ branchRows: [ { parentNoteId: "parentC" } ] }) });
        await flush();
        expect(harness.result.current.length).toBe(2);
    });

    it("useLauncherVisibility: visible when parented under a visible-launchers container", async () => {
        buildNote({ id: "_lbVisibleLaunchers", title: "Visible", children: [ { id: "launch1", title: "L" } ] });
        const harness = renderHook(() => useLauncherVisibility("launch1"));
        await flush();
        expect(harness.result.current).toBe(true);

        buildNote({ id: "someParent", title: "Other", children: [ { id: "launch2", title: "L2" } ] });
        const hidden = renderHook(() => useLauncherVisibility("launch2"));
        await flush();
        expect(hidden.result.current).toBe(false);
        hidden.fireEvent("entitiesReloaded", { loadResults: makeLoadResults({ branchRows: [ { noteId: "launch2" } ] }) });
        expect(hidden.result.current).toBe(false);
    });

    it("useNoteIcon / useNoteColorClass: derive from the note and react to label changes", () => {
        const note = buildNote({ id: "iconNote", title: "I", "#iconClass": "bx bx-star", "#color": "red" });
        const iconH = renderHook(() => useNoteIcon(note));
        const colorH = renderHook(() => useNoteColorClass(note));
        expect(iconH.result.current).toBe(note.getIcon());
        expect(colorH.result.current).toBe(note.getColorClass());
    });
});

// --- Attributes -----------------------------------------------------------------------------------

describe("attribute hooks", () => {
    it("useNoteProperty: reads a property and refreshes on note reload", () => {
        const note = buildNote({ id: "propNote", title: "Original" });
        const harness = renderHook(() => useNoteProperty(note, "title"));
        expect(harness.result.current).toBe("Original");

        note.title = "Changed";
        harness.fireEvent("entitiesReloaded", { loadResults: makeLoadResults({ reloadedNoteIds: [ "propNote" ] }) });
        expect(harness.result.current).toBe("Changed");
    });

    it("useNoteRelation: reads, updates and clears on events, and writes via the setter", () => {
        buildNote({ id: "relTarget", title: "T" });
        const note = buildNote({ id: "relNote", title: "N", "~renderNote": "relTarget" });
        const setAttribute = vi.spyOn(attributes, "setAttribute").mockImplementation(() => undefined as never);
        const harness = renderHook(() => useNoteRelation(note, "renderNote"));
        expect(harness.result.current[0]).toBe("relTarget");

        harness.fireEvent("entitiesReloaded", { loadResults: makeLoadResults({ attributeRows: [ { type: "relation", name: "renderNote", value: "relTarget2", noteId: "relNote", isDeleted: false } ] }) });
        expect(harness.result.current[0]).toBe("relTarget2");

        harness.fireEvent("entitiesReloaded", { loadResults: makeLoadResults({ attributeRows: [ { type: "relation", name: "renderNote", value: null, noteId: "relNote", isDeleted: true } ] }) });
        expect(harness.result.current[0]).toBeNull();

        act(() => harness.result.current[1]("relTarget2"));
        expect(setAttribute).toHaveBeenCalledWith(note, "relation", "renderNote", "relTarget2");
    });

    it("useNoteRelationTarget: resolves the related note", async () => {
        buildNote({ id: "rtTarget", title: "Target" });
        const note = buildNote({ id: "rtNote", title: "N", "~renderNote": "rtTarget" });
        const harness = renderHook(() => useNoteRelationTarget(note, "renderNote"));
        await flush();
        expect(harness.result.current[0]?.noteId).toBe("rtTarget");
    });

    it("useNoteLabel + defaulted variant: read, react, set and remove", () => {
        const note = buildNote({ id: "lblNote", title: "N", "#status": "open" });
        const setLabel = vi.spyOn(attributes, "setLabel").mockImplementation(() => undefined as never);
        const removeLabel = vi.spyOn(attributes, "removeOwnedLabelByName").mockImplementation(() => undefined as never);

        const harness = renderHook(() => useNoteLabel(note, "status"));
        expect(harness.result.current[0]).toBe("open");

        harness.fireEvent("entitiesReloaded", { loadResults: makeLoadResults({ attributeRows: [ { type: "label", name: "status", value: "closed", noteId: "lblNote", isDeleted: false } ] }) });
        harness.fireEvent("entitiesReloaded", { loadResults: makeLoadResults({ attributeRows: [ { type: "label", name: "status", value: null, noteId: "lblNote", isDeleted: true } ] }) });
        act(() => harness.result.current[1]("done"));
        expect(setLabel).toHaveBeenCalledWith("lblNote", "status", "done");
        act(() => harness.result.current[1](null));
        expect(removeLabel).toHaveBeenCalledWith(note, "status");

        const def = renderHook(() => useNoteLabelWithDefault(note, "language", "fallback"));
        expect(def.result.current[0]).toBe("fallback");
    });

    it("useNoteLabelBoolean: truthiness, event refresh and setter", () => {
        const note = buildNote({ id: "boolNote", title: "N", "#archived": "true" });
        const setBool = vi.spyOn(attributes, "setBooleanWithInheritance").mockImplementation(() => undefined as never);
        const harness = renderHook(() => useNoteLabelBoolean(note, "archived"));
        expect(harness.result.current[0]).toBe(true);

        harness.fireEvent("entitiesReloaded", { loadResults: makeLoadResults({ attributeRows: [ { type: "label", name: "archived", value: "false", noteId: "boolNote", isDeleted: false } ] }) });
        act(() => harness.result.current[1](false));
        expect(setBool).toHaveBeenCalledWith(note, "archived", false);
    });

    it("useNoteLabelOptionalBool / useNoteLabelInt: parse and serialize", () => {
        const note = buildNote({ id: "optNote", title: "N", "#includeArchived": "true", "#tabWidth": "5" });
        const optH = renderHook(() => useNoteLabelOptionalBool(note, "includeArchived"));
        const intH = renderHook(() => useNoteLabelInt(note, "tabWidth"));
        expect(optH.result.current[0]).toBe(true);
        expect(intH.result.current[0]).toBe(5);

        const setLabel = vi.spyOn(attributes, "setLabel").mockImplementation(() => undefined as never);
        const removeLabel = vi.spyOn(attributes, "removeOwnedLabelByName").mockImplementation(() => undefined as never);
        act(() => optH.result.current[1](false));
        act(() => intH.result.current[1](9));
        expect(setLabel).toHaveBeenCalled();
        act(() => optH.result.current[1](null));
        act(() => intH.result.current[1](null));
        expect(removeLabel).toHaveBeenCalled();

        const missing = renderHook(() => useNoteLabelOptionalBool(note, "sorted"));
        expect(missing.result.current[0]).toBeUndefined();
    });
});

// --- Context data ---------------------------------------------------------------------------------

describe("context-data hooks", () => {
    it("useSetContextData: sets, clears on undefined, and clears on cleanup", () => {
        const noteContext = fakeNoteContext();
        const harness = renderHook(() => useSetContextData(noteContext, "toc", [ { level: 1 } ] as never));
        expect(noteContext.setContextData).toHaveBeenCalledWith("toc", [ { level: 1 } ]);
        harness.unmount();
        expect(noteContext.clearContextData).toHaveBeenCalledWith("toc");

        renderHook(() => useSetContextData(noteContext, "toc", undefined));
        expect(noteContext.clearContextData).toHaveBeenCalled();
        renderHook(() => useSetContextData(null, "toc", [] as never)); // no-op when no context
    });

    it("useGetContextDataFrom: reads initial and updates on contextDataChanged", () => {
        const noteContext = fakeNoteContext({ getContextData: vi.fn(() => [ "a" ]) });
        const harness = renderHook(() => useGetContextDataFrom(noteContext, "toc"));
        expect(harness.result.current).toEqual([ "a" ]);
        harness.fireEvent("contextDataChanged", { noteContext, key: "toc", value: [ "b" ] });
        expect(harness.result.current).toEqual([ "b" ]);
    });

    it("useGetContextData: reads from the active note context", () => {
        const noteContext = fakeNoteContext({ getContextData: vi.fn(() => [ "x" ]) });
        Object.assign(appContext, { tabManager: { getActiveContext: () => noteContext } });
        const harness = renderHook(() => useGetContextData("toc"));
        expect(harness.result.current).toEqual([ "x" ]);
    });
});

// --- DOM observers --------------------------------------------------------------------------------

describe("DOM observer hooks", () => {
    function stubResizeObserver() {
        const observers: { cb: () => void }[] = [];
        class FakeResizeObserver {
            cb: () => void;
            constructor(cb: () => void) { this.cb = cb; observers.push({ cb }); }
            observe() {}
            unobserve() {}
            disconnect() {}
        }
        Object.assign(window, { ResizeObserver: FakeResizeObserver });
        return observers;
    }

    it("useElementSize: observes and updates on resize", () => {
        const observers = stubResizeObserver();
        const ref = { current: document.createElement("div") };
        const harness = renderHook(() => useElementSize(ref));
        act(() => observers.forEach(o => o.cb()));
        expect(harness.result.current).toBeDefined();
        harness.unmount(); // cleanup → unobserve + disconnect

        renderHook(() => useElementSize({ current: null })); // no element → effect returns early
    });

    it("useResizeObserver: invokes the callback on resize", () => {
        const observers = stubResizeObserver();
        const callback = vi.fn();
        const ref = { current: document.createElement("div") };
        renderHook(() => useResizeObserver(ref, callback));
        act(() => observers.forEach(o => o.cb()));
        expect(callback).toHaveBeenCalled();

        renderHook(() => useResizeObserver({ current: null }, vi.fn())); // no element → not observed
    });

    it("useWindowSize: reports window size and reacts to resize", () => {
        const harness = renderHook(() => useWindowSize());
        expect(harness.result.current.windowWidth).toBe(window.innerWidth);
        act(() => { window.dispatchEvent(new Event("resize")); });
        expect(harness.result.current.windowHeight).toBe(window.innerHeight);
    });
});

// --- Misc DOM / interaction -----------------------------------------------------------------------

describe("interaction hooks", () => {
    it("useImperativeSearchHighlighlighting: returns a marker; null tokens is a no-op", () => {
        const empty = renderHook(() => useImperativeSearchHighlighlighting(null));
        expect(() => empty.result.current(document.createElement("div"))).not.toThrow();

        const harness = renderHook(() => useImperativeSearchHighlighlighting([ "find" ]));
        const el = document.createElement("div");
        el.textContent = "please find this";
        expect(() => harness.result.current(el)).not.toThrow();
        expect(() => harness.result.current(null)).not.toThrow();
    });

    it("useLongPressContextMenu: fires the handler after a long press", () => {
        vi.useFakeTimers();
        try {
            const handler = vi.fn();
            const harness = renderHook(() => useLongPressContextMenu(handler, 100));
            const props = harness.result.current;
            expect(props.onContextMenu).toBe(handler);

            const target = document.createElement("div");
            props.onTouchStart({ touches: [ { pageX: 1, pageY: 2 } ], target } as unknown as TouchEvent);
            vi.advanceTimersByTime(100);
            expect(handler).toHaveBeenCalledTimes(1);

            const preventDefault = vi.fn();
            props.onTouchEnd({ preventDefault } as unknown as TouchEvent);
            expect(preventDefault).toHaveBeenCalled();

            // A touchend without a completed long-press must NOT suppress the click.
            const preventDefault2 = vi.fn();
            props.onTouchStart({ touches: [ { pageX: 0, pageY: 0 } ], target } as unknown as TouchEvent);
            props.onTouchEnd({ preventDefault: preventDefault2 } as unknown as TouchEvent);
            expect(preventDefault2).not.toHaveBeenCalled();

            props.onTouchStart({ touches: [], target } as unknown as TouchEvent); // no touch → early return
            props.onTouchMove();
            props.onTouchCancel();
        } finally {
            vi.useRealTimers();
        }
    });

    it("useNoteTreeDrag: drops payloads when enabled, ignoring empty/invalid data", () => {
        const callback = vi.fn();
        const container = document.createElement("div");
        const harness = renderHook(() => useNoteTreeDrag({ current: container }, { dragEnabled: true, dragNotEnabledMessage: { message: "no", icon: "bx bx-x" }, callback }));

        const dropWith = (getData: () => string) => {
            const drop = new Event("drop", { bubbles: true });
            Object.assign(drop, { dataTransfer: { getData } });
            container.dispatchEvent(drop);
        };
        dropWith(() => JSON.stringify([ { noteId: "a" } ]));
        expect(callback).toHaveBeenCalledWith([ { noteId: "a" } ], expect.anything());

        dropWith(() => "");     // no data → ignored
        dropWith(() => "[]");   // empty payload → ignored
        container.dispatchEvent(new Event("dragover"));
        container.dispatchEvent(new Event("dragleave"));
        expect(callback).toHaveBeenCalledTimes(1);

        harness.unmount(); // cleanup → removeEventListener for all drag listeners
    });

    it("useNoteTreeDrag: warns and blocks drops when disabled; no-op without a container", () => {
        const callback = vi.fn();
        const container = document.createElement("div");
        renderHook(() => useNoteTreeDrag({ current: container }, { dragEnabled: false, dragNotEnabledMessage: { message: "no", icon: "bx bx-x" }, callback }));

        container.dispatchEvent(new Event("dragenter"));
        expect(toast.showPersistent).toHaveBeenCalled();

        const drop = new Event("drop", { bubbles: true });
        Object.assign(drop, { dataTransfer: { getData: () => JSON.stringify([ { noteId: "b" } ]) } });
        container.dispatchEvent(drop);
        expect(callback).not.toHaveBeenCalled();

        renderHook(() => useNoteTreeDrag({ current: null }, { dragEnabled: true, dragNotEnabledMessage: { message: "no", icon: "bx bx-x" }, callback }));
    });

    it("useLegacyImperativeHandlers: assigns handlers onto the parent component", () => {
        const parent = new Component();
        const handlers = { fooCommand: vi.fn() };
        renderHook(() => useLegacyImperativeHandlers(handlers), { parent });
        expect((parent as unknown as Record<string, unknown>).fooCommand).toBe(handlers.fooCommand);
    });
});

// --- Shortcuts ------------------------------------------------------------------------------------

describe("shortcut hooks", () => {
    it("useGlobalShortcut: binds and unbinds; ignores empty shortcut", () => {
        const handler = vi.fn();
        const harness = renderHook(() => useGlobalShortcut("ctrl+x", handler));
        expect(shortcuts.bindGlobalShortcut).toHaveBeenCalledWith("ctrl+x", handler, expect.any(String));
        harness.unmount();
        expect(shortcuts.removeGlobalShortcut).toHaveBeenCalled();

        renderHook(() => useGlobalShortcut(null, handler));
        expect(shortcuts.bindGlobalShortcut).toHaveBeenCalledTimes(1);
    });

    it("useKeyboardShortcuts: sets up bindings and tears them down", async () => {
        const binding = { handler: vi.fn() };
        (keyboard_actions.setupActionsForElement as ReturnType<typeof vi.fn>).mockResolvedValueOnce([ binding ]);
        const parent = new Component();
        const ref = { current: document.createElement("div") };
        const harness = renderHook(() => useKeyboardShortcuts("text-detail", ref, parent, "ntx1"), { parent });
        expect(keyboard_actions.setupActionsForElement).toHaveBeenCalled();
        harness.unmount();
        await flush();
        expect(removeIndividualBinding).toHaveBeenCalledWith(binding);

        renderHook(() => useKeyboardShortcuts("code-detail", ref, undefined, null)); // no parent → early return
    });
});

// --- Tooltips -------------------------------------------------------------------------------------

describe("tooltip hooks", () => {
    it("useTooltip: exposes show/hide bound to the element; no-op without a ref", () => {
        const tooltipPlugin = vi.fn();
        Object.assign(($.fn as unknown as Record<string, unknown>), { tooltip: tooltipPlugin });
        const el = document.createElement("div");
        document.body.appendChild(el);
        const harness = renderHook(() => useTooltip({ current: el }, { title: "Hi" }));
        harness.result.current.showTooltip();
        harness.result.current.hideTooltip();
        expect(tooltipPlugin).toHaveBeenCalled();
        harness.unmount(); // cleanup → dispose while connected
        el.remove();

        const nullHarness = renderHook(() => useTooltip({ current: null }, { title: "Hi" }));
        nullHarness.result.current.showTooltip(); // early returns when ref is empty
        nullHarness.result.current.hideTooltip();
    });

    it("useStaticTooltip: builds, hides siblings on show, and disposes on cleanup", () => {
        const el1 = document.createElement("div");
        el1.setAttribute("title", "A");
        document.body.appendChild(el1);
        const el2 = document.createElement("div");
        document.body.appendChild(el2);
        const h1 = renderHook(() => useStaticTooltip({ current: el1 }));
        const h2 = renderHook(() => useStaticTooltip({ current: el2 }, { title: "B" }));
        act(() => { el1.dispatchEvent(new Event("show.bs.tooltip")); });

        const stray = document.createElement("div"); // lingering popup the cleanup should sweep
        stray.className = "tooltip";
        document.body.appendChild(stray);
        h1.unmount();
        h2.unmount();
        expect(document.querySelector(".tooltip")).toBeNull();
        el1.remove();
        el2.remove();

        renderHook(() => useStaticTooltip({ current: document.createElement("div") })); // no title/attribute → early return
    });

    it("useStaticTooltipWithKeyboardShortcut: looks up the action shortcut", async () => {
        const ref = { current: document.createElement("div") };
        renderHook(() => useStaticTooltipWithKeyboardShortcut(ref, "Save", "saveNote" as never));
        await flush();
        expect(keyboard_actions.getAction).toHaveBeenCalledWith("saveNote");
        renderHook(() => useStaticTooltipWithKeyboardShortcut(ref, "Save", undefined)); // no action → no lookup
    });
});

// --- Legacy widget --------------------------------------------------------------------------------

describe("useLegacyWidget", () => {
    class FakeWidget extends BasicWidget {
        doRender() { this.$widget = $("<div class='fake-widget'></div>"); }
    }

    it("renders the widget into the container and cleans up", () => {
        const parent = new Component();
        const host = document.createElement("div");
        document.body.appendChild(host);
        let widget: FakeWidget | undefined;
        function Host() {
            const [ vnode, w ] = useLegacyWidget(() => new FakeWidget());
            widget = w;
            return vnode;
        }
        act(() => render(<ParentComponent.Provider value={parent}><Host /></ParentComponent.Provider>, host));
        const w = widget;
        expect(w).toBeInstanceOf(FakeWidget);
        expect(w && parent.children.includes(w)).toBe(true);
        expect(host.querySelector(".fake-widget")).toBeTruthy();

        act(() => render(null, host)); // unmount → cleanup removes the child + runs widget.cleanup()
        host.remove();
        expect(w && parent.children.includes(w)).toBe(false);
    });

    it("injects the note context into a NoteContextAwareWidget", () => {
        const activeContextChangedEvent = vi.fn();
        class FakeAware extends NoteContextAwareWidget {
            doRender() { this.$widget = $("<div></div>"); }
        }
        const noteContext = fakeNoteContext();
        const parent = new Component();
        renderHook(() => useLegacyWidget(() => {
            const w = new FakeAware();
            Object.assign(w, { activeContextChangedEvent });
            return w;
        }, { noteContext }), { parent });
        expect(activeContextChangedEvent).toHaveBeenCalledWith({ noteContext });
    });
});

// --- Editor / content / note context --------------------------------------------------------------

describe("editor & note-context hooks", () => {
    it("useTextEditor: resolves the editor and reacts to refresh events", () => {
        const editor = { id: "ed" };
        const noteContext = fakeNoteContext({ getTextEditor: (cb: (e: unknown) => void) => cb(editor) });
        const harness = renderHook(() => useTextEditor(noteContext));
        expect(harness.result.current).toBe(editor);

        const editor2 = { id: "ed2" };
        harness.fireEvent("textEditorRefreshed", { ntxId: "ntx1", editor: editor2 });
        expect(harness.result.current).toBe(editor2);

        expect(renderHook(() => useTextEditor(null)).result.current).toBeNull();
    });

    it("useContentElement: resolves the element and reacts to refresh events", async () => {
        const el = document.createElement("section");
        const noteContext = fakeNoteContext({ getContentElement: vi.fn(async () => $(el)) });
        const harness = renderHook(() => useContentElement(noteContext));
        await flush();
        expect(harness.result.current).toBe(el);

        const el2 = document.createElement("article");
        harness.fireEvent("contentElRefreshed", { ntxId: "ntx1", contentEl: el2 });
        expect(harness.result.current).toBe(el2);
    });

    it("useNoteContext: derives state from the provided context", () => {
        const note = buildNote({ id: "ctxNote", title: "Ctx" });
        const noteContext = fakeNoteContext({ note, notePath: "root/ctxNote" });
        const harness = renderHook(() => useNoteContext(), { noteContext });
        expect(harness.result.current.noteContext).toBe(noteContext);
        expect(harness.result.current.hoistedNoteId).toBe("root");
    });

    it("useNoteContext: reacts to events when no context is provided", () => {
        const note = buildNote({ id: "evtNote", title: "E" });
        const noteContext = fakeNoteContext({ note, notePath: "root/evtNote" });
        const harness = renderHook(() => useNoteContext());
        harness.fireEvent("setNoteContext", { noteContext });
        expect(harness.result.current.noteContext).toBe(noteContext);
        harness.fireEvent("frocaReloaded", {});
        harness.fireEvent("noteTypeMimeChanged", { noteId: "evtNote" });
        harness.fireEvent("readOnlyTemporarilyDisabled", { noteContext });
        harness.fireEvent("hoistedNoteChanged", { noteId: "h2", ntxId: "ntx1" });
        expect(harness.result.current.hoistedNoteId).toBe("h2");
    });

    it("useActiveNoteContext: reads the active context and resolves moved paths", async () => {
        const note = buildNote({ id: "activeNote", title: "A" });
        const noteContext = fakeNoteContext({ note, notePath: "root/activeNote" });
        Object.assign(appContext, { tabManager: { getActiveContext: () => noteContext } });
        vi.spyOn(tree, "resolveNotePath").mockResolvedValue("root/activeNote");
        const harness = renderHook(() => useActiveNoteContext());
        harness.fireEvent("noteSwitched", {});
        expect(harness.result.current.noteContext).toBe(noteContext);

        harness.fireEvent("frocaReloaded", {});
        harness.fireEvent("noteTypeMimeChanged", { noteId: "activeNote" });
        harness.fireEvent("readOnlyTemporarilyDisabled", { noteContext });
        harness.fireEvent("hoistedNoteChanged", { noteId: "h9", ntxId: "ntx1" });
        expect(harness.result.current.hoistedNoteId).toBe("h9");

        // Non-matching ids are ignored.
        harness.fireEvent("noteTypeMimeChanged", { noteId: "nomatch" });
        harness.fireEvent("readOnlyTemporarilyDisabled", { noteContext: fakeNoteContext({ ntxId: "nomatch" }) });
        harness.fireEvent("hoistedNoteChanged", { noteId: "x", ntxId: "nomatch" });
        expect(harness.result.current.hoistedNoteId).toBe("h9");

        harness.fireEvent("entitiesReloaded", { loadResults: makeLoadResults({ branchRows: [ { noteId: "activeNote" } ] }) });
        await flush();
        expect(tree.resolveNotePath).toHaveBeenCalled();
    });

    it("useActiveNoteContext: initializes from an empty active context", () => {
        Object.assign(appContext, { tabManager: { getActiveContext: () => null } });
        const harness = renderHook(() => useActiveNoteContext());
        expect(harness.result.current.noteContext).toBeUndefined();
    });
});

// --- Read-only ------------------------------------------------------------------------------------

describe("read-only hooks", () => {
    it("useIsNoteReadOnly: resolves read-only state and toggles editing", async () => {
        const note = buildNote({ id: "roNote", title: "RO" });
        const noteContext = fakeNoteContext({ isReadOnly: vi.fn(async () => true) });
        const harness = renderHook(() => useIsNoteReadOnly(note, noteContext));
        await flush();
        expect(harness.result.current.isReadOnly).toBe(true);

        act(() => harness.result.current.enableEditing(true));
        expect(harness.result.current.temporarilyEditable).toBe(true);

        harness.fireEvent("readOnlyTemporarilyDisabled", { noteContext });
        expect(harness.result.current.temporarilyEditable).toBe(true);
    });

    it("useIsNoteReadOnly: not read-only for protected/databaseReadonly/non-default view", async () => {
        const note = buildNote({ id: "protNote", title: "P" });
        Object.assign(note, { isProtected: true });
        (protected_session_holder.isProtectedSessionAvailable as ReturnType<typeof vi.fn>).mockReturnValue(false);
        const protectedH = renderHook(() => useIsNoteReadOnly(note, fakeNoteContext({ isReadOnly: vi.fn(async () => true) })));
        await flush();
        expect(protectedH.result.current.isReadOnly).toBe(false);

        const note2 = buildNote({ id: "dbroNote", title: "D" });
        setOptions({ databaseReadonly: "true" });
        const dbH = renderHook(() => useIsNoteReadOnly(note2, fakeNoteContext({ isReadOnly: vi.fn(async () => true) })));
        await flush();
        expect(dbH.result.current.isReadOnly).toBe(false);

        setOptions({}); // clear databaseReadonly so the view-mode branch is the one that short-circuits
        const note3 = buildNote({ id: "viewNote", title: "V" });
        const viewH = renderHook(() => useIsNoteReadOnly(note3, fakeNoteContext({ viewScope: { viewMode: "source" }, isReadOnly: vi.fn(async () => true) })));
        await flush();
        expect(viewH.result.current.isReadOnly).toBe(false);
    });

    it("useEffectiveReadOnly: combines the readOnly label with the temporary toggle", () => {
        const note = buildNote({ id: "effNote", title: "E", "#readOnly": "true" });
        const noteContext = fakeNoteContext({ viewScope: { readOnlyTemporarilyDisabled: false } });
        const harness = renderHook(() => useEffectiveReadOnly(note, noteContext));
        expect(harness.result.current).toBe(true);

        harness.fireEvent("readOnlyTemporarilyDisabled", { noteContext: fakeNoteContext({ ntxId: "ntx1", viewScope: { readOnlyTemporarilyDisabled: true } }) });
        expect(harness.result.current).toBe(false);
    });
});

// --- Spaced update --------------------------------------------------------------------------------

describe("spaced-update hooks", () => {
    it("useSpacedUpdate: returns a stable instance and runs the callback on update", async () => {
        const callback = vi.fn();
        const stateCallback = vi.fn();
        const harness = renderHook(() => useSpacedUpdate(callback, 100, stateCallback));
        const instance = harness.result.current;
        expect(instance).toBeDefined();

        instance.scheduleUpdate();
        await act(async () => { await instance.updateNowIfNecessary(); });
        expect(callback).toHaveBeenCalled();

        harness.rerender(() => useSpacedUpdate(vi.fn(), 200, vi.fn())); // re-run callback/interval effects
        expect(harness.result.current).toBe(instance);
    });

    it("useEditorSpacedUpdate: saves note data and reacts to lifecycle events", async () => {
        const note = buildNote({ id: "edNote", title: "Ed", content: "x" });
        const noteContext = fakeNoteContext({ ntxId: "ntxEd" });
        const onContentChange = vi.fn();
        const getData = vi.fn(async () => ({ content: "new content" }));
        const harness = renderHook(() => useEditorSpacedUpdate({
            note, noteType: "text", noteContext, getData, onContentChange, updateInterval: 50
        }));
        await flush();
        expect(onContentChange).toHaveBeenCalled();

        await act(async () => { harness.result.current.scheduleUpdate(); await harness.result.current.updateNowIfNecessary(); });
        expect(server.put).toHaveBeenCalled();

        harness.fireEvent("beforeNoteSwitch", { noteContext: { ntxId: "ntxEd" } });
        harness.fireEvent("beforeNoteContextRemove", { ntxIds: [ "ntxEd" ] });
        harness.fireEvent("beforeNoteSwitch", { noteContext: { ntxId: "nope" } });   // other context → ignored
        harness.fireEvent("beforeNoteContextRemove", { ntxIds: [ "nope" ] });
        await flush();
    });

    it("useBlobEditorSpacedUpdate: uploads blob data and reacts to lifecycle events", async () => {
        const note = buildNote({ id: "blobEd", title: "B", type: "image", content: "x" });
        const noteContext = fakeNoteContext({ ntxId: "ntxBlob" });
        const onContentChange = vi.fn();
        const getData = vi.fn(async () => new Blob([ "data" ]));
        const harness = renderHook(() => useBlobEditorSpacedUpdate({
            note, noteType: "image", noteContext, getData, onContentChange, updateInterval: 50, replaceWithoutRevision: true
        }));
        await flush();
        expect(onContentChange).toHaveBeenCalled();

        await act(async () => { harness.result.current.scheduleUpdate(); await harness.result.current.updateNowIfNecessary(); });
        expect(server.upload).toHaveBeenCalled();

        harness.fireEvent("beforeNoteSwitch", { noteContext: { ntxId: "ntxBlob" } });
        harness.fireEvent("beforeNoteContextRemove", { ntxIds: [ "ntxBlob" ] });
        harness.fireEvent("beforeNoteSwitch", { noteContext: { ntxId: "nope" } });   // other context → ignored
        harness.fireEvent("beforeNoteContextRemove", { ntxIds: [ "nope" ] });
        await flush();
    });
});

// --- Math -----------------------------------------------------------------------------------------

describe("useMathRendering", () => {
    it("renders inline and display math, skips rendered, and survives errors", () => {
        const container = document.createElement("div");
        container.innerHTML = `
            <span class="math-tex">\\(a^2\\)</span>
            <span class="math-tex">\\[b^2\\]</span>
            <span class="math-tex">c</span>
            <span class="math-tex"><span class="katex">done</span></span>`;
        const ref = { current: container };
        (math.render as ReturnType<typeof vi.fn>).mockImplementationOnce(() => { throw new Error("bad"); });
        renderHook(() => useMathRendering(ref, [ "deps" ]));
        expect(math.render).toHaveBeenCalled();

        renderHook(() => useMathRendering({ current: null }, [])); // no container → early return
    });
});

// --- Branch coverage: guards & mismatches ---------------------------------------------------------

describe("guards and mismatches", () => {
    it("editor/content hooks ignore refreshes meant for other contexts", async () => {
        const editorCtx = fakeNoteContext({ getTextEditor: (cb: (e: unknown) => void) => cb({ id: "keep" }) });
        const editorH = renderHook(() => useTextEditor(editorCtx));
        editorH.fireEvent("textEditorRefreshed", { ntxId: "other", editor: { id: "drop" } });
        expect(editorH.result.current).toEqual({ id: "keep" });

        const el = document.createElement("div");
        const contentCtx = fakeNoteContext({ getContentElement: vi.fn(async () => $(el)) });
        const contentH = renderHook(() => useContentElement(contentCtx));
        await flush();
        contentH.fireEvent("contentElRefreshed", { ntxId: "other", contentEl: document.createElement("p") });
        expect(contentH.result.current).toBe(el);
    });

    it("useGetContextDataFrom ignores changes for a different key", () => {
        const noteContext = fakeNoteContext({ getContextData: vi.fn(() => [ "keep" ]) });
        const harness = renderHook(() => useGetContextDataFrom(noteContext, "toc"));
        harness.fireEvent("contextDataChanged", { noteContext, key: "pdfPages", value: [ "drop" ] });
        expect(harness.result.current).toEqual([ "keep" ]);
    });

    it("useEffectiveReadOnly ignores toggles from other contexts", () => {
        const note = buildNote({ id: "erNote", title: "E", "#readOnly": "true" });
        const noteContext = fakeNoteContext({ viewScope: { readOnlyTemporarilyDisabled: false } });
        const harness = renderHook(() => useEffectiveReadOnly(note, noteContext));
        harness.fireEvent("readOnlyTemporarilyDisabled", { noteContext: fakeNoteContext({ ntxId: "other", viewScope: { readOnlyTemporarilyDisabled: true } }) });
        expect(harness.result.current).toBe(true);
    });

    it("useNoteContext ignores events while a context is provided", () => {
        const note = buildNote({ id: "ncNote", title: "N" });
        const noteContext = fakeNoteContext({ note, notePath: "root/ncNote" });
        const harness = renderHook(() => useNoteContext(), { noteContext });
        harness.fireEvent("setNoteContext", { noteContext: fakeNoteContext({ ntxId: "other" }) });
        harness.fireEvent("readOnlyTemporarilyDisabled", { noteContext });
        expect(harness.result.current.noteContext).toBe(noteContext);
    });

    it("useNoteProperty honors the component id; useNoteBlob tolerates a missing note", () => {
        const note = buildNote({ id: "cidNote", title: "T" });
        const propH = renderHook(() => useNoteProperty(note, "title", "comp-1"));
        propH.fireEvent("entitiesReloaded", { loadResults: makeLoadResults({ reloadedNoteIds: [ "cidNote" ] }) });
        expect(propH.result.current).toBe("T");

        const blobH = renderHook(() => useNoteBlob(null));
        blobH.fireEvent("entitiesReloaded", { loadResults: makeLoadResults({ contentReloadedNoteIds: [ "x" ] }) });
        expect(blobH.result.current).toBeUndefined();
    });

    it("useTriliumOptionBool reads a false value and writes true", async () => {
        setOptions({ flag: "false" });
        const harness = renderHook(() => useTriliumOptionBool("flag" as OptionNames));
        expect(harness.result.current[0]).toBe(false);
        await act(async () => { await harness.result.current[1](true); });
        expect(harness.result.current[0]).toBe(true);
    });

    it("attribute hooks skip unrelated changes and no-op when the note is missing", () => {
        const note = buildNote({ id: "agNote", title: "N", "#status": "x", "~renderNote": "agT", "#archived": "true" });
        buildNote({ id: "agT", title: "T" });
        const rel = renderHook(() => useNoteRelation(note, "renderNote"));
        const lbl = renderHook(() => useNoteLabel(note, "status"));
        const bool = renderHook(() => useNoteLabelBoolean(note, "archived"));
        const unrelated = makeLoadResults({ attributeRows: [ { type: "label", name: "color", value: "z", noteId: "agNote", isDeleted: false } ] });
        rel.fireEvent("entitiesReloaded", { loadResults: unrelated });
        lbl.fireEvent("entitiesReloaded", { loadResults: unrelated });
        bool.fireEvent("entitiesReloaded", { loadResults: unrelated });
        expect(rel.result.current[0]).toBe("agT");
        expect(lbl.result.current[0]).toBe("x");

        const setAttribute = vi.spyOn(attributes, "setAttribute").mockImplementation(() => undefined as never);
        const setLabel = vi.spyOn(attributes, "setLabel").mockImplementation(() => undefined as never);
        const setBool = vi.spyOn(attributes, "setBooleanWithInheritance").mockImplementation(() => undefined as never);
        act(() => renderHook(() => useNoteRelation(null, "renderNote")).result.current[1]("v"));
        act(() => renderHook(() => useNoteLabel(null, "status")).result.current[1]("v"));
        act(() => renderHook(() => useNoteLabelBoolean(null, "archived")).result.current[1](true));
        expect(setAttribute).not.toHaveBeenCalled();
        expect(setLabel).not.toHaveBeenCalled();
        expect(setBool).not.toHaveBeenCalled();
    });

    it("note-data hooks tolerate empty ids and ignore unrelated reloads", async () => {
        vi.spyOn(tree, "getNoteTitle").mockResolvedValue("T");
        buildNote({ id: "ndtId", title: "T" });
        buildNote({ id: "ndChild", title: "Child" });

        renderHook(() => useNoteTitle(undefined, undefined)); // no id → refresh returns early
        const title = renderHook(() => useNoteTitle("ndtId", undefined));
        title.fireEvent("entitiesReloaded", { loadResults: makeLoadResults({ reloadedNoteIds: [ "other" ] }) });

        renderHook(() => useChildNotes(undefined)); // no parent → empty
        const kids = renderHook(() => useChildNotes("ndChild"));
        kids.fireEvent("entitiesReloaded", { loadResults: makeLoadResults({ branchRows: [ { parentNoteId: "different" } ] }) });

        buildNote({ id: "_lbVisibleLaunchers", title: "V", children: [ { id: "ndLaunch", title: "L" } ] });
        const vis = renderHook(() => useLauncherVisibility("ndLaunch"));
        await flush();
        vis.fireEvent("entitiesReloaded", { loadResults: makeLoadResults({ branchRows: [ { noteId: "other" } ] }) }); // unrelated branch
        expect(vis.result.current).toBe(true);

        const intMissing = renderHook(() => useNoteLabelInt(buildNote({ id: "ndInt", title: "I" }), "pageSize"));
        expect(intMissing.result.current[0]).toBeUndefined();
    });

    it("useIsNoteReadOnly handles missing inputs and unrelated toggles", async () => {
        renderHook(() => useIsNoteReadOnly(null, fakeNoteContext())); // note null → effect skips

        const note = buildNote({ id: "iroNote", title: "N" });
        const harness = renderHook(() => useIsNoteReadOnly(note, fakeNoteContext({ isReadOnly: vi.fn(async () => true) })));
        await flush();
        act(() => harness.result.current.enableEditing(true));
        harness.fireEvent("readOnlyTemporarilyDisabled", { noteContext: fakeNoteContext({ ntxId: "other" }) }); // mismatch → ignored
        expect(harness.result.current.temporarilyEditable).toBe(true);

        const noScope = renderHook(() => useIsNoteReadOnly(note, fakeNoteContext({ viewScope: undefined })));
        await flush();
        act(() => noScope.result.current.enableEditing()); // no view scope → no-op
        expect(noScope.result.current.temporarilyEditable).toBe(false);
    });
});
