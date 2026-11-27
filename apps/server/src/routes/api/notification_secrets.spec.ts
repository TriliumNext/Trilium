import { getLog, password, sql_init as coreSqlInit } from "@triliumnext/core";
import {
    hashTemplate
} from "@triliumnext/core/src/services/notifications/channels/body_template.js";
import {
    onAddressChanged
} from "@triliumnext/core/src/services/notifications/channels/registry.js";
import type { Application } from "express";
import fs from "fs";
import path from "path";
import supertest from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The secrets file is written for real, in a folder of its own.
vi.mock("../../services/data_dir.js", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../services/data_dir.js")>();
    const { mkdtempSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    return {
        ...original,
        default: {
            ...original.default,
            TRILIUM_DATA_DIR: mkdtempSync(join(tmpdir(), "trilium-secret-route-spec-"))
        }
    };
});

const { forwarding } = vi.hoisted(() => ({ forwarding: { isForwarding: true } }));
vi.mock("@triliumnext/core/src/services/notifications/channels/forwarder.js",
    async (importOriginal) => ({
        ...await importOriginal<object>(),
        isForwardingInstance: () => forwarding.isForwarding
    }));

import { refreshAuth } from "../../services/auth.js";
import config from "../../services/config.js";
import dataDir from "../../services/data_dir.js";

const SECRET_PATH = "/api/notification-channels/channelRoute/secret";
const CREDENTIALS = Buffer.from("user:demo1234").toString("base64");
const WRONG_CREDENTIALS = Buffer.from("user:wrong-password").toString("base64");
const TEMPLATE = "{ \"text\": \"{{title}}\", \"token\": \"{{secret.token}}\" }";
const SECRETS = [
    "hooks.example", "unguessable", "header-secret", "value-secret", "signing-secret"
];

let app: Application;
let agent: ReturnType<typeof supertest.agent>;
let csrfToken: string;

