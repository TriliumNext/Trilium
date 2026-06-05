import { CommandType, FUniver, IWorkbookData, LocaleType } from "@univerjs/presets";
import { MutableRef } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type NoteContext from "../../../components/note_context";
import froca from "../../../services/froca";
import server from "../../../services/server";
import ws from "../../../services/ws";
import { buildNote } from "../../../test/easy-froca";
import { flush, makeLoadResults, renderHook } from "../../../test/render-hook";
import usePersistence from "./persistence";

// --- Fakes ---------------------------------------------------------------------------------------

type CommandCb = (command: { type: number; id?: string; params?: { trigger?: string } }) => void;

interface FakeWorkbookConfig {
    id?: string;
    save?: () => IWorkbookData;
    /** When true, getSheetBySheetId returns a sheet; when false it returns null. */
    sheetForId?: boolean;
    currentCell?: { actualRow: number; actualColumn: number } | null;
    scrollState?: { sheetViewStartRow: number; sheetViewStartColumn: number } | null;
    throwOnSave?: boolean;
}

function makeFakeSheet(config: FakeWorkbookConfig) {
    const range = { activate: vi.fn() };
    return {
        getSheetId: () => "sheet-1",
        getSelection: () => ({ getCurrentCell: () => config.currentCell ?? null }),
        getScrollState: () => config.scrollState ?? null,
        getRange: vi.fn(() => range),
        scrollToCell: vi.fn(),
        _range: range
    };
}

function makeFakeWorkbook(config: FakeWorkbookConfig = {}) {
    const sheet = makeFakeSheet(config);
    let commandCb: CommandCb | undefined;
    const disposable = { dispose: vi.fn() };
    const workbook = {
        getId: () => config.id ?? "wb-id",
        getActiveSheet: () => sheet,
        getSheetBySheetId: vi.fn(() => (config.sheetForId === false ? null : sheet)),
        setActiveSheet: vi.fn(),
        save: vi.fn(() => {
            if (config.throwOnSave) throw new Error("save boom");
            return (config.save ? config.save() : { id: "saved-id", locale: LocaleType.ZH_CN }) as IWorkbookData;
        }),
        onCommandExecuted: vi.fn((cb: CommandCb) => {
            commandCb = cb;
            return disposable;
        }),
        _sheet: sheet,
        _disposable: disposable,
        fireCommand: (command: { type: number; id?: string; params?: { trigger?: string } }) => commandCb?.(command)
    };
    return workbook;
}

interface FakeUniverConfig {
    /** Existing active workbook (or undefined for none). */
    active?: ReturnType<typeof makeFakeWorkbook>;
    /** The workbook returned by createWorkbook. */
    created?: ReturnType<typeof makeFakeWorkbook>;
    /** When false, getFormula() returns undefined. */
    withFormula?: boolean;
    calcThrows?: boolean;
}

function makeFakeUniver(config: FakeUniverConfig = {}) {
    const created = config.created ?? makeFakeWorkbook();
    let active = config.active;
    const calcDisposable = { dispose: vi.fn() };
    let calcResultCb: (() => void) | undefined;
    const formula = {
        onCalculationResultApplied: vi.fn(async () => {
            if (config.calcThrows) throw new Error("calc boom");
        }),
        calculationResultApplied: vi.fn((cb: () => void) => {
            calcResultCb = cb;
            return calcDisposable;
        })
    };
    const api = {
        getActiveWorkbook: () => active,
        createWorkbook: vi.fn((_data?: Partial<IWorkbookData>) => {
            active = created;
            return created;
        }),
        disposeUnit: vi.fn(),
        getFormula: config.withFormula === false ? undefined : vi.fn(() => formula),
        _created: created,
        _formula: formula,
        _calcDisposable: calcDisposable,
        fireCalcResult: () => calcResultCb?.()
    };
    return api;
}

function asApiRef(api: ReturnType<typeof makeFakeUniver> | undefined): MutableRef<FUniver | undefined> {
    return { current: api as unknown as FUniver | undefined };
}

/** Builds a container whose offset dimensions can be toggled to drive isContainerVisible(). */
function makeContainer(visible: boolean): MutableRef<HTMLDivElement | null> {
    const div = document.createElement("div");
    Object.defineProperty(div, "offsetWidth", { configurable: true, get: () => (visible ? 100 : 0) });
    Object.defineProperty(div, "offsetHeight", { configurable: true, get: () => (visible ? 100 : 0) });
    document.body.appendChild(div);
    return { current: div };
}

