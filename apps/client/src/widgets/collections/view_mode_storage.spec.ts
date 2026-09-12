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

    /**
     * Each write carries the whole config, so two of them in flight can arrive in either order and
     * the earlier one landing last puts back the config it was built before. A board switching its
     * grouping while a column change is still being written would lose that grouping's columns.
     */
    it("sends one write at a time, in the order they were asked for", async () => {
        const storage = new ViewModeStorage<Config>(noteWithStoredConfig(undefined), "geoMap");
        const sent: string[] = [];
        let releaseFirst = () => {};
        vi.mocked(server.post)
            .mockImplementationOnce(async () => {
                await new Promise<void>((resolve) => { releaseFirst = resolve; });
            });

        const first = storage.store({ view: { zoom: 1 } });
        const second = storage.store({ view: { zoom: 2 } });
        // Lets the queue reach the first request, which is held open below.
        await new Promise((resolve) => setTimeout(resolve));

        // The second is held back rather than raced against the first.
        expect(server.post).toHaveBeenCalledTimes(1);

        releaseFirst();
        await Promise.all([ first, second ]);

        expect(server.post).toHaveBeenCalledTimes(2);
        for (const [ , payload ] of vi.mocked(server.post).mock.calls) {
            sent.push((payload as { content: string }).content);
        }
        expect(sent).toEqual([
            JSON.stringify({ view: { zoom: 1 } }),
            JSON.stringify({ view: { zoom: 2 } })
        ]);
    });

    /**
     * A queued write announces itself while a later one is still waiting to be sent, so what comes
     * back is what the view wrote a moment ago rather than what it now holds. Taken for an external
     * change, it would put the view back to that older config, and the next change made from there
     * would drop whatever the queued write carried.
     */
    it("passes over the echo of its own write that a later one has moved past", async () => {
        // Carrying an attachment already, which is what the echoes below are read from.
        const note = noteWithStoredConfig(JSON.stringify({ view: { zoom: 0 } }));
        const storage = new ViewModeStorage<Config>(note, "geoMap");
        let releaseFirst = () => {};
        vi.mocked(server.post).mockImplementationOnce(async () => {
            await new Promise<void>((resolve) => { releaseFirst = resolve; });
        });

        const first = storage.store({ view: { zoom: 1 } });
        const second = storage.store({ view: { zoom: 2 } });
        await new Promise((resolve) => setTimeout(resolve));

        // The first write has landed and announced itself; the second has not been sent yet.
        vi.mocked(server.get).mockResolvedValue({ content: JSON.stringify({ view: { zoom: 1 } }) });
        expect(await storage.restoreIfChanged()).toBeUndefined();

        releaseFirst();
        await Promise.all([ first, second ]);

        // ...and the second write echoes back as its own too.
        vi.mocked(server.get).mockResolvedValue({ content: JSON.stringify({ view: { zoom: 2 } }) });
        expect(await storage.restoreIfChanged()).toBeUndefined();

        // A change from anywhere else is still reported.
        vi.mocked(server.get).mockResolvedValue({ content: JSON.stringify({ view: { zoom: 9 } }) });
        expect(await storage.restoreIfChanged()).toEqual({ view: { zoom: 9 } });
    });

    /** One write failing is not a reason to drop the next: the config it carries is still wanted. */
    it("keeps writing after one is refused", async () => {
        const storage = new ViewModeStorage<Config>(noteWithStoredConfig(undefined), "geoMap");
        vi.mocked(server.post).mockRejectedValueOnce(new Error("offline"));

        await expect(storage.store({ view: { zoom: 1 } })).rejects.toThrow("offline");
        await storage.store({ view: { zoom: 2 } });

        expect(server.post).toHaveBeenCalledTimes(2);
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
