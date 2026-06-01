import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../components/app_context.js";
import type FNote from "../entities/fnote.js";
import { buildNote } from "../test/easy-froca.js";
import dateNotesService from "./date_notes.js";
import dialogService from "./dialog.js";
import FrontendScriptApi, { type Api, type Entity } from "./frontend_script_api.js";
import { preactAPI } from "./frontend_script_api_preact.js";
import froca from "./froca.js";
import linkService from "./link.js";
import noteTooltipService from "./note_tooltip.js";
import protectedSessionService from "./protected_session.js";
import searchService from "./search.js";
import server from "./server.js";
import shortcutService from "./shortcuts.js";
import toastService from "./toast.js";
import utils from "./utils.js";
import ws from "./ws.js";

// The global ws mock from setup.ts does not define waitForMaxKnownEntityChangeId.
ws.waitForMaxKnownEntityChangeId = vi.fn(async () => {}) as typeof ws.waitForMaxKnownEntityChangeId;

function makeApi(opts: { startNote?: FNote; currentNote?: FNote; originEntity?: Entity | null; $container?: JQuery<HTMLElement> | null } = {}): Api {
    const startNote = opts.startNote ?? buildNote({ title: "Start" });
    const currentNote = opts.currentNote ?? buildNote({ title: "Current" });
    return new FrontendScriptApi(startNote, currentNote, opts.originEntity ?? null, opts.$container ?? null);
}

