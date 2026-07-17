/**
 * Private loopback MCP endpoint for the Copilot Agent provider.
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
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { getLog } from "@triliumnext/core";
import { randomBytes } from "crypto";
import http from "http";

import { createMcpServer } from "../../mcp/mcp_server.js";

let endpointUrl: Promise<string> | undefined;

/**
 * Start (once) and return the endpoint URL to hand to the agent's
 * `session/new` MCP config. A failed start is not cached so a later chat
 * turn retries.
 */
export function getCopilotMcpEndpointUrl(): Promise<string> {
    if (!endpointUrl) {
        endpointUrl = startEndpoint().catch((err: unknown) => {
            endpointUrl = undefined;
            throw err;
        });
    }
    return endpointUrl;
}

/** For tests: close the listener and forget it so the next call starts fresh. */
export async function resetCopilotMcpEndpointForTests(): Promise<void> {
    if (endpointUrl) {
        const url = await endpointUrl.catch(() => undefined);
        endpointUrl = undefined;
        if (url) {
            await new Promise<void>(resolve => {
                listener?.close(() => resolve());
                listener = undefined;
            });
        }
    }
}

let listener: http.Server | undefined;

async function startEndpoint(): Promise<string> {
    const secretPath = `/mcp-${randomBytes(16).toString("hex")}`;

    const server = http.createServer((req, res) => {
        void handleRequest(req, res, secretPath);
    });
    listener = server;

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    /* v8 ignore next 3 -- listen() on a TCP port always yields an AddressInfo */
    if (address === null || typeof address === "string") {
        throw new Error("Failed to determine the MCP endpoint's bound address.");
    }

    const url = `http://127.0.0.1:${address.port}${secretPath}`;
    getLog().info(`Copilot Agent provider: note-tools MCP endpoint listening on 127.0.0.1:${address.port} (loopback only)`);
    return url;
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse, secretPath: string): Promise<void> {
    try {
        if (req.url !== secretPath) {
            res.writeHead(404).end();
            return;
        }

        // Stateless per-request server+transport, mirroring the public /mcp route.
        const mcpServer = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableDnsRebindingProtection: true,
            // The agent connects via the URL we hand it, so the Host header is
            // always the bound loopback address.
            allowedHosts: [req.headers.host ?? ""].filter(h => /^127\.0\.0\.1:\d+$/.test(h))
        });

        res.on("close", () => {
            void transport.close();
            void mcpServer.close();
        });

        const body = req.method === "POST" ? await readJsonBody(req) : undefined;
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, body);
    } catch (err) {
        getLog().error(`Copilot MCP endpoint error: ${err}`);
        if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Internal MCP error" }));
        }
    }
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(chunk as Buffer);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    return text ? JSON.parse(text) : undefined;
}
