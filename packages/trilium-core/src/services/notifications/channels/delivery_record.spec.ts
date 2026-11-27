import { describe, expect, it } from "vitest";

import {
    createEmptyState,
    DeliveryRecord,
    endChannel,
    getEntry,
    getHighestRecordSequence,
    MemoryRecordPort,
    parseState,
    RECORD_CHANNEL_LIMIT,
    seeSequence,
    serializeState,
    takeRevocation,
    takeSwitching
} from "./delivery_record.js";

const switching = (channelId: string, activationId: string | null, sequence: number) =>
    ({ channelId, activationId, sequence, isRevoked: false });

/** A port whose writes and reads can be made to fail. */
class FailingPort extends MemoryRecordPort {

    isWriteFailing = false;
    isReadFailing = false;
    writes = 0;

    override async read() {
        if (this.isReadFailing) {
            throw new Error("unreadable");
        }
        return super.read();
    }

    override async write(text: string) {
        this.writes++;
        if (this.isWriteFailing) {
            throw new Error("disk full");
        }
        return super.write(text);
    }

}

describe("the rules of the delivery record", () => {
    it("takes a switching numbered above its entry, or above the floor for a new channel", () => {
        const state = createEmptyState();
        state.floor = 4;
        expect(takeSwitching(state, switching("c1", "a1", 4))).toBe(true);
        expect(state.channels.has("c1")).toBe(false);

        takeSwitching(state, switching("c1", "a1", 5));
        expect(state.channels.get("c1")).toEqual({ activationId: "a1", isLive: true, sequence: 5 });

        // A replay, or an enabling numbered by a device that had not seen the last switching.
        takeSwitching(state, switching("c1", "a0", 5));
        expect(state.channels.get("c1")?.activationId).toBe("a1");

        // A disabling keeps the last activation, not live.
        takeSwitching(state, switching("c1", null, 6));
        expect(state.channels.get("c1"))
            .toEqual({ activationId: "a1", isLive: false, sequence: 6 });
        takeSwitching(state, { ...switching("c1", "a2", 7), isRevoked: true });
        expect(state.channels.get("c1"))
            .toEqual({ activationId: "a2", isLive: false, sequence: 7 });
    });

    it("raises the sequence of a row that loses, and ends a revoked or gone channel", () => {
        const state = createEmptyState();
        takeSwitching(state, switching("c1", "a1", 2));
        seeSequence(state, "c1", 9);
        seeSequence(state, "c2", 9);
        expect(state.channels.get("c1")?.sequence).toBe(9);
        expect(state.channels.has("c2")).toBe(false);
        expect(getHighestRecordSequence(state)).toBe(9);

        takeRevocation(state, "other");
        expect(state.channels.get("c1")?.isLive).toBe(true);
        takeRevocation(state, "a1");
        expect(state.channels.get("c1")?.isLive).toBe(false);

        takeSwitching(state, switching("c3", "a3", 1));
        endChannel(state, "c3");
        expect(state.channels.get("c3"))
            .toEqual({ activationId: "a3", isLive: false, sequence: 1 });
    });

    it("lets the stopped entry with the lowest sequence give way, and raises the floor", () => {
        const state = createEmptyState();
        for (let index = 0; index < RECORD_CHANNEL_LIMIT; index++) {
            takeSwitching(state, switching(`c${index}`, `a${index}`, index + 10));
        }
        expect(takeSwitching(state, switching("new", "aNew", 5000))).toBe(false);

        takeSwitching(state, switching("c7", null, 6000));
        takeSwitching(state, switching("c3", null, 6001));
        expect(takeSwitching(state, switching("new", "aNew", 6002))).toBe(true);
        expect(state.channels.has("c7")).toBe(false);
        expect(state.floor).toBe(6000);
        // An old activation of the channel that gave way stays below the floor.
        expect(takeSwitching(state, switching("c7", "a7", 6000))).toBe(true);
        expect(state.channels.has("c7")).toBe(false);
    });

    it("writes and reads every field, and refuses text that is not a record", () => {
        const state = createEmptyState();
        state.mark = 41;
        state.floor = 3;
        state.pause = { causes: [ "restore", "rollback" ], sinceMs: 1000 };
        state.confirmedCursor = { cursor: 77, untilMs: 2000 };
        takeSwitching(state, switching("__proto__", "a1", 5));
        const entry = getEntry(state, "key1", 500);
        entry.publicAtMs = 600;
        entry.endedAtMs = 700;
        entry.endedAs = "sent";
        entry.grants.push({ profileId: "p1", claimId: "c1", atMs: 650, isPublic: true });

        const read = parseState(serializeState(state));
        expect(read).toEqual(state);
        expect(read.channels.get("__proto__")?.activationId).toBe("a1");
        const negative = serializeState(state).replace("\"mark\":41", "\"mark\":-1");
        for (const text of [ "{", "[]", "{\"v\":2}", negative ]) {
            expect(() => parseState(text), text).toThrow();
        }
    });
});