/** A tabManager stub; assigned onto the singleton appContext per-test. */
function setTabManager(stub: Record<string, unknown>) {
    (appContext as unknown as { tabManager: unknown }).tabManager = stub;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("FrontendScriptApi constructor", () => {
    it("wires up notes, the dayjs lib, widget classes and the preact API", () => {
        const startNote = buildNote({ title: "Start" });
        const currentNote = buildNote({ title: "Current" });
        const originEntity = { noteId: "origin1" };
        const $container = {} as JQuery<HTMLElement>;

        const api = new FrontendScriptApi(startNote, currentNote, originEntity, $container);

        expect(api.startNote).toBe(startNote);
        expect(api.currentNote).toBe(currentNote);
        expect(api.originEntity).toBe(originEntity);
        expect(api.$container).toBe($container);
        expect(api.dayjs).toBeTypeOf("function");
        expect(api.preact).toBe(preactAPI);
        // Passthrough references should point at the underlying service functions.
        expect(api.formatDateISO).toBe(utils.formatDateISO);
        expect(api.parseDate).toBe(utils.parseDate);
        expect(api.randomString).toBe(utils.randomString);
        expect(api.formatSize).toBe(utils.formatSize);
        expect(api.formatNoteSize).toBe(utils.formatSize);
        expect(api.createLink).toBe(linkService.createLink);
        expect(api.createNoteLink).toBe(linkService.createLink);
        expect(api.setupElementTooltip).toBe(noteTooltipService.setupElementTooltip);
        expect(api.bindGlobalShortcut).toBe(shortcutService.bindGlobalShortcut);
        expect(api.waitUntilSynced).toBe(ws.waitForMaxKnownEntityChangeId);
        expect(api.getTodayNote).toBe(dateNotesService.getTodayNote);
        expect(api.getDayNote).toBe(dateNotesService.getDayNote);
        expect(api.getWeekFirstDayNote).toBe(dateNotesService.getWeekFirstDayNote);
        expect(api.getWeekNote).toBe(dateNotesService.getWeekNote);
        expect(api.getMonthNote).toBe(dateNotesService.getMonthNote);
        expect(api.getQuarterNote).toBe(dateNotesService.getQuarterNote);
        expect(api.getYearNote).toBe(dateNotesService.getYearNote);
        expect(api.showMessage).toBe(toastService.showMessage);
        expect(api.showError).toBe(toastService.showError);
        expect(api.showInfoDialog).toBe(dialogService.info);
        expect(api.showConfirmDialog).toBe(dialogService.confirm);
        expect(api.showPromptDialog).toBe(dialogService.prompt);
    });

    it("defaults originEntity and $container to null", () => {
        const api = new FrontendScriptApi(buildNote({ title: "S" }), buildNote({ title: "C" }), undefined as unknown as null, undefined as unknown as null);
        expect(api.originEntity).toBeNull();
        expect(api.$container).toBeNull();
    });
});

describe("note activation / tabs / splits", () => {
    it("activateNote sets the note on the active context", async () => {
        const setNote = vi.fn(async () => {});
        setTabManager({ getActiveContext: () => ({ setNote }) });
        await makeApi().activateNote("root");
        expect(setNote).toHaveBeenCalledWith("root");
    });

    it("activateNote is a no-op when there is no active context", async () => {
        setTabManager({ getActiveContext: () => undefined });
        await expect(makeApi().activateNote("root")).resolves.toBeUndefined();
    });

    it("activateNewNote waits for sync, sets note and focuses the title", async () => {
        const setNote = vi.fn(async () => {});
        setTabManager({ getActiveContext: () => ({ setNote }) });
        const triggerEvent = vi.spyOn(appContext, "triggerEvent").mockResolvedValue(undefined as never);

        await makeApi().activateNewNote("root");

        expect(ws.waitForMaxKnownEntityChangeId).toHaveBeenCalled();
        expect(setNote).toHaveBeenCalledWith("root");
        expect(triggerEvent).toHaveBeenCalledWith("focusAndSelectTitle", {});
    });

    it("openTabWithNote opens a hoisted tab and focuses the title when activate=true", async () => {
        const openTabWithNoteWithHoisting = vi.fn(async () => {});
        setTabManager({ openTabWithNoteWithHoisting });
        const triggerEvent = vi.spyOn(appContext, "triggerEvent").mockResolvedValue(undefined as never);

        await makeApi().openTabWithNote("root", true);

        expect(openTabWithNoteWithHoisting).toHaveBeenCalledWith("root", { activate: true });
        expect(triggerEvent).toHaveBeenCalledWith("focusAndSelectTitle", {});
    });

    it("openTabWithNote does not focus the title when activate=false", async () => {
        const openTabWithNoteWithHoisting = vi.fn(async () => {});
        setTabManager({ openTabWithNoteWithHoisting });
        const triggerEvent = vi.spyOn(appContext, "triggerEvent").mockResolvedValue(undefined as never);

        await makeApi().openTabWithNote("root", false);

        expect(openTabWithNoteWithHoisting).toHaveBeenCalledWith("root", { activate: false });
        expect(triggerEvent).not.toHaveBeenCalled();
    });

    it("openSplitWithNote derives the ntxId from the last sub context and focuses on activate", async () => {
        const subContexts = [{ ntxId: "a" }, { ntxId: "last" }];
        setTabManager({ getActiveContext: () => ({ getSubContexts: () => subContexts }) });
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockResolvedValue(undefined as never);
        const triggerEvent = vi.spyOn(appContext, "triggerEvent").mockResolvedValue(undefined as never);

        await makeApi().openSplitWithNote("root", true);

        expect(triggerCommand).toHaveBeenCalledWith("openNewNoteSplit", { ntxId: "last", notePath: "root" });
        expect(triggerEvent).toHaveBeenCalledWith("focusAndSelectTitle", {});
    });

    it("openSplitWithNote falls back to an empty ntxId when there is no active context and does not focus on activate=false", async () => {
        setTabManager({ getActiveContext: () => undefined });
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockResolvedValue(undefined as never);
        const triggerEvent = vi.spyOn(appContext, "triggerEvent").mockResolvedValue(undefined as never);

        await makeApi().openSplitWithNote("root", false);

        expect(triggerCommand).toHaveBeenCalledWith("openNewNoteSplit", { ntxId: undefined, notePath: "root" });
        expect(triggerEvent).not.toHaveBeenCalled();
    });
});

describe("addButtonToToolbar", () => {
    it("warns about deprecation and PUTs the launcher with a stringified action", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        // The global server mock only defines get/post, so assign put directly.
        const put = (server.put = vi.fn(async () => undefined) as typeof server.put);
        const action = () => {};

        await makeApi().addButtonToToolbar({ title: "T", action, id: "btn1", icon: "time", shortcut: "alt+t" });

        expect(warn).toHaveBeenCalled();
        expect(put).toHaveBeenCalledWith("special-notes/api-script-launcher", {
            action: action.toString(),
            title: "T",
            id: "btn1",
            icon: "time",
            shortcut: "alt+t"
        });
    });
});

