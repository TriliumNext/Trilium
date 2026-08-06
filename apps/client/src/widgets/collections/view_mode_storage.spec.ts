/**
 * Regression tests for collection views writing their config back unprompted.
 *
 * A view reports its own doing as readily as the user's — a geo map is told to move to its saved
 * position as it opens and hears that move back as though it had been dragged there — so `store()`
 * is called with the config that was just restored. The attachment is saved with `forceSave`, so
 * writing it anyway stamps a new date, records an entity change and announces it to every client,
 * each of which fetches the attachment back to find nothing changed. Opened in a dozen tabs, that
 * was a dozen writes and a fetch of each per tab for a config nobody touched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../entities/fnote";
import server from "../../services/server";
import ViewModeStorage from "./view_mode_storage";

vi.mock("../../services/server", () => ({
    default: {
        post: vi.fn(async () => {}),
        get: vi.fn(async () => ({ content: "{}" })),
        remove: vi.fn(async () => {})
    }
}));

interface Config extends Record<string, unknown> {
    view?: { zoom: number };
}

/** A note carrying one `viewConfig` attachment, as a collection view's owner does. */
function noteWithStoredConfig(content: string | undefined) {
    const attachment = { attachmentId: "att-1", title: "geoMap.json" };
    vi.mocked(server.get).mockResolvedValue(content === undefined ? null : { content });
    return {
        noteId: "note-1",
        getAttachmentsByRole: vi.fn(async () => (content === undefined ? [] : [ attachment ]))
    } as unknown as FNote;
}

describe("ViewModeStorage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(server.post).mockResolvedValue(undefined);
    });

    it("does not write a config identical to the one it restored", async () => {
        const stored = JSON.stringify({ view: { zoom: 8 } });
        const storage = new ViewModeStorage<Config>(noteWithStoredConfig(stored), "geoMap");

        const restored = await storage.restore();
        expect(restored).toEqual({ view: { zoom: 8 } });

        // What a map does on opening: report the position it was just told to take.
        await storage.store({ view: { zoom: 8 } });
        expect(server.post).not.toHaveBeenCalled();

        // A genuine change still goes through, and only once.
        await storage.store({ view: { zoom: 9 } });
        await storage.store({ view: { zoom: 9 } });
        expect(server.post).toHaveBeenCalledTimes(1);
        expect(vi.mocked(server.post).mock.calls[0][1]).toMatchObject({
            title: "geoMap.json",
            role: "viewConfig",
            content: JSON.stringify({ view: { zoom: 9 } })
        });
    });

    it("writes the first config for a view that has none stored", async () => {
        const storage = new ViewModeStorage<Config>(noteWithStoredConfig(undefined), "geoMap");

        expect(await storage.restore()).toBeUndefined();

        await storage.store({ view: { zoom: 2 } });
        expect(server.post).toHaveBeenCalledTimes(1);
    });

    it("reports an external change once, and not its own writes", async () => {
        const stored = JSON.stringify({ view: { zoom: 8 } });
        const note = noteWithStoredConfig(stored);
        const storage = new ViewModeStorage<Config>(note, "geoMap");
        await storage.restore();

        // Our own echo: the attachment holds exactly what we last saw.
        expect(await storage.restoreIfChanged()).toBeUndefined();

        // Another tab moved the map.
        vi.mocked(server.get).mockResolvedValue({ content: JSON.stringify({ view: { zoom: 12 } }) });
        expect(await storage.restoreIfChanged()).toEqual({ view: { zoom: 12 } });
        expect(await storage.restoreIfChanged()).toBeUndefined();

        // And having taken that on, we do not write it straight back.
        await storage.store({ view: { zoom: 12 } });
        expect(server.post).not.toHaveBeenCalled();
    });
});
