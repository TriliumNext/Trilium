import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AcpClient } from "./acp_client.js";
import type { AcpPoolConnection } from "./acp_client_pool.js";

const infoLogMock = vi.hoisted(() => vi.fn());
vi.mock("@triliumnext/core", () => ({
    getLog: () => ({ info: infoLogMock })
}));

const { AcpClientPool, IDLE_TIMEOUT_MS } = await import("./acp_client_pool.js");

describe("AcpClientPool", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        infoLogMock.mockClear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("keeps a newer process pooled when an older one reports its exit late", async () => {
        const pool = new AcpClientPool("Test");
        const { connect, connections, clients } = fakeConnector();

        const first = await pool.acquire(connect);
        pool.release();
        pool.dispose();
        const second = await pool.acquire(connect);
        expect(second.generation).toBe(first.generation + 1);

        connections[0].onExit(new Error("killed"));

        expect(pool.warm).toBe(true);
        expect(clients[1].dispose).not.toHaveBeenCalled();
        expect(infoLogMock).toHaveBeenCalledWith(expect.stringContaining("#1 ended (killed)"));
    });

    it("skips the idle reap when the process already exited on its own", async () => {
        const pool = new AcpClientPool("Test");
        const { connect, connections, clients } = fakeConnector();

        await pool.acquire(connect);
        pool.release();
        connections[0].onExit(new Error("crashed"));
        vi.advanceTimersByTime(IDLE_TIMEOUT_MS);

        expect(pool.warm).toBe(false);
        expect(clients[0].dispose).not.toHaveBeenCalled();
        expect(infoLogMock).not.toHaveBeenCalledWith(expect.stringContaining("reaping"));
    });
});

/** A `connect` callback that records each connection and hands out a live stub client. */
function fakeConnector() {
    const connections: AcpPoolConnection[] = [];
    const clients: { alive: boolean; dispose: ReturnType<typeof vi.fn> }[] = [];
    const connect = async (connection: AcpPoolConnection) => {
        connections.push(connection);
        const client = { alive: true, dispose: vi.fn() };
        clients.push(client);
        return client as unknown as AcpClient;
    };
    return { connect, connections, clients };
}
