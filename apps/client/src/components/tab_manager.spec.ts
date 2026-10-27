import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildNote } from "../test/easy-froca.js";
import appContext from "./app_context.js";
import NoteContext from "./note_context.js";
import TabManager, { buildNoteContextStatesFromUrl } from "./tab_manager.js";

describe("TabManager tab placement", () => {
    it("opens a blank tab at the end of the row, regardless of which tab is active", async () => {
        const tm = new TabManager();
        const [a, b, c] = await openEmptyTabs(tm, 3);
        tm.activeNtxId = b.ntxId; // active tab sits in the middle

        const blank = await tm.openEmptyTab();

        expect(ntxOrder(tm)).toEqual([a.ntxId, b.ntxId, c.ntxId, blank.ntxId]);
    });

    it("opens a tab spawned from a link right after the active tab", async () => {
        const tm = new TabManager();
        const [a, b, c] = await openEmptyTabs(tm, 3);
        tm.activeNtxId = b.ntxId; // active tab sits in the middle

        // A link / middle-click open goes through openContextWithNote. A null notePath keeps the
        // test focused on placement — the position is decided before any note loads.
        const fromLink = await tm.openContextWithNote(null, { placement: "afterCurrent" });

        expect(ntxOrder(tm)).toEqual([a.ntxId, b.ntxId, fromLink.ntxId, c.ntxId]);
    });

    it("inserts the new tab after the active tab and all of its splits", async () => {
        const tm = new TabManager();
        const [a] = await openEmptyTabs(tm, 1);
        // tab "a" gets two extra splits, then a plain tab "b" follows it
        const aSplit1 = await tm.openEmptyTab(null, "root", a.ntxId);
        const aSplit2 = await tm.openEmptyTab(null, "root", a.ntxId);
        const b = await tm.openEmptyTab();
        tm.activeNtxId = a.ntxId; // the split tab is active

        const fromLink = await tm.openContextWithNote(null, { placement: "afterCurrent" });

        // the new tab lands after the whole "a" group (main + both splits), before "b"
        expect(tm.children.map((nc) => nc.ntxId)).toEqual([
            a.ntxId, aSplit1.ntxId, aSplit2.ntxId, fromLink.ntxId, b.ntxId
        ]);
    });

    it("never inserts an unpinned tab inside the pinned group", async () => {
        const tm = new TabManager();
        const p1 = await tm.openEmptyTab(null, "root", null, true); // pinned
        const p2 = await tm.openEmptyTab(null, "root", null, true); // pinned
        const a = await tm.openEmptyTab();
        tm.activeNtxId = p1.ntxId; // the first pinned tab is active

        const fromLink = await tm.openContextWithNote(null, { placement: "afterCurrent" });

        // inserting right after p1 would split the pinned group, so it clamps past the group
        expect(ntxOrder(tm)).toEqual([p1.ntxId, p2.ntxId, fromLink.ntxId, a.ntxId]);
    });

    it("places a tab from openInNewTab() after the active tab only when asked to", async () => {
        const tm = new TabManager();
        const [a, b, c] = await openEmptyTabs(tm, 3);
        tm.activeNtxId = b.ntxId;

        // `order()` maps an unknown tab identifier to "new".
        const known = [a.ntxId, b.ntxId, c.ntxId];
        const order = () =>
            ntxOrder(tm).map((ntxId) => (known.includes(ntxId) ? ntxId : "new"));

        // An empty note ID makes setNote() return early, so only the placement is exercised.
        await tm.openInNewTab("", null, false, "afterCurrent");
        expect(order()).toEqual([a.ntxId, b.ntxId, "new", c.ntxId]);

        await tm.openInNewTab("", null);
        expect(order()).toEqual([a.ntxId, b.ntxId, "new", c.ntxId, "new"]);
    });
});

