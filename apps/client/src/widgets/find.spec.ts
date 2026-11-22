import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type NoteContext from "../components/note_context";
import toast from "../services/toast";
import FindWidget, {
    type CloseGuard, type FindChecks, type NavigationOptions, type WriteOutcome
} from "./find";
import type { FindCheck } from "./merged_find";
import { ScrollRailLayer } from "./scroll_rail_markers";

// The translations are loaded after this module is, as a layout that imports the bar statically
// loads it before `initLocale()` has run.
const i18n = vi.hoisted(() => ({ isLoaded: false }));
vi.mock("../services/i18n.js", () => ({ t: (key: string) => (i18n.isLoaded ? key : "") }));
vi.mock("../services/toast", () => ({ default: { showMessage: vi.fn() } }));

function fakeContext(ntxId: string) {
    return { ntxId, note: null } as unknown as NoteContext;
}

describe("FindWidget", () => {
    beforeAll(() => {
        i18n.isLoaded = true;
    });

    it("words its fields in the translations loaded after its module", () => {
        const $widget = new FindWidget().render();
        expect($widget.find(".find-widget-search-term-input").attr("placeholder")).toBe("find.find_placeholder");
        const labels = $widget.find(".find-widget-box .form-check-label").toArray()
            .map((label) => label.textContent?.trim());
        expect(labels).toEqual([ "find.case_sensitive", "find.match_words" ]);
    });

    it("stays on its pinned context while the tabs switch theirs", async () => {
        const popup = fakeContext("_popup-editor");
        const tab = fakeContext("main");
        const widget = new FindWidget("_popup-editor");
        widget.render();

        await widget.handleEvent("activeContextChanged", { noteContext: popup });
        expect(widget.noteContext).toBe(popup);

        await widget.handleEvent("activeContextChanged", { noteContext: tab });
        await widget.handleEvent("noteSwitchedAndActivated", { noteContext: tab, notePath: "root/n2" });
        await widget.handleEvent("setNoteContext", { noteContext: tab });
        expect(widget.noteContext).toBe(popup);

        // Unpinned, the bar follows the active context, as it does in the tab row.
        const unpinned = new FindWidget();
        unpinned.render();
        await unpinned.handleEvent("activeContextChanged", { noteContext: tab });
        expect(unpinned.noteContext).toBe(tab);
    });

    it("keeps Escape to itself, so a dialog around it stays open", () => {
        const widget = new FindWidget();
        const host = document.body.appendChild(document.createElement("div"));
        const onHost = vi.fn();
        host.addEventListener("keydown", onHost);
        widget.render().appendTo(host);

        const input = host.querySelector(".find-widget-search-term-input");
        expect(input).not.toBeNull();
        input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(onHost).not.toHaveBeenCalled();

        host.remove();
    });
});

