import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import $ from "jquery";

// --- Mocks (hoisted above imports) ---

const { triggerCommand, getActiveContextNoteId, getActiveContext, chooseNoteType, createNote, getAllCommands, searchCommands } = vi.hoisted(() => ({
    triggerCommand: vi.fn(),
    getActiveContextNoteId: vi.fn<() => string | null>(() => "activeNote"),
    getActiveContext: vi.fn<() => any>(() => ({ hoistedNoteId: "hoisted" })),
    chooseNoteType: vi.fn(),
    createNote: vi.fn(),
    getAllCommands: vi.fn(() => [] as any[]),
    searchCommands: vi.fn(() => [] as any[])
}));

vi.mock("../components/app_context.js", () => ({
    default: {
        triggerCommand,
        tabManager: {
            getActiveContextNoteId,
            getActiveContext
        }
    }
}));

vi.mock("./note_create.js", () => ({
    default: { chooseNoteType, createNote }
}));

vi.mock("./command_registry.js", () => ({
    default: { getAllCommands, searchCommands }
}));

// Imports AFTER vi.mock calls.
import server from "./server.js";
import froca from "./froca.js";
import { buildNote } from "../test/easy-froca.js";
import noteAutocomplete, { triggerRecentNotes } from "./note_autocomplete.js";

type Dataset = {
    displayKey: string;
    cache: boolean;
    source: (term: string, cb: (rows: any[]) => void) => void;
    templates: { suggestion: (s: any) => string };
};

// Captures the last `$el.autocomplete(config, datasets)` init call and records
// every command invocation so tests can drive the registered callbacks.
let lastConfig: AutoCompleteConfig | undefined;
let lastDatasets: Dataset[] | undefined;
let autocompleteCalls: any[][];
const stored = new Map<HTMLElement, string>();

function registerAutocompleteStub() {
    lastConfig = undefined;
    lastDatasets = undefined;
    autocompleteCalls = [];
    ($.fn as any).autocomplete = vi.fn(function (this: JQuery, config: any, datasets?: Dataset[]) {
        autocompleteCalls.push([config, datasets]);
        if (typeof config === "object" && Array.isArray(datasets)) {
            lastConfig = config;
            lastDatasets = datasets;
        }
        // emulate the "val" getter/setter so fullTextSearch can read it back
        if (config === "val") {
            const el = this[0];
            if (datasets === undefined) {
                return stored.get(el) as any;
            }
            stored.set(el, datasets as unknown as string);
        }
        return this;
    });
}

function makeEl(extraClass = "") {
    return $(`<input class="${extraClass}" />`);
}

function lastCommandWith(arg: any) {
    return autocompleteCalls.some((c) => c[0] === arg && c[1] === undefined);
}

describe("note_autocomplete", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getActiveContextNoteId.mockReturnValue("activeNote");
        getActiveContext.mockReturnValue({ hoistedNoteId: "hoisted" });
        registerAutocompleteStub();
        server.get = vi.fn(async () => []) as typeof server.get;
        noteAutocomplete.init();
    });

    describe("autocompleteSourceForCKEditor (default export)", () => {
        it("maps server rows into CKEditor mention feed items", async () => {
            server.get = vi.fn(async () => [
                {
                    action: "search-notes",
                    noteTitle: "Foo",
                    notePathTitle: "Root / Foo",
                    notePath: "root/abc",
                    highlightedNotePathTitle: "<b>Foo</b>",
                    icon: "bx bx-note"
                }
            ]) as typeof server.get;

            const result = (await noteAutocomplete.autocompleteSourceForCKEditor("Foo")) as any[];
            // autocompleteSourceForCKEditor forces allowCreatingNotes -> a create-note row is prepended.
            const mapped = result.find((r) => r.notePath === "root/abc");
            expect(mapped).toEqual({
                action: "search-notes",
                noteTitle: "Foo",
                id: "@Root / Foo",
                name: "Root / Foo",
                link: "#root/abc",
                notePath: "root/abc",
                highlightedNotePathTitle: "<b>Foo</b>",
                icon: "bx bx-note"
            });
        });

        it("falls back to empty name when notePathTitle is missing", async () => {
            server.get = vi.fn(async () => []) as typeof server.get;
            const result = (await noteAutocomplete.autocompleteSourceForCKEditor("X")) as any[];
            // only the synthetic create-note row remains; it has no notePathTitle.
            const createRow = result.find((r) => r.action === "create-note");
            expect(createRow).toBeDefined();
            expect(createRow!.name).toBe("");
            expect(createRow!.id).toBe("@undefined");
        });
    });
});

// ---------------------------------------------------------------------------
// Exercise the internal autocompleteSource via the dataset.source registered
// during initNoteAutocomplete (it is not exported, so we go through the public
// init path and capture the dataset callbacks).
// ---------------------------------------------------------------------------

