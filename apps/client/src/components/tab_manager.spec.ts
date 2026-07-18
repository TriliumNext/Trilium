import { describe, expect, it } from "vitest";

import TabManager from "./tab_manager.js";

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
});

function openEmptyTabs(tm: TabManager, count: number) {
    return Promise.all(Array.from({ length: count }, () => tm.openEmptyTab()));
}

function ntxOrder(tm: TabManager) {
    return tm.mainNoteContexts.map((nc) => nc.ntxId);
}
