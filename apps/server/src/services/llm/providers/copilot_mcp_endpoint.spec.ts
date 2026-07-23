import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { EventEmitter } from "events";
import http from "http";
import net from "net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const infoLogMock = vi.hoisted(() => vi.fn());
const errorLogMock = vi.hoisted(() => vi.fn());
vi.mock("@triliumnext/core", () => ({
    getLog: () => ({ info: infoLogMock, error: errorLogMock })
}));

// The real factory registers every LLM tool and drags in becca/the DB. Hand back
// a bare SDK server instead, so the transport still talks to a genuine MCP peer.
const createMcpServerMock = vi.hoisted(() => vi.fn());
vi.mock("../../mcp/mcp_server.js", () => ({ createMcpServer: createMcpServerMock }));

const { getCopilotMcpEndpointUrl, resetCopilotMcpEndpointForTests } =
    await import("./copilot_mcp_endpoint.js");

/** Loopback address, ephemeral port, 128-bit secret path. */
const ENDPOINT_URL = /^http:\/\/127\.0\.0\.1:\d+\/mcp-[0-9a-f]{32}$/;

/** What the Streamable HTTP transport insists on for a POST. */
const MCP_HEADERS = {
    "content-type": "application/json",
    "accept": "application/json, text/event-stream"
};

/** A stand-in for http.createServer whose listen() fails, as a taken port would. */
class UnstartableServer extends EventEmitter {
    listen() {
        setImmediate(() => this.emit("error", new Error("listen EADDRINUSE")));
        return this;
    }
}

interface HttpOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: Buffer | string;
}

interface HttpResult {
    status: number;
    body: string;
}

/** A one-off, non-keep-alive request so that `server.close()` never waits on us. */
function request(url: string, opts: HttpOptions = {}): Promise<HttpResult> {
    return new Promise<HttpResult>((resolve, reject) => {
        const req = http.request(url, {
            method: opts.method ?? "GET",
            headers: { connection: "close", ...opts.headers },
            agent: false
        }, res => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => resolve({
                status: res.statusCode ?? 0,
                body: Buffer.concat(chunks).toString()
            }));
        });
        req.on("error", reject);
        if (opts.body !== undefined) {
            req.write(opts.body);
        }
        req.end();
    });
}

/** HTTP/1.0 needs no Host header — the only way to reach the endpoint without one. */
function rawGetWithoutHost(url: string): Promise<string> {
    const { port, pathname } = new URL(url);
    return new Promise<string>((resolve, reject) => {
        const socket = net.connect(Number(port), "127.0.0.1", () => {
            socket.write(`GET ${pathname} HTTP/1.0\r\n\r\n`);
        });
        let response = "";
        socket.setEncoding("utf8");
        socket.on("data", chunk => (response += chunk));
        socket.on("end", () => resolve(response));
        socket.on("error", reject);
    });
}

