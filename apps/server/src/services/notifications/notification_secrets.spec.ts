import { getLog, options } from "@triliumnext/core";
import {
    hashTemplate
} from "@triliumnext/core/src/services/notifications/channels/body_template.js";
import {
    clearChannelTypes,
    getChannelType,
    loadChannelTypes,
    onAddressChanged
} from "@triliumnext/core/src/services/notifications/channels/registry.js";
import { NotificationError } from "@triliumnext/core/src/services/notifications/model.js";
import fs from "fs";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
            TRILIUM_DATA_DIR: mkdtempSync(join(tmpdir(), "trilium-secrets-spec-"))
        }
    };
});

import config from "../config.js";
import dataDir from "../data_dir.js";
import {
    applySecretPut,
    changeSecretEntry,
    getSecretEntry,
    getSecretView,
    loadNotificationSecrets,
    type NotificationSecretEntry,
    parseSecretDelete,
    parseSecretPut,
    registerWebhookChannelType,
    type SecretChange,
    type SecretEntryFields,
    setSecretsAside
} from "./notification_secrets.js";

const SECRETS_PATH = path.join(dataDir.TRILIUM_DATA_DIR, "notification-channel-secrets.json");
const ADDRESS = "https://hooks.example/unguessable-path";
const PUBLIC_ONLY = { allowPrivate: false, allowLoopback: false };
let changed: string[] = [];
let stopListening = () => false;

beforeEach(() => {
    changed = [];
    stopListening = onAddressChanged((channelId) => changed.push(channelId));
});

afterEach(() => {
    stopListening();
    vi.restoreAllMocks();
    config.Notifications.allowLocalNetworkWebhooks = true;
});

afterAll(() => fs.rmSync(dataDir.TRILIUM_DATA_DIR, { recursive: true, force: true }));