function initAndGetSource(options?: any) {
    const $el = makeEl();
    noteAutocomplete.initNoteAutocomplete($el, options);
    return { $el, dataset: lastDatasets![0] };
}

/** Runs the dataset.source and resolves with the rows it passes to cb. */
function runSource(dataset: Dataset, term: string): Promise<any[]> {
    return new Promise((resolve) => {
        dataset.source(term, (rows) => resolve(rows));
    });
}

/**
 * Fires the (debounced) dataset.source with the given cb and waits long enough
 * for the debounce timer + the awaited body to flush, even when cb is never called.
 */
function runSourceRaw(dataset: Dataset, term: string, cb: (rows: any[]) => void): Promise<void> {
    dataset.source(term, cb);
    return new Promise((resolve) => setTimeout(resolve, 30));
}

describe("autocompleteSource (via dataset)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getActiveContextNoteId.mockReturnValue("activeNote");
        registerAutocompleteStub();
        server.get = vi.fn(async () => []) as typeof server.get;
        noteAutocomplete.init();
    });

    it("returns command suggestions in command-palette mode (all commands, empty query)", async () => {
        getAllCommands.mockReturnValue([
            { id: "cmd1", name: "Cmd One", description: "desc", shortcut: "Ctrl+1", icon: "bx bx-cog" }
        ]);
        const { dataset } = initAndGetSource({ isCommandPalette: true });
        const rows = await runSource(dataset, ">");
        expect(getAllCommands).toHaveBeenCalled();
        expect(searchCommands).not.toHaveBeenCalled();
        expect(rows).toEqual([
            {
                action: "command",
                commandId: "cmd1",
                noteTitle: "Cmd One",
                notePathTitle: ">Cmd One",
                highlightedNotePathTitle: "Cmd One",
                commandDescription: "desc",
                commandShortcut: "Ctrl+1",
                icon: "bx bx-cog"
            }
        ]);
    });

    it("uses searchCommands when a command query is provided", async () => {
        searchCommands.mockReturnValue([{ id: "c", name: "C" }]);
        const { dataset } = initAndGetSource({ isCommandPalette: true });
        const rows = await runSource(dataset, "> hello");
        expect(searchCommands).toHaveBeenCalledWith("hello");
        expect(rows[0].commandId).toBe("c");
    });

    it("resets searchDelay back to the computed value after it was zeroed", async () => {
        server.get = vi.fn(async () => []) as typeof server.get;
        // Capture the delay arg the source's debounce schedules with, so we can
        // observe that the zeroed searchDelay is restored to the computed value.
        const scheduledDelays: number[] = [];
        const originalSetTimeout = globalThis.setTimeout;
        const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: any, delay?: number, ...rest: any[]) => {
            scheduledDelays.push(delay as number);
            // call through to the real timer so runSource's cb still resolves
            return originalSetTimeout(fn, delay as number, ...rest);
        }) as unknown as typeof setTimeout);
        try {
            const { $el, dataset } = initAndGetSource();
            // showRecentNotes zeroes the shared module-level searchDelay...
            noteAutocomplete.showRecentNotes($el);
            // ...so the FIRST source invocation debounces with delay 0 (immediate)
            // and, because searchDelay === 0, restores it to getSearchDelay(notesCount).
            await runSource(dataset, "x");
            // ...and the SECOND source invocation now sees the restored (non-zero)
            // delay rather than 0 — this is the reset behaviour the test name claims.
            await runSource(dataset, "y");
            expect(server.get).toHaveBeenCalled();

            // The source-callback delays we captured (filtering out any unrelated
            // timers froca/setup may schedule): the run after zeroing uses 0, the
            // following run uses the restored computed delay (which is NOT 0).
            // notesCount resolves to undefined in this mocked environment, so
            // getSearchDelay(undefined) === NaN — still distinct from the zeroed 0.
            expect(scheduledDelays).toContain(0); // the immediate run after zeroing
            const restored = scheduledDelays[scheduledDelays.length - 1];
            expect(restored).not.toBe(0); // searchDelay was restored away from 0
            expect(Number.isNaN(restored)).toBe(true); // == getSearchDelay(undefined)
        } finally {
            setTimeoutSpy.mockRestore();
        }
    });

    it("queries the server and returns plain results", async () => {
        server.get = vi.fn(async () => [{ noteTitle: "Result", notePath: "root/x" }]) as typeof server.get;
        const { dataset } = initAndGetSource();
        const rows = await runSource(dataset, "hello");
        expect(server.get).toHaveBeenCalledWith(
            "autocomplete?query=hello&activeNoteId=activeNote&fastSearch=true"
        );
        expect(rows).toEqual([{ noteTitle: "Result", notePath: "root/x" }]);
    });

    it("does the slow-search placeholder branch when fastSearch is false", async () => {
        server.get = vi.fn(async () => [{ noteTitle: "R" }]) as typeof server.get;
        const cbRows: any[][] = [];
        const { dataset } = initAndGetSource({ fastSearch: false });
        await new Promise<void>((resolve) => {
            let count = 0;
            dataset.source("hi", (rows) => {
                cbRows.push(rows);
                if (++count === 2) resolve();
            });
        });
        // first cb: searching placeholder, second cb: actual results
        expect(cbRows[0][0].noteTitle).toBe("hi");
        expect("highlightedNotePathTitle" in cbRows[0][0]).toBe(true);
        expect(cbRows[1]).toEqual([{ noteTitle: "R" }]);
        expect(server.get).toHaveBeenCalledWith(
            expect.stringContaining("fastSearch=false")
        );
    });

    it("returns early on blank term when fastSearch is false", async () => {
        server.get = vi.fn(async () => [{ noteTitle: "R" }]) as typeof server.get;
        const { dataset } = initAndGetSource({ fastSearch: false });
        const cb = vi.fn();
        // blank term -> autocompleteSource returns before touching the server / cb
        await runSourceRaw(dataset, "   ", cb);
        expect(cb).not.toHaveBeenCalled();
        expect(server.get).not.toHaveBeenCalled();
    });

    it("prepends a create-note suggestion when allowCreatingNotes and term is non-empty", async () => {
        server.get = vi.fn(async () => [{ noteTitle: "Existing", notePath: "root/y" }]) as typeof server.get;
        const { dataset } = initAndGetSource({ allowCreatingNotes: true });
        const rows = await runSource(dataset, "New");
        expect(rows[0].action).toBe("create-note");
        expect(rows[0].parentNoteId).toBe("activeNote");
        expect(rows[1].noteTitle).toBe("Existing");
    });

    it("uses root as parent when there is no active note", async () => {
        getActiveContextNoteId.mockReturnValue(null);
        server.get = vi.fn(async () => []) as typeof server.get;
        const { dataset } = initAndGetSource({ allowCreatingNotes: true });
        const rows = await runSource(dataset, "New");
        expect(rows[0].parentNoteId).toBe("root");
    });

    it("appends a search-notes suggestion when allowJumpToSearchNotes", async () => {
        server.get = vi.fn(async () => [{ noteTitle: "A", notePath: "root/a" }]) as typeof server.get;
        const { dataset } = initAndGetSource({ allowJumpToSearchNotes: true });
        const rows = await runSource(dataset, "term");
        expect(rows[rows.length - 1].action).toBe("search-notes");
    });

    it("prepends an external-link suggestion when allowExternalLinks and term is a URL", async () => {
        server.get = vi.fn(async () => [{ noteTitle: "A", notePath: "root/a" }]) as typeof server.get;
        const { dataset } = initAndGetSource({ allowExternalLinks: true });
        const rows = await runSource(dataset, "https://example.com/x");
        expect(rows[0].action).toBe("external-link");
        expect(rows[0].externalLink).toBe("https://example.com/x");
    });

    it("does not add a create suggestion for an empty term", async () => {
        server.get = vi.fn(async () => [{ noteTitle: "A", notePath: "root/a" }]) as typeof server.get;
        const { dataset } = initAndGetSource({ allowCreatingNotes: true, allowJumpToSearchNotes: true, allowExternalLinks: true });
        const rows = await runSource(dataset, "   ");
        // length === 0 so neither create-note nor search-notes nor external-link added
        expect(rows.every((r) => r.action !== "create-note")).toBe(true);
        expect(rows.every((r) => r.action !== "search-notes")).toBe(true);
    });

    it("renders a note suggestion via the template (default icon, no attribute snippet)", () => {
        const { dataset } = initAndGetSource();
        const html = dataset.templates.suggestion({ highlightedNotePathTitle: "Title" });
        expect(html).toContain("note-suggestion");
        expect(html).toContain("bx bx-note");
        expect(html).toContain("Title");
        expect(html).not.toContain("search-result-attributes");
    });

    it("renders a note suggestion with explicit icon and attribute snippet", () => {
        const { dataset } = initAndGetSource();
        const html = dataset.templates.suggestion({
            highlightedNotePathTitle: "T",
            icon: "bx bx-star",
            highlightedAttributeSnippet: "#color=red"
        });
        expect(html).toContain("bx bx-star");
        expect(html).toContain("search-result-attributes");
        expect(html).toContain("#color=red");
    });

    it("does not render a content snippet by default, even when the suggestion has one", () => {
        // showContentSnippets defaults to false so compact consumers (link dialogs, relation
        // editors, @-mentions) don't grow an extra line.
        const { dataset } = initAndGetSource();
        const html = dataset.templates.suggestion({
            highlightedNotePathTitle: "T",
            highlightedContentSnippet: "some <b>matched</b> content"
        });
        expect(html).not.toContain("search-result-content");
        expect(html).not.toContain("matched");
    });

    it("does not render a content snippet when showContentSnippets is set but the suggestion has none", () => {
        const { dataset } = initAndGetSource({ showContentSnippets: true });
        const html = dataset.templates.suggestion({ highlightedNotePathTitle: "T" });
        expect(html).not.toContain("search-result-content");
    });

    it("renders the content snippet when showContentSnippets is enabled (jump-to-note dialog)", () => {
        const { dataset } = initAndGetSource({ showContentSnippets: true });
        const html = dataset.templates.suggestion({
            highlightedNotePathTitle: "T",
            highlightedContentSnippet: "some <b>matched</b> content"
        });
        expect(html).toContain("search-result-content");
        expect(html).toContain("some <b>matched</b> content");
    });

    it("renders search-notes, create-note and external-link suggestion icons/classes", () => {
        const { dataset } = initAndGetSource();
        expect(dataset.templates.suggestion({ action: "search-notes", highlightedNotePathTitle: "S" }))
            .toContain("search-notes-action");
        expect(dataset.templates.suggestion({ action: "search-notes", highlightedNotePathTitle: "S" }))
            .toContain("bx bx-search");
        expect(dataset.templates.suggestion({ action: "create-note", highlightedNotePathTitle: "C" }))
            .toContain("bx bx-plus");
        expect(dataset.templates.suggestion({ action: "external-link", highlightedNotePathTitle: "E" }))
            .toContain("bx bx-link-external");
    });

    it("renders a command suggestion with description and shortcut", () => {
        const { dataset } = initAndGetSource();
        const html = dataset.templates.suggestion({
            action: "command",
            highlightedNotePathTitle: "Cmd",
            commandDescription: "Does a thing",
            commandShortcut: "Ctrl+K",
            icon: "bx bx-cog"
        });
        expect(html).toContain("command-suggestion");
        expect(html).toContain("command-name");
        expect(html).toContain("command-description");
        expect(html).toContain("command-shortcut");
        expect(html).toContain("bx bx-cog");
    });

    it("renders a command suggestion without description/shortcut and a default icon", () => {
        const { dataset } = initAndGetSource();
        const html = dataset.templates.suggestion({
            action: "command",
            highlightedNotePathTitle: "Cmd"
        });
        expect(html).toContain("bx bx-terminal");
        expect(html).not.toContain("command-description");
        expect(html).not.toContain("command-shortcut");
    });
});