describe("copilot MCP endpoint", () => {
    let mcpServers: McpServer[];

    beforeEach(() => {
        mcpServers = [];
        createMcpServerMock.mockReset();
        createMcpServerMock.mockImplementation(() => {
            const server = new McpServer({ name: "trilium-notes-spec", version: "1.2.3" });
            vi.spyOn(server, "close");
            mcpServers.push(server);
            return server;
        });
    });

    afterEach(async () => {
        await resetCopilotMcpEndpointForTests();
        vi.restoreAllMocks();
    });

    it("starts one loopback listener behind an unguessable path and memoizes it", async () => {
        const createServerSpy = vi.spyOn(http, "createServer");

        const url = await getCopilotMcpEndpointUrl();
        expect(url).toMatch(ENDPOINT_URL);

        await expect(getCopilotMcpEndpointUrl()).resolves.toBe(url);
        expect(createServerSpy).toHaveBeenCalledTimes(1);
        expect(infoLogMock).toHaveBeenCalledTimes(1);
    });

    it("logs a post-startup server error instead of taking the process down", async () => {
        const createServerSpy = vi.spyOn(http, "createServer");
        await getCopilotMcpEndpointUrl();

        // An "error" event with no listener is re-thrown by EventEmitter, which
        // would crash the server — the startup listener must have been replaced.
        const server = createServerSpy.mock.results[0]?.value;
        expect(() => server?.emit("error", new Error("late boom"))).not.toThrow();
        expect(errorLogMock).toHaveBeenCalledWith(expect.stringContaining("late boom"));
    });

    it("does not cache a failed start, so a later call retries", async () => {
        const failing = new UnstartableServer() as unknown as http.Server;
        vi.spyOn(http, "createServer").mockReturnValueOnce(failing);

        await expect(getCopilotMcpEndpointUrl()).rejects.toThrow(/EADDRINUSE/);
        await expect(getCopilotMcpEndpointUrl()).resolves.toMatch(ENDPOINT_URL);
    });

    it("survives a reset issued while a start is still in flight", async () => {
        const failing = new UnstartableServer() as unknown as http.Server;
        vi.spyOn(http, "createServer").mockReturnValueOnce(failing);

        const pending = getCopilotMcpEndpointUrl();
        const reset = resetCopilotMcpEndpointForTests();

        await expect(pending).rejects.toThrow(/EADDRINUSE/);
        await expect(reset).resolves.toBeUndefined();
    });

    it("closes the listener on reset and hands out a fresh URL afterwards", async () => {
        const first = await getCopilotMcpEndpointUrl();
        await expect(request(first)).resolves.toMatchObject({ status: 406 });

        await resetCopilotMcpEndpointForTests();
        await expect(request(first)).rejects.toThrow(/ECONNREFUSED/);

        await expect(getCopilotMcpEndpointUrl()).resolves.not.toBe(first);
    });

    it("404s every path but the secret one, without building an MCP server", async () => {
        const url = await getCopilotMcpEndpointUrl();
        const base = url.slice(0, url.lastIndexOf("/"));

        await expect(request(`${base}/`)).resolves.toMatchObject({ status: 404 });
        await expect(request(`${url}x`)).resolves.toMatchObject({ status: 404 });
        expect(createMcpServerMock).not.toHaveBeenCalled();
    });

    it("answers an MCP handshake and disposes both peers on response close", async () => {
        const transportClose = vi.spyOn(StreamableHTTPServerTransport.prototype, "close");
        const url = await getCopilotMcpEndpointUrl();

        const res = await request(url, {
            method: "POST",
            headers: MCP_HEADERS,
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "initialize",
                params: {
                    protocolVersion: "2025-06-18",
                    capabilities: {},
                    clientInfo: { name: "spec", version: "1.0.0" }
                }
            })
        });

        expect(res.status).toBe(200);
        expect(res.body).toContain("trilium-notes-spec");

        const mcpServer = mcpServers.at(-1);
        await vi.waitFor(() => {
            expect(transportClose).toHaveBeenCalled();
            expect(mcpServer?.close).toHaveBeenCalled();
        });
    });

    it("rejects a rebound Host and lets the bound one through", async () => {
        const url = await getCopilotMcpEndpointUrl();

        // The allowlist is pinned to the bound address, so a DNS-rebinding
        // attempt is turned away before it reaches the transport. (Derived from
        // req.headers.host it would filter to an empty list, which the SDK reads
        // as "unrestricted" — the check has to be independent of the header.)
        const rebound = await request(url, { headers: { host: "evil.example" } });
        expect(rebound.status).toBe(403);
        expect(rebound.body).toContain("Invalid Host header");

        // Host absent entirely (HTTP/1.0) is also refused, though earlier: the
        // transport cannot resolve a request URL without one, so it answers 400
        // before the allowlist is consulted.
        expect(await rawGetWithoutHost(url)).toContain("400 Bad Request");

        // The address we actually handed the agent still reaches the transport,
        // which turns a plain GET down for want of SSE.
        expect((await request(url)).status).toBe(406);
    });

    it("answers 500 when the MCP server cannot be built", async () => {
        const url = await getCopilotMcpEndpointUrl();
        createMcpServerMock.mockImplementationOnce(() => {
            throw new Error("becca unavailable");
        });

        const res = await request(url);
        expect(res.status).toBe(500);
        expect(JSON.parse(res.body)).toEqual({ error: "Internal MCP error" });
        expect(errorLogMock).toHaveBeenCalledWith(expect.stringContaining("becca unavailable"));
    });

    it("leaves an already-sent response alone when the transport fails late", async () => {
        const url = await getCopilotMcpEndpointUrl();
        // A failure once the transport has started writing must only be logged:
        // a second writeHead() would throw ERR_HTTP_HEADERS_SENT on top of it.
        const handle = vi.spyOn(StreamableHTTPServerTransport.prototype, "handleRequest");
        handle.mockImplementationOnce(async (_req, res) => {
            res.writeHead(204).end();
            throw new Error("late transport crash");
        });

        const res = await request(url);
        expect(res.status).toBe(204);
        expect(errorLogMock).toHaveBeenCalledWith(expect.stringContaining("late transport crash"));
    });

    it("treats an empty body as absent and refuses one over the 4 MB cap", async () => {
        const url = await getCopilotMcpEndpointUrl();

        // Nothing to parse: the transport is handed no body and reports the
        // JSON-RPC parse error itself.
        const empty = await request(url, { method: "POST", headers: MCP_HEADERS });
        expect(empty.status).toBe(400);

        // The oversized upload may be reset mid-flight, so assert on what the
        // server logged rather than on what the client managed to read back.
        const overCap = Buffer.alloc(4 * 1024 * 1024 + 1, 0x20);
        await request(url, { method: "POST", headers: MCP_HEADERS, body: overCap })
            .catch(() => undefined);
        const overLimit = expect.stringContaining("4194304-byte limit");
        await vi.waitFor(() => expect(errorLogMock).toHaveBeenCalledWith(overLimit));
    });
});
