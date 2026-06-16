import { describe, expect, it } from "vitest";

import { clampDragDestination, partitionPinnedFirst, shouldRedirectPinnedNavigation } from "./tab_pinning.js";

describe("shouldRedirectPinnedNavigation", () => {
    it("redirects only when a pinned tab with a note navigates to a different note", () => {
        expect(shouldRedirectPinnedNavigation(true, "noteA", "noteB")).toBe(true);
    });

    it("allows staying on the same note (e.g. view-scope change)", () => {
        expect(shouldRedirectPinnedNavigation(true, "noteA", "noteA")).toBe(false);
    });

    it("allows the first load when the context has no note yet", () => {
        expect(shouldRedirectPinnedNavigation(true, null, "noteA")).toBe(false);
        expect(shouldRedirectPinnedNavigation(true, undefined, "noteA")).toBe(false);
    });

    it("never redirects an unpinned tab", () => {
        expect(shouldRedirectPinnedNavigation(false, "noteA", "noteB")).toBe(false);
        expect(shouldRedirectPinnedNavigation(undefined, "noteA", "noteB")).toBe(false);
    });

    it("does not redirect when the target note cannot be resolved", () => {
        expect(shouldRedirectPinnedNavigation(true, "noteA", null)).toBe(false);
        expect(shouldRedirectPinnedNavigation(true, "noteA", undefined)).toBe(false);
    });
});

describe("partitionPinnedFirst", () => {
    const isPinned = (t: { id: string; pinned?: boolean }) => !!t.pinned;

    it("moves pinned items to the front while keeping relative order in both groups", () => {
        const items = [
            { id: "a" },
            { id: "b", pinned: true },
            { id: "c" },
            { id: "d", pinned: true }
        ];

        expect(partitionPinnedFirst(items, isPinned).map((t) => t.id)).toEqual(["b", "d", "a", "c"]);
    });

    it("is a no-op when nothing is pinned", () => {
        const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
        expect(partitionPinnedFirst(items, isPinned).map((t) => t.id)).toEqual(["a", "b", "c"]);
    });

    it("keeps order when everything is pinned", () => {
        const items = [{ id: "a", pinned: true }, { id: "b", pinned: true }];
        expect(partitionPinnedFirst(items, isPinned).map((t) => t.id)).toEqual(["a", "b"]);
    });

    it("handles an empty list", () => {
        expect(partitionPinnedFirst([], isPinned)).toEqual([]);
    });
});

describe("clampDragDestination", () => {
    // Layout: [pinned, pinned, normal, normal, normal] => pinnedCount = 2, total = 5
    it("keeps a pinned tab inside the pinned zone", () => {
        expect(clampDragDestination(4, true, 2, 5)).toBe(1); // can't leave the pinned zone
        expect(clampDragDestination(0, true, 2, 5)).toBe(0);
        expect(clampDragDestination(1, true, 2, 5)).toBe(1);
    });

    it("keeps an unpinned tab inside the unpinned zone", () => {
        expect(clampDragDestination(0, false, 2, 5)).toBe(2); // can't enter the pinned zone
        expect(clampDragDestination(3, false, 2, 5)).toBe(3);
        expect(clampDragDestination(9, false, 2, 5)).toBe(4); // can't exceed the last index
    });

    it("handles the no-pinned-tabs case (whole row is the unpinned zone)", () => {
        expect(clampDragDestination(0, false, 0, 3)).toBe(0);
        expect(clampDragDestination(2, false, 0, 3)).toBe(2);
    });
});