describe("the secret route of a webhook channel", () => {
    beforeAll(async () => {
        // The spec configuration turns authentication off.
        config.General.noAuthentication = false;
        refreshAuth();
        app = await (await import("../../app.js")).default();
        agent = supertest.agent(app);
        await agent.post("/login").send({ password: "demo1234" }).expect(302);
        csrfToken = (await agent.get("/bootstrap").expect(200)).body.csrfToken;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        forwarding.isForwarding = true;
    });

    afterAll(() => fs.rmSync(dataDir.TRILIUM_DATA_DIR, { recursive: true, force: true }));

    it("enters an address with the password, and shows its names, never a value", async () => {
        const logged = spyOnLog();
        const changed: string[] = [];
        const stop = onAddressChanged((channelId) => changed.push(channelId));

        const put = await change("put", {
            expected: 0, url: "https://hooks.example/unguessable", label: "ntfy on the NAS",
            headers: { Authorization: "Bearer header-secret" }, values: { token: "value-secret" },
            signingSecret: "signing-secret", template: TEMPLATE
        }).set("trilium-cred", CREDENTIALS);
        stop();
        const get = await agent.get(SECRET_PATH).expect(200);

        expect(put.status).toBe(200);
        expect(get.body).toEqual(put.body);
        expect(get.body).toEqual({
            isSet: true, version: 1, label: "ntfy on the NAS", headers: [ "Authorization" ],
            values: [ "token" ], hasSigningSecret: true,
            network: { allowPrivate: false, allowLoopback: false },
            changedAt: expect.any(String), templateHash: hashTemplate(TEMPLATE),
            isNetworkAllowed: true
        });
        expect(changed).toEqual([ "channelRoute" ]);
        const answers = JSON.stringify([ put.body, get.body ]);
        for (const secret of SECRETS) {
            expect(answers).not.toContain(secret);
            expect(logged()).not.toContain(secret);
        }
        const stored = fs.readFileSync(path.join(dataDir.TRILIUM_DATA_DIR,
            "notification-channel-secrets.json"), "utf-8");
        expect(stored).toContain("value-secret");
        expect(stored).not.toContain("{{title}}");
    });

    it("refuses a change without the password, with a wrong one, or a stale one", async () => {
        const body = { expected: 1, headers: { "X-Other": "x" } };

        const withoutPassword = await change("put", body);
        expect(withoutPassword.status).toBe(401);
        expect(withoutPassword.text).toBe("Incorrect password");
        expect((await change("delete", { expected: 1 }).set("trilium-cred", WRONG_CREDENTIALS))
            .status).toBe(401);
        expect((await change("put", { ...body, expected: 0 }).set("trilium-cred", CREDENTIALS))
            .body).toEqual({ code: "stale-revision" });
        expect((await change("put", { ...body, label: 42 }).set("trilium-cred", CREDENTIALS)))
            .toMatchObject({ status: 400, body: { code: "invalid-input" } });
        expect((await agent.get("/api/notification-channels/bad-id!/secret")).body)
            .toEqual({ code: "invalid-input" });
        expect((await agent.get(SECRET_PATH).expect(200)).body)
            .toMatchObject({ version: 1, headers: [ "Authorization" ] });

        // Without the CSRF token, and without a session.
        expect((await agent.delete(SECRET_PATH).send({ expected: 1 })
            .set("trilium-cred", CREDENTIALS)).status).toBe(403);
        expect((await supertest(app).get(SECRET_PATH)).status).toBe(401);
    });

    it("keeps the other headers when a PUT without a URL sets one, and deletes", async () => {
        const put = await change("put", { expected: 1, headers: { "X-Other": "x" } })
            .set("trilium-cred", CREDENTIALS);
        expect(put.body).toMatchObject({ version: 2, headers: [ "Authorization", "X-Other" ] });

        const removal = await change("delete", { expected: 2 }).set("trilium-cred", CREDENTIALS);
        expect(removal.body).toMatchObject({ isSet: false, version: 3, headers: [] });
        expect((await change("delete", { expected: 3 }).set("trilium-cred", CREDENTIALS)).body)
            .toEqual({ code: "not-found" });
    });

    it("refuses before the password: none is set, or not the forwarding instance", async () => {
        vi.spyOn(password, "isPasswordSet").mockReturnValue(false);
        const unset = await change("put", { expected: 3, url: "https://hooks.example/x" })
            .set("trilium-cred", CREDENTIALS);
        expect(unset.status).toBe(409);
        expect(unset.body).toEqual({ code: "password-not-set" });
        vi.restoreAllMocks();

        forwarding.isForwarding = false;
        expect((await agent.get(SECRET_PATH)).body).toEqual({ code: "not-forwarding" });
        expect((await change("delete", { expected: 3 }).set("trilium-cred", WRONG_CREDENTIALS))
            .body).toEqual({ code: "not-forwarding" });
        forwarding.isForwarding = true;

        vi.spyOn(coreSqlInit, "isDbInitialized").mockReturnValue(false);
        expect((await agent.get(SECRET_PATH)).body).toEqual({ code: "not-initialized" });
        expect((await change("put", { expected: 3 }).set("trilium-cred", CREDENTIALS)).body)
            .toEqual({ code: "not-initialized" });
    });

    it("answers internal without a message when the file cannot be read", async () => {
        const logError = vi.spyOn(getLog(), "error").mockImplementation(() => {});
        vi.spyOn(fs.promises, "readFile").mockRejectedValueOnce(
            Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }));

        const answer = await change("put", { expected: 3, url: "https://hooks.example/x" })
            .set("trilium-cred", CREDENTIALS);

        expect(answer.status).toBe(500);
        expect(answer.body).toEqual({ code: "internal" });
        expect(logError).toHaveBeenCalledWith(expect.stringMatching(
            /^A secret route of notification channels failed: internal\.\n\s+at /));
        expect(String(logError.mock.calls[0][0])).not.toContain("EACCES");
    });

    it("counts a wrong password until the limiter refuses", async () => {
        const statuses: number[] = [];
        for (let attempt = 0; attempt < 11 && !statuses.includes(429); attempt++) {
            statuses.push((await change("delete", { expected: 3 })
                .set("trilium-cred", WRONG_CREDENTIALS)).status);
        }

        expect(statuses.length).toBeGreaterThan(1);
        expect(statuses).toEqual([ ...statuses.slice(0, -1).map(() => 401), 429 ]);
    });
});

function change(method: "put" | "delete", body: object) {
    return agent[method](SECRET_PATH).set("x-csrf-token", csrfToken).send(body);
}

/** Collects what the log and the console are given, as one text. */
function spyOnLog() {
    const lines: unknown[] = [];
    const collect = (...args: unknown[]) => {
        lines.push(...args);
    };
    for (const method of [ "info", "warn", "error", "request" ] as const) {
        vi.spyOn(getLog(), method).mockImplementation(collect);
    }
    for (const method of [ "log", "info", "warn", "error" ] as const) {
        vi.spyOn(console, method).mockImplementation(collect);
    }
    return () => lines.map((line) => (typeof line === "object" ? "" : String(line))).join("\n");
}
