import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FRAME_SIZE } from "./format.js";
import { readBackupContainer } from "./node-streams.js";
import type { ReadBackupContainerOptions } from "./read.js";
import {
    chunked,
    fakeDatabase,
    FAST_SCRYPT,
    MemorySink,
    reasonOf,
    readFromBuffer,
    type WriteOptions,
    writeToBuffer
} from "./test-helpers.js";

const PASSPHRASE = "correct horse battery staple";

/** Every format combination, since progress is measured on the plaintext side of all of them. */
const FORMATS: [string, WriteOptions][] = [
    [ "plain", {} ],
    [ "compressed", { compress: true } ],
    [ "encrypted", { passphrase: PASSPHRASE, scrypt: FAST_SCRYPT } ],
    [ "compressed and encrypted", { compress: true, passphrase: PASSPHRASE, scrypt: FAST_SCRYPT } ]
];

afterEach(() => {
    vi.restoreAllMocks();
});

describe("writing", () => {
    it("reports each chunk of the database, up to and including a final 1", async () => {
        const { reports, onProgress } = collector();
        const database = fakeDatabase(64 * 1024);

        await writeToBuffer(chunked(database, 4096), {
            plaintextSize: database.length,
            onProgress,
            progressIntervalMs: 0
        });

        // Sixteen equal chunks, then completion once the digest has been patched in.
        expect(reports).toEqual([ ...sixteenths(), 1 ]);
    });

    it.each(FORMATS)("measures the database going in, not the %s payload coming out", async (
        _label,
        options
    ) => {
        const { reports, onProgress } = collector();
        const database = fakeDatabase(64 * 1024);

        await writeToBuffer(chunked(database, 4096), {
            ...options,
            plaintextSize: database.length,
            onProgress,
            progressIntervalMs: 0
        });

        // A compressed payload is a fraction of the size, so measuring it would report a fraction
        // of the progress: the sequence has to be the same one whatever the payload is doing.
        expect(reports).toEqual([ ...sixteenths(), 1 ]);
    });

    it("reports completion alone when no size was given to measure against", async () => {
        const { reports, onProgress } = collector();

        await writeToBuffer(chunked(fakeDatabase(64 * 1024), 4096), {
            onProgress,
            progressIntervalMs: 0
        });

        expect(reports).toEqual([ 1 ]);
    });

    it("never reports past 1, even when the database outgrew the size it was measured at", async () => {
        const { reports, onProgress } = collector();
        const database = fakeDatabase(64 * 1024);

        await writeToBuffer(chunked(database, 4096), {
            plaintextSize: database.length / 2,
            onProgress,
            progressIntervalMs: 0
        });

        // Chunks eight to sixteen are all past the stated size, and then completion.
        expect(Math.max(...reports)).toBe(1);
        expect(reports.filter((progress) => progress === 1)).toHaveLength(10);
    });

    it("writes the backup anyway when the callback throws", async () => {
        const database = fakeDatabase(64 * 1024);
        let calls = 0;

        const written = await writeToBuffer(chunked(database, 4096), {
            compress: true,
            plaintextSize: database.length,
            progressIntervalMs: 0,
            onProgress: () => {
                calls++;
                throw new Error("the caller cannot cope with its own progress");
            }
        });

        expect(calls).toBe(17);
        const read = await readFromBuffer(written.bytes);
        expect(read.bytes.equals(database)).toBe(true);
    });
});