describe("runOnBackend / __runOnBackendInner", () => {
    beforeEach(() => vi.clearAllMocks());

    it("serializes a sync function, posts it, waits for sync and returns the result", async () => {
        const post = vi.spyOn(server, "post").mockResolvedValue({ success: true, executionResult: 42 } as never);
        const start = buildNote({ title: "S" });
        const current = buildNote({ title: "C" });
        const origin = { noteId: "originX" };
        const api = makeApi({ startNote: start, currentNote: current, originEntity: origin });

        function myFunc() {}
        const result = await api.runOnBackend(myFunc, ["plain", () => {}]);

        expect(result).toBe(42);
        expect(ws.waitForMaxKnownEntityChangeId).toHaveBeenCalled();
        const body = (post.mock.calls[0][1]) as Record<string, unknown>;
        expect(post.mock.calls[0][0]).toBe("script/exec");
        expect(body.script).toBe(myFunc.toString());
        expect(body.transactional).toBe(true);
        expect(body.startNoteId).toBe(start.noteId);
        expect(body.currentNoteId).toBe(current.noteId);
        expect(body.originEntityName).toBe("notes");
        expect(body.originEntityId).toBe("originX");
        // prepareParams serializes nested functions and leaves primitives untouched.
        const params = body.params as unknown[];
        expect(params[0]).toBe("plain");
        expect(params[1]).toMatch(/^!@#Function: /);
    });

    it("passes originEntityId as null when there is no origin entity", async () => {
        const post = vi.spyOn(server, "post").mockResolvedValue({ success: true, executionResult: null } as never);
        await makeApi({ originEntity: null }).runOnBackend("function f(){}", []);
        const body = post.mock.calls[0][1] as Record<string, unknown>;
        expect(body.originEntityId).toBeNull();
    });

    it("warns and still runs when passed an async function reference", async () => {
        const post = vi.spyOn(server, "post").mockResolvedValue({ success: true, executionResult: 1 } as never);
        const showError = vi.spyOn(toastService, "showError").mockImplementation(() => undefined as never);
        const asyncFn = async () => {};
        const result = await makeApi().runOnBackend(asyncFn, []);
        expect(showError).toHaveBeenCalled();
        // "still runs": the warning does not short-circuit; it proceeds to the backend and returns the result.
        expect(post).toHaveBeenCalledWith("script/exec", expect.any(Object), "script");
        expect(result).toBe(1);
    });

    it("warns when passed an async function as a string", async () => {
        const post = vi.spyOn(server, "post").mockResolvedValue({ success: true, executionResult: 1 } as never);
        const showError = vi.spyOn(toastService, "showError").mockImplementation(() => undefined as never);
        const result = await makeApi().runOnBackend("async function f(){}", []);
        expect(showError).toHaveBeenCalled();
        // "still runs": the warning does not short-circuit; it proceeds to the backend and returns the result.
        expect(post).toHaveBeenCalledWith("script/exec", expect.any(Object), "script");
        expect(result).toBe(1);
    });

    it("does not warn for a plain sync function and defaults params to an empty array", async () => {
        const post = vi.spyOn(server, "post").mockResolvedValue({ success: true, executionResult: 1 } as never);
        const showError = vi.spyOn(toastService, "showError").mockImplementation(() => undefined as never);
        // Call with no params arg to exercise the `params = []` default.
        await (makeApi().runOnBackend as (func: () => void) => Promise<unknown>)(() => {});
        expect(showError).not.toHaveBeenCalled();
        expect((post.mock.calls[0][1] as Record<string, unknown>).params).toEqual([]);
    });

    it("throws a server error when the execution reports failure", async () => {
        vi.spyOn(server, "post").mockResolvedValue({ success: false, error: "boom" } as never);
        await expect(makeApi().runOnBackend("function f(){}", [])).rejects.toThrow("server error: boom");
    });
});

describe("runAsyncOnBackendWithManualTransactionHandling", () => {
    beforeEach(() => vi.clearAllMocks());

    it("warns when passed a sync function reference, then runs non-transactionally", async () => {
        const post = vi.spyOn(server, "post").mockResolvedValue({ success: true, executionResult: 7 } as never);
        const showError = vi.spyOn(toastService, "showError").mockImplementation(() => undefined as never);

        function syncFn() {}
        const result = await makeApi().runAsyncOnBackendWithManualTransactionHandling(syncFn, []);

        expect(result).toBe(7);
        expect(showError).toHaveBeenCalled();
        expect((post.mock.calls[0][1] as Record<string, unknown>).transactional).toBe(false);
    });

    it("warns when passed a sync function as a string", async () => {
        vi.spyOn(server, "post").mockResolvedValue({ success: true, executionResult: 1 } as never);
        const showError = vi.spyOn(toastService, "showError").mockImplementation(() => undefined as never);
        await makeApi().runAsyncOnBackendWithManualTransactionHandling("function f(){}", []);
        expect(showError).toHaveBeenCalled();
    });

    it("does not warn for an async function and defaults params to an empty array", async () => {
        const post = vi.spyOn(server, "post").mockResolvedValue({ success: true, executionResult: 1 } as never);
        const showError = vi.spyOn(toastService, "showError").mockImplementation(() => undefined as never);
        // Call with no params arg to exercise the `params = []` default.
        await (makeApi().runAsyncOnBackendWithManualTransactionHandling as (func: () => Promise<void>) => Promise<unknown>)(async () => {});
        expect(showError).not.toHaveBeenCalled();
        expect((post.mock.calls[0][1] as Record<string, unknown>).params).toEqual([]);
    });

    it("prepareParams returns the params unchanged when falsy", async () => {
        const post = vi.spyOn(server, "post").mockResolvedValue({ success: true, executionResult: 1 } as never);
        // Passing null params exercises the `if (!params) return params;` early-return branch.
        await makeApi().runAsyncOnBackendWithManualTransactionHandling("async () => {}", null as unknown as unknown[]);
        expect((post.mock.calls[0][1] as Record<string, unknown>).params).toBeNull();
    });
});

describe("search", () => {
    it("searchForNotes delegates to the search service", async () => {
        const note = buildNote({ title: "Hit" });
        vi.spyOn(searchService, "searchForNotes").mockResolvedValue([note]);
        expect(await makeApi().searchForNotes("#x")).toEqual([note]);
    });

    it("searchForNote returns the first match", async () => {
        const note = buildNote({ title: "Hit" });
        vi.spyOn(searchService, "searchForNotes").mockResolvedValue([note]);
        expect(await makeApi().searchForNote("#x")).toBe(note);
    });

    it("searchForNote returns null when there are no matches", async () => {
        vi.spyOn(searchService, "searchForNotes").mockResolvedValue([]);
        expect(await makeApi().searchForNote("#x")).toBeNull();
    });
});

describe("froca passthroughs", () => {
    it("getNote / getNotes / reloadNotes delegate to froca", async () => {
        const note = buildNote({ title: "N" });
        const getNote = vi.spyOn(froca, "getNote").mockResolvedValue(note);
        const getNotes = vi.spyOn(froca, "getNotes").mockResolvedValue([note]);
        const reloadNotes = vi.spyOn(froca, "reloadNotes").mockResolvedValue(undefined);
        const api = makeApi();

        expect(await api.getNote(note.noteId)).toBe(note);
        // default silentNotFoundError -> false
        expect(await api.getNotes([note.noteId], undefined as unknown as boolean)).toEqual([note]);
        expect(getNotes).toHaveBeenCalledWith([note.noteId], false);
        // explicit silentNotFoundError -> true
        await api.getNotes([note.noteId], true);
        expect(getNotes).toHaveBeenLastCalledWith([note.noteId], true);
        await api.reloadNotes([note.noteId]);
        expect(getNote).toHaveBeenCalled();
        expect(reloadNotes).toHaveBeenCalledWith([note.noteId]);
    });

    it("getInstanceName reads from window.glob", () => {
        window.glob.instanceName = "inst-A";
        expect(makeApi().getInstanceName()).toBe("inst-A");
    });
});

describe("commands and events", () => {
    it("triggerCommand / triggerEvent / addTextToActiveContextEditor / refreshIncludedNote dispatch via appContext", () => {
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined as never);
        const triggerEvent = vi.spyOn(appContext, "triggerEvent").mockReturnValue(undefined as never);
        const api = makeApi();

        api.triggerCommand("jumpToNote" as never, { foo: 1 } as never);
        expect(triggerCommand).toHaveBeenCalledWith("jumpToNote", { foo: 1 });

        api.triggerEvent("noteSwitched" as never, { bar: 2 } as never);
        expect(triggerEvent).toHaveBeenCalledWith("noteSwitched", { bar: 2 });

        api.addTextToActiveContextEditor("hello");
        expect(triggerCommand).toHaveBeenCalledWith("addTextToActiveEditor", { text: "hello" });

        api.refreshIncludedNote("incl1");
        expect(triggerEvent).toHaveBeenCalledWith("refreshIncludedNote", { noteId: "incl1" });
    });

    it("getActiveNoteDetailWidget resolves through the executeInActiveNoteDetailWidget command callback", async () => {
        const widget = { kind: "detail" };
        vi.spyOn(appContext, "triggerCommand").mockImplementation(((_name: string, data: { callback: (w: unknown) => void }) => {
            data.callback(widget);
            return undefined;
        }) as never);
        expect(await makeApi().getActiveNoteDetailWidget()).toBe(widget);
    });

    it("getComponentByEl delegates to appContext.getComponentByEl", () => {
        const component = { id: "c" };
        const el = document.createElement("div");
        vi.spyOn(appContext, "getComponentByEl").mockReturnValue(component as never);
        expect(makeApi().getComponentByEl(el)).toBe(component);
    });
});