describe("FindWidget requests", () => {
    beforeAll(() => {
        i18n.isLoaded = true;
    });
    beforeEach(() => {
        vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout" ] });
        vi.mocked(toast.showMessage).mockClear();
    });
    afterEach(() => {
        vi.useRealTimers();
        document.body.replaceChildren();
    });

    it("publishes the find layer while a text note has matches and the bar is open", async () => {
        const bar = await openBar({ needle: 3, none: 0 });
        await bar.search("needle");
        const layer = bar.layer();
        expect(layer).toBeInstanceOf(ScrollRailLayer);
        expect(bar.counters()).toEqual([ "1", "3" ]);
        expect(layer?.emphasized).toBe(0);

        await bar.press("Enter");
        await bar.settle();
        expect(bar.handler.findNext).toHaveBeenLastCalledWith(
            0, 0, 1, expect.objectContaining({ check: expect.any(Function) }));
        expect(bar.counters()).toEqual([ "2", "3" ]);
        expect(layer?.emphasized).toBe(1);

        await bar.search("none");
        expect(bar.noteContext.clearContextData).toHaveBeenLastCalledWith("scrollRailFind");
        await bar.search("needle");
        expect(bar.layer()).toBe(layer);
        await bar.widget.closeSearch();
        expect(bar.noteContext.clearContextData).toHaveBeenCalledTimes(2);

        // Other note types search with the bar too, and publish nothing.
        const code = await openBar({ needle: 3 }, "code");
        await code.search("needle");
        expect(code.counters()).toEqual([ "1", "3" ]);
        expect(code.noteContext.setContextData).not.toHaveBeenCalled();
    });

    it("marks results stale on an edit, whose lines follow with refreshLater() alone", async () => {
        const bar = await openBar({ needle: 3 });
        await bar.search("needle");
        const layer = bar.layer();
        if (!layer) throw new Error("No layer was published.");
        const calls = spyOnLayer(layer);

        for (let index = 0; index < 10; index++) {
            bar.widget.invalidateResults("content");
        }
        expect(bar.counters()).toEqual([ "1", "?" ]);
        expect(calls.refreshLater).toHaveBeenCalledTimes(10);
        expect(calls.retire).not.toHaveBeenCalled();
        expect(calls.refresh).not.toHaveBeenCalled();
        expect(layer.emphasized).toBeNull();

        // A line declines its click, so the rail goes to that line's own match.
        expect(layer.source.onClick?.(1)).toBe(false);
        layer.source.readTargets();
        expect(bar.handler.getMatchTargets).toHaveBeenLastCalledWith({ isStale: true });
        await bar.settle();
        expect(bar.handler.findNext).not.toHaveBeenCalled();

        // Enter at `?` searches again.
        await bar.press("Enter");
        await bar.settle();
        expect(bar.handler.performFind).toHaveBeenCalledTimes(2);
        expect(bar.counters()).toEqual([ "1", "3" ]);
    });

    it("makes a fresh line's match current at once, and declines while a search runs", async () => {
        const bar = await openBar({ needle: 3, other: 2 });
        await bar.search("needle");
        const layer = bar.layer();

        expect(layer?.source.onClick?.(2)).toBe(true);
        await bar.settle();
        expect(bar.handler.findNext).toHaveBeenLastCalledWith(
            0, 0, 2, expect.objectContaining({ isInstant: true }));
        expect(bar.counters()).toEqual([ "3", "3" ]);
        expect(layer?.emphasized).toBe(2);

        const release = bar.handler.hold("other");
        bar.type("other");
        expect(layer?.source.onClick?.(0)).toBe(false);
        await bar.wait(200);
        expect(layer?.source.onClick?.(0)).toBe(false);
        release();
        await bar.settle();
        expect(layer?.source.onClick?.(0)).toBe(true);
    });

    it("retires the lines when a search is asked and run, and skips an overtaken one", async () => {
        const bar = await openBar({ needle: 3, b: 2, c: 2, d: 1 });
        await bar.search("needle");
        const layer = bar.layer();
        if (!layer) throw new Error("No layer was published.");
        const { retire } = spyOnLayer(layer);

        const release = bar.handler.hold("b");
        bar.type("b");
        expect(retire).toHaveBeenCalledTimes(1);
        await bar.wait(200);
        expect(retire).toHaveBeenCalledTimes(3);
        await bar.searchWithoutWaiting("c");
        await bar.searchWithoutWaiting("d");
        release();
        await bar.settle();
        expect(bar.handler.performFind.mock.calls.map(([ term ]) => term))
            .toEqual([ "needle", "b", "d" ]);
        expect(bar.counters()).toEqual([ "1", "1" ]);
        expect(layer.isPaused).toBe(false);
    });

    it("shows nothing of a search ended by Escape, and runs none closed in the delay", async () => {
        const bar = await openBar({ needle: 3, b: 2, c: 1 });
        await bar.search("needle");
        const published = bar.noteContext.setContextData.mock.calls.length;

        const release = bar.handler.hold("b");
        await bar.searchWithoutWaiting("b");
        const closed = bar.widget.closeSearch();
        await bar.flush();
        expect(bar.handler.findBoxClosed).not.toHaveBeenCalled();
        release();
        await closed;
        expect(bar.handler.log).toEqual([ "search needle", "search b", "close" ]);
        expect(bar.counters()).toEqual([ "1", "3" ]);
        expect(bar.noteContext.setContextData).toHaveBeenCalledTimes(published);

        await bar.reopen();
        bar.type("c");
        await bar.widget.closeSearch();
        await bar.wait(500);
        expect(bar.handler.log).not.toContain("search c");
    });

    it("lets Enter and Replace All wait for a pending search; Replace does nothing", async () => {
        const bar = await openBar({ a: 3, b: 5 });
        await bar.search("a");
        const release = bar.handler.hold("b");
        await bar.searchWithoutWaiting("b");

        await bar.press("Enter");
        await bar.click(".replace-widget-replace-button");
        await bar.click(".replace-widget-replaceall-button");
        release();
        await bar.settle();

        expect(bar.handler.findNext).toHaveBeenCalledExactlyOnceWith(0, 0, 1, expect.anything());
        expect(bar.handler.replace).not.toHaveBeenCalled();
        expect(bar.handler.log).toEqual([ "search a", "search b", "replaceAll pin" ]);
        expect(bar.counters()).toEqual([ "0", "0" ]);
    });

    it("stops a search overtaken by typing before it shows, and the Enter behind it", async () => {
        const bar = await openBar({ a: 3, b: 5, c: 2 });
        await bar.search("a");
        const release = bar.handler.hold("b");
        await bar.searchWithoutWaiting("b");
        await bar.press("Enter");
        bar.type("c");
        release();
        await bar.flush();

        expect(bar.counters()).toEqual([ "1", "3" ]);
        expect(bar.handler.findNext).not.toHaveBeenCalled();
        expect(bar.layer()?.source.onClick?.(0)).toBe(false);
        expect(bar.layer()?.isPaused).toBe(true);
        await bar.wait(200);
        await bar.settle();
        expect(bar.counters()).toEqual([ "1", "2" ]);
        expect(bar.layer()?.isPaused).toBe(false);
    });

    it("runs a close's cleanup after the request before it; recovers from a failure", async () => {
        const bar = await openBar({ a: 3, b: 2 });
        const release = bar.handler.hold("a");
        await bar.searchWithoutWaiting("a");
        void bar.widget.closeSearch();
        await bar.reopen();
        release();
        await bar.settle();
        // The reopened bar keeps the focus: no cleanup takes it once another session opened.
        expect(bar.handler.closeGuards).toEqual([ false ]);

        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        bar.handler.fail("b");
        await bar.search("b");
        expect(error).toHaveBeenCalledOnce();
        expect(bar.counters()[1]).toBe("?");
        await bar.press("Enter");
        await bar.settle();
        expect(bar.handler.log.filter((entry) => entry === "search b")).toHaveLength(2);
        expect(bar.counters()).toEqual([ "1", "2" ]);
        await bar.widget.closeSearch();
        expect(bar.handler.closeGuards).toEqual([ false, true ]);
        await bar.reopen();
        await bar.search("a");
        expect(bar.counters()).toEqual([ "1", "3" ]);
        error.mockRestore();
    });

    it("drops a write whose search does not commit, with a message; replaces nothing", async () => {
        const bar = await openBar({ a: 3, b: 2, c: 1 });
        await bar.search("a");
        const release = bar.handler.hold("b");
        await bar.searchWithoutWaiting("b");
        await bar.click(".replace-widget-replaceall-button");
        await bar.searchWithoutWaiting("c");
        release();
        await bar.settle();
        expect(bar.handler.log).toEqual([ "search a", "search b", "search c" ]);
        expect(toast.showMessage).toHaveBeenCalledExactlyOnceWith("find.nothing_replaced");
        expect(bar.counters()).toEqual([ "1", "1" ]);

        // A search that fails leaves its write nothing to replace in either.
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        bar.handler.fail("b");
        const releaseFailing = bar.handler.hold("b");
        await bar.searchWithoutWaiting("b");
        await bar.click(".replace-widget-replaceall-button");
        releaseFailing();
        await bar.settle();
        expect(bar.handler.replaceAll).not.toHaveBeenCalled();
        expect(toast.showMessage).toHaveBeenCalledTimes(2);
        error.mockRestore();
    });

    it("makes a write and Enter follow the field in the delay, with no second search", async () => {
        const bar = await openBar({ a: 3, b: 2, c: 4 });
        await bar.search("a");

        bar.type("b");
        await bar.click(".replace-widget-replaceall-button");
        await bar.settle();
        expect(bar.handler.log).toEqual([ "search a", "search b", "replaceAll pin" ]);
        await bar.wait(300);
        expect(bar.handler.performFind).toHaveBeenCalledTimes(2);

        // Replace searches the field and stops at its start match, which the next click replaces.
        bar.type("c");
        await bar.click(".replace-widget-replace-button");
        await bar.settle();
        expect(bar.handler.log.at(-1)).toBe("search c");
        await bar.click(".replace-widget-replace-button");
        await bar.settle();
        expect(bar.handler.log.at(-1)).toBe("replace pin");

        // Enter during the delay searches the field at once, and steps through none of the old
        // matches.
        bar.type("a");
        await bar.press("Enter");
        await bar.settle();
        await bar.wait(300);
        expect(bar.handler.log.slice(-2)).toEqual([ "replace pin", "search a" ]);
        expect(bar.handler.findNext).not.toHaveBeenCalled();

        // A stale result is searched again before Replace All replaces in it.
        bar.widget.invalidateResults("content");
        await bar.click(".replace-widget-replaceall-button");
        await bar.settle();
        expect(bar.handler.log.slice(-2)).toEqual([ "search a", "replaceAll pin" ]);
    });

    it("finishes a write overtaken by typing and shows nothing of it", async () => {
        const bar = await openBar({ a: 3, b: 2 });
        await bar.search("a");
        const release = bar.handler.hold("replaceAll");
        await bar.click(".replace-widget-replaceall-button");
        bar.type("b");
        release();
        await bar.flush();
        expect(bar.handler.log).toEqual([ "search a", "replaceAll pin" ]);
        expect(bar.counters()).toEqual([ "1", "3" ]);
        expect(bar.layer()?.isPaused).toBe(true);
        await bar.wait(200);
        await bar.settle();
        expect(bar.counters()).toEqual([ "1", "2" ]);
    });

    it("holds a write's invalidations: edits are counted, a new embed makes it stale", async () => {
        const bar = await openBar({ a: 3 });
        await bar.search("a");

        let release = bar.handler.hold("replaceAll");
        await bar.click(".replace-widget-replaceall-button");
        bar.widget.invalidateResults("content");
        expect(bar.counters()[1]).toBe("3");
        expect(bar.layer()?.isPaused).toBe(true);
        release();
        await bar.settle();
        expect(bar.counters()).toEqual([ "0", "0" ]);

        bar.handler.counts.a = 2;
        bar.type("");
        await bar.search("a");
        release = bar.handler.hold("replaceAll");
        await bar.click(".replace-widget-replaceall-button");
        bar.widget.invalidateResults("targets");
        release();
        await bar.settle();
        expect(bar.counters()[1]).toBe("?");
    });

    it("shows a seeded search's bar only with matches, then publishes the layer", async () => {
        const bar = await openBar({ needle: 2 }, "text", false);
        const isShownWhenPublished: boolean[] = [];
        bar.noteContext.setContextData.mockImplementation(() => {
            isShownWhenPublished.push(bar.widget.$widget[0].style.display !== "none");
        });

        await bar.widget.findInTextEvent({ ntxId: "main", searchTerms: [ "needle", "extra" ] });
        await bar.settle();
        expect(bar.widget.$widget[0].style.display).not.toBe("none");
        expect(isShownWhenPublished).toEqual([ true ]);
        expect(bar.handler.highlightExtraTokens).toHaveBeenCalledWith([ "extra" ]);

        await bar.widget.closeSearch();
        await bar.widget.findInTextEvent({ ntxId: "main", searchTerms: [ "none" ] });
        await bar.settle();
        expect(bar.widget.$widget[0].style.display).toBe("none");
        expect(isShownWhenPublished).toEqual([ true ]);
        await bar.widget.closeSearch();
        // A bar that never showed takes no focus on close.
        expect(bar.handler.closeGuards.at(-1)).toBe(false);
    });

    it("drops a search answered after the context switched notes; moves no focus", async () => {
        const bar = await openBar({ needle: 2 });
        const release = bar.handler.hold("needle");
        await bar.searchWithoutWaiting("needle");
        bar.noteContext.noteId = "otherNote";
        release();
        await bar.settle();
        expect(bar.counters()).toEqual([ "0", "0" ]);
        expect(bar.noteContext.setContextData).not.toHaveBeenCalled();
        await bar.widget.closeSearch();
        expect(bar.handler.closeGuards).toEqual([ false ]);
    });
});

