import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const triggerCommand = vi.fn();
vi.mock("../components/app_context.js", () => ({
    default: {
        triggerCommand: (...args: unknown[]) => triggerCommand(...args)
    }
}));

import { consumeSearchTerms } from "./search_jump.js";

function makeContext(searchTerms?: string[]) {
    return {
        viewScope: searchTerms === undefined ? {} : { searchTerms }
    } as any;
}

describe("consumeSearchTerms", () => {
    let rafCallbacks: FrameRequestCallback[];

    beforeEach(() => {
        triggerCommand.mockClear();
        rafCallbacks = [];
        vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
            rafCallbacks.push(cb);
            return rafCallbacks.length;
        });
    });

    afterEach(() => vi.unstubAllGlobals());

    function flushRaf() {
        const pending = rafCallbacks.splice(0);
        for (const cb of pending) {
            cb(0);
        }
    }

    it("clears searchTerms synchronously and triggers a seeded findInText after a frame", () => {
        const ctx = makeContext([ "foo", "bar" ]);

        consumeSearchTerms(ctx, "ntx1");

        // Cleared immediately so a concurrent same-note re-check sees the consumed state.
        expect(ctx.viewScope.searchTerms).toBeUndefined();
        // Deferred: the command must not fire during the noteSwitched dispatch (would race
        // FindWidget's noteSwitched -> closeSearch and close the freshly opened bar).
        expect(triggerCommand).not.toHaveBeenCalled();

        flushRaf();

        expect(triggerCommand).toHaveBeenCalledTimes(1);
        expect(triggerCommand).toHaveBeenCalledWith("findInText", { ntxId: "ntx1", searchTerms: [ "foo", "bar" ] });
    });

    it("no-ops when searchTerms is absent or empty", () => {
        consumeSearchTerms(makeContext(), "ntx1");
        consumeSearchTerms(makeContext([]), "ntx1");

        flushRaf();

        expect(triggerCommand).not.toHaveBeenCalled();
    });

    it("no-ops when the note context is missing", () => {
        consumeSearchTerms(null, "ntx1");
        consumeSearchTerms(undefined, null);

        flushRaf();

        expect(triggerCommand).not.toHaveBeenCalled();
    });

    it("aborts the deferred trigger when the context navigates before the frame fires", () => {
        const ctx = makeContext([ "foo" ]);

        consumeSearchTerms(ctx, "ntx1");
        // Navigation replaces the context's viewScope object (note_context.setNote /
        // resetViewScope) before the animation frame fires; the stale seeded find must not
        // open the find bar on whatever note the tab shows now.
        ctx.viewScope = {};
        flushRaf();

        expect(triggerCommand).not.toHaveBeenCalled();
    });

    it("is idempotent: a second call after consumption does nothing", () => {
        const ctx = makeContext([ "foo" ]);

        consumeSearchTerms(ctx, "ntx1");
        flushRaf();
        expect(triggerCommand).toHaveBeenCalledTimes(1);

        // Simulates the belt-and-suspenders double trigger (content-ready effect + noteSwitched
        // listener) — the terms are gone, so nothing fires again.
        consumeSearchTerms(ctx, "ntx1");
        flushRaf();
        expect(triggerCommand).toHaveBeenCalledTimes(1);
    });
});
