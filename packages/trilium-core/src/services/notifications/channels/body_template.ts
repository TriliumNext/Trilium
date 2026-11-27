/**
 * @module
 *
 * The body template of a webhook: JSON whose string values contain placeholders, `{{title}}` and
 * the other fields of the payload, and `{{secret.<name>}}` for a secret value of the secrets
 * file. A send fills them in and writes the body with `JSON.stringify()`.
 */
import {
    NOTIFICATION_TEMPLATE_FIELDS,
    type NotificationChannelPayload,
    type NotificationTemplateField,
    WEBHOOK_TEMPLATE_MAX_BYTES
} from "@triliumnext/commons";

import { getCrypto } from "../../encryption/crypto.js";
import { encodeUtf8 } from "../../utils/binary.js";
import { NotificationError } from "../model.js";
import { ChannelSendError } from "./types.js";

/** `{{…}}`: a placeholder when its name is a field or `secret.<name>`. */
const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;
/** The name of a secret value: ASCII letters, digits and `_`, at most 64. */
const SECRET_PLACEHOLDER = /^secret\.([A-Za-z0-9_]{1,64})$/;
const FIELDS: ReadonlySet<string> = new Set(NOTIFICATION_TEMPLATE_FIELDS);
/** The deepest nesting of objects and arrays that a template can have. */
const MAX_DEPTH = 32;

/**
 * Checks the body template of a create or an edit of a channel. An empty string means the
 * default body.
 *
 * @returns the template, unchanged.
 * @throws NotificationError `invalid-input` for a value that is not a string, `too-large` over
 *         16 KiB of UTF-8, `invalid-template` for one that is not JSON, nests too deep, or has a
 *         `{{…}}` that is not a placeholder inside a string value.
 */
export function checkTemplate(template: unknown): string {
    if (typeof template !== "string") {
        throw new NotificationError("invalid-input");
    }
    parseTemplate(template);
    return template;
}

/**
 * The names of the secret values that a template refers to, each once.
 *
 * @throws NotificationError for a template that `checkTemplate()` refuses.
 */
export function getTemplateSecretNames(template: string): string[] {
    const names = new Set<string>();
    mapJson(parseTemplate(template), (text) => {
        for (const [ , name ] of text.matchAll(PLACEHOLDER)) {
            const secretName = SECRET_PLACEHOLDER.exec(name)?.[1];
            if (secretName !== undefined) {
                names.add(secretName);
            }
        }
        return text;
    });
    return [ ...names ];
}

/**
 * Builds the body of a send: the payload as JSON without a template, or the template with the
 * placeholders of each string value replaced in one pass, so a value is never searched for
 * placeholders. A field that the payload lacks becomes an empty string.
 *
 * @throws ChannelSendError `secret` when the template names a secret value that is not set, and
 *         `policy` for a template that `checkTemplate()` refuses.
 */
export function fillTemplate(
    template: string | undefined,
    payload: NotificationChannelPayload,
    secrets: ReadonlyMap<string, string>
): string {
    if (!template) {
        return JSON.stringify(payload);
    }

    let parsed: unknown;
    try {
        parsed = parseTemplate(template);
    } catch {
        throw new ChannelSendError("policy");
    }
    return JSON.stringify(mapJson(parsed, (text, isKey) => (isKey ? text : text.replace(
        PLACEHOLDER, (_placeholder, name: string) => resolvePlaceholder(name, payload, secrets)))));
}

/** The SHA-256 of a template in hex, of the empty string for none. */
export function hashTemplate(template: string | undefined): string {
    const digest = getCrypto().createHash("sha256", encodeUtf8(template ?? ""));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Parses a template and checks that every `{{…}}` is a placeholder inside a string value.
 *
 * @returns the parsed JSON, `undefined` for an empty template.
 */
function parseTemplate(template: string): unknown {
    if (encodeUtf8(template).length > WEBHOOK_TEMPLATE_MAX_BYTES) {
        throw new NotificationError("too-large");
    }
    if (template === "") {
        return undefined;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(template);
    } catch {
        throw new NotificationError("invalid-template");
    }
    mapJson(parsed, (text, isKey) => {
        for (const [ , name ] of text.matchAll(PLACEHOLDER)) {
            if (isKey || !(FIELDS.has(name) || SECRET_PLACEHOLDER.test(name))) {
                throw new NotificationError("invalid-template");
            }
        }
        return text;
    });
    return parsed;
}

/**
 * Copies a JSON value with each key and each string value passed through `map`. An object is
 * built with `Object.fromEntries()`, so a `__proto__` key stays an own property.
 */
function mapJson(
    value: unknown,
    map: (text: string, isKey: boolean) => string,
    depth = 0
): unknown {
    if (depth > MAX_DEPTH) {
        throw new NotificationError("invalid-template");
    }
    if (typeof value === "string") {
        return map(value, false);
    }
    if (Array.isArray(value)) {
        return value.map((item) => mapJson(item, map, depth + 1));
    }
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([ key, item ]) => [
            map(key, true), mapJson(item, map, depth + 1)
        ]));
    }
    return value;
}

function resolvePlaceholder(
    name: string,
    payload: NotificationChannelPayload,
    secrets: ReadonlyMap<string, string>
) {
    const secretName = SECRET_PLACEHOLDER.exec(name)?.[1];
    if (secretName === undefined) {
        return payload[name as NotificationTemplateField] ?? "";
    }

    const secret = secrets.get(secretName);
    if (secret === undefined) {
        throw new ChannelSendError("secret");
    }
    return secret;
}
