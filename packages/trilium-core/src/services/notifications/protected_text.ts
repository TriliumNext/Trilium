/**
 * @module
 *
 * The private text of notifications: the keys derived from the data key of the protected session,
 * the seal of each field, and `openPrivateText()`. No key is stored or kept beyond a call.
 */
import type { NotificationPrivateContent } from "@triliumnext/commons";

import { getCrypto } from "../encryption/crypto.js";
import { getDataKey } from "../protected_session.js";
import { decodeBase64, decodeUtf8, encodeBase64, encodeUtf8 } from "../utils/binary.js";
import { parsePrivateContent, type PrivateText } from "./model.js";

export const NOTIFICATION_KEY_LABEL = "trilium:notification-key:v1";
export const NOTIFICATION_MAC_LABEL = "trilium:notification-mac:v1";

const KEY_LENGTH = 16;
const IV_LENGTH = 16;
const BLOCK_LENGTH = 16;
const TAG_LENGTH = 16;

export const PRIVATE_TEXT_FIELDS = [ "title", "description" ] as const;

export type PrivateTextField = typeof PRIVATE_TEXT_FIELDS[number];

/** The key that seals the text and the key of its tag. */
export interface NotificationKeys {
    encryptionKey: Uint8Array;
    macKey: Uint8Array;
}

/** A field of a stored private text that opened: its sealed form and its text. */
export interface OpenedField {
    sealed: string;
    text: string;
}

export type OpenedPrivateText = Partial<Record<PrivateTextField, OpenedField>>;

/** Bytes 0 to 15 of HMAC-SHA256 keyed with all bytes of `secret`, over the UTF-8 of `label`. */
export function deriveKey(secret: Uint8Array, label: string): Uint8Array {
    return decodeBase64(getCrypto().hmac(secret, encodeUtf8(label))).slice(0, KEY_LENGTH);
}

/** The keys of the private text, derived from the data key of the protected session, or `null`. */
export function getNotificationKeys(): NotificationKeys | null {
    const dataKey = getDataKey();
    if (!dataKey) {
        return null;
    }

    return {
        encryptionKey: deriveKey(dataKey, NOTIFICATION_KEY_LABEL),
        macKey: deriveKey(dataKey, NOTIFICATION_MAC_LABEL)
    };
}

/** Seals a field: the IV, the AES-128-CBC ciphertext and the tag, in base64. */
export function sealField(
    keys: NotificationKeys,
    notificationId: string,
    field: PrivateTextField,
    text: string
): string {
    const crypto = getCrypto();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv("aes-128-cbc", keys.encryptionKey, iv);
    const ciphertext = concatBytes(cipher.update(encodeUtf8(text)), cipher.final());
    const tag = computeTag(keys.macKey, notificationId, field, iv, ciphertext);
    return encodeBase64(concatBytes(iv, ciphertext, tag));
}

/**
 * Opens a sealed field. The tag is checked before anything is decrypted.
 *
 * @returns the text, or `null` for a value that the keys did not seal for this notification and
 *          field. It never throws.
 */
export function openField(
    keys: NotificationKeys,
    notificationId: string,
    field: PrivateTextField,
    sealed: string
): string | null {
    try {
        const bytes = decodeBase64(sealed);
        const ciphertextLength = bytes.length - IV_LENGTH - TAG_LENGTH;
        if (ciphertextLength < BLOCK_LENGTH || ciphertextLength % BLOCK_LENGTH !== 0) {
            return null;
        }

        const iv = bytes.slice(0, IV_LENGTH);
        const ciphertext = bytes.slice(IV_LENGTH, IV_LENGTH + ciphertextLength);
        const tag = bytes.slice(IV_LENGTH + ciphertextLength);
        const crypto = getCrypto();
        if (!crypto.constantTimeCompare(tag,
            computeTag(keys.macKey, notificationId, field, iv, ciphertext))) {
            return null;
        }

        const decipher = crypto.createDecipheriv("aes-128-cbc", keys.encryptionKey, iv);
        return decodeUtf8(concatBytes(decipher.update(ciphertext), decipher.final()));
    } catch {
        return null;
    }
}

/** The `content` of a private text, each field sealed. An empty field is left out. */
export function sealPrivateText(
    keys: NotificationKeys,
    notificationId: string,
    text: PrivateText
): string {
    const content: NotificationPrivateContent = { v: 1 };
    for (const field of PRIVATE_TEXT_FIELDS) {
        const value = text[field];
        if (value) {
            content[field] = sealField(keys, notificationId, field, value);
        }
    }
    return JSON.stringify(content);
}

/**
 * The fields of a stored private text that open under the keys. A field that does not open counts
 * as absent. It never throws.
 */
export function openPrivateText(
    keys: NotificationKeys,
    notificationId: string,
    content: string
): OpenedPrivateText {
    const parsed = parsePrivateContent(content);
    const opened: OpenedPrivateText = {};
    for (const field of PRIVATE_TEXT_FIELDS) {
        const sealed = parsed?.[field];
        const text = sealed === undefined ? null : openField(keys, notificationId, field, sealed);
        if (sealed !== undefined && text !== null) {
            opened[field] = { sealed, text };
        }
    }
    return opened;
}

/**
 * The first 16 bytes of HMAC-SHA256 under the MAC key, over the notification ID, the field, the IV
 * and the ciphertext, each preceded by its length in four bytes, big-endian.
 */
function computeTag(
    macKey: Uint8Array,
    notificationId: string,
    field: PrivateTextField,
    iv: Uint8Array,
    ciphertext: Uint8Array
) {
    const message = concatBytes(...[ encodeUtf8(notificationId), encodeUtf8(field), iv, ciphertext ]
        .flatMap((part) => [ encodeLength(part.length), part ]));
    return decodeBase64(getCrypto().hmac(macKey, message)).slice(0, TAG_LENGTH);
}

function encodeLength(length: number) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, length);
    return bytes;
}

function concatBytes(...parts: Uint8Array[]) {
    const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
    }
    return bytes;
}
