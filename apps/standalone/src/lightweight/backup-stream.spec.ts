import { getSql } from "@triliumnext/core";
import { describe, expect, it } from "vitest";

import {
    DatabaseChangedError,
    type LiveDatabaseReader,
    streamLiveDatabasePages
} from "./backup-stream.js";
import BrowserSqlProvider from "./sql_provider.js";

// The sqlite-wasm module can only be initialized once per worker (test_setup.ts already does it
// for core), so every provider here borrows that module rather than calling initWasm() again.
type WithSqlite3 = {
    sqlite3: { capi: { sqlite3_js_db_export(db: unknown): Uint8Array } };
};
type WithDb = { db: unknown };

function newProviderWithModule(): BrowserSqlProvider {
    const provider = new BrowserSqlProvider();
    (provider as unknown as WithSqlite3).sqlite3 =
        (getSql() as unknown as { dbConnection: unknown } as { dbConnection: WithSqlite3 })
            .dbConnection.sqlite3;
    return provider;
}

function rawConnection(provider: BrowserSqlProvider): unknown {
    return (provider as unknown as WithDb).db;
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        chunks.push(value);
    }

    const whole = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
        whole.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return whole;
}

describe("streamLiveDatabasePages against the real engine", () => {
    function readerFor(provider: BrowserSqlProvider): LiveDatabaseReader {
        return {
            getValue: (sql, params) => provider.prepare(sql).pluck().get(params ?? []),
            getColumn: (sql, params) => provider.prepare(sql).pluck().all(params ?? []) as unknown[]
        };
    }

    function populatedProvider(): BrowserSqlProvider {
        const provider = newProviderWithModule();
        provider.loadFromMemory();
        provider.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, payload BLOB)");
        // Enough rows to span several batches, and deletions so a freelist is streamed too.
        provider.exec("INSERT INTO t (payload) SELECT randomblob(1000) "
            + "FROM (WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c WHERE n < 500) "
            + "SELECT n FROM c)");
        provider.exec("DELETE FROM t WHERE id % 5 = 0");
        return provider;
    }

    it("streams the live database as its exact bytes, without taking the connection over", async () => {
        const provider = populatedProvider();
        const exported = (provider as unknown as WithSqlite3).sqlite3.capi
            .sqlite3_js_db_export(rawConnection(provider));

        const { byteSize, stream } = streamLiveDatabasePages(readerFor(provider));
        const streamed = await drain(stream);

        expect(byteSize).toBe(exported.byteLength);
        expect(streamed).toEqual(exported);
        // Not taken over: the connection answers as before, because it is the live one.
        expect(provider.prepare("SELECT count(*) FROM t").pluck().get([])).toBe(400);
        provider.close();
    });

    it("errors the stream when a write lands mid-stream, so a caller can start over", async () => {
        const provider = populatedProvider();
        const { stream } = streamLiveDatabasePages(readerFor(provider));
        const reader = stream.getReader();
        await reader.read();

        provider.exec("INSERT INTO t (payload) VALUES (randomblob(10))");

        await expect(reader.read()).rejects.toBeInstanceOf(DatabaseChangedError);
        provider.close();
    });

    it("refuses a reader that reports no usable page size", () => {
        const reader: LiveDatabaseReader = { getValue: () => 0 };
        expect(() => streamLiveDatabasePages(reader)).toThrow(/page_size/);
    });

    it("errors the stream when a page comes back the wrong size", async () => {
        const reader: LiveDatabaseReader = {
            getValue: (sql) =>
                sql.includes("page_size") ? 512 : sql.includes("page_count") ? 4 : 0,
            // A page short of what the page size says it must be, four times over.
            getColumn: () => Array.from({ length: 4 }, () => new Uint8Array(3))
        };
        await expect(drain(streamLiveDatabasePages(reader).stream)).rejects.toThrow(/malformed/);
    });

    it("errors the stream when the range comes back short of the pages it asked for", async () => {
        const reader: LiveDatabaseReader = {
            getValue: (sql) =>
                sql.includes("page_size") ? 512 : sql.includes("page_count") ? 4 : 0,
            getColumn: () => [ new Uint8Array(512) ]
        };
        await expect(drain(streamLiveDatabasePages(reader).stream)).rejects.toThrow(/got 1 of 4/);
    });
});