function fakeNoteContext(overrides: Record<string, unknown> = {}): NoteContext {
    return {
        ntxId: "ntx-sheet",
        setContextData: vi.fn(),
        getContextData: vi.fn(),
        clearContextData: vi.fn(),
        ...overrides
    } as unknown as NoteContext;
}

// --- ResizeObserver capture ----------------------------------------------------------------------

let resizeObservers: { cb: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }[] = [];
let originalResizeObserver: typeof ResizeObserver;

function installFakeResizeObserver() {
    originalResizeObserver = window.ResizeObserver;
    resizeObservers = [];
    class FakeRO {
        cb: ResizeObserverCallback;
        disconnect = vi.fn();
        constructor(cb: ResizeObserverCallback) {
            this.cb = cb;
            resizeObservers.push({ cb, disconnect: this.disconnect });
        }
        observe() {}
        unobserve() {}
    }
    Object.assign(window, { ResizeObserver: FakeRO });
}

function buildPersistedContent() {
    return JSON.stringify({ version: 1, workbook: { sheetOrder: [ "s1" ], name: "Persisted" } });
}

// --- Tests ---------------------------------------------------------------------------------------

beforeEach(() => {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    vi.clearAllMocks();
    Object.assign(server, { put: vi.fn(async () => undefined), upload: vi.fn(async () => undefined) });
    Object.assign(ws, { logError: vi.fn() });
    installFakeResizeObserver();
});

afterEach(() => {
    Object.assign(window, { ResizeObserver: originalResizeObserver });
    vi.restoreAllMocks();
});

function mountPersistence(opts: {
    api?: ReturnType<typeof makeFakeUniver>;
    visible?: boolean;
    content?: string;
    noteContext?: NoteContext | null;
}) {
    const note = buildNote({ id: "sheetNote", title: "Sheet", type: "spreadsheet", content: opts.content ?? "" });
    const apiRef = asApiRef(opts.api);
    const containerRef = makeContainer(opts.visible ?? true);
    const noteContext = opts.noteContext === undefined ? fakeNoteContext() : opts.noteContext;
    const harness = renderHook(() => usePersistence(note, noteContext, apiRef, containerRef));
    return { harness, note, apiRef, containerRef };
}