describe("source debounce + searchDelay reset", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        getActiveContextNoteId.mockReturnValue("activeNote");
        registerAutocompleteStub();
        server.get = vi.fn(async () => []) as typeof server.get;
        noteAutocomplete.init();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("debounces and skips the search while composing input", async () => {
        const { $el, dataset } = initAndGetSource();
        // simulate IME composition active
        $el.trigger("compositionstart");
        const cb = vi.fn();
        dataset.source("hi", cb);
        await vi.runAllTimersAsync();
        // isComposingInput is true -> autocompleteSource not invoked
        expect(server.get).not.toHaveBeenCalled();
        expect(cb).not.toHaveBeenCalled();
    });

    it("runs the search after the debounce when not composing", async () => {
        const { dataset } = initAndGetSource();
        const cb = vi.fn();
        dataset.source("hi", cb);
        await vi.runAllTimersAsync();
        expect(server.get).toHaveBeenCalled();
    });
});

describe("$.fn jQuery extensions (init)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        registerAutocompleteStub();
        server.get = vi.fn(async () => []) as typeof server.get;
        noteAutocomplete.init();
    });

    it("getSelectedNotePath returns empty when input value is blank", () => {
        const $el = makeEl();
        $el.val("");
        $el.attr("data-note-path", "root/x");
        expect($el.getSelectedNotePath()).toBe("");
    });

    it("getSelectedNotePath returns the stored path when there is a value", () => {
        const $el = makeEl();
        $el.val("Some title");
        $el.attr("data-note-path", "root/x");
        expect($el.getSelectedNotePath()).toBe("root/x");
    });

    it("getSelectedNoteId returns null when no path, last segment otherwise", () => {
        const $el = makeEl();
        $el.val("");
        expect($el.getSelectedNoteId()).toBeNull();

        $el.val("title");
        $el.attr("data-note-path", "root/parent/child");
        expect($el.getSelectedNoteId()).toBe("child");
    });

    it("setSelectedNotePath toggles the go-to button and sets href", () => {
        const $group = $(`<div class="input-group"><input class="note-autocomplete-input" /><a class="go-to-selected-note-button"></a></div>`);
        const $el = $group.find("input");
        $el.setSelectedNotePath("root/abc");
        const $btn = $group.find(".go-to-selected-note-button");
        expect($btn.hasClass("disabled")).toBe(false);
        expect($btn.attr("href")).toBe("#root/abc");

        $el.setSelectedNotePath("");
        expect($group.find(".go-to-selected-note-button").hasClass("disabled")).toBe(true);
    });

    it("getSelectedExternalLink mirrors getSelectedNotePath blank/value behaviour", () => {
        const $el = makeEl();
        $el.val("");
        $el.attr("data-external-link", "https://x");
        expect($el.getSelectedExternalLink()).toBe("");

        $el.val("title");
        expect($el.getSelectedExternalLink()).toBe("https://x");
    });

    it("setSelectedExternalLink stores the link and disables the go-to button", () => {
        const $group = $(`<div class="input-group"><input /><a class="go-to-selected-note-button"></a></div>`);
        const $el = $group.find("input");
        $el.setSelectedExternalLink("https://example.com");
        expect($el.attr("data-external-link")).toBe("https://example.com");
        expect($group.find(".go-to-selected-note-button").hasClass("disabled")).toBe(true);
    });

    it("setNote loads the note title from froca and sets the value + path", async () => {
        const note = buildNote({ title: "Loaded note" });
        const $el = makeEl();
        await $el.setNote(note.noteId);
        expect($el.val()).toBe("Loaded note");
        expect($el.attr("data-note-path")).toBe(note.noteId);
    });

    it("setNote clears the value when noteId is falsy", async () => {
        const $el = makeEl();
        $el.val("previous");
        await $el.setNote(null as any);
        expect($el.val()).toBe("");
        expect($el.attr("data-note-path")).toBe("");
    });
});

