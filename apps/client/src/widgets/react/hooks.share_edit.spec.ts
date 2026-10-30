import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import server from "../../services/server";
import SpacedUpdate from "../../services/spaced_update";
import type { ShareEditGlobals } from "../../services/utils";
import { saveOnShare } from "./hooks";

/** What the guest API answers a save over an older version with. */
const STALE = JSON.stringify({ stale: { blobId: "newer" } });

describe("saveOnShare", () => {
    const onConflict = vi.fn<ShareEditGlobals["onConflict"]>();
    const onLocked = vi.fn<ShareEditGlobals["onLocked"]>();
    const shareEdit: ShareEditGlobals = {
        version: "blob1", attachments: false, onSaveState: vi.fn(), onConflict, onLocked
    };

    let putWithSilentRefusal: MockInstance<typeof server.putWithSilentRefusal>;

    beforeEach(() => {
        vi.clearAllMocks();
        putWithSilentRefusal = vi.spyOn(server, "putWithSilentRefusal");
        shareEdit.version = "blob1";
        delete shareEdit.stale;
        delete shareEdit.locked;
        (window as unknown as { glob: unknown }).glob = { isShare: true, shareEdit };
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("saves against the loaded version and adopts the saved one", async () => {
        putWithSilentRefusal.mockResolvedValue({ blobId: "blob2" });

        expect(await saveOnShare("note", { content: "<p>x</p>" }, "component", vi.fn())).toBe(true);

        expect(putWithSilentRefusal).toHaveBeenCalledWith(
            "notes/note/data", { content: "<p>x</p>", baseBlobId: "blob1" }, "component");
        expect(shareEdit.version).toBe("blob2");
    });

    it("keeps a stale save pending, unsent, until the visitor keeps their version", async () => {
        putWithSilentRefusal.mockRejectedValueOnce(STALE);
        const retry = vi.fn();
        const save = () => saveOnShare("note", { content: "<p>x</p>" }, undefined, retry);

        await expect(save()).rejects.toThrow(/changed/);
        expect(shareEdit.version).toBe("blob1");
        expect(onConflict).toHaveBeenCalledWith({ blobId: "newer" }, expect.any(Function));

        // The spaced update's own retries send nothing while the visitor has not chosen.
        await expect(save()).rejects.toThrow(/changed/);
        expect(putWithSilentRefusal).toHaveBeenCalledTimes(1);

        onConflict.mock.calls[0][1]();
        expect(shareEdit.version).toBe("newer");
        expect(retry).toHaveBeenCalled();
        putWithSilentRefusal.mockResolvedValueOnce({ blobId: "blob3" });
        expect(await save()).toBe(true);
        expect(putWithSilentRefusal).toHaveBeenLastCalledWith(
            "notes/note/data", { content: "<p>x</p>", baseBlobId: "newer" }, undefined);
    });

    it("holds a save refused for lost access, unsent, until the page unlocks again", async () => {
        putWithSilentRefusal.mockRejectedValueOnce(JSON.stringify({ locked: true }));
        const retry = vi.fn();
        const save = () => saveOnShare("note", { content: "<p>x</p>" }, undefined, retry);

        await expect(save()).rejects.toThrow(/access/);
        expect(onLocked).toHaveBeenCalledWith(expect.any(Function));
        await expect(save()).rejects.toThrow(/access/);
        expect(putWithSilentRefusal).toHaveBeenCalledTimes(1);

        onLocked.mock.calls[0][0]();
        expect(retry).toHaveBeenCalled();
        putWithSilentRefusal.mockResolvedValueOnce({ blobId: "blob2" });
        expect(await save()).toBe(true);
        expect(putWithSilentRefusal).toHaveBeenLastCalledWith(
            "notes/note/data", { content: "<p>x</p>", baseBlobId: "blob1" }, undefined);
    });

    it("leaves the refused content unsaved in the spaced update, with an error", async () => {
        vi.useFakeTimers();
        vi.stubGlobal("logError", vi.fn());
        putWithSilentRefusal.mockRejectedValue(STALE);
        const states: string[] = [];
        const spacedUpdate: SpacedUpdate<{ content: string }> = new SpacedUpdate({
            key: "note",
            prepare: () => ({ content: "<p>x</p>" }),
            commit: async (data) => {
                await saveOnShare("note", data, undefined, () => spacedUpdate.scheduleUpdate());
            }
        }, 1000, (state) => states.push(state));

        spacedUpdate.scheduleUpdate();
        await expect(spacedUpdate.updateNowIfNecessary()).rejects.toThrow(/changed/);
        expect(spacedUpdate.hasUnsavedChanges()).toBe(true);
        expect(states.at(-1)).toBe("error");
    });

    it("rethrows any other failure, and saves nothing off a shared page", async () => {
        putWithSilentRefusal.mockRejectedValue("Network down");
        const save = () => saveOnShare("note", { content: "" }, undefined, vi.fn());
        await expect(save()).rejects.toBe("Network down");
        putWithSilentRefusal.mockRejectedValue(JSON.stringify({ message: "no stale here" }));
        await expect(save()).rejects.toBeDefined();
        expect(onConflict).not.toHaveBeenCalled();

        (window as unknown as { glob: unknown }).glob = { isShare: true };
        expect(await saveOnShare("note", { content: "" }, undefined, vi.fn())).toBe(false);
    });
});
