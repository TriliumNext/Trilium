/**
 * @module
 *
 * The secrets of the webhook channels: the URL, the headers, the signing secret and the secret
 * values of each, kept in `notification-channel-secrets.json` in the data directory and never in
 * the database. Every change goes through one queue that writes the whole file, and the entries
 * are kept in memory after the first read and after each write.
 */
import {
    type NotificationChannelSecretView,
    type NotificationWebhookNetwork,
    WEBHOOK_MAX_HEADERS,
    WEBHOOK_MAX_VALUES,
    WEBHOOK_SECRET_MAX_BYTES
} from "@triliumnext/commons";
import {
    date_utils as dateUtils,
    getLog,
    options as optionService,
    utils
} from "@triliumnext/core";
import {
    checkTemplate,
    hashTemplate
} from "@triliumnext/core/src/services/notifications/channels/body_template.js";
import {
    notifyAddressChanged,
    registerChannelTypeLoader
} from "@triliumnext/core/src/services/notifications/channels/registry.js";
import { NotificationError } from "@triliumnext/core/src/services/notifications/model.js";
import fs from "fs";
import path from "path";

import config from "../config.js";
import dataDir from "../data_dir.js";
import {
    getErrorCode,
    readFileIfExists,
    syncFolder,
    writeFileAtomically
} from "./delivery_record_file.js";

const SECRETS_FILE_NAME = "notification-channel-secrets.json";
const PUBLIC_ONLY: NotificationWebhookNetwork = { allowPrivate: false, allowLoopback: false };
/** The name of a secret value, the `<name>` of `{{secret.<name>}}` in a body template. */
const VALUE_NAME = /^[A-Za-z0-9_]{1,64}$/;
/** The characters of a header name: an HTTP token. */
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** The bytes of a header value: no control characters, and nothing beyond Latin-1. */
const HEADER_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/;
const CONTROL_CHARACTER = /[\x00-\x1f\x7f]/;
/** The headers that the webhook sets itself, and transport headers that no user sets. */
const RESERVED_HEADERS = new Set([
    "host", "content-length", "content-type", "connection", "transfer-encoding",
    "idempotency-key", "x-trilium-timestamp", "x-trilium-signature", "expect", "upgrade", "te",
    "trailer", "keep-alive"
]);
const LABEL_MAX_BYTES = 1024;
const PUT_FIELDS = new Set([
    "url", "headers", "network", "signingSecret", "values", "label", "template", "expected"
]);

/** The entry of a channel in the secrets file. */
export interface NotificationSecretEntry {
    url: string;
    /** By name as entered; two names that differ in case only are one header. */
    headers: Map<string, string>;
    network: NotificationWebhookNetwork;
    signingSecret?: string;
    values: Map<string, string>;
    /** The name that the user gave the address. */
    label?: string;
    /** A new random ID at every change of the URL. */
    configurationId: string;
    /** When the URL was last changed. */
    changedAt: string;
    /** The SHA-256 of the template that the credentials were entered for, in hex. */
    templateHash: string;
    /** The `documentId` of the database that the entry was entered for. */
    documentId: string;
    /** One higher at every change of the entry. */
    version: number;
}

export type SecretEntryFields = Omit<NotificationSecretEntry, "version">;

/** A checked `PUT` of the secret route. `null` removes a header or a value. */
export interface SecretChange {
    url?: string;
    headers: Map<string, string | null>;
    network?: NotificationWebhookNetwork;
    signingSecret?: string | null;
    values: Map<string, string | null>;
    label?: string;
    templateHash?: string;
}

interface SecretsFile {
    entries: Map<string, NotificationSecretEntry>;
    /** The last version of each channel whose entry was removed, so that no version repeats. */
    removedVersions: Map<string, number>;
}

/** The file as JSON: arrays of pairs, so that no name becomes a key of an object. */
interface StoredSecrets {
    entries: StoredEntry[];
    removed: { channelId: string; version: number }[];
}

interface StoredEntry extends Omit<NotificationSecretEntry, "headers" | "values"> {
    channelId: string;
    headers: [ string, string ][];
    values: [ string, string ][];
}

let secrets: SecretsFile | null = null;
let queue: Promise<unknown> = Promise.resolve();