describe("initNoteAutocomplete wiring", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        registerAutocompleteStub();
        server.get = vi.fn(async () => []) as typeof server.get;
        noteAutocomplete.init();
    });

    it("returns early and detaches the noteselected listener if already initialized", () => {
        const $el = makeEl("note-autocomplete-input");
        const result = noteAutocomplete.initNoteAutocomplete($el);
        // no autocomplete init call was made (config + datasets form)
        expect(lastDatasets).toBeUndefined();
        expect(result).toBe($el);
    });

    it("adds all buttons and wires their click handlers", () => {
        const $group = $(`<div class="input-group"></div>`);
        const $el = makeEl();
        $group.append($el);
        noteAutocomplete.initNoteAutocomplete($el);

        expect($el.hasClass("note-autocomplete-input")).toBe(true);
        expect($group.find(".input-clearer-button").length).toBe(1);
        expect($group.find(".show-recent-notes-button").length).toBe(1);
        expect($group.find(".full-text-search-button").length).toBe(1);
        expect($group.find(".go-to-selected-note-button").length).toBe(1);

        const onInput = vi.fn();
        $el.on("input", onInput);

        // clear button -> autocomplete("val", "") + change trigger. Also re-triggers "input" so
        // consumers tracking the live query (e.g. jump_to_note.tsx's actualText ref) don't go
        // stale when the value is cleared programmatically instead of by typing (#task-7 review).
        $group.find(".input-clearer-button").trigger("click");
        expect(autocompleteCalls.some((c) => c[0] === "val" && c[1] === "")).toBe(true);
        expect(onInput).toHaveBeenCalled();

        onInput.mockClear();
        // show-recent-notes button click returns false (prevent focus steal), and likewise
        // re-triggers "input" for the same reason.
        $group.find(".show-recent-notes-button").trigger("click");
        expect(onInput).toHaveBeenCalled();

        // full text search button click
        $el.autocomplete("val", "search me");
        $group.find(".full-text-search-button").trigger("click");
    });

    it("hides the go-to button only when hideGoToSelectedNoteButton is set", () => {
        const $group = $(`<div class="input-group"></div>`);
        const $el = makeEl();
        $group.append($el);
        noteAutocomplete.initNoteAutocomplete($el, { hideGoToSelectedNoteButton: true });
        expect($group.find(".go-to-selected-note-button").length).toBe(0);
        expect($group.find(".full-text-search-button").length).toBe(1);
    });

    it("hides all buttons when hideAllButtons is set", () => {
        const $group = $(`<div class="input-group"></div>`);
        const $el = makeEl();
        $group.append($el);
        noteAutocomplete.initNoteAutocomplete($el, { hideAllButtons: true });
        expect($group.find(".input-clearer-button").length).toBe(0);
        expect($group.find(".go-to-selected-note-button").length).toBe(0);
    });

    it("passes a container into the autocomplete config and enables debug", () => {
        const container = document.createElement("div");
        const $el = makeEl();
        noteAutocomplete.initNoteAutocomplete($el, { container });
        expect(lastConfig?.dropdownMenuContainer).toBe(container);
        expect(lastConfig?.debug).toBe(true);
    });

    it("Ctrl+Enter triggers a search-notes selection when allowJumpToSearchNotes", () => {
        const $el = makeEl();
        const selected = vi.fn();
        ($el as any).on("autocomplete:selected", selected);
        noteAutocomplete.initNoteAutocomplete($el, { allowJumpToSearchNotes: true });

        $el.autocomplete("val", "find this");
        const ev = $.Event("keydown", { ctrlKey: true, key: "Enter" });
        $el.trigger(ev);
        expect(selected).toHaveBeenCalled();
        const payload = selected.mock.calls[0][1];
        expect(payload.action).toBe("search-notes");
    });

    it("Shift+Enter performs a full text search", () => {
        const $el = makeEl();
        noteAutocomplete.initNoteAutocomplete($el);
        $el.autocomplete("val", "some text");
        const callsBefore = autocompleteCalls.length;
        const ev = $.Event("keydown", { shiftKey: true, key: "Enter" });
        $el.trigger(ev);
        // fullTextSearch re-runs the search: it clears val ("val", "") and then
        // re-sets it to the captured search string ("val", "some text"). Assert
        // BOTH setter calls happened after the Shift+Enter, proving the body after
        // the blank-string guard actually ran (not merely the getter read).
        const setterCallsAfter = autocompleteCalls
            .slice(callsBefore)
            .filter((c) => c[0] === "val" && c[1] !== undefined)
            .map((c) => c[1]);
        expect(setterCallsAfter).toContain("");
        expect(setterCallsAfter).toContain("some text");
        // the clear ("val", "") must precede the re-set ("val", "some text")
        expect(setterCallsAfter.indexOf("")).toBeLessThan(setterCallsAfter.indexOf("some text"));
        // and the input ends up re-populated with the search string
        expect($el.autocomplete("val")).toBe("some text");
    });

    it("ignores keydowns that are not Ctrl+Enter / Shift+Enter", () => {
        const $el = makeEl();
        const selected = vi.fn();
        ($el as any).on("autocomplete:selected", selected);
        noteAutocomplete.initNoteAutocomplete($el, { allowJumpToSearchNotes: true });

        // a plain key press -> neither handler fires its body
        $el.trigger($.Event("keydown", { key: "a" }));
        // Ctrl without Enter, Shift without Enter
        $el.trigger($.Event("keydown", { ctrlKey: true, key: "a" }));
        $el.trigger($.Event("keydown", { shiftKey: true, key: "b" }));
        expect(selected).not.toHaveBeenCalled();
    });

    // Issue #5669: autocomplete.js empties its suggestion list only a tick after closing
    // it, and its Enter handler selects from the closed-but-not-yet-emptied dropdown, so
    // a fast second Enter right after a selection would consume a stale suggestion row.
    // Plain Enter must never reach the library while the dropdown is closed (the library
    // keeps aria-expanded in sync with its open/close state).
    it("does not deliver a plain Enter to autocomplete while the dropdown is closed", () => {
        const $el = makeEl();
        noteAutocomplete.initNoteAutocomplete($el);
        // simulates the library's own keydown handler, which is bound after init
        const autocompleteKeydown = vi.fn((event: JQuery.KeyDownEvent) => event.preventDefault());
        $el.on("keydown.aa", autocompleteKeydown);

        // aria-expanded not yet set (before the first open), then explicitly closed
        for (const expanded of [undefined, "false"]) {
            if (expanded) {
                $el.attr("aria-expanded", expanded);
            }
            const event = $.Event("keydown", { key: "Enter" });
            $el.trigger(event);
            // the default action (form submission) must stay intact
            expect(event.isDefaultPrevented()).toBe(false);
        }
        expect(autocompleteKeydown).not.toHaveBeenCalled();
    });

    it("delivers a plain Enter to autocomplete while the dropdown is open", () => {
        const $el = makeEl();
        noteAutocomplete.initNoteAutocomplete($el);
        const autocompleteKeydown = vi.fn();
        $el.on("keydown.aa", autocompleteKeydown);

        $el.attr("aria-expanded", "true");
        $el.trigger($.Event("keydown", { key: "Enter" }));

        expect(autocompleteKeydown).toHaveBeenCalledOnce();
    });

    it("leaves modified Enter presses alone even when the dropdown is closed", () => {
        const $el = makeEl();
        noteAutocomplete.initNoteAutocomplete($el);
        const autocompleteKeydown = vi.fn();
        $el.on("keydown.aa", autocompleteKeydown);

        $el.attr("aria-expanded", "false");
        $el.trigger($.Event("keydown", { key: "Enter", ctrlKey: true }));

        expect(autocompleteKeydown).toHaveBeenCalledOnce();
    });

    it("composition end re-sets the autocomplete value", () => {
        const $el = makeEl();
        noteAutocomplete.initNoteAutocomplete($el);
        $el.autocomplete("val", "composed");
        $el.trigger("compositionstart");
        $el.trigger("compositionend");
        // value was read then re-applied -> still "composed"
        expect($el.autocomplete("val")).toBe("composed");
    });

    it("autocomplete:closed clears text when the input is blank", () => {
        const $el = makeEl();
        noteAutocomplete.initNoteAutocomplete($el);
        $el.val("");
        $el.trigger("autocomplete:closed");
        // clearText sets the path to ""
        expect($el.attr("data-note-path")).toBe("");
    });

    it("autocomplete:closed leaves a non-blank input untouched", () => {
        const $el = makeEl();
        noteAutocomplete.initNoteAutocomplete($el);
        $el.val("keep me");
        $el.attr("data-note-path", "root/keep");
        $el.trigger("autocomplete:closed");
        expect($el.attr("data-note-path")).toBe("root/keep");
    });

    it("autocomplete:opened closes the dropdown for a readonly input", () => {
        const $el = makeEl();
        noteAutocomplete.initNoteAutocomplete($el);
        $el.attr("readonly", "readonly");
        $el.trigger("autocomplete:opened");
        expect(lastCommandWith("close")).toBe(true);
    });

    it("autocomplete:opened does nothing for a non-readonly input", () => {
        const $el = makeEl();
        noteAutocomplete.initNoteAutocomplete($el);
        $el.trigger("autocomplete:opened");
        expect(lastCommandWith("close")).toBe(false);
    });
});