describe("moving a tab with splits into a window of its own", () => {
    it("captures every pane of the tab, in order, and which one is focused", async () => {
        const tm = new TabManager();
        const [main, other] = await openEmptyTabs(tm, 2);
        const split1 = await tm.openEmptyTab(null, "root", main.ntxId);
        const split2 = await tm.openEmptyTab(null, "root", main.ntxId);

        main.notePath = "root/aaaaaaaaaaaa";
        split1.notePath = "root/bbbbbbbbbbbb";
        split1.viewScope = { viewMode: "source" };
        split2.notePath = "root/cccccccccccc";
        split2.hoistedNoteId = "h1";
        other.notePath = "root/dddddddddddd"; // a neighbouring tab must not come along
        main.lastActiveNtxId = split2.ntxId; // the last of the three panes had the focus

        expect(tm.captureTabAsWindowTarget(main.ntxId ?? "")).toEqual({
            notePath: "root/aaaaaaaaaaaa",
            hoistedNoteId: "root",
            viewScope: {},
            splits: [
                { notePath: "root/bbbbbbbbbbbb", hoistedNoteId: "root", viewScope: { viewMode: "source" } },
                { notePath: "root/cccccccccccc", hoistedNoteId: "h1", viewScope: {} }
            ],
            activeSplit: 2
        });
    });

    it("falls back to the main pane, and gives up once the tab is gone", async () => {
        const tm = new TabManager();
        const [main] = await openEmptyTabs(tm, 1);
        await tm.openEmptyTab(null, "root", main.ntxId);
        main.lastActiveNtxId = "vanished"; // remembered pane was closed since

        expect(tm.captureTabAsWindowTarget(main.ntxId ?? "")).toMatchObject({ activeSplit: 0 });

        // the tear-off fires from dragMove, so a second call for an already-removed tab is expected
        expect(tm.captureTabAsWindowTarget("gone")).toBeNull();
    });
});

describe("handing a tab over to a window of its own", () => {
    it("moves the tab, having described it before the close takes its panes down", async () => {
        const tm = new TabManager();
        // closing a pane asks the app which manager owns it, which only booting normally answers
        appContext.tabManager = tm;
        const [main, other] = await openEmptyTabs(tm, 2);
        const split = await tm.openEmptyTab(null, "root", main.ntxId);
        main.notePath = "root/aaaaaaaaaaaa";
        split.notePath = "root/bbbbbbbbbbbb";
        const triggerCommand = vi.spyOn(tm, "triggerCommand").mockReturnValue(undefined);

        await tm.moveTabToNewWindowCommand({ ntxId: main.ntxId ?? "" });

        expect(triggerCommand).toHaveBeenCalledWith("openInWindow", expect.objectContaining({
            notePath: "root/aaaaaaaaaaaa",
            splits: [ expect.objectContaining({ notePath: "root/bbbbbbbbbbbb" }) ]
        }));
        // the tab left with its split, leaving the neighbouring tab behind
        expect(ntxOrder(tm)).toEqual([other.ntxId]);
    });

    it("copies the tab without closing it, and asks for nothing once the tab is gone", async () => {
        const tm = new TabManager();
        const [main] = await openEmptyTabs(tm, 2);
        main.notePath = "root/aaaaaaaaaaaa";
        const triggerCommand = vi.spyOn(tm, "triggerCommand").mockReturnValue(undefined);

        await tm.copyTabToNewWindowCommand({ ntxId: main.ntxId ?? "" });

        expect(triggerCommand).toHaveBeenCalledWith("openInWindow", expect.objectContaining({
            notePath: "root/aaaaaaaaaaaa"
        }));
        expect(tm.noteContexts).toContain(main);

        // the tear-off drag fires repeatedly, so a call for an already-removed tab is expected
        triggerCommand.mockClear();
        await tm.copyTabToNewWindowCommand({ ntxId: "gone" });
        expect(triggerCommand).not.toHaveBeenCalled();
    });
});

describe("TabManager after froca is rebuilt", () => {
    it("unpins and empties a tab whose note the rebuild no longer holds", async () => {
        vi.spyOn(appContext, "triggerEvent").mockResolvedValue(undefined as any);
        const tm = new TabManager();
        appContext.tabManager = tm;
        const kept = buildNote({ title: "Kept" });
        const gone = await tm.openEmptyTab(null, "root", null, true);
        const stays = await tm.openEmptyTab(null, "root", null, true);
        gone.noteId = "goneAfterRebuild";
        gone.notePath = "root/goneAfterRebuild";
        stays.noteId = kept.noteId;
        stays.notePath = `root/${kept.noteId}`;

        await tm.handleEvent("frocaReloaded", {});

        expect(gone.pinned).toBe(false);
        expect(gone.noteId).toBeNull();
        expect(stays.pinned).toBe(true);
        expect(stays.noteId).toBe(kept.noteId);
    });
});

