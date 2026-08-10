import { cls, options as optionService } from "@triliumnext/core";
import type { Application, NextFunction, Request, Response } from "express";
import supertest from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Simulate the desktop build — the only one where the middleware gates anything.
vi.mock("./utils.js", async (orig) => {
    const actual = await orig<typeof import("./utils.js")>();
    return { ...actual, isElectron: true, default: { ...actual.default, isElectron: true } };
});

// Network access defaults to off (the state that gates anything) but is exposed through a
// getter so a test can flip it after the app has booted — the gate re-reads config on every
// request. The rest of the config stays real so the wiring tests can boot the actual app.
const network = vi.hoisted(() => ({ allowLanAccess: false }));
vi.mock("./config.js", async (orig) => {
    const actual = (await orig<typeof import("./config.js")>()).default;
    return {
        default: {
            ...actual,
            Security: {
                ...actual.Security,
                get allowLanAccess() { return network.allowLanAccess; }
            }
        }
    };
});

import { desktopNetworkAccessGate, isLocalIntegrationPath, isLoopbackHost, shouldBlockDesktopWebRequest } from "./desktop_network_gate.js";
import etapiTokenService from "./etapi_tokens.js";

function makeRes() {
    const res = {} as Record<string, unknown>;
    res.status = vi.fn(() => res);
    res.type = vi.fn(() => res);
    res.send = vi.fn(() => res);
    return res as unknown as Response & { status: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
}

// A plain-object stand-in for an external (unmarked) request: the middleware reads the
// path and the Host header via req.get("host").
function makeReq(path: string, host: string | undefined): Request {
    return { path, get: (name: string) => (name.toLowerCase() === "host" ? host : undefined) } as unknown as Request;
}

describe("isLocalIntegrationPath", () => {
    it("matches the MCP and clipper endpoints (and only those)", () => {
        expect(isLocalIntegrationPath("/mcp")).toBe(true);
        expect(isLocalIntegrationPath("/mcp/messages")).toBe(true);
        expect(isLocalIntegrationPath("/api/clipper")).toBe(true);
        expect(isLocalIntegrationPath("/api/clipper/handshake")).toBe(true);
        expect(isLocalIntegrationPath("/etapi")).toBe(true);
        expect(isLocalIntegrationPath("/etapi/notes")).toBe(true);

        expect(isLocalIntegrationPath("/")).toBe(false);
        expect(isLocalIntegrationPath("/bootstrap")).toBe(false);
        expect(isLocalIntegrationPath("/api/tree")).toBe(false);
        expect(isLocalIntegrationPath("/share/abc")).toBe(false);
        // Must not be fooled by a prefix that isn't a path segment boundary.
        expect(isLocalIntegrationPath("/mcp-evil")).toBe(false);
        expect(isLocalIntegrationPath("/api/clipperx")).toBe(false);
    });
});

describe("isLoopbackHost", () => {
    it("accepts loopback host headers (with or without port / brackets) and rejects the rest", () => {
        for (const host of ["localhost", "localhost:37742", "127.0.0.1", "127.0.0.1:37742", "127.5.5.5", "[::1]", "[::1]:37742"]) {
            expect(isLoopbackHost(host)).toBe(true);
        }
        for (const host of [undefined, "", "evil.example.com", "evil.example.com:37742", "192.168.1.9:37742", "localhost.evil.com"]) {
            expect(isLoopbackHost(host)).toBe(false);
        }
    });
});

describe("shouldBlockDesktopWebRequest", () => {
    const base = { isElectron: true, allowLanAccess: false, isInternal: false, path: "/", host: "localhost:37742" };

    it("never blocks on the server build", () => {
        expect(shouldBlockDesktopWebRequest({ ...base, isElectron: false })).toBe(false);
        expect(shouldBlockDesktopWebRequest({ ...base, isElectron: false, path: "/share/x" })).toBe(false);
    });

    it("serves everything once network access is enabled", () => {
        expect(shouldBlockDesktopWebRequest({ ...base, allowLanAccess: true })).toBe(false);
        expect(shouldBlockDesktopWebRequest({ ...base, allowLanAccess: true, path: "/share/x" })).toBe(false);
    });

    it("never blocks the trusted renderer (internal trilium-app:// request)", () => {
        expect(shouldBlockDesktopWebRequest({ ...base, isInternal: true })).toBe(false);
        expect(shouldBlockDesktopWebRequest({ ...base, isInternal: true, path: "/share/x" })).toBe(false);
    });

    it("blocks the web app and share for external requests when network access is off", () => {
        expect(shouldBlockDesktopWebRequest({ ...base, path: "/" })).toBe(true);
        expect(shouldBlockDesktopWebRequest({ ...base, path: "/bootstrap" })).toBe(true);
        expect(shouldBlockDesktopWebRequest({ ...base, path: "/api/tree" })).toBe(true);
        expect(shouldBlockDesktopWebRequest({ ...base, path: "/share/abc" })).toBe(true);
    });

    it("still allows the localhost integrations (MCP, clipper, ETAPI) from a loopback host", () => {
        expect(shouldBlockDesktopWebRequest({ ...base, path: "/mcp" })).toBe(false);
        expect(shouldBlockDesktopWebRequest({ ...base, path: "/api/clipper/handshake" })).toBe(false);
        expect(shouldBlockDesktopWebRequest({ ...base, path: "/etapi/notes" })).toBe(false);
    });

    it("blocks the localhost integrations when the Host header is non-loopback (DNS rebinding)", () => {
        expect(shouldBlockDesktopWebRequest({ ...base, path: "/api/clipper/handshake", host: "evil.example.com" })).toBe(true);
        expect(shouldBlockDesktopWebRequest({ ...base, path: "/etapi/notes", host: "evil.example.com:37742" })).toBe(true);
        expect(shouldBlockDesktopWebRequest({ ...base, path: "/mcp", host: undefined })).toBe(true);
    });
});

describe("desktopNetworkAccessGate (desktop build, network access off)", () => {
    it("responds 403 to an external web request and does not continue", () => {
        const res = makeRes();
        const next = vi.fn() as unknown as NextFunction;
        // A plain object carries no internal-electron marker → treated as external/TCP.
        desktopNetworkAccessGate(makeReq("/", "localhost:37742"), res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it("passes localhost-integration requests through to the next handler", () => {
        const res = makeRes();
        const next = vi.fn() as unknown as NextFunction;
        desktopNetworkAccessGate(makeReq("/api/clipper/handshake", "localhost:37742"), res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });
});

/**
 * The tests above call the middleware directly, so they cannot see whether it is mounted
 * anywhere the paths it names can actually reach it — the gate once sat *after* the MCP
 * routes in app.ts, which meant it never ran for `/mcp` at all. These boot the real app
 * and drive requests through the real middleware chain instead.
 */
describe("desktopNetworkAccessGate wiring (real app)", () => {
    let app: Application;

    const initializeRequest = {
        jsonrpc: "2.0",
        method: "initialize",
        id: 1,
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "spec", version: "1" } }
    };

    function mcpPost(host: string, authToken: string) {
        return supertest(app)
            .post("/mcp")
            .set("Host", host)
            .set("Authorization", `Bearer ${authToken}`)
            .set("Content-Type", "application/json")
            .set("Accept", "application/json, text/event-stream")
            .send(initializeRequest);
    }

    function createToken(name: string) {
        cls.init(() => optionService.setOption("mcpEnabled", "true"));
        return cls.init(() => etapiTokenService.createToken(name)).authToken;
    }

    beforeAll(async () => {
        // Built without the usual login handshake: with the gate active, `POST /login` is
        // itself web access and gets refused, which is the behaviour under test.
        app = await (await import("../app.js")).default();
    });

    it("is mounted ahead of the MCP routes", () => {
        const layers = app.router.stack;
        const gateIndex = layers.findIndex((layer) => layer.name === "desktopNetworkAccessGate");
        const mcpIndex = layers.findIndex((layer) => layer.route?.path === "/mcp");

        expect(gateIndex).toBeGreaterThanOrEqual(0);
        expect(mcpIndex).toBeGreaterThanOrEqual(0);
        // Express dispatches in registration order: a route registered first terminates the
        // request before any middleware mounted after it gets a chance to run.
        expect(gateIndex).toBeLessThan(mcpIndex);
    });

    it("refuses a rebound (non-loopback) Host on /mcp even with a valid token", async () => {
        // Enabled + authenticated, so MCP's own guard would answer 200. Anything other than
        // the gate's 403 means the gate never ran.
        const res = await mcpPost("evil.example.com", createToken("mcp gate spec"));

        expect(res.status).toBe(403);
        expect(res.text).toContain("Network access");
    });

    it("still serves a loopback Host on /mcp, so local clients keep working", async () => {
        const res = await mcpPost("localhost:37740", createToken("mcp gate loopback spec"));

        expect(res.status).toBe(200);
    });

    it("serves /mcp on a LAN Host once network access is enabled", async () => {
        const authToken = createToken("mcp gate lan spec");
        // Same request the previous test proves is refused while network access is off, so a
        // 200 here can only come from the opt-in — this is the case the gate must not break
        // now that it sits ahead of the MCP routes.
        expect((await mcpPost("192.168.1.50:37740", authToken)).status).toBe(403);

        network.allowLanAccess = true;
        try {
            expect((await mcpPost("192.168.1.50:37740", authToken)).status).toBe(200);
        } finally {
            network.allowLanAccess = false;
        }
    });
});