/**
 * Registers the webhook type through a loader, so that its module loads when the channels start,
 * once the secrets file is in memory.
 */
export function registerWebhookChannelType() {
    registerChannelTypeLoader(async () => {
        try {
            await loadNotificationSecrets();
        } catch {
            getLog().error(`${SECRETS_FILE_NAME} cannot be read, so no webhook has an address.`);
        }
        const { webhookChannelType } = await import("./webhook.js");
        return [ webhookChannelType ];
    });
}

/**
 * Reads the secrets file into memory, unless it is there already.
 *
 * @throws when the file exists and cannot be read.
 */
export async function loadNotificationSecrets(): Promise<void> {
    await loadSecrets();
}

/**
 * The entry of a channel, from memory: `null` when none is set, when the file is not read yet,
 * or when the entry was entered for the database of another document.
 */
export function getSecretEntry(channelId: string): NotificationSecretEntry | null {
    return getOwnEntry(secrets?.entries.get(channelId));
}

/**
 * What the secret route shows of a channel's entry: names, never a value or part of the URL.
 *
 * @throws when the file exists and cannot be read.
 */
export async function getSecretView(channelId: string): Promise<NotificationChannelSecretView> {
    const file = await loadSecrets();
    const entry = getOwnEntry(file.entries.get(channelId));
    const common = { version: getVersion(file, channelId), isNetworkAllowed: isNetworkAllowed() };
    if (!entry) {
        return {
            ...common, isSet: false, headers: [], values: [], hasSigningSecret: false,
            network: PUBLIC_ONLY, templateHash: hashTemplate(undefined)
        };
    }
    return {
        ...common,
        isSet: true,
        label: entry.label,
        headers: [ ...entry.headers.keys() ],
        values: [ ...entry.values.keys() ],
        hasSigningSecret: entry.signingSecret !== undefined,
        network: entry.network,
        changedAt: entry.changedAt,
        templateHash: entry.templateHash
    };
}

/**
 * Checks the body of a `PUT` of the secret route.
 *
 * @throws NotificationError `invalid-input`, `too-large` or `invalid-template`.
 */
export function parseSecretPut(body: unknown): { expected: number; change: SecretChange } {
    if (!isPlainObject(body) || Object.keys(body).some((field) => !PUT_FIELDS.has(field))) {
        throw new NotificationError("invalid-input");
    }
    return {
        expected: parseExpected(body.expected),
        change: {
            url: parseUrl(body.url),
            headers: parseHeaders(body.headers),
            network: parseNetwork(body.network),
            signingSecret: parseSigningSecret(body.signingSecret),
            values: parseValues(body.values),
            label: parseLabel(body.label),
            templateHash: parseTemplateHash(body.template)
        }
    };
}

/**
 * Checks the body of a `DELETE` of the secret route.
 *
 * @throws NotificationError `invalid-input`.
 */
export function parseSecretDelete(body: unknown): { expected: number } {
    if (!isPlainObject(body) || Object.keys(body).some((field) => field !== "expected")) {
        throw new NotificationError("invalid-input");
    }
    return { expected: parseExpected(body.expected) };
}

/**
 * The fields of an entry after a `PUT`. With a URL the change replaces the whole entry, so that
 * nothing entered for one address is sent to another; without a URL, it changes the fields that
 * it includes.
 *
 * @throws NotificationError `not-found` without a URL where no entry is set, and `invalid-input`
 *         for more than ten headers or ten values.
 */
