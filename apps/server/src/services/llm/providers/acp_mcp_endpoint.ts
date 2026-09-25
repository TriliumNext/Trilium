/**
 * Private loopback MCP endpoint for the ACP agent providers (GitHub Copilot, Google
 * Antigravity).
 *
 * The Claude Agent provider hands its agent an *in-process* MCP server
 * instance over the SDK's stdio control channel. ACP has no such channel —
 * `session/new` only accepts MCP servers by URL (http/sse) — so this module
 * exposes Trilium's MCP server on an ephemeral, loopback-only HTTP listener
 * instead.
 *
 * Deliberately separate from the public `/mcp` route: that route exists to
 * expose notes to *external* clients and is gated on the user-facing
 * `mcpEnabled` option. The in-chat agent's note access is governed by the
 * chat's own "Note access" toggle, so it must not depend on that option.
 * Access control: the listener binds to 127.0.0.1 on a random port, and the
 * endpoint lives under an unguessable 128-bit secret path known only to the
 * agent subprocess we spawn.
 *
 * The same listener answers the Antigravity file-access hook under a second
 * secret path (see `antigravity_hook.ts`): the hook's `curl` posts each tool
 * call there and prints the decision it gets back.
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { getLog } from "@triliumnext/core";
import { randomBytes } from "crypto";
import http from "http";

import { createMcpServer } from "../../mcp/mcp_server.js";

/** Decides one hook request from its JSON body; the result is sent back as JSON. */
export type AcpHookHandler = (payload: unknown) => unknown;

let endpoint: Promise<{ mcpUrl: string; hookUrl: string }> | undefined;
let hookHandler: AcpHookHandler | undefined;

/**
 * Start (once) and return the endpoint URL to hand to the agent's
 * `session/new` MCP config. A failed start is not cached so a later chat
 * turn retries.
 */
export async function getAcpMcpEndpointUrl(): Promise<string> {
    return (await startOnce()).mcpUrl;
}

/**
 * Start (once) and return the URL the hook posts tool calls to, which
 * `handler` answers from then on.
 */
export async function getAcpHookEndpointUrl(handler: AcpHookHandler): Promise<string> {
    hookHandler = handler;
    return (await startOnce()).hookUrl;
}

/** For tests: close the listener and forget it so the next call starts fresh. */
export async function resetAcpMcpEndpointForTests(): Promise<void> {
    hookHandler = undefined;
    if (endpoint) {
        const started = await endpoint.catch(() => undefined);
        endpoint = undefined;
        if (started) {
            await new Promise<void>(resolve => {
                listener?.close(() => resolve());
                listener = undefined;
            });
        }
    }
}

let listener: http.Server | undefined;

function startOnce() {
    if (!endpoint) {
        endpoint = startEndpoint().catch((err: unknown) => {
            endpoint = undefined;
            throw err;
        });
    }
    return endpoint;
}

async function startEndpoint(): Promise<{ mcpUrl: string; hookUrl: string }> {
    const mcpPath = `/mcp-${randomBytes(16).toString("hex")}`;
    const hookPath = `/hook-${randomBytes(16).toString("hex")}`;
    // Filled in once the listener is bound. A request can only arrive after
    // that, so the handlers always observe the real address.
    let boundHost = "";

    const server = http.createServer((req, res) => {
        if (req.url === hookPath && hookHandler) {
            void handleHookRequest(req, res, hookHandler, boundHost);
        } else {
            void handleRequest(req, res, mcpPath, boundHost);
        }
    });
    listener = server;

    await new Promise<void>((resolve, reject) => {
        const onStartupError = (err: Error) => reject(err);
        server.once("error", onStartupError);
        server.listen(0, "127.0.0.1", () => {
            // Past startup, rejecting a settled promise would drop the error
            // silently — log it instead (and keep a listener attached, since an
            // unhandled "error" event would crash the server).
            server.removeListener("error", onStartupError);
            server.on("error", err => getLog().error(`ACP MCP endpoint server error: ${err}`));
            resolve();
        });
    });

    const address = server.address();
    /* v8 ignore next 3 -- listen() on a TCP port always yields an AddressInfo */
    if (address === null || typeof address === "string") {
        throw new Error("Failed to determine the MCP endpoint's bound address.");
    }

    boundHost = `127.0.0.1:${address.port}`;
    getLog().info(`ACP agent providers: loopback endpoint for note tools and hooks listening on ${boundHost}`);
    return { mcpUrl: `http://${boundHost}${mcpPath}`, hookUrl: `http://${boundHost}${hookPath}` };
}

/**
 * Answer a hook request with the handler's decision. Any other response makes
 * the hook's `curl --fail` exit non-zero, which the agent treats as a denial.
 */
async function handleHookRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    handler: AcpHookHandler,
    boundHost: string
): Promise<void> {
    try {
        if (req.method !== "POST") {
            res.writeHead(405).end();
            return;
        }
        if (req.headers.host !== boundHost) {
            res.writeHead(403).end();
            return;
        }
        const decision = handler(await readJsonBody(req));
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(decision));
    } catch (err) {
        getLog().error(`ACP hook endpoint error: ${err}`);
        res.writeHead(500).end();
    }
}

async function handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    secretPath: string,
    boundHost: string
): Promise<void> {
    try {
        if (req.url !== secretPath) {
            res.writeHead(404).end();
            return;
        }

        // Stateless per-request server+transport, mirroring the public /mcp route.
        const mcpServer = await createMcpServer();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableDnsRebindingProtection: true,
            // Pinned to the address we bound and handed to the agent. Deriving
            // this from req.headers.host would be self-referential: a rebound
            // Host filters down to an empty list, and the SDK skips the check
            // entirely when the list is empty — so it could never reject.
            allowedHosts: [boundHost]
        });

        res.on("close", () => {
            void transport.close();
            void mcpServer.close();
        });

        const body = req.method === "POST" ? await readJsonBody(req) : undefined;
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, body);
    } catch (err) {
        getLog().error(`ACP MCP endpoint error: ${err}`);
        if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Internal MCP error" }));
        }
    }
}

/**
 * Cap on the buffered request body. Only the agent subprocess we spawn should
 * ever reach this endpoint, but the public /mcp route is bounded by Express's
 * body parser and this raw listener bypasses it — keep the two comparable so a
 * local process that learned the secret path can't exhaust the heap.
 */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of req) {
        totalBytes += (chunk as Buffer).length;
        if (totalBytes > MAX_BODY_BYTES) {
            throw new Error(`The request body exceeds the ${MAX_BODY_BYTES}-byte limit.`);
        }
        chunks.push(chunk as Buffer);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    return text ? JSON.parse(text) : undefined;
}
