import type { NotificationChannelPayload } from "@triliumnext/commons";
import { getLog, options } from "@triliumnext/core";
import {
    hashTemplate
} from "@triliumnext/core/src/services/notifications/channels/body_template.js";
import {
    ChannelSendError,
    type ChannelSendRequest
} from "@triliumnext/core/src/services/notifications/channels/types.js";
import { NotificationError } from "@triliumnext/core/src/services/notifications/model.js";
import crypto from "crypto";
import fs from "fs";
import http from "http";
import type { AddressInfo, Socket } from "net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The secrets file is written for real, in a folder of its own.
vi.mock("../data_dir.js", async (importOriginal) => {
    const original = await importOriginal<typeof import("../data_dir.js")>();
    const { mkdtempSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    return {
        ...original,
        default: {
            ...original.default,
            TRILIUM_DATA_DIR: mkdtempSync(join(tmpdir(), "trilium-webhook-spec-"))
        }
    };
});

// The real `safeFetch()`, with a spy on what it is asked.
const { safeFetch } = vi.hoisted(() => ({ safeFetch: vi.fn() }));
vi.mock("../safe_fetch.js", async (importOriginal) => {
    const original = await importOriginal<typeof import("../safe_fetch.js")>();
    safeFetch.mockImplementation(original.safeFetch);
    return { ...original, safeFetch };
});

import config from "../config.js";
import dataDir from "../data_dir.js";
import {
    applySecretPut,
    changeSecretEntry,
    getSecretEntry,
    type SecretEntryFields
} from "./notification_secrets.js";
import { webhookChannelType } from "./webhook.js";

interface Received {
    method?: string;
    url?: string;
    headers: http.IncomingHttpHeaders;
    body: string;
}

const PAYLOAD: NotificationChannelPayload = {
    key: "delivery-key-1",
    title: "Backup failed",
    description: "The disk is full.",
    category: "general",
    attentionLevel: "high",
    raisedAt: "2026-11-27 10:00:00.000Z",
    noteId: "abcdefghijkl"
};
const LOOPBACK = { allowPrivate: false, allowLoopback: true };

let server: http.Server;
let origin = "";
let received: Received[] = [];
let respond: (response: http.ServerResponse) => void = (response) => response.end();
let lastSocket: Socket | null = null;
let channelCount = 0;

beforeAll(async () => {
    server = http.createServer((request, response) => {
        lastSocket = request.socket;
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
            received.push({
                method: request.method, url: request.url, headers: request.headers,
                body: Buffer.concat(chunks).toString("utf-8")
            });
            respond(response);
        });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
    received = [];
    respond = (response) => response.end();
});

afterEach(() => {
    vi.restoreAllMocks();
    config.Notifications.allowLocalNetworkWebhooks = true;
});

afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir.TRILIUM_DATA_DIR, { recursive: true, force: true });
});