describe("reading", () => {
    it("reports each chunk of the database coming out, up to and including a final 1", async () => {
        const { reports, onProgress } = collector();
        const database = fakeDatabase(2 * FRAME_SIZE);
        const written = await writeToBuffer(database, { plaintextSize: database.length });

        await readFromBuffer(written.bytes, { onProgress, progressIntervalMs: 0 });

        // Not exact fractions: an unencrypted payload is emitted a trailer's length behind the
        // input, since that much is held back until the input ends and it can be told apart from
        // the payload. What has to hold is that it climbs and arrives.
        expect(reports.at(-1)).toBe(1);
        expect(reports).toEqual([ ...reports ].sort((left, right) => left - right));
        expect(reports[0]).toBeCloseTo(0.5, 3);
    });

    it.each(FORMATS)("measures the database coming out of a %s container", async (
        _label,
        options
    ) => {
        const { reports, onProgress } = collector();
        const database = fakeDatabase(2 * FRAME_SIZE);
        const written = await writeToBuffer(database, {
            ...options,
            plaintextSize: database.length
        });

        const read = await readFromBuffer(written.bytes, {
            passphrase: PASSPHRASE,
            onProgress,
            progressIntervalMs: 0
        });

        expect(read.result.bytesWritten).toBe(database.length);
        expectRisesToOne(reports);
    });

    it("reports completion alone when the container recorded no size", async () => {
        const { reports, onProgress } = collector();
        const written = await writeToBuffer(fakeDatabase(2 * FRAME_SIZE), { compress: true });

        await readFromBuffer(written.bytes, { onProgress, progressIntervalMs: 0 });

        expect(reports).toEqual([ 1 ]);
    });

    it.each([
        [
            "the passphrase is refused, which happens before a byte is unwrapped",
            { passphrase: "wrong" },
            "wrong-passphrase-or-damaged-header"
        ],
        [
            "the output would exceed the ceiling",
            { passphrase: PASSPHRASE, maxOutputBytes: 1_000 },
            "output-too-large"
        ]
    ])("reports nothing when %s", async (_label, options, reason) => {
        const { reports, onProgress } = collector();
        const database = fakeDatabase(2 * FRAME_SIZE);
        const written = await writeToBuffer(database, {
            passphrase: PASSPHRASE,
            scrypt: FAST_SCRYPT,
            plaintextSize: database.length
        });

        const failure = await reasonOf(readFromBuffer(written.bytes, {
            ...options as ReadBackupContainerOptions,
            onProgress,
            progressIntervalMs: 0
        }));

        expect(failure).toBe(reason);
        expect(reports).toEqual([]);
    });

    it("reports nothing for output that is not a database, which is checked first", async () => {
        const { reports, onProgress } = collector();
        const payload = Buffer.from("this is not a database, it is a note");
        const written = await writeToBuffer(payload, { plaintextSize: payload.length });

        const failure = await reasonOf(
            readFromBuffer(written.bytes, { onProgress, progressIntervalMs: 0 })
        );

        expect(failure).toBe("not-a-database");
        expect(reports).toEqual([]);
    });

    it("does not report completion when the unwrapped database is the wrong size", async () => {
        const { reports, onProgress } = collector();
        const database = fakeDatabase(2 * FRAME_SIZE);
        const written = await writeToBuffer(database, { plaintextSize: database.length });

        // Claim a third more than the container actually holds, which is only caught at the end,
        // where the header's figure meets the one the trailer counted.
        const lying = Buffer.from(written.bytes);
        lying.writeBigUInt64LE(BigInt(3 * FRAME_SIZE), 32);

        const failure = await reasonOf(
            readFromBuffer(lying, { onProgress, progressIntervalMs: 0 })
        );

        expect(failure).toBe("size-mismatch");
        // Climbs towards the size it was told and stops where the payload really ended, which is
        // the point: completion is never reported for a database that did not measure up.
        expect(reports[0]).toBeCloseTo(1 / 3, 3);
        expect(reports.at(-1)).toBeCloseTo(2 / 3, 3);
        expect(reports).not.toContain(1);
    });

    it("stops reporting when the destination fails, without reporting completion after it", async () => {
        const { reports, onProgress } = collector();
        const database = fakeDatabase(2 * FRAME_SIZE);
        const written = await writeToBuffer(database, { plaintextSize: database.length });

        const failing = new MemorySink();
        failing._write = (_chunk, _encoding, callback) => callback(new Error("ENOSPC"));

        await expect(readBackupContainer(
            Readable.from([ written.bytes ]),
            failing,
            { onProgress, progressIntervalMs: 0 }
        )).rejects.toThrow(/ENOSPC/);

        // A report of 1 can be the last chunk on its way to a destination that then refuses it, so
        // what a failure rules out is a report *after* the last one the payload accounts for.
        expect(reports.length).toBeLessThanOrEqual(2);
        expect(reports.every((progress) => progress <= 1)).toBe(true);
    });
});

describe("throttling", () => {
    it("reports at most once per interval, whatever the clock does in between", async () => {
        const reports: { progress: number; at: number }[] = [];
        const database = fakeDatabase(64 * 1024);
        const clock = mockedClock();

        // A hundred milliseconds per chunk against the default interval of 250, so most chunks go
        // unreported. The exact chunks that do report depend on how far the stream buffers ahead,
        // so what is asserted is the throttle contract, not one buffering pattern.
        await writeToBuffer(ticking(chunked(database, 4096), clock, 100), {
            plaintextSize: database.length,
            onProgress: (progress) => reports.push({ progress, at: clock.now })
        });

        expect(reports.length).toBeLessThan(17);
        expect(reports.at(-1)?.progress).toBe(1);

        const throttled = reports.slice(0, -1);
        expect(throttled.length).toBeGreaterThan(2);
        for (let index = 1; index < throttled.length; index++) {
            expect(throttled[index].at - throttled[index - 1].at).toBeGreaterThanOrEqual(250);
        }
    });

    it("reports the first chunk and the last, however little time passes", async () => {
        const { reports, onProgress } = collector();
        const database = fakeDatabase(64 * 1024);
        const clock = mockedClock();

        // A clock that never moves: everything between the leading report and completion is held
        // back, and neither of those two is.
        await writeToBuffer(ticking(chunked(database, 4096), clock, 0), {
            plaintextSize: database.length,
            onProgress,
            progressIntervalMs: 250
        });

        expect(reports).toEqual([ 1 / 16, 1 ]);
    });
});

function collector(): { reports: number[]; onProgress: (progress: number) => void } {
    const reports: number[] = [];

    return { reports, onProgress: (progress) => reports.push(progress) };
}

/** The sequence a sixteen chunk database produces, which most of these tests write. */
function sixteenths(): number[] {
    return Array.from({ length: 16 }, (_value, index) => (index + 1) / 16);
}

function expectRisesToOne(reports: number[]): void {
    expect(reports.length).toBeGreaterThan(2);
    expect(reports.at(-1)).toBe(1);
    expect(reports.every((progress) => progress > 0 && progress <= 1)).toBe(true);
    expect([ ...reports ].sort((first, second) => first - second)).toEqual(reports);
}

/** A clock the test moves itself, so a throttle can be observed without waiting on a real one. */
function mockedClock(): { now: number } {
    const clock = { now: 1_000 };
    vi.spyOn(Date, "now").mockImplementation(() => clock.now);

    return clock;
}

/** Advances `clock` by `step` before each chunk, so the throttle sees time pass between them. */
function ticking(source: Readable, clock: { now: number }, step: number): Readable {
    return Readable.from((async function* () {
        for await (const chunk of source) {
            clock.now += step;
            yield chunk as Buffer;
        }
    })());
}