describe("active context accessors", () => {
    it("getActiveContextNote returns the note or throws when absent", () => {
        const note = buildNote({ title: "Active" });
        setTabManager({ getActiveContextNote: () => note });
        expect(makeApi().getActiveContextNote()).toBe(note);

        setTabManager({ getActiveContextNote: () => null });
        expect(() => makeApi().getActiveContextNote()).toThrow("No active context note found");
    });

    it("getActiveContext returns the context or throws when absent", () => {
        const ctx = { id: "ctx" };
        setTabManager({ getActiveContext: () => ctx });
        expect(makeApi().getActiveContext()).toBe(ctx);

        setTabManager({ getActiveContext: () => null });
        expect(() => makeApi().getActiveContext()).toThrow("No active context found");
    });

    it("getActiveMainContext returns the main context or throws when absent", () => {
        const ctx = { id: "main" };
        setTabManager({ getActiveMainContext: () => ctx });
        expect(makeApi().getActiveMainContext()).toBe(ctx);

        setTabManager({ getActiveMainContext: () => null });
        expect(() => makeApi().getActiveMainContext()).toThrow("No active main context found");
    });

    it("getNoteContexts / getMainNoteContexts / getActiveContextNotePath delegate to the tab manager", () => {
        const noteContexts = [{ a: 1 }];
        const mainContexts = [{ b: 2 }];
        setTabManager({
            getNoteContexts: () => noteContexts,
            getMainNoteContexts: () => mainContexts,
            getActiveContextNotePath: () => "root/abc"
        });
        const api = makeApi();
        expect(api.getNoteContexts()).toBe(noteContexts);
        expect(api.getMainNoteContexts()).toBe(mainContexts);
        expect(api.getActiveContextNotePath()).toBe("root/abc");
    });

    it("getActiveContextTextEditor returns the editor or throws when absent", async () => {
        const editor = { type: "ck" };
        setTabManager({ getActiveContext: () => ({ getTextEditor: () => Promise.resolve(editor) }) });
        expect(await makeApi().getActiveContextTextEditor()).toBe(editor);

        // The "no context" guard throws synchronously, before any Promise is returned.
        setTabManager({ getActiveContext: () => null });
        expect(() => makeApi().getActiveContextTextEditor()).toThrow("No active context found");
    });

    it("getActiveContextCodeEditor returns the editor or throws when absent", async () => {
        const editor = { type: "cm" };
        setTabManager({ getActiveContext: () => ({ getCodeEditor: () => Promise.resolve(editor) }) });
        expect(await makeApi().getActiveContextCodeEditor()).toBe(editor);

        setTabManager({ getActiveContext: () => null });
        expect(() => makeApi().getActiveContextCodeEditor()).toThrow("No active context found");
    });
});