describe("buildNoteContextStatesFromUrl", () => {
    it("rebuilds the panes as one tab, with the focused one active", () => {
        const states = buildNoteContextStatesFromUrl({
            notePath: "root/aaaaaaaaaaaa",
            splits: [
                { notePath: "root/bbbbbbbbbbbb", viewScope: { viewMode: "source" } },
                { notePath: null, hoistedNoteId: "h1" }
            ],
            activeSplit: 1
        }, "main1");

        expect(states).toMatchObject([
            { notePath: "root/aaaaaaaaaaaa", ntxId: "main1", mainNtxId: null, active: false },
            {
                notePath: "root/bbbbbbbbbbbb",
                mainNtxId: "main1",
                active: true,
                hoistedNoteId: "root",
                viewScope: { viewMode: "source" }
            },
            // a pane torn off empty stays empty rather than falling back to root
            { notePath: null, mainNtxId: "main1", active: false, hoistedNoteId: "h1" }
        ]);
        // the splits get ids of their own, and the tab remembers which of them held the focus
        expect(new Set(states.map((s) => s.ntxId)).size).toBe(3);
        expect(states[0].lastActiveNtxId).toBe(states[1].ntxId);
    });

    it("opens root for a bare address, and ignores an active index pointing nowhere", () => {
        expect(buildNoteContextStatesFromUrl({}, "main1")).toMatchObject([
            { notePath: "root", ntxId: "main1", mainNtxId: null, active: true }
        ]);

        // activeSplit arrives from the address bar, so it may be out of range in either direction
        const states = buildNoteContextStatesFromUrl(
            { notePath: "root/aaaaaaaaaaaa", splits: [{ notePath: "root/bbbb" }], activeSplit: 9 },
            "main1"
        );
        expect(states.map((s) => s.active)).toEqual([false, true]);
        expect(buildNoteContextStatesFromUrl({ activeSplit: -3 }, "main1")[0].active).toBe(true);
    });

    it("focuses a pane with a note, since an empty one would leave the window with none", () => {
        const states = buildNoteContextStatesFromUrl(
            { notePath: null, splits: [{ notePath: "root/bbbbbbbbbbbb" }], activeSplit: 0 },
            "main1"
        );

        expect(states.map((s) => s.active)).toEqual([false, true]);
    });
});

describe("moving the focus between splits", () => {
    it("steps one pane at a time and stops at both ends of the tab", async () => {
        const tm = new TabManager();
        // a pane resolves its siblings by asking the app which contexts are open
        appContext.tabManager = tm;
        const [ main ] = await openEmptyTabs(tm, 1);
        const split = await tm.openEmptyTab(null, "root", main.ntxId);
        const otherTab = await tm.openEmptyTab();
        expect(tm.children.map((nc) => nc.ntxId)).toEqual([ main.ntxId, split.ntxId, otherTab.ntxId ]);

        await tm.activateNoteContext(main.ntxId);
        const triggerEvent = vi.spyOn(tm, "triggerEvent").mockReturnValue(undefined);

        await tm.focusNoteSplitRightCommand();
        expect(tm.activeNtxId).toBe(split.ntxId);
        // activating the pane moves the tree; the caret follows on its own event
        expect(triggerEvent).toHaveBeenCalledWith("focusOnDetail", { ntxId: split.ntxId });

        // the tab next door is not the next pane
        await tm.focusNoteSplitRightCommand();
        expect(tm.activeNtxId).toBe(split.ntxId);

        await tm.focusNoteSplitLeftCommand();
        expect(tm.activeNtxId).toBe(main.ntxId);

        // and nothing sits to the left of the first pane
        await tm.focusNoteSplitLeftCommand();
        expect(tm.activeNtxId).toBe(main.ntxId);

        // a pane closed between the keypress and the handler leaves the id behind; resolving it is
        // what getActiveMainContext() would throw over
        tm.activeNtxId = "already-gone";
        await tm.focusNoteSplitRightCommand();
        expect(tm.activeNtxId).toBe("already-gone");
    });
});

function openEmptyTabs(tm: TabManager, count: number) {
    return Promise.all(Array.from({ length: count }, () => tm.openEmptyTab()));
}

function ntxOrder(tm: TabManager) {
    return tm.mainNoteContexts.map((nc) => nc.ntxId);
}