export function applySecretPut(
    current: NotificationSecretEntry | null,
    change: SecretChange
): SecretEntryFields {
    if (change.url !== undefined) {
        return {
            url: change.url,
            headers: withoutRemovals(change.headers),
            network: change.network ?? PUBLIC_ONLY,
            signingSecret: change.signingSecret ?? undefined,
            values: withoutRemovals(change.values),
            label: change.label || undefined,
            configurationId: utils.randomString(16),
            changedAt: dateUtils.utcNowDateTime(),
            templateHash: change.templateHash ?? hashTemplate(undefined),
            documentId: optionService.getOption("documentId")
        };
    }
    if (!current) {
        throw new NotificationError("not-found");
    }

    const headers = new Map(current.headers);
    for (const [ name, value ] of change.headers) {
        for (const existing of headers.keys()) {
            if (existing.toLowerCase() === name.toLowerCase()) {
                headers.delete(existing);
            }
        }
        if (value !== null) {
            headers.set(name, value);
        }
    }
    const values = new Map(current.values);
    for (const [ name, value ] of change.values) {
        if (value === null) {
            values.delete(name);
        } else {
            values.set(name, value);
        }
    }
    if (headers.size > WEBHOOK_MAX_HEADERS || values.size > WEBHOOK_MAX_VALUES) {
        throw new NotificationError("invalid-input");
    }

    return {
        ...current,
        headers,
        values,
        network: change.network ?? current.network,
        signingSecret: change.signingSecret === undefined
            ? current.signingSecret
            : change.signingSecret ?? undefined,
        label: change.label === undefined ? current.label : change.label || undefined,
        templateHash: change.templateHash ?? current.templateHash
    };
}

/**
 * Changes the entry of a channel through the queue when `expected` is its version, 0 for none:
 * writes the fields that `change` returns, or removes the entry for `null`. Settles after the
 * rename, with the file in memory and the listeners of address changes notified.
 *
 * @param change receives the entry of the open database, or `null`.
 * @throws NotificationError `stale-revision` for another version, and `not-found` for a removal
 *         where no entry is set.
 */
export async function changeSecretEntry(
    channelId: string,
    expected: number,
    change: (current: NotificationSecretEntry | null) => SecretEntryFields | null
): Promise<NotificationSecretEntry | null> {
    const entry = await enqueue(async () => {
        const file = await readSecretsFile();
        const version = getVersion(file, channelId);
        if (expected !== version) {
            throw new NotificationError("stale-revision");
        }

        const stored = file.entries.get(channelId);
        const fields = change(getOwnEntry(stored));
        if (fields) {
            file.entries.set(channelId, { ...fields, version: version + 1 });
            file.removedVersions.delete(channelId);
        } else if (stored) {
            file.entries.delete(channelId);
            file.removedVersions.set(channelId, version + 1);
        } else {
            throw new NotificationError("not-found");
        }

        await writeFileAtomically(getSecretsFilePath(), serializeSecrets(file));
        secrets = file;
        return file.entries.get(channelId) ?? null;
    });
    notifyChannels([ channelId ]);
    return entry;
}

/**
 * Renames the secrets file, for a restore of the database, to a name that is never read again,
 * and notifies the listeners of address changes for its channels. Runs after a write in progress.
 */
export async function setSecretsAside(): Promise<void> {
    const channelIds = await enqueue(async () => {
        const filePath = getSecretsFilePath();
        if (!fs.existsSync(filePath)) {
            secrets = emptySecrets();
            return [];
        }

        const file = await readSecretsFile().catch(() => emptySecrets());
        const asidePath = path.join(path.dirname(filePath),
            `notification-channel-secrets.set-aside-${Date.now()}.json`);
        try {
            await fs.promises.rename(filePath, asidePath);
        } catch (e) {
            throw new Error(`${SECRETS_FILE_NAME} cannot be set aside: ${getErrorCode(e)}`);
        }
        await syncFolder(path.dirname(filePath));
        secrets = emptySecrets();
        return [ ...file.entries.keys() ];
    });
    notifyChannels(channelIds);
}

/** Whether the host lets a webhook reach the local network. */
export function isNetworkAllowed() {
    return config.Notifications.allowLocalNetworkWebhooks;
}

/** The file in memory, read through the queue the first time. */
function loadSecrets(): Promise<SecretsFile> {
    return enqueue(async () => (secrets ??= await readSecretsFile()));
}

/** Runs the steps one at a time. A step that fails does not stop the next. */
function enqueue<T>(step: () => Promise<T>): Promise<T> {
    const result = queue.then(step);
    queue = result.catch(() => undefined);
    return result;
}

/** Notifies the listeners of address changes. A listener that throws does not undo the change. */
function notifyChannels(channelIds: string[]) {
    for (const channelId of channelIds) {
        try {
            notifyAddressChanged(channelId);
        } catch {
            getLog().error("A listener of an address change of a notification channel failed.");
        }
    }
}