describe("autocomplete:selected handler", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getActiveContext.mockReturnValue({ hoistedNoteId: "hoisted" });
        registerAutocompleteStub();
        server.get = vi.fn(async () => []) as typeof server.get;
        noteAutocomplete.init();
    });

    function initWithSelected() {
        const $el = makeEl();
        const handlers: Record<string, any> = {};
        noteAutocomplete.initNoteAutocomplete($el);
        ["autocomplete:commandselected", "autocomplete:externallinkselected", "autocomplete:noteselected"].forEach((evt) => {
            $el.on(evt, (_e: any, s: any) => (handlers[evt] = s));
        });
        return { $el, handlers };
    }

    function fireSelected($el: JQuery, suggestion: any) {
        ($el as any).trigger("autocomplete:selected", suggestion);
        return new Promise((r) => setTimeout(r, 0));
    }

    it("handles a command selection", async () => {
        const { $el, handlers } = initWithSelected();
        await fireSelected($el, { action: "command", commandId: "x" });
        expect(lastCommandWith("close")).toBe(true);
        expect(handlers["autocomplete:commandselected"]).toBeDefined();
    });

    it("handles an external-link selection", async () => {
        const { $el, handlers } = initWithSelected();
        await fireSelected($el, { action: "external-link", externalLink: "https://e.com" });
        expect($el.attr("data-external-link")).toBe("https://e.com");
        expect(handlers["autocomplete:externallinkselected"]).toBeDefined();
    });

    it("handles a search-notes selection by triggering searchNotes", async () => {
        const { $el } = initWithSelected();
        await fireSelected($el, { action: "search-notes", noteTitle: "query" });
        expect(triggerCommand).toHaveBeenCalledWith("searchNotes", { searchString: "query" });
    });

    it("creates a note then selects it", async () => {
        const note = buildNote({ title: "Created" });
        chooseNoteType.mockResolvedValue({ success: true, noteType: "text", templateNoteId: undefined, notePath: undefined });
        createNote.mockResolvedValue({ note: { getBestNotePathString: () => "root/created" } });
        const { $el, handlers } = initWithSelected();
        await fireSelected($el, { action: "create-note", noteTitle: "Created", parentNoteId: "parent" });
        expect(chooseNoteType).toHaveBeenCalled();
        expect(createNote).toHaveBeenCalledWith("parent", expect.objectContaining({ title: "Created", type: "text" }));
        expect(handlers["autocomplete:noteselected"]).toBeDefined();
        expect(handlers["autocomplete:noteselected"].notePath).toBe("root/created");
    });

    it("aborts the create-note flow when the type chooser is cancelled", async () => {
        chooseNoteType.mockResolvedValue({ success: false });
        const { $el, handlers } = initWithSelected();
        await fireSelected($el, { action: "create-note", noteTitle: "X", parentNoteId: "p" });
        expect(createNote).not.toHaveBeenCalled();
        expect(handlers["autocomplete:noteselected"]).toBeUndefined();
    });

    it("uses the chosen notePath as parent and tolerates a missing created note", async () => {
        chooseNoteType.mockResolvedValue({ success: true, noteType: "text", notePath: "chosen/path" });
        createNote.mockResolvedValue({ note: undefined });
        getActiveContext.mockReturnValue(undefined);
        const { $el, handlers } = initWithSelected();
        await fireSelected($el, { action: "create-note", noteTitle: "X", parentNoteId: "p" });
        expect(createNote).toHaveBeenCalledWith("chosen/path", expect.any(Object));
        // The missing-note branch must be tolerated end to end: note?.getBestNotePathString
        // and getActiveContext()?.hoistedNoteId are both undefined and must not throw.
        // The flow still falls through to fire autocomplete:noteselected with an
        // undefined notePath (rather than crashing inside the async handler).
        expect(handlers["autocomplete:noteselected"]).toBeDefined();
        expect(handlers["autocomplete:noteselected"].notePath).toBeUndefined();
        // the selection was written back as a cleared path (setSelectedNotePath(undefined))
        expect($el.attr("data-note-path") ?? "").toBe("");
    });

    it("handles a plain note selection", async () => {
        const { $el, handlers } = initWithSelected();
        await fireSelected($el, { action: undefined, notePath: "root/n", noteTitle: "N" });
        expect($el.attr("data-note-path")).toBe("root/n");
        expect(handlers["autocomplete:noteselected"]).toBeDefined();
    });
});