describe("the queue of the delivery record", () => {
    it("reads a missing record as an empty one and writes the mark of every step", async () => {
        const port = new FailingPort();
        let mark = 12;
        const record = new DeliveryRecord(port, () => mark);
        expect(await record.load()).toBe(true);
        expect(record.wasMissing()).toBe(true);

        mark = 15;
        expect((await record.run(() => "done")).value).toBe("done");
        expect(parseState(port.text ?? "").mark).toBe(15);
    });

    it("keeps a switching whose write failed pending until any write carries it", async () => {
        const port = new FailingPort();
        const record = new DeliveryRecord(port, () => 0);
        await record.load();

        port.isWriteFailing = true;
        const failed = await record.run(() => undefined, [ switching("c1", "a1", 1) ]);
        expect(failed.isWritten).toBe(false);
        expect(record.isPending("c1")).toBe(true);
        // A pending enabling runs nothing yet, and a pending disabling stops a channel at once.
        expect(record.isLive("c1", "a1")).toBe(false);

        port.isWriteFailing = false;
        await record.run((draft) => getEntry(draft, "other-delivery", 1));
        expect(record.isPending("c1")).toBe(false);
        expect(record.isLive("c1", "a1")).toBe(true);
        expect(parseState(port.text ?? "").channels.get("c1")?.isLive).toBe(true);

        port.isWriteFailing = true;
        await record.run(() => undefined, [ switching("c1", null, 2) ]);
        expect(record.isLive("c1", "a1")).toBe(false);
    });

    it("writes nothing while unreadable, and reads the file after a failed write", async () => {
        const port = new FailingPort();
        const record = new DeliveryRecord(port, () => 0);
        port.isReadFailing = true;
        expect(await record.load()).toBe(false);
        expect(record.getState()).toBeNull();
        expect((await record.run(() => 1)).isWritten).toBe(false);
        expect(port.writes).toBe(0);

        port.isReadFailing = false;
        await record.run((draft) => getEntry(draft, "k1", 1));
        port.isWriteFailing = true;
        await record.run((draft) => getEntry(draft, "k2", 1));
        // Another process wrote the file meanwhile: the queue holds what the file holds.
        port.text = serializeState(createEmptyState());
        port.isWriteFailing = false;
        await record.run(() => undefined);
        expect([ ...record.getState()?.entries.keys() ?? [] ]).toEqual([]);
    });

    it("runs its steps one at a time, in order", async () => {
        const record = new DeliveryRecord(new MemoryRecordPort(), () => 0);
        const order: string[] = [];
        await Promise.all([
            record.run((draft) => {
                order.push("first");
                getEntry(draft, "k", 1).grants.push(
                    { profileId: "p", claimId: "c1", atMs: 1, isPublic: false });
            }),
            record.run((draft) => {
                order.push("second");
                return draft.entries.get("k")?.grants.length;
            })
        ]).then(([ , second ]) => expect(second.value).toBe(1));
        expect(order).toEqual([ "first", "second" ]);
    });
});

describe("the mark of the delivery record", () => {
    it("keeps the mark it holds while no database is open", async () => {
        const port = new MemoryRecordPort();
        let isOpen = true;
        const record = new DeliveryRecord(port, () => {
            if (!isOpen) {
                throw new Error("no database");
            }
            return 30;
        });
        await record.run(() => undefined);
        isOpen = false;
        expect((await record.run((draft) => {
            draft.pause = { causes: [ "restore" ], sinceMs: 1 };
        })).isWritten).toBe(true);
        expect(parseState(port.text ?? ""))
            .toMatchObject({ mark: 30, pause: { causes: [ "restore" ] } });
    });
});