function getSecretsFilePath() {
    return path.join(dataDir.TRILIUM_DATA_DIR, SECRETS_FILE_NAME);
}

/** An entry entered for the open database, or `null`. */
function getOwnEntry(entry: NotificationSecretEntry | undefined) {
    return entry && entry.documentId === optionService.getOptionOrNull("documentId")
        ? entry
        : null;
}

/** The version that a change names: the entry's, the last of a removed one, or 0. */
function getVersion(file: SecretsFile, channelId: string) {
    return file.entries.get(channelId)?.version ?? file.removedVersions.get(channelId) ?? 0;
}

async function readSecretsFile(): Promise<SecretsFile> {
    const text = await readFileIfExists(getSecretsFilePath());
    return text === null ? emptySecrets() : parseSecretsFile(text);
}

function emptySecrets(): SecretsFile {
    return { entries: new Map(), removedVersions: new Map() };
}

/** Parses the file. No error includes its text, which contains the secrets. */
function parseSecretsFile(text: string): SecretsFile {
    let stored: unknown;
    try {
        stored = JSON.parse(text);
    } catch {
        stored = null;
    }
    if (!isStoredSecrets(stored)) {
        throw new Error(`${SECRETS_FILE_NAME} cannot be read: invalid`);
    }

    return {
        entries: new Map(stored.entries.map((entry) => [ entry.channelId, {
            url: entry.url,
            headers: new Map(entry.headers),
            network: {
                allowPrivate: entry.network.allowPrivate,
                allowLoopback: entry.network.allowLoopback
            },
            signingSecret: entry.signingSecret,
            values: new Map(entry.values),
            label: entry.label,
            configurationId: entry.configurationId,
            changedAt: entry.changedAt,
            templateHash: entry.templateHash,
            documentId: entry.documentId,
            version: entry.version
        } ])),
        removedVersions: new Map(stored.removed.map(({ channelId, version }) => [
            channelId, version
        ]))
    };
}

function serializeSecrets(file: SecretsFile) {
    const stored: StoredSecrets = {
        entries: [ ...file.entries ].map(([ channelId, entry ]) => ({
            ...entry, channelId, headers: [ ...entry.headers ], values: [ ...entry.values ]
        })),
        removed: [ ...file.removedVersions ].map(([ channelId, version ]) => ({
            channelId, version
        }))
    };
    return JSON.stringify(stored, null, 2);
}

function isStoredSecrets(value: unknown): value is StoredSecrets {
    const stored = value as Partial<StoredSecrets> | null;
    return isPlainObject(stored)
        && Array.isArray(stored.entries) && stored.entries.every(isStoredEntry)
        && Array.isArray(stored.removed) && stored.removed.every((removal: unknown) => {
            const { channelId, version } = removal as Partial<StoredSecrets["removed"][number]>;
            return typeof channelId === "string" && Number.isSafeInteger(version);
        });
}

function isStoredEntry(value: unknown): value is StoredEntry {
    const entry = value as Partial<StoredEntry>;
    return isPlainObject(entry)
        && typeof entry.channelId === "string" && typeof entry.url === "string"
        && isPairs(entry.headers) && isNetwork(entry.network)
        && isOptionalString(entry.signingSecret) && isPairs(entry.values)
        && isOptionalString(entry.label) && typeof entry.configurationId === "string"
        && typeof entry.changedAt === "string" && typeof entry.templateHash === "string"
        && typeof entry.documentId === "string" && Number.isSafeInteger(entry.version);
}

function isPairs(value: unknown): value is [ string, string ][] {
    return Array.isArray(value) && value.every((pair) => Array.isArray(pair)
        && pair.length === 2 && typeof pair[0] === "string" && typeof pair[1] === "string");
}

function isNetwork(value: unknown): value is NotificationWebhookNetwork {
    const network = value as Partial<NotificationWebhookNetwork>;
    return isPlainObject(network) && Object.keys(network).length === 2
        && typeof network.allowPrivate === "boolean" && typeof network.allowLoopback === "boolean";
}

function isOptionalString(value: unknown) {
    return value === undefined || typeof value === "string";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseExpected(value: unknown): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new NotificationError("invalid-input");
    }
    return value as number;
}

