import { cls, options as optionService, sql_init } from "@triliumnext/core";
import type { Application } from "express";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { type ApiTestContext, bootLoggedInApp, createTextNote } from "../../spec/support/internal_api.js";
import etapiTokenService from "../services/etapi_tokens.js";
import port from "../services/port.js";

const initializeRequest = {
    jsonrpc: "2.0",
    method: "initialize",
    id: 1,
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "spec", version: "1" } }
};

let ctx: ApiTestContext;
let app: Application;

describe("Route transport & middleware", () => {
    beforeAll(async () => {
        ctx = await bootLoggedInApp();
        app = ctx.app;
    });

    describe("bootstrap view detection", () => {
        it("returns the print view when ?print is present", async () => {
            const res = await supertest(app).get("/bootstrap?print").expect(200);
            expect(res.body.device).toBe("print");
        });

        it("returns the mobile view via query, cookie and user-agent", async () => {
            expect((await supertest(app).get("/bootstrap?mobile").expect(200)).body.device).toBe("mobile");
            expect((await supertest(app).get("/bootstrap?desktop").expect(200)).body.device).toBe("desktop");

            const byCookie = await supertest(app).get("/bootstrap").set("Cookie", "trilium-device=mobile").expect(200);
            expect(byCookie.body.device).toBe("mobile");

            const byUa = await supertest(app).get("/bootstrap")
                .set("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)").expect(200);
            expect(byUa.body.device).toBe("mobile");
        });

        it("treats ?extraWindow as a non-main window", async () => {
            const res = await supertest(app).get("/bootstrap?extraWindow=1").expect(200);
            expect(res.body.isMainWindow).toBe(false);
        });

        it("includes platform in the setup (uninitialized DB) payload", async () => {
            // The setup window relies on `glob.platform` to apply the
            // platform-darwin drag-region CSS on macOS.
            const spy = vi.spyOn(sql_init, "isDbInitialized").mockReturnValue(false);
            try {
                const res = await supertest(app).get("/bootstrap").expect(200);
                expect(res.body.dbInitialized).toBe(false);
                expect(res.body.platform).toBe(process.platform);
            } finally {
                spy.mockRestore();
            }
        });
    });

    describe("CSRF & error handling", () => {
        it("rejects a mutating request carrying a bogus CSRF token (403)", async () => {
            await ctx.agent.post("/api/tree/load")
                .set("x-csrf-token", "bogustoken1234567890")
                .send({ noteIds: ["root"] })
                .expect(403);
        });

        it("returns a 404 body for an unknown route", async () => {
            const res = await supertest(app).get("/this-route-does-not-exist").expect(404);
            expect(res.body.message).toBeTruthy();
        });

        it("serves a [statusCode, string] handler result as plain text", async () => {
            // /api/login/token returns [401, "Incorrect credential"] on a bad
            // password — exercising apiResultHandler's array form and send()'s
            // text-error branch.
            const res = await supertest(app).post("/api/login/token").send({ password: "wrong" }).expect(401);
            expect(res.headers["content-type"]).toContain("text/plain");
            expect(res.text).toBe("Incorrect credential");
        });

        it("maps a thrown ValidationError to a 400 JSON body", async () => {
            const res = await ctx.agent.post("/api/database/anonymize/bogus")
                .set("x-csrf-token", ctx.csrfToken)
                .send({})
                .expect(400);
            expect(res.body.message).toContain("Invalid type");
        });

        it("handles a multipart file upload through the upload middleware", async () => {
            const { noteId } = await createTextNote(ctx, { title: "Upload target" });
            const res = await ctx.agent.put(`/api/notes/${noteId}/file`)
                .set("x-csrf-token", ctx.csrfToken)
                .attach("upload", Buffer.from("uploaded bytes"), { filename: "doc.txt", contentType: "text/plain" })
                .expect(200);
            expect(res.body.uploaded).toBe(true);
        });

        it("accepts a flat (non-bracketed) multipart field alongside the file", async () => {
            // fieldNestingDepth: 0 rejects only bracketed names; a flat field has zero brackets.
            const { noteId } = await createTextNote(ctx, { title: "Flat field target" });
            const res = await ctx.agent.put(`/api/notes/${noteId}/file`)
                .set("x-csrf-token", ctx.csrfToken)
                .field("description", "a plain field")
                .attach("upload", Buffer.from("uploaded bytes"), { filename: "doc.txt", contentType: "text/plain" })
                .expect(200);
            expect(res.body.uploaded).toBe(true);
        });

        it("rejects a nested (bracketed) multipart field name with 400 (CVE-2026-5079 guard)", async () => {
            // The fieldNestingDepth: 0 limit aborts with LIMIT_FIELD_NESTING, which the upload error
            // handler maps to a 400 instead of letting the request reach the route handler file-less.
            const { noteId } = await createTextNote(ctx, { title: "Nested field target" });
            const res = await ctx.agent.put(`/api/notes/${noteId}/file`)
                .set("x-csrf-token", ctx.csrfToken)
                .field("a[b][c]", "deep")
                .attach("upload", Buffer.from("uploaded bytes"), { filename: "doc.txt", contentType: "text/plain" })
                .expect(400);
            expect(res.text).toContain("nested multipart field names are not allowed");
        });
    });

    it("redirects /setup to the app when the DB is already initialized", async () => {
        await supertest(app).get("/setup").expect(302);
    });

    it("logs out an authenticated session", async () => {
        await ctx.agent.post("/logout").set("x-csrf-token", ctx.csrfToken).expect(302);
    });

    describe("MCP endpoint", () => {
        it("returns 403 when MCP is disabled", async () => {
            const res = await supertest(app).post("/mcp").send({ jsonrpc: "2.0", method: "ping", id: 1 }).expect(403);
            expect(res.body.error).toContain("disabled");
        });

        it("rejects an untokened request with 401 even over loopback, with no OAuth challenge", async () => {
            cls.init(() => optionService.setOption("mcpEnabled", "true"));
            // supertest dials loopback, which used to be sufficient on its own. It no longer
            // is: any local process can reach the listener, so a token is always required.
            const res = await supertest(app)
                .post("/mcp")
                .set("Host", `localhost:${port}`)
                .set("Content-Type", "application/json")
                .set("Accept", "application/json, text/event-stream")
                .send(initializeRequest)
                .expect(401);
            expect(res.body.error).toContain("ETAPI token");
            // A WWW-Authenticate header would send spec-compliant MCP clients into an
            // OAuth discovery flow Trilium cannot serve.
            expect(res.headers["www-authenticate"]).toBeUndefined();
        });

        it("does not accept a logged-in browser session in place of a token", async () => {
            cls.init(() => optionService.setOption("mcpEnabled", "true"));
            // A session of its own: the shared ctx.agent was logged out by an earlier test,
            // and a dead session would make this pass without proving anything.
            const agent = supertest.agent(app);
            await agent.post("/login").send({ password: "demo1234" }).expect(302);
            const csrfToken = (await agent.get("/bootstrap").expect(200)).body.csrfToken;
            await agent.post("/api/tree/load")
                .set("x-csrf-token", csrfToken)
                .send({ noteIds: ["root"] })
                .expect(200);

            // That cookie now demonstrably authenticates the internal API. If it also worked
            // here, /mcp would be CSRF-able by any page the logged-in user visits — with full
            // tool access. Only the Authorization header may authenticate.
            const res = await agent
                .post("/mcp")
                .set("Host", `localhost:${port}`)
                .set("Content-Type", "application/json")
                .set("Accept", "application/json, text/event-stream")
                .send(initializeRequest)
                .expect(401);
            expect(res.body.error).toContain("ETAPI token");
        });

        it("rejects a bogus token with 401", async () => {
            cls.init(() => optionService.setOption("mcpEnabled", "true"));
            const res = await supertest(app)
                .post("/mcp")
                .set("Host", `localhost:${port}`)
                .set("Authorization", "Bearer not_a_real_token")
                .set("Content-Type", "application/json")
                .set("Accept", "application/json, text/event-stream")
                .send(initializeRequest)
                .expect(401);
            expect(res.body.error).toContain("ETAPI token");
        });

        it("serves a token-authenticated caller, including on a foreign Host", async () => {
            cls.init(() => optionService.setOption("mcpEnabled", "true"));
            const { authToken } = cls.init(() => etapiTokenService.createToken("mcp transport spec"));

            // A remote client's Host is its own domain and could never satisfy a loopback
            // allow-list; the token is what authorises it, so no Host check applies.
            for (const host of [`localhost:${port}`, "trilium.example.com"]) {
                const res = await supertest(app)
                    .post("/mcp")
                    .set("Host", host)
                    .set("Authorization", `Bearer ${authToken}`)
                    .set("Content-Type", "application/json")
                    .set("Accept", "application/json, text/event-stream")
                    .send(initializeRequest);
                expect(res.status).toBe(200);
                expect(JSON.stringify(res.body)).not.toContain("Invalid Host header");
            }
        });

        it("accepts the ETAPI Basic-auth form as well as Bearer", async () => {
            cls.init(() => optionService.setOption("mcpEnabled", "true"));
            const { authToken } = cls.init(() => etapiTokenService.createToken("mcp basic spec"));
            // isValidAuthHeader also parses `Basic etapi:<token>`, which some clients emit
            // when given a username/password pair rather than a raw header.
            const res = await supertest(app)
                .post("/mcp")
                .auth("etapi", authToken, { type: "basic" })
                .set("Content-Type", "application/json")
                .set("Accept", "application/json, text/event-stream")
                .send(initializeRequest);
            expect(res.status).toBe(200);
        });

        /**
         * The limiter's budget is per-IP, and these tests have to exhaust one to say anything.
         * `trust proxy` makes the limiter key off `X-Forwarded-For`, so each test spends a
         * bucket of its own instead of the shared loopback one every other test in this file
         * uses — otherwise the first exhaustion here would 429 all of them.
         */
        describe("rate limiting", () => {
            let authToken: string;

            beforeAll(() => {
                app.set("trust proxy", 1);
                cls.init(() => optionService.setOption("mcpEnabled", "true"));
                ({ authToken } = cls.init(() => etapiTokenService.createToken("mcp rate limit spec")));
            });

            afterAll(() => {
                app.set("trust proxy", false);
            });

            function mcpPostFrom(clientIp: string) {
                return supertest(app)
                    .post("/mcp")
                    .set("X-Forwarded-For", clientIp)
                    .set("Content-Type", "application/json")
                    .set("Accept", "application/json, text/event-stream");
            }

            it("does not spend the token-guessing budget on failures that are not failed authentication", async () => {
                cls.init(() => optionService.setOption("mcpEnabled", "false"));

                // A full budget's worth of responses that have nothing to do with credentials. A
                // client polling a server whose MCP toggle is off reaches this on its own, without
                // anyone ever presenting a bad token — as does one that trips a transport-level
                // 4xx or a 500.
                for (let i = 0; i < 10; i++) {
                    await mcpPostFrom("203.0.113.1").send(initializeRequest).expect(403);
                }

                cls.init(() => optionService.setOption("mcpEnabled", "true"));

                // Nothing above was an authentication failure, so none of it may cost budget —
                // and a valid token is skipped by the limiter outright in any case. If either
                // rule slips, this is a 429: the limiter runs ahead of the guard, so an
                // unauthenticated caller could otherwise spend the budget on purpose and lock
                // out a legitimate client, or everyone sharing a NAT or Docker bridge address,
                // for fifteen minutes.
                const res = await mcpPostFrom("203.0.113.1")
                    .set("Authorization", `Bearer ${authToken}`)
                    .send(initializeRequest);
                expect(res.status).toBe(200);
            });

            it("still throttles a caller guessing tokens", async () => {
                for (let i = 0; i < 10; i++) {
                    await mcpPostFrom("203.0.113.2")
                        .set("Authorization", "Bearer not_a_real_token")
                        .send(initializeRequest)
                        .expect(401);
                }

                // Repeated bad tokens are what the limiter exists for: once the budget is gone
                // the guessing stops being answered. Guards against "fixing" the above by
                // dropping the limiter.
                await mcpPostFrom("203.0.113.2")
                    .set("Authorization", "Bearer still_not_a_real_token")
                    .send(initializeRequest)
                    .expect(429);

                // The client that does hold a token is served throughout: it never spends
                // budget, so it cannot be locked out by someone else's guessing from the same
                // address — which is everyone, behind a NAT, a Docker bridge or a proxy.
                const res = await mcpPostFrom("203.0.113.2")
                    .set("Authorization", `Bearer ${authToken}`)
                    .send(initializeRequest);
                expect(res.status).toBe(200);
            });
        });
    });
});
