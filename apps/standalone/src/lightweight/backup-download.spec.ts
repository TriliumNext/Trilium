import { readBackupContainer } from "@triliumnext/backup-container";
import { streamedContainerSize } from "@triliumnext/backup-container/web";
import { Readable, Writable } from "stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type DownloadPort, streamDatabaseDownload } from "./backup-download.js";
import type { LiveDatabaseReader } from "./backup-stream.js";

const PAGE_SIZE = 512;
const PAGE_COUNT = 300;

/** Cheap scrypt cost, so the suite is not dominated by key derivation. */
const FAST_SCRYPT = { log2N: 10, r: 8, p: 1 };

/** A reader serving `PAGE_COUNT` constant-filled pages, with steady write counters. */
function fakeReader(): LiveDatabaseReader {
    return {
        getValue(sql: string, params?: unknown[]) {
            if (sql.includes("sqlite_dbpage")) {
                return new Uint8Array(PAGE_SIZE).fill((params?.[0] as number) & 0xff);
            }
            if (sql.includes("page_size")) {
                return PAGE_SIZE;
            }
            if (sql.includes("page_count")) {
                return PAGE_COUNT;
            }
            return 7;
        }
    };
}

/** The bytes the fake reader's database consists of, for comparing an unwrapped download against. */
function fakeDatabaseBytes(): Uint8Array {
    const bytes = new Uint8Array(PAGE_SIZE * PAGE_COUNT);
    for (let page = 1; page <= PAGE_COUNT; page++) {
        bytes.fill(page & 0xff, (page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    }
    return bytes;
}

/** A port whose far end is the test: what was sent piles up, and the test delivers the replies. */
function fakePort() {
    const sent: { type?: string; byteSize?: number; data?: ArrayBuffer; message?: string }[] = [];
    const port = {
        sent,
        closed: false,
        // Faithful to a real port where it matters most: a transferred buffer is DETACHED on the
        // sending side, so a producer still holding a view into it breaks here as in production.
        postMessage: (message: unknown, transfer?: Transferable[]) => {
            sent.push(structuredClone(message, transfer ? { transfer } : undefined) as (typeof sent)[number]);
        },
        onmessage: null as DownloadPort["onmessage"],
        close: () => {
            port.closed = true;
        },
        deliver(message: unknown) {
            port.onmessage?.({ data: message });
        },
        chunks(): ArrayBuffer[] {
            return sent.filter((message) => message.type === "chunk")
                .map((message) => message.data as ArrayBuffer);
        }
    };
    return port;
}

/**
 * Everything the port carried, read back through the Node entry point: a container the browser
 * wrote and the other runtime can open is the whole point of sharing the format.
 */
async function unwrap(port: ReturnType<typeof fakePort>, passphrase?: string): Promise<Uint8Array> {
    const container = Buffer.concat(port.chunks().map((chunk) => Buffer.from(chunk)));
    const unwrapped: Buffer[] = [];
    const sink = new Writable({
        write(chunk: Buffer, _encoding, callback) {
            unwrapped.push(chunk);
            callback();
        }
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a Node stream over the bytes.
    await readBackupContainer(Readable.from([ container ]) as any, sink, {
        passphrase,
        requireSqliteHeader: false
    });

    return new Uint8Array(Buffer.concat(unwrapped));
}

describe("streamDatabaseDownload", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("wraps an unpassworded download in a container too, and reads back as the database", async () => {
        const port = fakePort();
        const running = streamDatabaseDownload(fakeReader(), port);

        for (let i = 0; i < 10; i++) {
            port.deliver({ type: "pull" });
        }
        const outcome = await running;

        expect(outcome).toEqual({ status: "done" });
        // One format whether or not a password was given, so one extension and one restore path.
        expect(port.sent[0])
            .toEqual({ type: "begin", byteSize: streamedContainerSize(PAGE_SIZE * PAGE_COUNT, false) });
        expect(port.chunks().reduce((total, chunk) => total + chunk.byteLength, 0))
            .toBe(port.sent[0].byteSize);
        expect(port.sent.at(-1)).toEqual({ type: "end" });
        expect(port.closed).toBe(true);
        expect(port.onmessage).toBeNull();

        expect(await unwrap(port)).toEqual(fakeDatabaseBytes());
    });

    it("wraps the stream in an encrypted container, sized exactly as its begin announces", async () => {
        const port = fakePort();
        const running = streamDatabaseDownload(fakeReader(), port, {
            passphrase: "123456",
            scrypt: FAST_SCRYPT
        });

        for (let i = 0; i < 10; i++) {
            port.deliver({ type: "pull" });
        }
        const outcome = await running;

        expect(outcome).toEqual({ status: "done" });
        // The announced size is what the download's Content-Length becomes, so it must be exact.
        const announced = port.sent[0].byteSize;
        expect(announced).toBe(streamedContainerSize(PAGE_SIZE * PAGE_COUNT, true));
        const streamed = port.chunks().reduce((total, chunk) => total + chunk.byteLength, 0);
        expect(streamed).toBe(announced);

        // What went down the wire reads back as the database, through the other runtime's reader.
        expect(await unwrap(port, "123456")).toEqual(fakeDatabaseBytes());
    });

    it("stops quietly when the download is cancelled", async () => {
        const port = fakePort();
        const running = streamDatabaseDownload(fakeReader(), port);

        port.deliver({ type: "pull" });
        port.deliver({ type: "cancel" });
        const outcome = await running;

        expect(outcome).toEqual({ status: "cancelled" });
        expect(port.chunks()).toHaveLength(1);
        expect(port.sent.some((message) => message.type === "end")).toBe(false);
        expect(port.closed).toBe(true);
    });

    it("abandons a stream nothing asks after, which is what a reclaimed service worker leaves", async () => {
        vi.useFakeTimers();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const port = fakePort();
        const running = streamDatabaseDownload(fakeReader(), port);

        // One chunk flows, then the far end goes silent forever.
        port.deliver({ type: "pull" });
        await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
        const outcome = await running;

        expect(outcome).toMatchObject({ status: "failed" });
        expect(port.sent.some((message) => message.type === "end")).toBe(false);
        expect(port.closed).toBe(true);
        expect(warn.mock.calls.join("\n")).toMatch(/abandoning/);
    });

    it("reports a database that cannot even be sized, before any begin", async () => {
        const port = fakePort();
        const outcome = await streamDatabaseDownload({ getValue: () => 0 }, port);

        expect(outcome).toMatchObject({ status: "failed" });
        expect(port.sent).toHaveLength(1);
        expect(port.sent[0].type).toBe("error");
        expect(port.sent[0].message).toMatch(/page_size/);
        expect(port.closed).toBe(true);
    });

    it("reports a failure mid-stream through the port rather than throwing", async () => {
        const reader = fakeReader();
        const broken: LiveDatabaseReader = {
            getValue: (sql, params) =>
                sql.includes("sqlite_dbpage") ? new Uint8Array(3) : reader.getValue(sql, params)
        };
        const port = fakePort();
        const running = streamDatabaseDownload(broken, port);

        port.deliver({ type: "pull" });
        const outcome = await running;

        expect(outcome).toMatchObject({ status: "failed", message: expect.stringMatching(/malformed/) });
        expect(port.sent[0].type).toBe("begin");
        expect(port.sent.at(-1)?.type).toBe("error");
        expect(port.closed).toBe(true);
    });
});