describe("protection and hoisting", () => {
    it("protectNote protects a single note (non-recursively)", async () => {
        const protectNote = vi.spyOn(protectedSessionService, "protectNote").mockResolvedValue(undefined as never);
        // The public type over-declares a 3rd arg (typeof protectedSessionService.protectNote); the impl ignores it.
        await makeApi().protectNote("note1", true, false);
        expect(protectNote).toHaveBeenCalledWith("note1", true, false);
    });

    it("protectSubTree protects recursively", async () => {
        const protectNote = vi.spyOn(protectedSessionService, "protectNote").mockResolvedValue(undefined as never);
        // The public type over-declares a 3rd arg (typeof protectedSessionService.protectNote); the impl ignores it.
        await makeApi().protectSubTree("note1", false, true);
        expect(protectNote).toHaveBeenCalledWith("note1", false, true);
    });

    it("setHoistedNoteId forwards to the active context when present", () => {
        const setHoistedNoteId = vi.fn();
        setTabManager({ getActiveContext: () => ({ setHoistedNoteId }) });
        makeApi().setHoistedNoteId("note9");
        expect(setHoistedNoteId).toHaveBeenCalledWith("note9");
    });

    it("setHoistedNoteId is a no-op when there is no active context", () => {
        setTabManager({ getActiveContext: () => null });
        expect(() => makeApi().setHoistedNoteId("note9")).not.toThrow();
    });
});

