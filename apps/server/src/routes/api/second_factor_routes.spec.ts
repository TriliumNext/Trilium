import type { Application } from "express";
import supertest from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

let app: Application;
let agent: ReturnType<typeof supertest.agent>;
let csrfToken: string;

const PASSWORD = Buffer.from("user:demo1234").toString("base64");

describe("the routes of the second factor", () => {
    beforeAll(async () => {
        const buildApp = (await import("../../app.js")).default;
        app = await buildApp();
        agent = supertest.agent(app);

        await agent.post("/login").send({ password: "demo1234" }).expect(302);
        csrfToken = (await agent.get("/bootstrap").expect(200)).body.csrfToken;
        expect(csrfToken).toBeTruthy();
    });

    it("answers no route that read the secret or spent a recovery code", async () => {
        await agent.get("/api/totp/get").expect(404);
        await agent.post("/api/totp_recovery/verify").set("x-csrf-token", csrfToken)
            .send({ recovery_code_guess: "AAAAAAAAAAAAAAAAAAAAAA==" }).expect(404);
    });

    it("changes the factor only with the password, without a code since none is set", async () => {
        const changes: [ "post" | "put", string, object ][] = [
            [ "post", "/api/totp/reset", {} ],
            [ "post", "/api/totp_recovery/regenerate", {} ],
            [ "post", "/api/oauth/disconnect", {} ],
            [ "put", "/api/totp/method", { method: "totp" } ],
            [ "post", "/api/totp/enable", { secret: "JBSWY3DPEHPK3PXP", recoveryCodes: [ "a" ] } ]
        ];
        for (const [ method, path, body ] of changes) {
            const res = await agent[method](path).set("x-csrf-token", csrfToken).send(body);
            expect(res.status, path).toBe(401);
            expect(res.text, path).toBe("Incorrect password");
        }

        await agent.put("/api/totp/method").set("x-csrf-token", csrfToken)
            .set("trilium-cred", PASSWORD)
            .send({ method: "totp" }).expect(200);
    });

    it("refuses mfaMethod through the options route, but returns it to the page", async () => {
        await agent.put("/api/options/mfaMethod/oauth").set("x-csrf-token", csrfToken).expect(400);

        const optionsRes = await agent.get("/api/options").expect(200);
        expect(optionsRes.body.mfaMethod).toBe("totp");
    });
});
