/**
 * MCP (Model Context Protocol) HTTP route handler.
 *
 * Mounts the Streamable HTTP transport at `/mcp` with a localhost-only guard.
 * No authentication is required — access is restricted to loopback addresses.
 */

import type express from "express";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createMcpServer } from "../services/mcp/mcp_server.js";
import log from "../services/log.js";
import optionService from "../services/options.js";

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
            sessionIdGenerator: undefined // stateless
        });

        res.on("close", () => {
            transport.close();
            server.close();
        });

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    } catch (err) {
        log.error(`MCP request error: ${err}`);
        if (!res.headersSent) {
            res.status(500).json({ error: "Internal MCP error" });
        }
    }
}

export function register(app: express.Application) {
    app.post("/mcp", mcpGuard, handleMcpRequest);
    app.get("/mcp", mcpGuard, handleMcpRequest);
    app.delete("/mcp", mcpGuard, handleMcpRequest);

    log.info("MCP server registered at /mcp (localhost only)");
}

export default { register };