describe("note contexts outside the tab row", () => {
    it("resolves a registered context by its id without listing it among the tabs", async () => {
        const tm = new TabManager();
        await openEmptyTabs(tm, 1);
        const popupContext = new NoteContext("_popup-editor");

        tm.registerDetachedContext(popupContext);
        expect(tm.getNoteContextById("_popup-editor")).toBe(popupContext);
        expect(tm.getNoteContexts()).not.toContain(popupContext);

        // `getCommandContext()` returns the context with the given `ntxId`, or the active one without it.
        const [ tab ] = tm.getNoteContexts();
        tm.activeNtxId = tab.ntxId;
        expect(tm.getCommandContext("_popup-editor")).toBe(popupContext);
        expect(tm.getCommandContext(undefined)).toBe(tab);
    });

    it("forgets a context once unregistered, and resolves an unknown one to nothing", async () => {
        const tm = new TabManager();
        await openEmptyTabs(tm, 1);
        const replaced = new NoteContext("_tree-popup");
        const current = new NoteContext("_tree-popup");

        tm.registerDetachedContext(replaced);
        tm.registerDetachedContext(current);
        // Unregistering the context a host replaced leaves the one it replaced it with.
        tm.unregisterDetachedContext(replaced);
        expect(tm.getCommandContext("_tree-popup")).toBe(current);

        tm.unregisterDetachedContext(current);
        expect(tm.getCommandContext("_tree-popup")).toBeNull();
        expect(tm.getCommandContext("_nowhere")).toBeNull();
    });
});