describe("the webhook channel type", () => {
    it("checks its configuration, and answers the state of an address from memory", async () => {
        expect(webhookChannelType).toMatchObject({ type: "webhook", title: "Webhook" });
        expect(webhookChannelType.isAvailable()).toBe(true);
        expect(webhookChannelType.checkConfig(undefined)).toEqual({});
        expect(webhookChannelType.checkConfig({})).toEqual({});
        const template = "{ \"text\": \"{{title}}\" }";
        expect(webhookChannelType.checkConfig({ template })).toEqual({ template });
        for (const [ config, code ] of [
            [ null, "invalid-input" ], [ [], "invalid-input" ], [ "text", "invalid-input" ],
            [ { template, other: 1 }, "invalid-input" ], [ { template: 42 }, "invalid-input" ],
            [ { template: "{ \"{{title}}\": 1 }" }, "invalid-template" ]
        ] as const) {
            expect(errorOf(() => webhookChannelType.checkConfig(config)), JSON.stringify(config))
                .toMatchObject({ name: "NotificationError", code });
        }

        const channelId = await addChannel({ templateHash: hashTemplate(template) });
        const entry = getSecretEntry(channelId);
        expect(webhookChannelType.getAddressState(channelId)).toEqual({
            configurationId: entry?.configurationId, templateHash: hashTemplate(template),
            changedAt: entry?.changedAt
        });
        expect(webhookChannelType.getAddressState("channelMissing")).toBeNull();
    });

    it("posts the payload as JSON to a receiver on this machine, framed and signed", async () => {
        const channelId = await addChannel({
            url: `${origin}/hook?topic=alerts`, signingSecret: "signing-secret",
            headers: new Map([ [ "Authorization", "Bearer header-secret" ] ])
        });
        const before = Math.floor(Date.now() / 1000);

        await webhookChannelType.send(requestOf(channelId));

        expect(received).toHaveLength(1);
        const [ { method, url, headers, body } ] = received;
        expect({ method, url, body }).toEqual({
            method: "POST", url: "/hook?topic=alerts", body: JSON.stringify(PAYLOAD)
        });
        expect(headers).toMatchObject({
            "host": origin.slice("http://".length),
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(body)),
            "idempotency-key": PAYLOAD.key,
            "authorization": "Bearer header-secret"
        });
        expect(headers["transfer-encoding"]).toBeUndefined();
        expect(headers.cookie).toBeUndefined();

        // The receiver checks the signature over the timestamp and the body.
        const timestamp = String(headers["x-trilium-timestamp"]);
        expect(Number(timestamp)).toBeGreaterThanOrEqual(before);
        expect(headers["x-trilium-signature"]).toBe(crypto.createHmac("sha256", "signing-secret")
            .update(`${timestamp}.${body}`).digest("hex"));

        expect(safeFetch).toHaveBeenLastCalledWith(`${origin}/hook?topic=alerts`,
            expect.objectContaining({ method: "POST", body }), {
                localRanges: LOOPBACK, isPlainHttpLocalOnly: true, maxRedirects: 0, timeoutMs: null
            });
    });

    it("reaches this machine only where the channel and the host allow it", async () => {
        const publicOnly = await addChannel({
            network: { allowPrivate: false, allowLoopback: false }
        });
        await expect(webhookChannelType.send(requestOf(publicOnly)))
            .rejects.toMatchObject({ name: "ChannelSendError", code: "refused-destination" });

        const local = await addChannel();
        config.Notifications.allowLocalNetworkWebhooks = false;
        await expect(webhookChannelType.send(requestOf(local)))
            .rejects.toMatchObject({ code: "refused-destination" });
        expect(received).toEqual([]);

        config.Notifications.allowLocalNetworkWebhooks = true;
        await webhookChannelType.send(requestOf(local));
        expect(received).toHaveLength(1);
    });

    it("hands a public HTTPS address to the policy with the channel's own ranges", async () => {
        const network = { allowPrivate: true, allowLoopback: false };
        const channelId = await addChannel({ url: "https://hooks.example/abc", network });
        safeFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

        await webhookChannelType.send(requestOf(channelId));

        expect(safeFetch).toHaveBeenLastCalledWith("https://hooks.example/abc",
            expect.objectContaining({ method: "POST" }), expect.objectContaining({
                localRanges: network, isPlainHttpLocalOnly: true
            }));
    });

    it("fails by the status, held back as long as Retry-After asks, an hour at most", async () => {
        const channelId = await addChannel();
        const failures: [ number, Record<string, string>, object ][] = [
            [ 500, {}, { httpStatus: 500, retryAfterMs: undefined } ],
            [ 404, { "Retry-After": "soon" }, { httpStatus: 404, retryAfterMs: undefined } ],
            [ 429, { "Retry-After": "120" }, { httpStatus: 429, retryAfterMs: 120_000 } ],
            [ 429, { "Retry-After": String(7 * 24 * 60 * 60) }, { retryAfterMs: 60 * 60 * 1000 } ],
            [ 503, { "Retry-After": new Date(Date.now() - 60_000).toUTCString() },
                { retryAfterMs: 0 } ]
        ];
        for (const [ status, headers, details ] of failures) {
            respond = (response) => response.writeHead(status, headers).end("busy");
            const error = await webhookChannelType.send(requestOf(channelId))
                .then(() => null, (e: unknown) => e);
            expect(error, String(status)).toBeInstanceOf(ChannelSendError);
            expect(error, String(status)).toMatchObject({ code: "http", message: "http", details });
        }

        respond = (response) => response.writeHead(503, {
            "Retry-After": new Date(Date.now() + 10 * 60_000).toUTCString()
        }).end();
        const dated = await webhookChannelType.send(requestOf(channelId))
            .then(() => null, (e: ChannelSendError) => e);
        expect(dated?.details.retryAfterMs).toBeGreaterThan(9 * 60_000);
        expect(dated?.details.retryAfterMs).toBeLessThanOrEqual(10 * 60_000);
    });

    it("follows no redirect", async () => {
        const channelId = await addChannel();
        respond = (response) => response.writeHead(307, { Location: `${origin}/elsewhere` }).end();

        await expect(webhookChannelType.send(requestOf(channelId)))
            .rejects.toMatchObject({ code: "redirect", message: "redirect" });
        expect(received.map(({ url }) => url)).toEqual([ "/hook" ]);
    });

    it("cancels the body of an answer once its status is read", async () => {
        const channelId = await addChannel();
        respond = (response) => response.writeHead(200).write("a body that never ends");

        await webhookChannelType.send(requestOf(channelId));

        await closeOf(lastSocket);
    });

    it("aborts an attempt that times out with its connection", async () => {
        const channelId = await addChannel();
        const controller = new AbortController();
        respond = () => controller.abort();

        await expect(webhookChannelType.send(requestOf(channelId, controller.signal)))
            .rejects.toMatchObject({ code: "timeout", message: "timeout" });
        await closeOf(lastSocket);
    });

    it("fails with network where nothing answers", async () => {
        const closed = http.createServer();
        await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
        const { port } = closed.address() as AddressInfo;
        await new Promise((resolve) => closed.close(resolve));
        const channelId = await addChannel({ url: `http://127.0.0.1:${port}/hook` });

        await expect(webhookChannelType.send(requestOf(channelId)))
            .rejects.toMatchObject({ code: "network", message: "network" });
    });

    it("fills the template with the secret values, which no log line holds", async () => {
        const logged = spyOnLog();
        const template = "{ \"token\": \"{{secret.token}}\", \"message\": \"{{title}}\", "
            + "\"priority\": 5 }";
        const channelId = await addChannel({
            values: new Map([ [ "token", "value-secret" ] ]), templateHash: hashTemplate(template)
        });
        const title = "{{secret.token}} {{key}} \"quoted\"\nnext";

        await webhookChannelType.send(requestOf(channelId, undefined, template, title));

        expect(JSON.parse(received[0].body)).toEqual({
            token: "value-secret", message: title, priority: 5
        });
        expect(logged()).not.toContain("value-secret");
    });

    it("fails with secret without the entry or a value that the template names", async () => {
        const template = "{ \"token\": \"{{secret.token}}\" }";
        const withoutValue = await addChannel({ values: new Map() });
        const otherDocument = await addChannel({ documentId: "another-document" });

        for (const request of [
            requestOf(withoutValue, undefined, template),
            requestOf("channelMissing"),
            requestOf(otherDocument)
        ]) {
            await expect(webhookChannelType.send(request), request.channelId)
                .rejects.toMatchObject({ name: "ChannelSendError", code: "secret" });
        }
        expect(received).toEqual([]);
    });

    it("sends nothing of the old entry after a PUT with another URL", async () => {
        const template = "{ \"token\": \"{{secret.token}}\" }";
        const channelId = await addChannel({
            headers: new Map([ [ "X-Old", "old-header" ] ]), signingSecret: "old-signing",
            values: new Map([ [ "token", "old-value" ] ])
        });

        await changeSecretEntry(channelId, 1, (current) => applySecretPut(current, {
            url: `${origin}/new`, headers: new Map(), values: new Map(),
            network: LOOPBACK
        }));
        await expect(webhookChannelType.send(requestOf(channelId, undefined, template)))
            .rejects.toMatchObject({ code: "secret" });
        await webhookChannelType.send(requestOf(channelId));

        expect(received).toHaveLength(1);
        expect(received[0].url).toBe("/new");
        expect(JSON.stringify(received[0])).not.toMatch(/old-header|old-signing|old-value/);
        expect(received[0].headers["x-trilium-signature"]).toBeUndefined();
    });

    it("reads the entry when called, so a later change cannot reach the request", async () => {
        const channelId = await addChannel({ headers: new Map([ [ "X-Before", "before" ] ]) });

        const sending = webhookChannelType.send(requestOf(channelId));
        await changeSecretEntry(channelId, 1, () => fieldsOf({ url: `${origin}/after` }));
        await sending;

        expect(received[0]).toMatchObject({ url: "/hook", headers: { "x-before": "before" } });
    });
});

