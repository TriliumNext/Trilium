import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Loads a fresh copy of the module, so that the "only the first call counts" latch of
 * `preloadCommonNoteTypes` starts out untripped in every test.
 */
async function loadModule() {
    vi.resetModules();
    return import("./note_types");
}

describe("preloadCommonNoteTypes", () => {
    let idleCallbacks: (() => void)[];

    beforeEach(() => {
        idleCallbacks = [];
        vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
            idleCallbacks.push(callback);
            return 1;
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("fetches the text editor's module once the browser is idle, and only ever once", async () => {
        const { preloadCommonNoteTypes, TYPE_MAPPINGS } = await loadModule();
        const view = vi.fn(() => Promise.resolve({ default: () => undefined }));
        TYPE_MAPPINGS.editableText.view = view;

        // Merely asking for the preload must not fetch anything yet — the whole point is to wait for
        // a moment where the application has nothing better to do.
        preloadCommonNoteTypes();
        expect(view).not.toHaveBeenCalled();
        expect(idleCallbacks).toHaveLength(1);

        idleCallbacks[0]();
        expect(view).toHaveBeenCalledOnce();

        // Repeated calls (e.g. a second window, or a restart of the layout) are a no-op: the module
        // is in hand already, and re-importing it would only add noise.
        preloadCommonNoteTypes();
        expect(idleCallbacks).toHaveLength(1);
        expect(view).toHaveBeenCalledOnce();
    });

    it("swallows a failed fetch rather than leaving an unhandled rejection behind", async () => {
        const { preloadCommonNoteTypes, TYPE_MAPPINGS } = await loadModule();
        const rejection = Promise.reject(new Error("offline"));
        TYPE_MAPPINGS.editableText.view = () => rejection;

        preloadCommonNoteTypes();
        idleCallbacks[0]();

        await expect(rejection.catch(() => "handled")).resolves.toBe("handled");
    });

    it("falls back to a timer where the browser has no notion of idleness", async () => {
        vi.stubGlobal("requestIdleCallback", undefined);
        vi.useFakeTimers();
        try {
            const { preloadCommonNoteTypes, TYPE_MAPPINGS } = await loadModule();
            const view = vi.fn(() => Promise.resolve({ default: () => undefined }));
            TYPE_MAPPINGS.editableText.view = view;

            preloadCommonNoteTypes();
            expect(view).not.toHaveBeenCalled();

            vi.runAllTimers();
            expect(view).toHaveBeenCalledOnce();
        } finally {
            vi.useRealTimers();
        }
    });
});
