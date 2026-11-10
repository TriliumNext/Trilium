import { getLog, NotFoundError } from "@triliumnext/core";
import express from "express";
import supertest from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import errorHandlers, {
    describeError,
    extractOAuthErrorDetail,
    isLogoutFormNavigation
} from "./error_handlers.js";

describe("registered error handlers", () => {
    afterEach(() => vi.restoreAllMocks());

    function buildApp() {
        const app = express();
        app.get("/csrf", (_req, _res, next) => next(Object.assign(new Error("invalid csrf token"), { code: "EBADCSRFTOKEN" })));
        app.get("/missing", (_req, _res, next) => next(new NotFoundError("Note 'x' not found.")));
        app.get("/broken", (_req, _res, next) => next(Object.assign(new TypeError("fetch failed"), {
            cause: Object.assign(new Error("getaddrinfo ENOTFOUND idp.example"), { code: "ENOTFOUND" })
        })));
        app.get("/string", (_req, _res, next) => next("plain string"));
        app.post("/logout", (_req, _res, next) => next(new Error("provider down")));
        errorHandlers.register(app);
        return app;
    }

    it("turns a CSRF failure into a 403 and logs the token prefix it carried", async () => {
        const error = vi.spyOn(getLog(), "error");
        const app = buildApp();

        const withToken = await supertest(app).get("/csrf").set("x-csrf-token", "abcdefghijkl").expect(403);
        expect(withToken.body).toEqual({ message: "Invalid CSRF token" });
        expect(error).toHaveBeenCalledWith("Invalid CSRF token on GET /csrf (token prefix: abcdefgh)");

        await supertest(app).get("/csrf").expect(403);
        expect(error).toHaveBeenCalledWith("Invalid CSRF token on GET /csrf");
    });

    it("answers with the status of an HttpError and 500 for anything else", async () => {
        const info = vi.spyOn(getLog(), "info");
        const app = buildApp();

        expect((await supertest(app).get("/missing").expect(404)).body).toEqual({ message: "Note 'x' not found." });
        expect(info).toHaveBeenCalledWith("404 GET /missing");

        expect((await supertest(app).get("/nowhere").expect(404)).body)
            .toEqual({ message: "Router not found for request GET /nowhere" });

        expect((await supertest(app).get("/string").expect(500)).body).toEqual({ message: "Unknown Error" });
        expect(info).toHaveBeenCalledWith("500 GET /string");
    });

    it("logs the cause chain of an error whose message hides the reason", async () => {
        const error = vi.spyOn(getLog(), "error");

        const res = await supertest(buildApp()).get("/broken").expect(500);

        expect(res.body).toEqual({ message: "fetch failed" });
        expect(error).toHaveBeenCalledWith(
            "Error on GET /broken: fetch failed ← caused by: getaddrinfo ENOTFOUND idp.example [ENOTFOUND]");
    });

    it("sends a failed logout form back into the app, and answers an API logout with the error", async () => {
        const app = buildApp();

        const form = await supertest(app).post("/logout").type("form").set("Accept", "text/html").send("x=1").expect(302);
        expect(form.headers.location).toBe(".");

        const api = await supertest(app).post("/logout").set("Accept", "application/json").send({}).expect(500);
        expect(api.body).toEqual({ message: "provider down" });
    });
});

describe("isLogoutFormNavigation", () => {
    const request = (accept: string) => ({
        method: "POST",
        path: "/logout",
        headers: { accept },
        is: () => "application/x-www-form-urlencoded",
        get: (header: string) => header.toLowerCase() === "accept" ? accept : undefined
    });

    it("recognizes HTML form posts to logout", () => {
        const req = request("text/html,application/xhtml+xml");

        expect(isLogoutFormNavigation(req as never)).toBe(true);
    });

    it("does not classify API requests as navigations", () => {
        const req = request("application/json");

        expect(isLogoutFormNavigation(req as never)).toBe(false);
    });
});

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
