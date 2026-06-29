import { cls, options as optionService } from "@triliumnext/core";
import type { Application } from "express";
import supertest from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

import { type ApiTestContext, bootLoggedInApp, createTextNote } from "../../spec/support/internal_api.js";
import port from "../services/port.js";

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

        it("reaches the MCP transport over loopback with a valid Host once enabled", async () => {
            cls.init(() => optionService.setOption("mcpEnabled", "true"));
            // supertest connects over loopback so the guard passes; a Host matching
            // the configured port clears DNS-rebinding protection and the request
            // is handed to the streamable transport (any status is fine — we only
            // need the handler to execute past header validation).
            const res = await supertest(app)
                .post("/mcp")
                .set("Host", `localhost:${port}`)
                .set("Content-Type", "application/json")
                .set("Accept", "application/json, text/event-stream")
                .send({ jsonrpc: "2.0", method: "initialize", id: 1, params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "spec", version: "1" } } });
            expect(res.status).toBeGreaterThanOrEqual(200);
            expect(JSON.stringify(res.body)).not.toContain("Invalid Host header");
        });

        it("rejects a forged Host header (DNS rebinding) with 403", async () => {
            cls.init(() => optionService.setOption("mcpEnabled", "true"));
            // A DNS-rebinding attacker reaches the loopback listener through the
            // victim's browser (so the IP guard passes) but carries an attacker-
            // controlled Host. It must be rejected before any MCP tool can run.
            const res = await supertest(app)
                .post("/mcp")
                .set("Host", "attacker.example.com")
                .set("Content-Type", "application/json")
                .set("Accept", "application/json, text/event-stream")
                .send({ jsonrpc: "2.0", method: "initialize", id: 1, params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "spec", version: "1" } } })
                .expect(403);
            expect(res.body?.error?.message ?? "").toContain("Invalid Host header");
        });
    });
});