interface Deferred {
    promise: Promise<void>;
    resolve(): void;
}

function defer(): Deferred {
    let resolve: () => void = () => {};
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

/**
 * A backend of the bar with `counts` matches per term. A search or a write can be held until
 * released, and a search can fail.
 */
function createHandler(counts: Record<string, number>) {
    const holds = new Map<string, Deferred>();
    const log: string[] = [];
    const closeGuards: boolean[] = [];
    let failing: string | null = null;
    let term = "";

    async function write(
        kind: "replace" | "replaceAll", text: string, checks: FindChecks
    ): Promise<WriteOutcome> {
        if (!checks.start()) return { isDropped: true, result: null };
        log.push(`${kind} ${text}`);
        await holds.get(kind)?.promise;
        counts[term] = kind === "replaceAll" ? 0 : Math.max((counts[term] ?? 0) - 1, 0);
        const total = counts[term] ?? 0;
        return {
            isDropped: false,
            result: checks.show() ? { totalFound: total, currentFound: total ? 1 : 0 } : null
        };
    }

    return {
        counts, log, closeGuards,
        performFind: vi.fn(async (
            searchTerm: string, _matchCase: boolean, _wholeWord: boolean, check: FindCheck
        ) => {
            log.push(`search ${searchTerm}`);
            await holds.get(searchTerm)?.promise;
            if (searchTerm === failing) {
                failing = null;
                throw new Error("The search failed.");
            }
            if (!check()) return null;
            term = searchTerm;
            const total = counts[searchTerm] ?? 0;
            return { totalFound: total, currentFound: total ? 1 : 0 };
        }),
        findNext: vi.fn(async (
            _direction: number, _current: number, _next: number, _options?: NavigationOptions
        ) => true),
        canReplace: () => true,
        replace: vi.fn((text: string, checks: FindChecks) => write("replace", text, checks)),
        replaceAll: vi.fn((text: string, checks: FindChecks) => write("replaceAll", text, checks)),
        findBoxClosed: vi.fn(async (guard: CloseGuard) => {
            log.push("close");
            closeGuards.push(guard());
        }),
        getMatchTargets: vi.fn((_options: { isStale: boolean }) => []),
        highlightExtraTokens: vi.fn(async (_tokens: string[]) => {}),
        /**
         * Holds the search for `key`, or the write of that kind, until the returned function runs.
         */
        hold(key: string) {
            const deferred = defer();
            holds.set(key, deferred);
            return () => {
                holds.delete(key);
                deferred.resolve();
            };
        },
        fail(searchTerm: string) {
            failing = searchTerm;
        }
    };
}

/** Opens the find bar of a note of `noteType`, which searches with a fake backend. */
async function openBar(counts: Record<string, number>, noteType = "text", isOpened = true) {
    const noteContext = {
        ntxId: "main",
        noteId: "noteOne" as string | null,
        get note() {
            return { noteId: "noteOne", type: noteType };
        },
        viewScope: { viewMode: "default" },
        isReadOnly: async () => false,
        getCodeEditor: async () => ({ getSelectedText: () => "" }),
        setContextData: vi.fn(),
        clearContextData: vi.fn()
    };
    const handler = createHandler(counts);
    const widget = new FindWidget();
    document.body.append(widget.render()[0]);
    widget.noteContext = noteContext as unknown as NoteContext;
    vi.spyOn(widget, "getHandler").mockImplementation(async () => {
        await (widget as unknown as { loadRailLayer(): Promise<void> }).loadRailLayer();
        return handler as unknown as Awaited<ReturnType<FindWidget["getHandler"]>>;
    });
    const input = widget.$widget[0].querySelector<HTMLInputElement>(
        ".find-widget-search-term-input"
    );
    if (!input) throw new Error("The bar has no field.");
    $(widget.$widget[0]).find(".replace-widget-replacetext-input").val("pin");

    const flush = async () => {
        for (let index = 0; index < 20; index++) await Promise.resolve();
    };
    const settle = async () => {
        await flush();
        await (widget as unknown as { queue: Promise<void> }).queue;
        await flush();
    };
    const wait = async (delay: number) => {
        vi.advanceTimersByTime(delay);
        await flush();
    };
    const type = (text: string) => {
        input.value = text;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const reopen = () => widget.findInTextEvent({ ntxId: "main" });
    if (isOpened) await reopen();

    return {
        widget, handler, noteContext, flush, settle, wait, type, reopen,
        /** Types `text` and lets the timer ask for its search, without waiting for its answer. */
        searchWithoutWaiting: async (text: string) => {
            type(text);
            await wait(200);
        },
        search: async (text: string) => {
            type(text);
            await wait(200);
            await settle();
        },
        press: async (key: string) => {
            input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
            await flush();
        },
        click: async (selector: string) => {
            widget.$widget[0].querySelector<HTMLElement>(selector)?.click();
            await flush();
        },
        counters: () => [ ".find-widget-current-found", ".find-widget-total-found" ]
            .map((selector) => widget.$widget[0].querySelector(selector)?.textContent ?? ""),
        layer: () =>
            noteContext.setContextData.mock.calls.at(-1)?.[1] as ScrollRailLayer | undefined
    };
}

function spyOnLayer(layer: ScrollRailLayer) {
    return {
        retire: vi.spyOn(layer, "retire"),
        refresh: vi.spyOn(layer, "refresh"),
        refreshLater: vi.spyOn(layer, "refreshLater")
    };
}
