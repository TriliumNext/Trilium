import { Application } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import config from "../../src/services/config.js";

let app: Application;

const LOGIN_URL = "/etapi/auth/login";
const CORRECT_PASSWORD = "demo1234";

describe("etapi/auth/login", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        const buildApp = (await import("../../src/app.js")).default;
        app = await buildApp();
    });

    it("issues a token for the correct password", async () => {
        const response = await supertest(app)
            .post(LOGIN_URL)
            .send({ password: CORRECT_PASSWORD, tokenName: "test" })
            .expect(201);

        expect(response.body.authToken).toBeTruthy();
    });

    // verifyPassword is async; this guards that a wrong password is rejected and the
    // async verification result actually gates token issuance.
    it("rejects a wrong password and issues no token", async () => {
        const response = await supertest(app)
            .post(LOGIN_URL)
            .send({ password: "definitely-not-the-password", tokenName: "test" })
            .expect(401);

        expect(response.body.code).toBe("WRONG_PASSWORD");
        expect(response.body.authToken).toBeUndefined();
    });

    it("rejects an empty password and issues no token", async () => {
        const response = await supertest(app)
            .post(LOGIN_URL)
            .send({ password: "", tokenName: "test" })
            .expect(401);

        expect(response.body.authToken).toBeUndefined();
    });

    it("reports a 500 when the password is missing and cannot be verified", async () => {
        // No password field → verifyPassword throws → caught by the middleware.
        await supertest(app)
            .post(LOGIN_URL)
            .send({ tokenName: "test" })
            .expect(500);
    });

    // A token must never be issued from a failed login, and even if one were, it must not
    // grant access to data.
    it("does not grant data access from a wrong-password login attempt", async () => {
        const response = await supertest(app)
            .post(LOGIN_URL)
            .send({ password: "definitely-not-the-password", tokenName: "test" });

        const token = response.body.authToken;
        // Defense in depth: if any token came back, assert it cannot read the root note.
        if (token) {
            await supertest(app)
                .get("/etapi/notes/root")
                .auth("etapi", token, { type: "basic" })
                .expect(401);
        }
    });
});