describe("the secrets file", () => {
    it("is read once, refused when it cannot be read, and read before the type loads", async () => {
        expect(getSecretEntry("channelFirst")).toBeNull();

        fs.writeFileSync(SECRETS_PATH, "{ \"entries\": [ not json, https://hooks.example/x");
        const error = await loadNotificationSecrets().then(() => null, (e: Error) => e);
        expect(error?.message).toBe("notification-channel-secrets.json cannot be read: invalid");
        for (const text of [
            JSON.stringify({ entries: [ { channelId: 1 } ], removed: [] }),
            JSON.stringify({ entries: [], removed: [ { channelId: "a", version: "1" } ] }),
            JSON.stringify({ entries: [] }),
            "[]"
        ]) {
            fs.writeFileSync(SECRETS_PATH, text);
            await expect(loadNotificationSecrets(), text).rejects.toThrow("cannot be read");
        }

        const logError = vi.spyOn(getLog(), "error").mockImplementation(() => {});
        registerWebhookChannelType();
        await loadChannelTypes();
        // The type of the server, which replaces the unavailable one of the registry.
        expect(getChannelType("webhook")?.isAvailable()).toBe(true);
        expect(logError).toHaveBeenCalledWith(
            "notification-channel-secrets.json cannot be read, so no webhook has an address.");
        clearChannelTypes();

        fs.rmSync(SECRETS_PATH);
        await loadNotificationSecrets();
        expect(getSecretEntry("channelFirst")).toBeNull();
    });

    it("writes an entry readable by the server's user only, and keeps it in memory", async () => {
        const entry = await changeSecretEntry("channelWrite", 0, (current) => {
            expect(current).toBeNull();
            return fieldsOf();
        });

        expect(entry).toMatchObject({ ...fieldsOf(), version: 1 });
        expect(getSecretEntry("channelWrite")).toEqual(entry);
        expect(changed).toEqual([ "channelWrite" ]);
        expect(fs.readdirSync(dataDir.TRILIUM_DATA_DIR)).not.toContain(
            "notification-channel-secrets.json.tmp");
        if (process.platform !== "win32") {
            expect(fs.statSync(SECRETS_PATH).mode & 0o777).toBe(0o600);
        }

        // The next change reads the entry back from the file, with its maps.
        await changeSecretEntry("channelWrite", 1, (current) => {
            expect(current).toEqual(entry);
            return { ...fieldsOf(), signingSecret: undefined, label: undefined };
        });
        const stored: { entries: { channelId: string }[] } =
            JSON.parse(fs.readFileSync(SECRETS_PATH, "utf-8"));
        expect(stored.entries.find(({ channelId }) => channelId === "channelWrite"))
            .toEqual({
                ...fieldsOf(), signingSecret: undefined, label: undefined,
                channelId: "channelWrite", version: 2,
                headers: [ [ "Authorization", "Bearer header-secret" ] ],
                values: [ [ "token", "value-secret" ] ]
            });
    });

    it("refuses another version, and never gives a removed entry's version again", async () => {
        const refusal = await changeSecretEntry("channelVersion", 3, () => fieldsOf())
            .then(() => null, (e: unknown) => e);
        expect(refusal).toBeInstanceOf(NotificationError);
        expect(refusal).toMatchObject({ code: "stale-revision" });
        await expect(changeSecretEntry("channelVersion", 0, () => null))
            .rejects.toMatchObject({ code: "not-found" });

        await changeSecretEntry("channelVersion", 0, () => fieldsOf());
        expect(await changeSecretEntry("channelVersion", 1, () => null)).toBeNull();
        expect(getSecretEntry("channelVersion")).toBeNull();
        expect(await getSecretView("channelVersion")).toMatchObject({ isSet: false, version: 2 });

        // A retry of the first entry, whose answer was lost, enters nothing again.
        await expect(changeSecretEntry("channelVersion", 0, () => fieldsOf()))
            .rejects.toMatchObject({ code: "stale-revision" });
        expect(await changeSecretEntry("channelVersion", 2, () => fieldsOf()))
            .toMatchObject({ version: 3 });
        expect(changed).toEqual([ "channelVersion", "channelVersion", "channelVersion" ]);
    });

    it("ignores an entry entered for the database of another document", async () => {
        await changeSecretEntry("channelOther", 0, () => fieldsOf({ documentId: "another" }));

        expect(getSecretEntry("channelOther")).toBeNull();
        expect(await getSecretView("channelOther")).toMatchObject({ isSet: false, version: 1 });
        await changeSecretEntry("channelOther", 1, (current) => {
            expect(current).toBeNull();
            return null;
        });
        expect(await getSecretView("channelOther")).toMatchObject({ isSet: false, version: 2 });
    });

    it("changes nothing when the write fails, and goes on with the next change", async () => {
        await changeSecretEntry("channelFail", 0, () => fieldsOf());
        const before = fs.readFileSync(SECRETS_PATH, "utf-8");
        vi.spyOn(fs.promises, "rename").mockRejectedValueOnce(
            Object.assign(new Error(`EACCES: permission denied, rename '${SECRETS_PATH}'`),
                { code: "EACCES" }));

        const error = await changeSecretEntry("channelFail", 1,
            () => fieldsOf({ url: `${ADDRESS}2` })).then(() => null, (e: Error) => e);
        expect(error?.message).toBe("notification-channel-secrets.json cannot be written: EACCES");
        expect(fs.readFileSync(SECRETS_PATH, "utf-8")).toBe(before);
        expect(fs.readdirSync(dataDir.TRILIUM_DATA_DIR)).not.toContain(
            "notification-channel-secrets.json.tmp");
        expect(getSecretEntry("channelFail")).toMatchObject({ url: ADDRESS, version: 1 });
        expect(changed).toEqual([ "channelFail" ]);

        await changeSecretEntry("channelFail", 1, () => fieldsOf({ url: `${ADDRESS}2` }));
        expect(getSecretEntry("channelFail")).toMatchObject({ url: `${ADDRESS}2`, version: 2 });
    });

    it("keeps a change whose listener fails", async () => {
        const logError = vi.spyOn(getLog(), "error").mockImplementation(() => {});
        const stop = onAddressChanged(() => {
            throw new Error(ADDRESS);
        });

        try {
            await changeSecretEntry("channelListener", 0, () => fieldsOf());
        } finally {
            stop();
        }

        expect(getSecretEntry("channelListener")).not.toBeNull();
        expect(logError).toHaveBeenCalledWith(
            "A listener of an address change of a notification channel failed.");
    });

    it("sets the file aside for a restore, never to be read again", async () => {
        await changeSecretEntry("channelAside", 0, () => fieldsOf());
        const text = fs.readFileSync(SECRETS_PATH, "utf-8");
        const ids = JSON.parse(text).entries.map((entry: { channelId: string }) => entry.channelId);
        changed = [];

        await setSecretsAside();

        expect(fs.existsSync(SECRETS_PATH)).toBe(false);
        const aside = setAsideFiles();
        expect(aside).toHaveLength(1);
        expect(fs.readFileSync(path.join(dataDir.TRILIUM_DATA_DIR, aside[0]), "utf-8")).toBe(text);
        expect(getSecretEntry("channelAside")).toBeNull();
        expect(changed).toEqual(ids);
        expect(ids).toContain("channelAside");

        // Without a file there is nothing to set aside, and no listener is notified.
        changed = [];
        await setSecretsAside();
        expect(setAsideFiles()).toHaveLength(1);
        expect(changed).toEqual([]);

        // A file that cannot be read is set aside as well.
        fs.writeFileSync(SECRETS_PATH, "not json");
        await setSecretsAside();
        expect(fs.existsSync(SECRETS_PATH)).toBe(false);
        expect(setAsideFiles()).toHaveLength(2);
        expect(changed).toEqual([]);
        for (const name of setAsideFiles()) {
            fs.rmSync(path.join(dataDir.TRILIUM_DATA_DIR, name));
        }
    });

    it("fails a restore whose file cannot be set aside, naming no path", async () => {
        fs.writeFileSync(SECRETS_PATH, JSON.stringify({ entries: [], removed: [] }));
        vi.spyOn(fs.promises, "rename").mockRejectedValueOnce(
            Object.assign(new Error(`EPERM: operation not permitted, rename '${SECRETS_PATH}'`),
                { code: "EPERM" }));

        await expect(setSecretsAside()).rejects.toThrow(
            /^notification-channel-secrets.json cannot be set aside: EPERM$/);
        expect(fs.existsSync(SECRETS_PATH)).toBe(true);
        fs.rmSync(SECRETS_PATH);
    });
});

