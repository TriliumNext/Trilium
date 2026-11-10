import { getLog, options as optionService } from "@triliumnext/core";
import express from "express";
import supertest from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mcp = vi.hoisted(() => ({
    createMcpServer: vi.fn(),
    handleRequest: vi.fn(),
    closeTransport: vi.fn(async () => {})
}));

vi.mock("../services/mcp/mcp_server.js", () => ({ createMcpServer: mcp.createMcpServer }));
vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
    StreamableHTTPServerTransport: class {
        handleRequest = mcp.handleRequest;
        close = mcp.closeTransport;
    }
}));

import etapiTokenService from "../services/etapi_tokens.js";
import { createMcpRateLimiter, register, resolveMcpAccess } from "./mcp.js";

describe("MCP request handling", () => {
    beforeEach(() => {
        vi.spyOn(optionService, "getOptionOrNull").mockReturnValue("true");
        vi.spyOn(etapiTokenService, "isValidAuthHeader").mockReturnValue(true);
    });
    afterEach(() => {
        vi.restoreAllMocks();
        mcp.createMcpServer.mockReset();
        mcp.handleRequest.mockReset();
    });

    function buildMcpApp() {
        const app = express();
        register(app);
        return app;
    }

    it("turns a request without a valid token away before setting anything up", async () => {
        vi.spyOn(etapiTokenService, "isValidAuthHeader").mockReturnValue(false);

        const res = await supertest(buildMcpApp()).post("/mcp").expect(401);

        expect(res.body.error).toContain("ETAPI token");
        expect(mcp.createMcpServer).not.toHaveBeenCalled();
    });

    it("answers 500 when the MCP server cannot be set up", async () => {
        const error = vi.spyOn(getLog(), "error");
        mcp.createMcpServer.mockRejectedValue(new Error("tools failed"));

        const res = await supertest(buildMcpApp()).post("/mcp").set("Authorization", "Bearer t").expect(500);

        expect(res.body).toEqual({ error: "Internal MCP error" });
        expect(error).toHaveBeenCalledWith("MCP request error: Error: tools failed");
    });

    it("keeps the response the transport already sent when it fails afterwards, and closes both ends", async () => {
        const error = vi.spyOn(getLog(), "error");
        const server = { connect: vi.fn(async () => {}), close: vi.fn(async () => {}) };
        mcp.createMcpServer.mockResolvedValue(server);
        mcp.handleRequest.mockImplementation(async (_req: express.Request, res: express.Response) => {
            res.status(202).end("accepted");
            throw new Error("stream broke");
        });

        const res = await supertest(buildMcpApp()).post("/mcp").set("Authorization", "Bearer t").expect(202);

        expect(res.text).toBe("accepted");
        expect(error).toHaveBeenCalledWith("MCP request error: Error: stream broke");
        await vi.waitFor(() => expect(server.close).toHaveBeenCalledOnce());
        expect(server.connect).toHaveBeenCalledOnce();
        expect(mcp.closeTransport).toHaveBeenCalled();
    });
});

describe("resolveMcpAccess", () => {
    it("denies everything with 403 while MCP is disabled, token or not", () => {
        for (const hasValidToken of [true, false]) {
            expect(resolveMcpAccess({ mcpEnabled: false, hasValidToken }))
                .toEqual({ type: "deny", status: 403, error: expect.stringContaining("disabled") });
        }
    });

    it("allows a valid token", () => {
        expect(resolveMcpAccess({ mcpEnabled: true, hasValidToken: true })).toEqual({ type: "allow" });
    });

    it("rejects a missing or invalid token with 401 and tells the user where to get one", () => {
        const decision = resolveMcpAccess({ mcpEnabled: true, hasValidToken: false });
        expect(decision).toEqual({ type: "deny", status: 401, error: expect.stringContaining("ETAPI token") });
        expect(decision.type === "deny" && decision.error).toContain("Options > ETAPI");
    });
});

describe("createMcpRateLimiter", () => {
    // The limiter reads both halves of the access decision to tell a failed authentication
    // from anything else, so both singletons are stubbed rather than a live becca booted.
    beforeEach(() => vi.spyOn(optionService, "getOptionOrNull").mockReturnValue("true"));
    afterEach(() => vi.restoreAllMocks());

    it("never spends the budget on an authenticated client, even when its responses are abandoned", async () => {
        // The leak this guards against: an MCP client drops its standing GET stream on every
        // reconnect, so the response never reaches `finish`. A limiter that counts the hit up
        // front and refunds it on `finish` never refunds these, and locks the valid token out
        // once 10 have piled up.
        vi.spyOn(etapiTokenService, "isValidAuthHeader").mockReturnValue(true);
        const { app, handled } = buildApp((_req, res) => res.socket?.destroy());

        const statuses = await sendRepeatedly(app, 15);

        expect(handled()).toBe(15);
        expect(statuses).toEqual(Array(15).fill(ABORTED));
    });

    it("caps failed authentications and keeps rejecting past the limit", async () => {
        vi.spyOn(etapiTokenService, "isValidAuthHeader").mockReturnValue(false);
        const { app, handled } = buildApp((_req, res) => { res.status(401).json({ error: "nope" }); });

        const statuses = await sendRepeatedly(app, 12);

        expect(handled()).toBe(10); // the configured max
        expect(statuses).toEqual([...Array(10).fill(401), 429, 429]);
    });

    it("does not spend the budget while MCP is disabled, since nothing there is an attempt at the credential", async () => {
        vi.spyOn(optionService, "getOptionOrNull").mockReturnValue("false");
        vi.spyOn(etapiTokenService, "isValidAuthHeader").mockReturnValue(false);
        const { app } = buildApp((_req, res) => { res.status(403).json({ error: "off" }); });

        const statuses = await sendRepeatedly(app, 12);

        expect(statuses).toEqual(Array(12).fill(403));
    });
});

const ABORTED = "aborted";

/** An app whose only route counts how many requests made it past the limiter. */
function buildApp(handler: express.RequestHandler) {
    let handled = 0;

    const app = express();
    app.get("/mcp", createMcpRateLimiter(), (req, res, next) => {
        handled++;
        handler(req, res, next);
    });

    return { app, handled: () => handled };
}

async function sendRepeatedly(app: express.Application, count: number) {
    const statuses: (number | typeof ABORTED)[] = [];

    // Sequentially: the limiter's budget is spent in request order, which is what's asserted.
    for (let i = 0; i < count; i++) {
        statuses.push(await sendAndTolerateAbort(app));
    }

    return statuses;
}

/**
 * A destroyed socket surfaces to the client as ECONNRESET rather than as a response — the
 * point of the first test — so that one rejection is an expected outcome. Anything else is
 * a broken test, and is rethrown rather than quietly recorded as an abort.
 */
async function sendAndTolerateAbort(app: express.Application): Promise<number | typeof ABORTED> {
    try {
        return (await supertest(app).get("/mcp")).status;
    } catch (e) {
        if ((e as NodeJS.ErrnoException)?.code !== "ECONNRESET") {
            throw e;
        }
        return ABORTED;
    }
}