describe("public helpers", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        registerAutocompleteStub();
        server.get = vi.fn(async () => []) as typeof server.get;
        noteAutocomplete.init();
    });

    it("setText sets the trimmed value and opens the dropdown", () => {
        const $el = makeEl();
        const onInput = vi.fn();
        $el.on("input", onInput);
        noteAutocomplete.setText($el, "  hello  ");
        expect(lastCommandWith("open")).toBe(true);
        expect($el.attr("data-note-path")).toBe("");
        // re-triggers "input" so consumers tracking the live query stay in sync (#task-7 review)
        expect(onInput).toHaveBeenCalled();
    });

    it("showRecentNotes clears path, blanks val, opens and focuses", () => {
        const $el = makeEl();
        const onInput = vi.fn();
        $el.on("input", onInput);
        noteAutocomplete.showRecentNotes($el);
        expect(lastCommandWith("open")).toBe(true);
        expect($el.attr("data-note-path")).toBe("");
        expect(onInput).toHaveBeenCalled();
    });

    it("showAllCommands sets the '>' prefix and opens", () => {
        const $el = makeEl();
        const onInput = vi.fn();
        $el.on("input", onInput);
        noteAutocomplete.showAllCommands($el);
        // val was set to ">"
        expect($el.autocomplete("val")).toBe(">");
        expect(lastCommandWith("open")).toBe(true);
        expect(onInput).toHaveBeenCalled();
    });

    it("triggerRecentNotes is a no-op for a missing element", () => {
        expect(() => triggerRecentNotes(null)).not.toThrow();
        expect(() => triggerRecentNotes(undefined)).not.toThrow();
    });

    it("triggerRecentNotes shows recent notes for a real element", () => {
        const input = document.createElement("input");
        triggerRecentNotes(input);
        expect(lastCommandWith("open")).toBe(true);
    });
});