describe("the view of the secret route", () => {
    it("names what is set, and holds no value and no part of the URL", async () => {
        await changeSecretEntry("channelView", 0, () => fieldsOf({
            headers: new Map([ [ "Authorization", "Bearer header-secret" ], [ "X-Extra", "x1" ] ])
        }));

        const view = await getSecretView("channelView");
        expect(view).toEqual({
            isSet: true, version: 1, label: "ntfy on the NAS",
            headers: [ "Authorization", "X-Extra" ], values: [ "token" ], hasSigningSecret: true,
            network: PUBLIC_ONLY,
            changedAt: "2026-01-01 10:00:00.000Z", templateHash: hashTemplate(undefined),
            isNetworkAllowed: true
        });
        for (const secret of [ "hooks.example", "unguessable", "header-secret", "value-secret",
            "signing-secret", "x1" ]) {
            expect(JSON.stringify(view)).not.toContain(secret);
        }

        config.Notifications.allowLocalNetworkWebhooks = false;
        expect(await getSecretView("channelNone")).toEqual({
            isSet: false, version: 0, headers: [], values: [], hasSigningSecret: false,
            network: PUBLIC_ONLY,
            templateHash: hashTemplate(undefined), isNetworkAllowed: false
        });
    });
});

describe("a change of the secret route", () => {
    it("checks every field of a PUT, and of a DELETE", () => {
        const long = "a".repeat(4097);
        const refusals: [ unknown, string ][] = [
            [ null, "invalid-input" ],
            [ [], "invalid-input" ],
            [ { expected: 0, extra: 1 }, "invalid-input" ],
            [ {}, "invalid-input" ],
            [ { expected: -1 }, "invalid-input" ],
            [ { expected: 1.5 }, "invalid-input" ],
            [ { expected: "1" }, "invalid-input" ],
            [ { expected: 0, url: 42 }, "invalid-input" ],
            [ { expected: 0, url: "ftp://hooks.example/" }, "invalid-input" ],
            [ { expected: 0, url: "https://user:pass@hooks.example/" }, "invalid-input" ],
            [ { expected: 0, url: "https://user@hooks.example/" }, "invalid-input" ],
            [ { expected: 0, url: "https://hooks.example/#token" }, "invalid-input" ],
            [ { expected: 0, url: "https://hooks.example/#" }, "invalid-input" ],
            [ { expected: 0, url: "https://hooks.example/a b" }, "invalid-input" ],
            [ { expected: 0, url: "https://hooks.example/\nx" }, "invalid-input" ],
            [ { expected: 0, url: "hooks.example/path" }, "invalid-input" ],
            [ { expected: 0, url: `https://hooks.example/${long}` }, "too-large" ],
            [ { expected: 0, headers: [] }, "invalid-input" ],
            [ { expected: 0, headers: { "Bad Name": "x" } }, "invalid-input" ],
            [ { expected: 0, headers: { "X-Header": 42 } }, "invalid-input" ],
            [ { expected: 0, headers: { "X-Header": "line\nbreak" } }, "invalid-input" ],
            [ { expected: 0, headers: { "X-Header": "nul\u{0}" } }, "invalid-input" ],
            [ { expected: 0, headers: { "X-Header": "wide \u{100}" } }, "invalid-input" ],
            [ { expected: 0, headers: { "X-Header": "a", "x-header": "b" } }, "invalid-input" ],
            [ { expected: 0, headers: { "X-Header": long } }, "too-large" ],
            [ { expected: 0, headers: manyOf(11, "X-H") }, "invalid-input" ],
            [ { expected: 0, values: { "my-token": "x" } }, "invalid-input" ],
            [ { expected: 0, values: { [ "a".repeat(65) ]: "x" } }, "invalid-input" ],
            [ { expected: 0, values: { token: 1 } }, "invalid-input" ],
            [ { expected: 0, values: { token: long } }, "too-large" ],
            [ { expected: 0, values: manyOf(11, "v") }, "invalid-input" ],
            [ { expected: 0, network: { ...PUBLIC_ONLY, allowPrivate: "yes" } }, "invalid-input" ],
            [ { expected: 0, network: { allowPrivate: true } }, "invalid-input" ],
            [ { expected: 0, network: { ...PUBLIC_ONLY, more: 1 } }, "invalid-input" ],
            [ { expected: 0, signingSecret: "" }, "invalid-input" ],
            [ { expected: 0, signingSecret: 42 }, "invalid-input" ],
            [ { expected: 0, signingSecret: long }, "too-large" ],
            [ { expected: 0, label: 42 }, "invalid-input" ],
            [ { expected: 0, label: "two\nlines" }, "invalid-input" ],
            [ { expected: 0, label: "a".repeat(1025) }, "too-large" ],
            [ { expected: 0, template: 42 }, "invalid-input" ],
            [ { expected: 0, template: "{ \"{{title}}\": 1 }" }, "invalid-template" ],
            [ { expected: 0, template: `"${"a".repeat(16 * 1024)}"` }, "too-large" ]
        ];
        for (const [ body, code ] of refusals) {
            expect(codeOf(() => parseSecretPut(body)), JSON.stringify(body)).toBe(code);
        }
        for (const name of [ "Host", "content-length", "Content-Type", "CONNECTION",
            "Transfer-Encoding", "Idempotency-Key", "X-Trilium-Timestamp", "x-trilium-signature",
            "Expect", "Upgrade", "TE", "Trailer", "Keep-Alive", "Proxy-Authorization" ]) {
            expect(codeOf(() => parseSecretPut({ expected: 0, headers: { [name]: "x" } })), name)
                .toBe("invalid-input");
        }
        for (const body of [ null, {}, { expected: 0, url: ADDRESS }, { expected: -1 } ]) {
            expect(codeOf(() => parseSecretDelete(body)), JSON.stringify(body))
                .toBe("invalid-input");
        }
        expect(parseSecretDelete({ expected: 4 })).toEqual({ expected: 4 });
    });

    it("parses a valid PUT, with the hash of its template instead of the text", () => {
        const template = "{ \"text\": \"{{title}}\", \"token\": \"{{secret.token}}\" }";

        expect(parseSecretPut({
            expected: 2, url: "https://Hooks.Example:443/path?q=1", label: "",
            headers: { "X-Api-Key": "key \t Latin-1 é", "X-Gone": null },
            values: { token: "t", user: null }, signingSecret: null,
            network: { allowPrivate: true, allowLoopback: true }, template
        })).toEqual({
            expected: 2,
            change: {
                url: "https://hooks.example/path?q=1",
                headers: new Map([ [ "X-Api-Key", "key \t Latin-1 é" ], [ "X-Gone", null ] ]),
                network: { allowPrivate: true, allowLoopback: true },
                signingSecret: null,
                values: new Map([ [ "token", "t" ], [ "user", null ] ]),
                label: "",
                templateHash: hashTemplate(template)
            }
        });
        expect(parseSecretPut({ expected: 0 })).toEqual({
            expected: 0,
            change: {
                url: undefined, headers: new Map(), network: undefined, signingSecret: undefined,
                values: new Map(), label: undefined, templateHash: undefined
            }
        });
    });

    it("takes a local network setting only where the host allows the local network", () => {
        config.Notifications.allowLocalNetworkWebhooks = false;

        for (const network of [
            { ...PUBLIC_ONLY, allowPrivate: true }, { ...PUBLIC_ONLY, allowLoopback: true }
        ]) {
            expect(codeOf(() => parseSecretPut({ expected: 0, network })), JSON.stringify(network))
                .toBe("invalid-input");
        }
        expect(parseSecretPut({ expected: 0, network: PUBLIC_ONLY }).change.network)
            .toEqual(PUBLIC_ONLY);
    });

    it("replaces the whole entry for a new URL, so no credential reaches the new address", () => {
        const current = entryOf({
            headers: new Map([ [ "Authorization", "old" ], [ "X-B", "b" ] ]),
            network: { allowPrivate: true, allowLoopback: false },
            templateHash: hashTemplate("{ \"a\": \"{{secret.token}}\" }")
        });

        const fields = applySecretPut(current, changeOf({ url: `${ADDRESS}-new` }));

        expect(fields).toEqual({
            url: `${ADDRESS}-new`, headers: new Map(), network: PUBLIC_ONLY,
            signingSecret: undefined, values: new Map(), label: undefined,
            configurationId: expect.any(String), changedAt: expect.any(String),
            templateHash: hashTemplate(undefined), documentId: options.getOption("documentId")
        });
        expect(fields.configurationId).not.toBe(current.configurationId);
        expect(fields.changedAt).not.toBe(current.changedAt);

        expect(applySecretPut(null, changeOf({
            url: ADDRESS, headers: new Map([ [ "X-New", "n" ], [ "X-Gone", null ] ]),
            values: new Map([ [ "token", "t" ], [ "user", null ] ]), signingSecret: "s",
            label: "Label", network: { allowPrivate: false, allowLoopback: true },
            templateHash: "hash"
        }))).toMatchObject({
            headers: new Map([ [ "X-New", "n" ] ]), values: new Map([ [ "token", "t" ] ]),
            signingSecret: "s", label: "Label",
            network: { allowPrivate: false, allowLoopback: true }, templateHash: "hash"
        });
    });

    it("changes only what a PUT without a URL carries, by name", () => {
        const current = entryOf({
            headers: new Map([ [ "Authorization", "old" ], [ "X-A", "a" ], [ "X-B", "b" ] ]),
            values: new Map([ [ "token", "t" ], [ "user", "u" ] ])
        });

        expect(applySecretPut(current, changeOf({
            headers: new Map([ [ "x-a", "replaced" ] ])
        }))).toEqual({
            ...current,
            headers: new Map([ [ "Authorization", "old" ], [ "X-B", "b" ], [ "x-a", "replaced" ] ])
        });
        expect(applySecretPut(current, changeOf({
            headers: new Map([ [ "X-B", null ], [ "X-Missing", null ] ]),
            values: new Map([ [ "token", null ], [ "user", "u2" ], [ "extra", "e" ] ]),
            signingSecret: null, label: "", network: { allowPrivate: true, allowLoopback: true },
            templateHash: "new-hash"
        }))).toEqual({
            ...current,
            headers: new Map([ [ "Authorization", "old" ], [ "X-A", "a" ] ]),
            values: new Map([ [ "user", "u2" ], [ "extra", "e" ] ]),
            signingSecret: undefined, label: undefined,
            network: { allowPrivate: true, allowLoopback: true }, templateHash: "new-hash"
        });
        expect(applySecretPut(current, changeOf({ signingSecret: "new", label: "New" })))
            .toMatchObject({ signingSecret: "new", label: "New", url: current.url });

        expect(codeOf(() => applySecretPut(null, changeOf({})))).toBe("not-found");
        expect(codeOf(() => applySecretPut(current, changeOf({
            headers: new Map(Object.entries(manyOf(9, "X-More")))
        })))).toBe("invalid-input");
        expect(codeOf(() => applySecretPut(current, changeOf({
            values: new Map(Object.entries(manyOf(9, "more")))
        })))).toBe("invalid-input");
    });
});

