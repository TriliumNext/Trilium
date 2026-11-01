/**
 * MCP (Model Context Protocol) HTTP route handler.
 *
 * Mounts the Streamable HTTP transport at `/mcp`. Every request must carry an ETAPI token
 * in the `Authorization` header — there is no unauthenticated path, on any address.
 *
 * See {@link resolveMcpAccess} for why that replaces the previous loopback + DNS-rebinding
 * arrangement outright rather than layering on top of it.
 */

import { getLog, options as optionService } from "@triliumnext/core";
import type express from "express";
import rateLimit from "express-rate-limit";

import etapiTokenService from "../services/etapi_tokens.js";

export function register(app: express.Application) {
    const mcpRateLimiter = createMcpRateLimiter();

    app.post("/mcp", mcpRateLimiter, mcpGuard, handleMcpRequest);
    app.get("/mcp", mcpRateLimiter, mcpGuard, handleMcpRequest);
    app.delete("/mcp", mcpRateLimiter, mcpGuard, handleMcpRequest);

    getLog().info("MCP server registered at /mcp (ETAPI token required)");
}

/**
 * Caps failed authentications per IP — token guessing is unbounded once the endpoint is
 * reachable off-loopback. Mirrors the login limiter.
 *
 * A request costs budget only if it is one the guard behind this would answer 401 to, and
 * the cost is never refunded: `skip` decides before anything is recorded. The refund route
 * that express-rate-limit offers for the same goal — `skipSuccessfulRequests`, which
 * records the hit up front and gives it back from a `res.on("finish")` handler — cannot be
 * used here, because a response that never finishes never gets its hit back. Abandoned
 * responses are routine on this endpoint: an MCP client drops its standing `GET /mcp` event
 * stream on every reconnect, and cancels in-flight tool calls on timeout or user interrupt.
 * Ten of those inside the window — a handful of agent restarts — and the limiter answers
 * 429 to a perfectly valid token for the rest of it, which reads to the user as the MCP
 * connection dropping.
 *
 * A 401 always completes, so nothing is abandoned on the path that does spend budget.
 *
 * The corollary is that a valid token is served even from an address that has exhausted its
 * budget. That is the intent, not a hole: the budget is per-IP, and a Docker port mapping,
 * a NAT or a reverse proxy collapses every client onto one address, so anything else lets
 * one bad client lock out the one that actually holds a credential. Guessing is still
 * throttled — that is what the budget is for — and throttling a request that already
 * presents the right token protects nothing.
 */
export function createMcpRateLimiter() {
    return rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 10,
        skip: (req) => {
            const decision = readMcpAccess(req);
            return decision.type !== "deny" || decision.status !== 401;
        }
    });
}

function readMcpAccess(req: express.Request): McpAccessDecision {
    return resolveMcpAccess({
        mcpEnabled: optionService.getOptionOrNull("mcpEnabled") === "true",
        // Only the Authorization header authenticates — never a session cookie. A cookie would
        // make `/mcp` CSRF-able by any page the logged-in user visits, with full tool access.
        hasValidToken: etapiTokenService.isValidAuthHeader(req.headers.authorization)
    });
}

export type McpAccessDecision =
    | { type: "allow" }
    | { type: "deny"; status: number; error: string };

/**
 * Pure access decision for {@link mcpGuard}, extracted so the branching is unit-testable.
 *
 * An ETAPI token is required unconditionally — loopback is *not* a credential. Any local
 * process (a package postinstall script, another user on a shared box) can reach the
 * loopback listener, so the previous "no token needed from 127.0.0.1" rule handed full
 * read/write access over every note to anything running on the machine. It also meant a
 * misconfigured `trustedReverseProxy` could forge `X-Forwarded-For: 127.0.0.1` and walk
 * straight in. This mirrors what the web clipper already does on the server build
 * (see routes.ts — `clipperMiddleware`).
 *
 * Requiring the token also makes the SDK's DNS-rebinding protection redundant rather than
 * merely inconvenient: rebinding attacks work by borrowing the victim browser's *network
 * position*, and a bearer token is not ambient authority — cross-origin JS cannot attach an
 * `Authorization` header without a CORS preflight we never approve. See
 * {@link handleMcpRequest} for why the Host allow-list is therefore gone.
 *
 * Note the 401 deliberately carries no `WWW-Authenticate` header. In MCP that header is
 * the OAuth-discovery trigger (RFC 9728) and must point at protected-resource metadata;
 * Trilium has no authorization server, so advertising one would send spec-compliant
 * clients into a discovery flow that cannot succeed.
 */
export function resolveMcpAccess(opts: {
    mcpEnabled: boolean;
    hasValidToken: boolean;
}): McpAccessDecision {
    if (!opts.mcpEnabled) {
        return { type: "deny", status: 403, error: "MCP server is disabled. Enable it in Options > AI / LLM." };
    }

    if (!opts.hasValidToken) {
        return { type: "deny", status: 401, error: "MCP requires an ETAPI token. Create one in Options > ETAPI and send it as 'Authorization: Bearer <token>'." };
    }

    return { type: "allow" };
}

function mcpGuard(req: express.Request, res: express.Response, next: express.NextFunction) {
    const decision = readMcpAccess(req);

    if (decision.type === "deny") {
        res.status(decision.status).json({ error: decision.error });
        return;
    }

    next();
}

async function handleMcpRequest(req: express.Request, res: express.Response) {
    try {
        // Imported here rather than at module scope so the MCP SDK and the
        // tool stack land in lazy chunks: the route registers at startup, but
        // the guard above answers unauthenticated traffic before any of this
        // loads.
        const [{ StreamableHTTPServerTransport }, { createMcpServer }] = await Promise.all([
            import("@modelcontextprotocol/sdk/server/streamableHttp.js"),
            import("../services/mcp/mcp_server.js")
        ]);
        const server = await createMcpServer();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined, // stateless
            // Off because the guard above has already required a bearer token, which the
            // browser in a rebinding attack cannot supply. Keeping a Host allow-list here
            // would block legitimate remote clients — whose Host is their own domain —
            // without denying an attacker anything the token doesn't already deny.
            enableDnsRebindingProtection: false
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

export default { register };
