import { afterEach, describe, expect, it, vi } from "vitest";

import BridgedSqlProvider, { probeDesktopSqlBridge } from "./bridged_sql_provider.js";

interface RecordedRequest {
    url: string;
    body: any;
}

/** Installs a fake synchronous XMLHttpRequest that answers from `respond`. */
function installXhr(respond: (body: any) => { status: number; response: unknown }) {
    const requests: RecordedRequest[] = [];

    class FakeXhr {
        status = 0;
        responseText = "";
        private url = "";

        open(_method: string, url: string, async: boolean) {
            expect(async).toBe(false);
            this.url = url;
        }

        setRequestHeader() {}

        send(payload: string) {
            const body = JSON.parse(payload);
            requests.push({ url: this.url, body });
            const { status, response } = respond(body);
            this.status = status;
            this.responseText = JSON.stringify(response);
        }
    }

    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    return requests;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("probeDesktopSqlBridge", () => {
    it("detects the bridge, and rejects error statuses, HTML fallbacks and network failures", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch");

        fetchSpy.mockResolvedValueOnce(Response.json({ desktopSqlBridge: true }));
        expect(await probeDesktopSqlBridge()).toBe(true);

        fetchSpy.mockResolvedValueOnce(new Response("nope", { status: 404 }));
        expect(await probeDesktopSqlBridge()).toBe(false);

        fetchSpy.mockResolvedValueOnce(new Response("<!DOCTYPE html><html></html>"));
        expect(await probeDesktopSqlBridge()).toBe(false);

        fetchSpy.mockRejectedValueOnce(new TypeError("network error"));
        expect(await probeDesktopSqlBridge()).toBe(false);
    });
});

describe("BridgedStatement", () => {
    it("sends run/get/all ops with normalized parameters and decodes results", () => {
        const requests = installXhr((body) => {
            switch (body.op) {
                case "run":
                    return { status: 200, response: { changes: 2, lastInsertRowid: 42 } };
                case "get":
                    return { status: 200, response: { row: { noteId: "abc", isProtected: 0 } } };
                case "all":
                    return { status: 200, response: { rows: [["a", 1], ["b", 2]] } };
                default:
                    return { status: 500, response: { error: `unexpected op ${body.op}` } };
            }
        });

        const provider = new BridgedSqlProvider();

        // run() with positional params, booleans normalized to 0/1.
        const result = provider.prepare("UPDATE notes SET isDeleted = ? WHERE noteId = ?").run(true, "abc");
        expect(result).toEqual({ changes: 2, lastInsertRowid: 42 });
        expect(requests[0].body).toMatchObject({
            op: "run",
            sql: "UPDATE notes SET isDeleted = ? WHERE noteId = ?",
            params: [1, "abc"]
        });

        // get() with a named-parameter object.
        const row = provider.prepare("SELECT * FROM notes WHERE noteId = :noteId").get({ noteId: "abc" });
        expect(row).toEqual({ noteId: "abc", isProtected: 0 });
        expect(requests[1].body.params).toEqual({ named: { noteId: "abc" } });

        // all() in raw mode propagates the flag and returns array rows.
        const rows = provider.prepare("SELECT noteId, x FROM notes").raw().all();
        expect(rows).toEqual([["a", 1], ["b", 2]]);
        expect(requests[2].body).toMatchObject({ op: "all", raw: true, pluck: false });
    });

    it("round-trips blobs as base64 markers in both directions", () => {
        const payload = new Uint8Array([0, 1, 2, 250, 251, 252]);
        const requests = installXhr((body) => {
            if (body.op === "run") {
                return { status: 200, response: { changes: 1, lastInsertRowid: 1 } };
            }
            // Echo the blob that was sent in.
            return { status: 200, response: { row: { content: requests[0].body.params[0] } } };
        });

        const provider = new BridgedSqlProvider();
        provider.prepare("UPDATE blobs SET content = ?").run(payload);

        const marker = requests[0].body.params[0];
        expect(typeof marker.__trilium_blob__).toBe("string");

        const row = provider.prepare("SELECT content FROM blobs").get(undefined) as { content: Uint8Array };
        expect([...row.content]).toEqual([...payload]);
    });

    it("throws the shell-reported error message on failures", () => {
        installXhr(() => ({ status: 500, response: { error: "no such table: nonsense" } }));
        const provider = new BridgedSqlProvider();
        expect(() => provider.prepare("SELECT * FROM nonsense").all()).toThrow("no such table: nonsense");
    });
});

describe("BridgedSqlProvider transactions", () => {
    it("wraps the callback in BEGIN DEFERRED/COMMIT and rolls back on error", () => {
        const executed: string[] = [];
        const requests = installXhr((body) => {
            if (body.op === "status") {
                return { status: 200, response: { inTransaction: false } };
            }
            executed.push(body.sql);
            if (body.op === "run") {
                return { status: 200, response: { changes: 1, lastInsertRowid: 1 } };
            }
            return { status: 200, response: {} };
        });

        const provider = new BridgedSqlProvider();

        const value = (provider.transaction(() => {
            provider.prepare("INSERT INTO t VALUES (1)").run();
            return "done";
        }) as any).deferred();
        expect(value).toBe("done");
        expect(executed).toEqual(["BEGIN DEFERRED", "INSERT INTO t VALUES (1)", "COMMIT"]);
        expect(provider.inTransaction).toBe(false);

        executed.length = 0;
        expect(() =>
            (provider.transaction(() => {
                throw new Error("boom");
            }) as any).deferred()
        ).toThrow("boom");
        expect(executed).toEqual(["BEGIN DEFERRED", "ROLLBACK"]);
        expect(provider.inTransaction).toBe(false);
        expect(requests.length).toBeGreaterThan(0);
    });

    it("nests via SAVEPOINT when the shell reports an open transaction", () => {
        const executed: string[] = [];
        installXhr((body) => {
            if (body.op === "status") {
                return { status: 200, response: { inTransaction: true } };
            }
            executed.push(body.sql);
            return { status: 200, response: {} };
        });

        const provider = new BridgedSqlProvider();
        (provider.transaction(() => "nested") as any).deferred();

        expect(executed).toHaveLength(2);
        expect(executed[0]).toMatch(/^SAVEPOINT sp_/);
        expect(executed[1]).toMatch(/^RELEASE SAVEPOINT sp_/);
    });
});
