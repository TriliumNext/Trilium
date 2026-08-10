import { describe, expect, it } from "vitest";

import { resolveMcpAccess } from "./mcp.js";

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
