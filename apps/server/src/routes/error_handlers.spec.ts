import { describe, expect, it } from "vitest";

import { describeError, extractOAuthErrorDetail } from "./error_handlers.js";

describe("extractOAuthErrorDetail", () => {
    it("combines OAuth error code and description", () => {
        expect(extractOAuthErrorDetail({ error: "invalid_client", error_description: "Unauthorized" }))
            .toBe("invalid_client: Unauthorized");
    });

    it("returns whichever field is present on its own", () => {
        expect(extractOAuthErrorDetail({ error: "redirect_uri_mismatch" })).toBe("redirect_uri_mismatch");
        expect(extractOAuthErrorDetail({ error_description: "Bad Request" })).toBe("Bad Request");
    });

    it("returns null for errors without OAuth detail", () => {
        expect(extractOAuthErrorDetail(new Error("server responded with an error in the response body"))).toBeNull();
        expect(extractOAuthErrorDetail({ error: 42 })).toBeNull();
        expect(extractOAuthErrorDetail("just a string")).toBeNull();
        expect(extractOAuthErrorDetail(null)).toBeNull();
        expect(extractOAuthErrorDetail(undefined)).toBeNull();
    });
});

describe("describeError", () => {
    it("unwraps undici's opaque 'fetch failed' to its underlying cause and code", () => {
        const cause = Object.assign(new Error("self-signed certificate in certificate chain"), {
            code: "DEPTH_ZERO_SELF_SIGNED_CERT"
        });
        const err = Object.assign(new TypeError("fetch failed"), { cause });

        expect(describeError(err)).toBe(
            "fetch failed ← caused by: self-signed certificate in certificate chain [DEPTH_ZERO_SELF_SIGNED_CERT]"
        );
    });

    it("surfaces Node system-error fields for connection failures", () => {
        const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9091"), {
            code: "ECONNREFUSED",
            syscall: "connect",
            address: "127.0.0.1",
            port: 9091
        });
        const err = Object.assign(new TypeError("fetch failed"), { cause });

        expect(describeError(err)).toBe(
            "fetch failed ← caused by: connect ECONNREFUSED 127.0.0.1:9091 [ECONNREFUSED connect 127.0.0.1 9091]"
        );
    });

    it("includes OAuth error/description detail alongside the message", () => {
        const err = Object.assign(new Error("server responded with an error in the response body"), {
            error: "invalid_client",
            error_description: "Client authentication failed"
        });

        expect(describeError(err)).toBe(
            "server responded with an error in the response body invalid_client: Client authentication failed"
        );
    });

    it("stops walking a cyclic cause chain", () => {
        const a: { message: string; cause?: unknown } = { message: "a" };
        const b = { message: "b", cause: a };
        a.cause = b;

        expect(describeError(a)).toBe("a ← caused by: b");
    });

    it("returns null when there is no extractable detail", () => {
        expect(describeError("just a string")).toBeNull();
        expect(describeError(null)).toBeNull();
        expect(describeError(undefined)).toBeNull();
        expect(describeError({})).toBeNull();
    });
});