/** Adds a webhook entry for a new channel, to the receiver on loopback unless told otherwise. */
async function addChannel(overrides: Partial<SecretEntryFields> = {}) {
    const channelId = `channelWebhook${++channelCount}`;
    await changeSecretEntry(channelId, 0, () => fieldsOf(overrides));
    return channelId;
}

function fieldsOf(overrides: Partial<SecretEntryFields>): SecretEntryFields {
    return {
        url: `${origin}/hook`,
        headers: new Map(),
        network: LOOPBACK,
        values: new Map(),
        configurationId: `configuration${channelCount}`,
        changedAt: "2026-11-27 10:00:00.000Z",
        templateHash: hashTemplate(undefined),
        documentId: options.getOption("documentId"),
        ...overrides
    };
}

function requestOf(
    channelId: string,
    signal = new AbortController().signal,
    template?: string,
    title = PAYLOAD.title
): ChannelSendRequest {
    return {
        channelId,
        template,
        payload: { ...PAYLOAD, title },
        delivery: { key: PAYLOAD.key, attempt: 1, signal }
    };
}

/** Waits for the receiver's end of a connection to close. */
async function closeOf(socket: Socket | null) {
    await vi.waitFor(() => expect(socket?.destroyed).toBe(true), { timeout: 5000 });
}

/** Collects what the log and the console are given, as one text. */
function spyOnLog() {
    const lines: unknown[] = [];
    const collect = (...args: unknown[]) => {
        lines.push(...args);
    };
    for (const method of [ "info", "warn", "error" ] as const) {
        vi.spyOn(getLog(), method).mockImplementation(collect);
        vi.spyOn(console, method).mockImplementation(collect);
    }
    vi.spyOn(console, "log").mockImplementation(collect);
    return () => lines.map(String).join("\n");
}

function errorOf(run: () => unknown): unknown {
    try {
        run();
    } catch (e) {
        expect(e).toBeInstanceOf(NotificationError);
        return e;
    }
    throw new Error("expected a refusal");
}