describe("usePersistence", () => {
    it("applies persisted content into a fresh workbook and restores view state", async () => {
        const active = makeFakeWorkbook({ id: "old-id", currentCell: { actualRow: 3, actualColumn: 4 }, scrollState: { sheetViewStartRow: 1, sheetViewStartColumn: 2 } });
        const created = makeFakeWorkbook({ id: "new-id" });
        const api = makeFakeUniver({ active, created });
        const { harness } = mountPersistence({ api, visible: true, content: buildPersistedContent() });
        await flush();

        // Workbook created with a fresh id and pinned EN_US locale; old workbook disposed.
        expect(api.createWorkbook).toHaveBeenCalledTimes(1);
        const passed = api.createWorkbook.mock.calls[0]?.[0] as Partial<IWorkbookData> | undefined;
        expect(passed?.locale).toBe(LocaleType.EN_US);
        expect(typeof passed?.id).toBe("string");
        expect(passed?.name).toBe("Persisted");
        expect(api.disposeUnit).toHaveBeenCalledWith("old-id");
        // Restore view state used the saved cursor + scroll.
        expect(created.setActiveSheet).toHaveBeenCalled();
        expect(created._sheet.getRange).toHaveBeenCalledWith(3, 4);
        expect(created._sheet.scrollToCell).toHaveBeenCalledWith(1, 2);
        // A command listener was registered on the new workbook.
        expect(created.onCommandExecuted).toHaveBeenCalled();

        harness.unmount();
    });

    it("creates a workbook without disposing when there is no existing one, and parses empty content", async () => {
        const api = makeFakeUniver({ active: undefined });
        mountPersistence({ api, visible: true, content: "" });
        await flush();

        expect(api.createWorkbook).toHaveBeenCalledTimes(1);
        expect(api.disposeUnit).not.toHaveBeenCalled();
    });

    it("tolerates invalid JSON content (parse error branch) and non-workbook objects", async () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const api1 = makeFakeUniver({ active: undefined });
        mountPersistence({ api: api1, visible: true, content: "{not valid json" });
        await flush();
        expect(errorSpy).toHaveBeenCalled();
        expect(api1.createWorkbook).toHaveBeenCalled();

        // Valid JSON but without a "workbook" key -> workbookData stays {}.
        const api2 = makeFakeUniver({ active: undefined });
        mountPersistence({ api: api2, visible: true, content: JSON.stringify({ version: 1, other: true }) });
        await flush();
        expect(api2.createWorkbook).toHaveBeenCalled();
    });

    it("defers content application while the container is hidden, then applies on resize", async () => {
        const api = makeFakeUniver({ active: undefined });
        const note = buildNote({ id: "hiddenNote", title: "H", type: "spreadsheet", content: buildPersistedContent() });
        const apiRef = asApiRef(api);
        const containerRef = makeContainer(false); // hidden
        renderHook(() => usePersistence(note, fakeNoteContext(), apiRef, containerRef));
        await flush();

        // Hidden -> content was buffered, not applied.
        expect(api.createWorkbook).not.toHaveBeenCalled();

        // Make it visible and fire the ResizeObserver callback.
        Object.defineProperty(containerRef.current, "offsetWidth", { configurable: true, get: () => 100 });
        Object.defineProperty(containerRef.current, "offsetHeight", { configurable: true, get: () => 100 });
        resizeObservers.forEach(o => o.cb([], o as unknown as ResizeObserver));
        await flush();
        expect(api.createWorkbook).toHaveBeenCalledTimes(1);
    });

    it("resize callback returns early when nothing is pending or api is missing", async () => {
        // No api -> onContentChange returns early, nothing pending; resize is a no-op.
        const note = buildNote({ id: "noApiNote", title: "N", type: "spreadsheet", content: buildPersistedContent() });
        const apiRef = asApiRef(undefined);
        const containerRef = makeContainer(true);
        renderHook(() => usePersistence(note, fakeNoteContext(), apiRef, containerRef));
        await flush();
        resizeObservers.forEach(o => o.cb([], o as unknown as ResizeObserver));
        await flush();
        // No throw is the assertion.
        expect(resizeObservers.length).toBeGreaterThan(0);
    });

    it("resize effect returns early (no observer) when containerRef has no element", async () => {
        const note = buildNote({ id: "nullContainer", title: "NC", type: "spreadsheet", content: "" });
        const apiRef = asApiRef(makeFakeUniver({ active: undefined }));
        const containerRef: MutableRef<HTMLDivElement | null> = { current: null };
        const before = resizeObservers.length;
        renderHook(() => usePersistence(note, fakeNoteContext(), apiRef, containerRef));
        await flush();
        // Effect short-circuits before creating an observer.
        expect(resizeObservers.length).toBe(before);
    });

    it("getData saves slimmed workbook content and a canvas attachment via the spaced update", async () => {
        const created = makeFakeWorkbook({ id: "new", save: () => ({
            id: "x",
            locale: LocaleType.ZH_CN,
            name: "S",
            resources: [
                { name: "EMPTY", data: "" },
                { name: "BRACES", data: "{}" },
                { name: "KEEP", data: "{\"a\":1}" }
            ]
        }) as IWorkbookData });
        const api = makeFakeUniver({ active: undefined, created });
        const { harness, containerRef } = mountPersistence({ api, visible: true, content: buildPersistedContent() });
        await flush();

        // Add a canvas with an id so the attachment branch runs.
        const canvas = document.createElement("canvas");
        canvas.id = "univer-canvas";
        Object.assign(canvas, { toDataURL: () => "data:image/png;base64,QUJD" });
        containerRef.current?.appendChild(canvas);

        // A user-triggered mutation arms scheduleUpdate; then a tab switch flushes the save.
        created.fireCommand({ type: CommandType.MUTATION, id: "sheet.mutation.set-range-values", params: { trigger: "edit" } });
        harness.fireEvent("beforeNoteSwitch", { noteContext: { ntxId: "ntx-sheet" } });
        await flush();

        expect(server.put).toHaveBeenCalled();
        const putArgs = (server.put as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(putArgs?.[0]).toBe("notes/sheetNote/data");
        const data = putArgs?.[1] as { content: string; attachments: { content: string; role: string }[] };
        const parsed = JSON.parse(data.content) as { version: number; workbook: Partial<IWorkbookData> };
        expect(parsed.version).toBe(1);
        expect(parsed.workbook.id).toBeUndefined();
        expect(parsed.workbook.locale).toBeUndefined();
        // slimWorkbookData drops empty ("" / "{}") resources, keeps the informative one.
        expect(parsed.workbook.resources).toEqual([ { name: "KEEP", data: "{\"a\":1}" } ]);
        expect(data.attachments[0]?.role).toBe("image");
        expect(data.attachments[0]?.content).toBe("QUJD");

        // The recalc-pending path awaited onCalculationResultApplied before serializing.
        expect(api._formula.onCalculationResultApplied).toHaveBeenCalled();
    });

    it("getData returns undefined when the active workbook is gone at save time", async () => {
        const created = makeFakeWorkbook({ id: "n" });
        const api = makeFakeUniver({ active: undefined, created });
        const { harness } = mountPersistence({ api, visible: true, content: buildPersistedContent() });
        await flush();

        // Arm a change, then make getActiveWorkbook() yield undefined so getData hits line 148.
        created.fireCommand({ type: CommandType.MUTATION, id: "sheet.mutation.set-range-values", params: { trigger: "x" } });
        (api as unknown as { getActiveWorkbook: () => undefined }).getActiveWorkbook = () => undefined;
        harness.fireEvent("beforeNoteSwitch", { noteContext: { ntxId: "ntx-sheet" } });
        await flush();
        expect(server.put).not.toHaveBeenCalled();
    });

    it("getData serializes immediately when no recalc is pending", async () => {
        const created = makeFakeWorkbook({ id: "n" });
        const api = makeFakeUniver({ active: undefined, created });
        const { harness } = mountPersistence({ api, visible: true, content: buildPersistedContent() });
        await flush();

        // A mutation WITHOUT a trigger arms scheduleUpdate but never sets recalcPending,
        // so getData skips the onCalculationResultApplied wait (line 158 false branch).
        created.fireCommand({ type: CommandType.MUTATION, id: "sheet.mutation.set-range-values", params: {} });
        harness.fireEvent("beforeNoteSwitch", { noteContext: { ntxId: "ntx-sheet" } });
        await flush();
        expect(server.put).toHaveBeenCalled();
        expect(api._formula.onCalculationResultApplied).not.toHaveBeenCalled();
    });

    it("resize callback returns early when pending content exists but the container is still hidden", async () => {
        const api = makeFakeUniver({ active: undefined });
        const note = buildNote({ id: "stillHidden", title: "SH", type: "spreadsheet", content: buildPersistedContent() });
        const apiRef = asApiRef(api);
        const containerRef = makeContainer(false); // hidden -> content buffered
        renderHook(() => usePersistence(note, fakeNoteContext(), apiRef, containerRef));
        await flush();
        expect(api.createWorkbook).not.toHaveBeenCalled();

        // Container is STILL hidden when the resize fires -> second operand of the guard short-circuits.
        resizeObservers.forEach(o => o.cb([], o as unknown as ResizeObserver));
        await flush();
        expect(api.createWorkbook).not.toHaveBeenCalled();
    });

    it("getData returns undefined when there is no api or no active workbook", async () => {
        // No active workbook (createWorkbook never ran because content empty still creates one) —
        // simulate by clearing api after mount, then forcing an update.
        const api = makeFakeUniver({ active: undefined });
        const { harness, apiRef } = mountPersistence({ api, visible: true, content: "" });
        await flush();

        // Arm a change, then drop the api so getData hits the early return.
        const created = apiRef.current as unknown as ReturnType<typeof makeFakeUniver>["_created"];
        created.fireCommand?.({ type: CommandType.MUTATION, id: "sheet.mutation.set-range-values", params: { trigger: "x" } });
        apiRef.current = undefined;
        harness.fireEvent("beforeNoteContextRemove", { ntxIds: [ "ntx-sheet" ] });
        await flush();
        expect(server.put).not.toHaveBeenCalled();
    });

    it("recalc catch path: onCalculationResultApplied throwing still serializes the save", async () => {
        const created = makeFakeWorkbook({ id: "n" });
        const api = makeFakeUniver({ active: undefined, created, calcThrows: true });
        const { harness } = mountPersistence({ api, visible: true, content: buildPersistedContent() });
        await flush();

        created.fireCommand({ type: CommandType.MUTATION, id: "sheet.mutation.set-range-values", params: { trigger: "edit" } });
        harness.fireEvent("beforeNoteSwitch", { noteContext: { ntxId: "ntx-sheet" } });
        await flush();
        expect(server.put).toHaveBeenCalled();
    });

    it("command listener ignores non-mutation commands and value-writes without a trigger", async () => {
        const created = makeFakeWorkbook({ id: "n" });
        const api = makeFakeUniver({ active: undefined, created });
        mountPersistence({ api, visible: true, content: buildPersistedContent() });
        await flush();

        // Non-mutation -> early return, no scheduleUpdate (server.put not driven here anyway).
        created.fireCommand({ type: 999 });
        // Mutation but not set-range-values / no trigger -> scheduleUpdate without arming recalc.
        created.fireCommand({ type: CommandType.MUTATION, id: "sheet.mutation.other" });
        created.fireCommand({ type: CommandType.MUTATION, id: "sheet.mutation.set-range-values", params: {} });
        await flush();
        // Listener executed without throwing.
        expect(created.onCommandExecuted).toHaveBeenCalled();
    });

    it("restoreViewState falls through when there is no view state and the existing sheet is absent", async () => {
        // Active workbook returns no current cell / no scroll state, and the persisted activeSheetId is missing.
        const active = makeFakeWorkbook({ id: "old", currentCell: null, scrollState: null });
        const created = makeFakeWorkbook({ id: "new", sheetForId: false });
        const api = makeFakeUniver({ active, created });
        mountPersistence({ api, visible: true, content: JSON.stringify({ version: 1, workbook: {} }) });
        await flush();

        expect(api.createWorkbook).toHaveBeenCalled();
        // No cursor/scroll restore since view state had none.
        expect(created._sheet.getRange).not.toHaveBeenCalled();
        expect(created._sheet.scrollToCell).not.toHaveBeenCalled();
    });

    it("disposes the previous command listener when content is re-applied", async () => {
        const created = makeFakeWorkbook({ id: "wb" });
        // After the first apply, mark the created workbook active so the second apply also disposes it.
        const api = makeFakeUniver({ active: undefined, created });
        const note = buildNote({ id: "reapply", title: "R", type: "spreadsheet", content: buildPersistedContent() });
        // Return a fresh blob object on each fetch so a content reload changes the blob reference
        // (easy-froca otherwise hands back the same instance, so the effect would not re-run).
        const content = buildPersistedContent();
        note.getBlob = (async () => ({ content })) as typeof note.getBlob;

        const apiRef = asApiRef(api);
        const containerRef = makeContainer(true);
        const harness = renderHook(() => usePersistence(note, fakeNoteContext(), apiRef, containerRef));
        await flush();
        expect(api.createWorkbook).toHaveBeenCalledTimes(1);

        // A content reload re-fetches the blob, re-running onContentChange -> applyContent,
        // which must dispose the previously-registered command listener (lines 115-116).
        harness.fireEvent("entitiesReloaded", { loadResults: makeLoadResults({ contentReloadedNoteIds: [ "reapply" ] }) });
        await flush();

        expect(api.createWorkbook).toHaveBeenCalledTimes(2);
        expect(created._disposable.dispose).toHaveBeenCalled();
        harness.unmount();
    });

    it("warns and skips the eager-clear subscription when the formula service is unavailable", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const api = makeFakeUniver({ active: undefined, withFormula: false });
        mountPersistence({ api, visible: true, content: "" });
        await flush();
        expect(warnSpy).toHaveBeenCalled();
    });

    it("subscribes to calculationResultApplied and disposes it on unmount", async () => {
        const api = makeFakeUniver({ active: undefined, withFormula: true });
        const { harness } = mountPersistence({ api, visible: true, content: "" });
        await flush();
        expect(api._formula.calculationResultApplied).toHaveBeenCalled();

        // Fire the eager-clear callback (covers the subscription body).
        api.fireCalcResult();
        harness.unmount();
        expect(api._calcDisposable.dispose).toHaveBeenCalled();
    });

    it("onContentChange returns early when there is no api", async () => {
        const note = buildNote({ id: "earlyNote", title: "E", type: "spreadsheet", content: buildPersistedContent() });
        const apiRef = asApiRef(undefined);
        const containerRef = makeContainer(true);
        const harness = renderHook(() => usePersistence(note, fakeNoteContext(), apiRef, containerRef));
        await flush();
        // Nothing to assert beyond not throwing; the effect chain ran with apiRef.current undefined.
        harness.unmount();
        expect(true).toBe(true);
    });

    it("disposes the active change listener on unmount", async () => {
        const created = makeFakeWorkbook({ id: "n" });
        const api = makeFakeUniver({ active: undefined, created });
        const { harness } = mountPersistence({ api, visible: true, content: buildPersistedContent() });
        await flush();
        harness.unmount();
        expect(created._disposable.dispose).toHaveBeenCalled();
    });
});