describe("log", () => {
    beforeEach(() => vi.clearAllMocks());

    it("logs to the console, accumulates messages and schedules a spaced update per note", () => {
        const startNote = buildNote({ title: "Logger" });
        const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
        const api = makeApi({ startNote });

        api.log("first", "message");
        api.log("second");

        const noteId = startNote.noteId;
        expect(consoleLog).toHaveBeenCalled();
        // Both messages should be accumulated under the start note's id.
        expect(api.logMessages[noteId]).toHaveLength(2);
        expect(api.logMessages[noteId][0]).toContain("first message");
        // The spaced update instance should be created once and reused across calls.
        expect(api.logSpacedUpdates[noteId]).toBeDefined();
    });

    it("flushes accumulated messages via apiLogMessages when the spaced update fires", async () => {
        vi.useFakeTimers();
        try {
            const startNote = buildNote({ title: "Logger2" });
            vi.spyOn(console, "log").mockImplementation(() => {});
            const triggerEvent = vi.spyOn(appContext, "triggerEvent").mockReturnValue(undefined as never);
            const api = makeApi({ startNote });
            const noteId = startNote.noteId;

            api.log("flushme");
            // SpacedUpdate.scheduleUpdate schedules a triggerUpdate via setTimeout.
            await vi.advanceTimersByTimeAsync(2000);

            expect(triggerEvent).toHaveBeenCalledWith("apiLogMessages", { noteId, messages: [expect.stringContaining("flushme")] });
            // After flushing, the per-note message buffer is reset to empty.
            expect(api.logMessages[noteId]).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });
});