describe("going to an entry of the navigation history", () => {
    let tm: TabManager;

    // Unlike browsers, happy-dom fires `hashchange` for `pushState()` and `replaceState()`.
    const stopHashChange = (e: Event) => e.stopImmediatePropagation();
    beforeAll(() => window.addEventListener("hashchange", stopHashChange, true));
    afterAll(() => window.removeEventListener("hashchange", stopHashChange, true));

    beforeEach(() => {
        // `appContext.triggerEvent` passes on the note switch, and an earlier test mocks it.
        vi.restoreAllMocks();
        buildNote({
            id: "root",
            title: "root",
            children: [
                { id: "historyA", title: "A" },
                { id: "historyB", title: "B" },
                { id: "historyC", title: "C" }
            ]
        });
        tm = new TabManager();
        // A note context reports a note switch through the app, which passes it to its children.
        appContext.tabManager = tm;
        appContext.child(tm);
    });

    afterEach(() => {
        appContext.removeChild(tm);
        vi.restoreAllMocks();
        window.history.replaceState(null, "", "/");
    });

    it("rewrites the entry of another tab instead of pushing over the entries ahead", async () => {
        const first = await tm.openEmptyTab();
        const second = await tm.openEmptyTab();
        await tm.activateNoteContext(first.ntxId);
        await first.setNote("root/historyA");
        await first.setNote("root/historyB");
        await tm.activateNoteContext(second.ntxId);
        await second.setNote("root/historyC");

        // The browser is back on the entry of A, which the first tab has since left for B.
        const entry = `#root/historyA?ntxId=${first.ntxId}`;
        window.history.replaceState(null, "", entry);
        const pushState = vi.spyOn(window.history, "pushState");

        await tm.switchToHistoryEntry(first.ntxId, "root/historyA", { viewMode: "default" });
        expect(pushState).not.toHaveBeenCalled();
        expect(tm.activeNtxId).toBe(first.ntxId);
        expect(first.notePath).toBe("root/historyA");
        expect(window.location.hash).toBe(entry);

        // A note opened afterwards is a new entry again.
        await first.setNote("root/historyC");
        expect(pushState).toHaveBeenCalledOnce();
        expect(window.location.hash).toBe(`#root/historyC?ntxId=${first.ntxId}`);
    });

    it("rewrites the entry of a closed tab with the tab that reopens it", async () => {
        const tab = await tm.openEmptyTab();
        await tm.activateNoteContext(tab.ntxId);
        window.history.replaceState(null, "", "#root/historyA?ntxId=closedTab");
        const pushState = vi.spyOn(window.history, "pushState");

        await tm.switchToHistoryEntry("closedTab", "root/historyA", { viewMode: "default" });

        expect(pushState).not.toHaveBeenCalled();
        const reopened = tm.getActiveContext();
        expect(reopened).not.toBe(tab);
        expect(reopened?.notePath).toBe("root/historyA");
        expect(window.location.hash).toBe(`#root/historyA?ntxId=${reopened?.ntxId}`);
    });

    it("rewrites the entry of a pinned tab with the tab it opens instead", async () => {
        const pinnedTab = await tm.openEmptyTab();
        await tm.activateNoteContext(pinnedTab.ntxId);
        await pinnedTab.setNote("root/historyA");
        await pinnedTab.setNote("root/historyB");
        pinnedTab.pinned = true;

        window.history.replaceState(null, "", `#root/historyA?ntxId=${pinnedTab.ntxId}`);
        const pushState = vi.spyOn(window.history, "pushState");

        await tm.switchToHistoryEntry(pinnedTab.ntxId, "root/historyA", { viewMode: "default" });

        expect(pushState).not.toHaveBeenCalled();
        const opened = tm.getActiveContext();
        expect(opened).not.toBe(pinnedTab);
        expect(pinnedTab.notePath).toBe("root/historyB");
        expect(window.location.hash).toBe(`#root/historyA?ntxId=${opened?.ntxId}`);
    });

    it("pushes a note a pinned tab opens while the entry is still loading", async () => {
        const pinnedTab = await tm.openEmptyTab();
        await tm.activateNoteContext(pinnedTab.ntxId);
        await pinnedTab.setNote("root/historyA");
        await pinnedTab.setNote("root/historyB");
        pinnedTab.pinned = true;

        window.history.replaceState(null, "", `#root/historyA?ntxId=${pinnedTab.ntxId}`);
        let showA: (notePath: string) => void = () => {};
        const resolvePath = vi.spyOn(pinnedTab, "getResolvedNotePath")
            .mockReturnValueOnce(new Promise((resolve) => { showA = resolve; }));
        const pushState = vi.spyOn(window.history, "pushState");
        const replaceState = vi.spyOn(window.history, "replaceState");

        const restoring = tm.switchToHistoryEntry(
            pinnedTab.ntxId, "root/historyA", { viewMode: "default" }
        );
        await vi.waitFor(() => expect(resolvePath).toHaveBeenCalledOnce());
        // A click in the tree while the entry loads.
        const clicked = await pinnedTab.setNote("root/historyC");
        showA("root/historyA");
        await restoring;

        expect(replaceState).not.toHaveBeenCalled();
        expect(pushState).toHaveBeenCalledTimes(2);
        expect(pushState).toHaveBeenNthCalledWith(
            1, null, "", `#root/historyC?ntxId=${clicked?.ntxId}`
        );
    });

    it("pushes a tab switch made while the entry is still loading", async () => {
        const first = await tm.openEmptyTab();
        const second = await tm.openEmptyTab();
        await second.setNote("root/historyC");
        await tm.activateNoteContext(first.ntxId);
        await first.setNote("root/historyA");
        await first.setNote("root/historyB");

        window.history.replaceState(null, "", `#root/historyA?ntxId=${first.ntxId}`);
        let showA: (notePath: string) => void = () => {};
        vi.spyOn(first, "getResolvedNotePath")
            .mockReturnValueOnce(new Promise((resolve) => { showA = resolve; }));
        const pushState = vi.spyOn(window.history, "pushState");
        const replaceState = vi.spyOn(window.history, "replaceState");

        const restoring = tm.switchToHistoryEntry(
            first.ntxId, "root/historyA", { viewMode: "default" }
        );
        await tm.activateNoteContext(second.ntxId);
        showA("root/historyA");
        await restoring;

        expect(replaceState).not.toHaveBeenCalled();
        expect(pushState).toHaveBeenCalledOnce();
        expect(window.location.hash).toBe(`#root/historyC?ntxId=${second.ntxId}`);
        expect(first.notePath).toBe("root/historyA");
    });

    it("keeps rewriting entries when two of them load at once", async () => {
        const tab = await tm.openEmptyTab();
        await tm.activateNoteContext(tab.ntxId);
        await tab.setNote("root/historyA");
        await tab.setNote("root/historyB");
        await tab.setNote("root/historyC");

        let showB: (notePath: string) => void = () => {};
        let showA: (notePath: string) => void = () => {};
        vi.spyOn(tab, "getResolvedNotePath")
            .mockReturnValueOnce(new Promise((resolve) => { showB = resolve; }))
            .mockReturnValueOnce(new Promise((resolve) => { showA = resolve; }));
        const pushState = vi.spyOn(window.history, "pushState");

        // Back twice: the entry of A is reached before B has loaded.
        const toB = tm.switchToHistoryEntry(tab.ntxId, "root/historyB", { viewMode: "default" });
        const toA = tm.switchToHistoryEntry(tab.ntxId, "root/historyA", { viewMode: "default" });
        showB("root/historyB");
        await toB;
        expect(window.location.hash).toBe(`#root/historyB?ntxId=${tab.ntxId}`);
        showA("root/historyA");
        await toA;

        expect(pushState).not.toHaveBeenCalled();
        expect(window.location.hash).toBe(`#root/historyA?ntxId=${tab.ntxId}`);
    });
});