describe("fullTextSearch guards", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        registerAutocompleteStub();
        server.get = vi.fn(async () => []) as typeof server.get;
        noteAutocomplete.init();
    });

    it("returns early when the search string is blank (Shift+Enter on empty input)", () => {
        const $el = makeEl();
        noteAutocomplete.initNoteAutocomplete($el);
        $el.autocomplete("val", "   ");
        const callsBefore = autocompleteCalls.length;
        const ev = $.Event("keydown", { shiftKey: true, key: "Enter" });
        $el.trigger(ev);
        // fullTextSearch bailed out at the blank-string guard before re-setting
        // val / focus. The ONLY autocomplete call it may make is the single getter
        // read ("val" with datasets === undefined) at its first line. Assert that
        // NO setter call ("val", <non-undefined>) was added afterwards, which is
        // what would distinguish the early-return path from the full execution
        // (which would have written ["val", ""] then ["val", "   "]).
        const callsAfter = autocompleteCalls.slice(callsBefore);
        const setterCalls = callsAfter.filter((c) => c[0] === "val" && c[1] !== undefined);
        expect(setterCalls).toEqual([]);
        // every autocomplete call after Shift+Enter is at most the guard's getter read
        expect(callsAfter.every((c) => c[0] === "val" && c[1] === undefined)).toBe(true);
        // setSelectedNotePath (which runs only on the non-early path) was not called
        expect($el.attr("data-note-path") ?? "").toBe("");
    });
});
