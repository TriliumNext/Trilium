/**
 * MCP (Model Context Protocol) HTTP route handler.
 *
 * Mounts the Streamable HTTP transport at `/mcp` with a localhost-only guard.
 * No authentication is required — access is restricted to loopback addresses,
 * with DNS-rebinding protection (Host-header allow-list) layered on top so a
 * rebound attacker domain can't drive the transport from the victim's browser.
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { options as optionService } from "@triliumnext/core";
import type express from "express";

import { getLog } from "@triliumnext/core";
import { createMcpServer } from "../services/mcp/mcp_server.js";
import port from "../services/port.js";

/**
 * Host header values a legitimate (loopback) MCP client may target. The SDK's
 * DNS-rebinding protection rejects any other Host before a tool can run, so a
 * rebound attacker domain pointed at 127.0.0.1 — which the browser sends as its
 * own Host — cannot reach the transport even though it originates from loopback.
 *
 * Both the port-qualified form (`localhost:8080`) and the bare form (`localhost`)
 * are listed: a client reaching the server on a standard port (80/443) omits the
 * port from the Host header. Bare loopback names still only ever resolve to
 * loopback, so allowing them does not widen the DNS-rebinding surface.
 */
const MCP_ALLOWED_HOSTS = [
    "localhost",
    `localhost:${port}`,
    "127.0.0.1",
    `127.0.0.1:${port}`,
    "[::1]",
    `[::1]:${port}`
];

function isLoopback(addr: string | undefined): boolean {
    if (!addr) return false;
    // IPv6 loopback
    if (addr === "::1") return true;
    // IPv4 loopback (127.0.0.0/8)
    if (addr.startsWith("127.")) return true;
    // IPv4-mapped IPv6 loopback
    if (addr.startsWith("::ffff:127.")) return true;
    return false;
}

function mcpGuard(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (optionService.getOptionOrNull("mcpEnabled") !== "true") {
        res.status(403).json({ error: "MCP server is disabled. Enable it in Options > AI / LLM." });
        return;
    }

    // Use req.ip which respects trust proxy settings, falling back to socket address
    const clientIp = req.ip || req.socket.remoteAddress;
    if (!isLoopback(clientIp)) {
        res.status(403).json({ error: "MCP is only available from localhost" });
        return;
    }

    next();
}

async function handleMcpRequest(req: express.Request, res: express.Response) {
    try {
        const server = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined, // stateless
            enableDnsRebindingProtection: true,
            allowedHosts: MCP_ALLOWED_HOSTS
        });

        res.on("close", () => {
            void transport.close();
            void server.close();
        });

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    } catch (err) {
        getLog().error(`MCP request error: ${err}`);
        if (!res.headersSent) {
            res.status(500).json({ error: "Internal MCP error" });
        }
    }
}

export function register(app: express.Application) {
    app.post("/mcp", mcpGuard, handleMcpRequest);
    app.get("/mcp", mcpGuard, handleMcpRequest);
    app.delete("/mcp", mcpGuard, handleMcpRequest);

    getLog().info("MCP server registered at /mcp (localhost only)");
}

export default { register };
