import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCreationDate, loadCreationDates } from "./note_dates";
import server from "./server";

/** Names notes uniquely per test: the cache is module-level and is never emptied. */
let counter = 0;

function noteIds(count: number) {
    return Array.from({ length: count }, () => `note${counter++}`);
}

function respondWith(dates: Record<string, string>) {
    return vi.spyOn(server, "post").mockImplementation(async (_url, data) => {
        const requested = (data as { noteIds: string[] }).noteIds;
        return Object.fromEntries(requested
            .filter((noteId) => dates[noteId])
            .map((noteId) => [ noteId, { utcDateCreated: dates[noteId] } ]));
    });
}

describe("loadCreationDates", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("loads dates and exposes them as milliseconds", async () => {
        const [ first, second ] = noteIds(2);
        respondWith({
            [first]: "2026-01-05 09:30:00.000Z",
            [second]: "2026-02-05 09:30:00.000Z"
        });

        expect(await loadCreationDates([ first, second ])).toBe(true);
        expect(getCreationDate(first)).toBe(Date.parse("2026-01-05 09:30:00.000Z"));
        expect(getCreationDate(second)).toBe(Date.parse("2026-02-05 09:30:00.000Z"));
    });

    it("asks only about the notes it does not know yet", async () => {
        const [ known, fresh ] = noteIds(2);
        const post = respondWith({
            [known]: "2026-01-05 09:30:00.000Z",
            [fresh]: "2026-01-06 09:30:00.000Z"
        });
        await loadCreationDates([ known ]);

        post.mockClear();
        expect(await loadCreationDates([ known, fresh ])).toBe(true);
        expect(post.mock.calls[0][1]).toEqual({ noteIds: [ fresh ] });

        post.mockClear();
        expect(await loadCreationDates([ known, fresh ])).toBe(false);
        expect(server.post).not.toHaveBeenCalled();
    });

    it("sends one request for two callers asking at the same time", async () => {
        const [ shared ] = noteIds(1);
        respondWith({ [shared]: "2026-01-05 09:30:00.000Z" });

        await Promise.all([ loadCreationDates([ shared ]), loadCreationDates([ shared ]) ]);

        expect(server.post).toHaveBeenCalledTimes(1);
    });

    it("does not ask again about a note the server does not know", async () => {
        const [ missing ] = noteIds(1);
        respondWith({});

        await loadCreationDates([ missing ]);
        expect(getCreationDate(missing)).toBeUndefined();

        expect(await loadCreationDates([ missing ])).toBe(false);
        expect(server.post).toHaveBeenCalledTimes(1);
    });

    it("splits a large set into batches", async () => {
        const many = noteIds(2500);
        respondWith({});

        await loadCreationDates(many);

        expect(server.post).toHaveBeenCalledTimes(3);
        const sizes = vi.mocked(server.post).mock.calls
            .map(([ , data ]) => (data as { noteIds: string[] }).noteIds.length);
        expect(sizes).toEqual([ 1000, 1000, 500 ]);
    });
});