/** An `https` or `http` URL without a fragment or credentials, as `URL` writes it. */
function parseUrl(value: unknown): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    const text = parseText(value, WEBHOOK_SECRET_MAX_BYTES);
    if (/[\x00-\x20\x7f]/.test(text) || text.includes("#") || !URL.canParse(text)) {
        throw new NotificationError("invalid-input");
    }
    const url = new URL(text);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
        throw new NotificationError("invalid-input");
    }
    return url.href;
}

/** At most ten headers by name, HTTP tokens that the webhook does not set itself. */
function parseHeaders(value: unknown): Map<string, string | null> {
    const headers = new Map<string, string | null>();
    for (const [ name, text ] of parsePairs(value, WEBHOOK_MAX_HEADERS)) {
        const lowerName = name.toLowerCase();
        if (!HEADER_NAME.test(name) || RESERVED_HEADERS.has(lowerName)
            || lowerName.startsWith("proxy-")
            || [ ...headers.keys() ].some((other) => other.toLowerCase() === lowerName)) {
            throw new NotificationError("invalid-input");
        }
        if (text !== null) {
            parseText(text, WEBHOOK_SECRET_MAX_BYTES - name.length);
            if (!HEADER_VALUE.test(text)) {
                throw new NotificationError("invalid-input");
            }
        }
        headers.set(name, text);
    }
    return headers;
}

/** At most ten secret values by name. */
function parseValues(value: unknown): Map<string, string | null> {
    const values = new Map<string, string | null>();
    for (const [ name, text ] of parsePairs(value, WEBHOOK_MAX_VALUES)) {
        if (!VALUE_NAME.test(name)) {
            throw new NotificationError("invalid-input");
        }
        if (text !== null) {
            parseText(text, WEBHOOK_SECRET_MAX_BYTES);
        }
        values.set(name, text);
    }
    return values;
}

/** The pairs of an object whose values are strings or `null`, at most `max`. */
function parsePairs(value: unknown, max: number): [ string, string | null ][] {
    if (value === undefined) {
        return [];
    }
    if (!isPlainObject(value)) {
        throw new NotificationError("invalid-input");
    }
    const pairs = Object.entries(value);
    const isEachNullOrText = pairs.every(([ , text ]) => text === null || typeof text === "string");
    if (pairs.length > max || !isEachNullOrText) {
        throw new NotificationError("invalid-input");
    }
    return pairs as [ string, string | null ][];
}

/** A network setting. With the host's switch off, only public addresses. */
function parseNetwork(value: unknown): NotificationWebhookNetwork | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!isNetwork(value) || (!isNetworkAllowed() && (value.allowPrivate || value.allowLoopback))) {
        throw new NotificationError("invalid-input");
    }
    return { allowPrivate: value.allowPrivate, allowLoopback: value.allowLoopback };
}

/** A signing secret to set, `null` to remove it, or `undefined` to keep it. */
function parseSigningSecret(value: unknown): string | null | undefined {
    if (value === undefined || value === null) {
        return value;
    }
    const text = parseText(value, WEBHOOK_SECRET_MAX_BYTES);
    if (!text) {
        throw new NotificationError("invalid-input");
    }
    return text;
}

/** A label to set, `""` to remove it, or `undefined` to keep it. */
function parseLabel(value: unknown): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    const text = parseText(value, LABEL_MAX_BYTES);
    if (CONTROL_CHARACTER.test(text)) {
        throw new NotificationError("invalid-input");
    }
    return text;
}

/** The hash of the template that the credentials go with; the text is never stored. */
function parseTemplateHash(value: unknown): string | undefined {
    return value === undefined ? undefined : hashTemplate(checkTemplate(value));
}

/** A string of at most `maxBytes` of UTF-8. */
function parseText(value: unknown, maxBytes: number): string {
    if (typeof value !== "string") {
        throw new NotificationError("invalid-input");
    }
    if (Buffer.byteLength(value, "utf-8") > maxBytes) {
        throw new NotificationError("too-large");
    }
    return value;
}

/** The pairs that set a value, without those that remove one. */
function withoutRemovals(pairs: Map<string, string | null>): Map<string, string> {
    return new Map([ ...pairs ].filter((pair): pair is [ string, string ] => pair[1] !== null));
}