function fieldsOf(overrides: Partial<SecretEntryFields> = {}): SecretEntryFields {
    return {
        url: ADDRESS,
        headers: new Map([ [ "Authorization", "Bearer header-secret" ] ]),
        network: PUBLIC_ONLY,
        signingSecret: "signing-secret",
        values: new Map([ [ "token", "value-secret" ] ]),
        label: "ntfy on the NAS",
        configurationId: "configuration1",
        changedAt: "2026-01-01 10:00:00.000Z",
        templateHash: hashTemplate(undefined),
        documentId: options.getOption("documentId"),
        ...overrides
    };
}

function entryOf(overrides: Partial<NotificationSecretEntry> = {}): NotificationSecretEntry {
    return { ...fieldsOf(), version: 4, ...overrides };
}

function changeOf(overrides: Partial<SecretChange>): SecretChange {
    return { headers: new Map(), values: new Map(), ...overrides };
}

/** An object of `count` names that start with `prefix`. */
function manyOf(count: number, prefix: string) {
    return Object.fromEntries(Array.from({ length: count }, (_, index) => [
        `${prefix}${index}`, "x"
    ]));
}

function setAsideFiles() {
    return fs.readdirSync(dataDir.TRILIUM_DATA_DIR)
        .filter((name) => name.startsWith("notification-channel-secrets.set-aside-"));
}

function codeOf(run: () => unknown) {
    try {
        run();
    } catch (e) {
        expect(e).toBeInstanceOf(NotificationError);
        return (e as NotificationError).code;
    }
    throw new Error("expected a refusal");
}
