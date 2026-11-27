import { afterEach, describe, expect, it, vi } from "vitest";

import * as cls from "../context.js";
import { getCrypto } from "../encryption/crypto.js";
import optionService from "../options.js";
import protectedSessionService from "../protected_session.js";
import { decodeBase64, encodeBase64, encodeUtf8 } from "../utils/binary.js";
import { checkPrivateTextRow, formatUtcDateTime, parsePrivateContent } from "./model.js";
import {
    deriveKey,
    getNotificationKeys,
    NOTIFICATION_KEY_LABEL,
    NOTIFICATION_MAC_LABEL,
    type NotificationKeys,
    openField,
    openPrivateText,
    sealField,
    sealPrivateText
} from "./protected_text.js";

const KEY_16 = Uint8Array.from({ length: 16 }, (_, index) => index);
/** A data key as `setPassword()` made it before 2026-04-12: the base64 text of 16 bytes. */
const KEY_24 = encodeUtf8("AAECAwQFBgcICQoLDA0ODw==");
const NOTIFICATION_ID = "abcdefghijkl0000000aa";
const OTHER_NOTIFICATION_ID = "abcdefghijkl0000000ab";

function keysOf(dataKey: Uint8Array): NotificationKeys {
    return {
        encryptionKey: deriveKey(dataKey, NOTIFICATION_KEY_LABEL),
        macKey: deriveKey(dataKey, NOTIFICATION_MAC_LABEL)
    };
}

function toHex(bytes: Uint8Array) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

afterEach(() => {
    protectedSessionService.resetDataKey();
    vi.restoreAllMocks();
});

describe("deriveKey", () => {
    it("gives the known keys for a data key of 16 bytes and for one of 24", () => {
        // Computed with node:crypto, so that both providers are held to the same answer.
        expect(toHex(deriveKey(KEY_16, NOTIFICATION_KEY_LABEL)))
            .toBe("fb40fb0f43fb10621996634e62126c02");
        expect(toHex(deriveKey(KEY_16, NOTIFICATION_MAC_LABEL)))
            .toBe("54bacb19502f4c3fdf7f6b96a30fbc43");
        expect(toHex(deriveKey(KEY_24, NOTIFICATION_KEY_LABEL)))
            .toBe("d7801d14dc35027bdca0a0787268a219");
        expect(toHex(deriveKey(KEY_24, NOTIFICATION_MAC_LABEL)))
            .toBe("47f6d03a7581def35a0f94ffff95e1df");
    });

    it("derives the keys from the data key of the protected session only", () => {
        expect(getNotificationKeys()).toBeNull();

        protectedSessionService.setDataKey(KEY_24);
        const keys = getNotificationKeys();
        expect(keys && toHex(keys.encryptionKey)).toBe("d7801d14dc35027bdca0a0787268a219");
        expect(keys && toHex(keys.macKey)).toBe("47f6d03a7581def35a0f94ffff95e1df");

        protectedSessionService.resetDataKey();
        expect(getNotificationKeys()).toBeNull();
    });
});

describe("the seal of a private text", () => {
    it("writes the IV, the ciphertext and the tag in the known form", () => {
        vi.spyOn(getCrypto(), "randomBytes")
            .mockReturnValue(Uint8Array.from({ length: 16 }, (_, index) => 16 + index));

        // Computed with node:crypto: AES-128-CBC, then HMAC-SHA256 over the length-prefixed parts.
        expect(sealField(keysOf(KEY_16), NOTIFICATION_ID, "title", "Secret title"))
            .toBe("EBESExQVFhcYGRobHB0eH9V15ealfUw+/Dy2WhK50QpNwwQI47//NnplcKw+QRds");
    });

    it("opens what it sealed, and nothing moved, damaged or sealed under another key", () => {
        const keys = keysOf(KEY_16);
        const text = "Ünïcode ✓ and a line\nbreak";
        const sealed = sealField(keys, NOTIFICATION_ID, "description", text);
        expect(openField(keys, NOTIFICATION_ID, "description", sealed)).toBe(text);

        const bytes = decodeBase64(sealed);
        const flipped = Uint8Array.from(bytes);
        flipped[20] ^= 1;
        for (const [ notificationId, field, value, dataKey ] of [
            [ OTHER_NOTIFICATION_ID, "description", sealed, KEY_16 ],
            [ NOTIFICATION_ID, "title", sealed, KEY_16 ],
            [ NOTIFICATION_ID, "description", sealed, KEY_24 ],
            [ NOTIFICATION_ID, "description", encodeBase64(flipped), KEY_16 ],
            [ NOTIFICATION_ID, "description", encodeBase64(bytes.slice(0, 40)), KEY_16 ],
            [ NOTIFICATION_ID, "description", encodeBase64(bytes.slice(0, bytes.length - 1)),
                KEY_16 ],
            [ NOTIFICATION_ID, "description", "not base64 at all", KEY_16 ],
            [ NOTIFICATION_ID, "description", "", KEY_16 ]
        ] as const) {
            expect(openField(keysOf(dataKey), notificationId, field, value)).toBeNull();
        }
    });

    it("opens the fields that open and leaves out the others, never throwing", () => {
        const keys = keysOf(KEY_16);
        const content = sealPrivateText(keys, NOTIFICATION_ID,
            { title: "Title", description: "Description" });
        const parsed = parsePrivateContent(content);
        expect(Object.keys(parsed ?? {}).sort()).toEqual([ "description", "title", "v" ]);
        expect(openPrivateText(keys, NOTIFICATION_ID, content)).toEqual({
            title: { sealed: parsed?.title, text: "Title" },
            description: { sealed: parsed?.description, text: "Description" }
        });

        // A title moved into the description opens as nothing.
        const moved = JSON.stringify({ v: 1, title: parsed?.title, description: parsed?.title });
        expect(openPrivateText(keys, NOTIFICATION_ID, moved))
            .toEqual({ title: { sealed: parsed?.title, text: "Title" } });
        expect(openPrivateText(keysOf(KEY_24), NOTIFICATION_ID, content)).toEqual({});
        expect(openPrivateText(keys, NOTIFICATION_ID, "{ not json")).toEqual({});
        expect(sealPrivateText(keys, NOTIFICATION_ID, { title: "", description: "" }))
            .toBe(JSON.stringify({ v: 1 }));
    });

    it("reads no key from an option, such as one a peer planted", () => {
        const planted = Uint8Array.from({ length: 20 }, (_, index) => 7 * index);
        cls.init(() => optionService.createOption("encryptedNotificationKey" as never,
            encodeBase64(planted), true));
        protectedSessionService.setDataKey(KEY_16);
        const keys = getNotificationKeys();
        const sealed = keys ? sealField(keys, NOTIFICATION_ID, "title", "Secret") : "";

        for (const key of [ planted.slice(0, 16), deriveKey(planted, NOTIFICATION_KEY_LABEL) ]) {
            expect(openField({ encryptionKey: key, macKey: key }, NOTIFICATION_ID, "title",
                sealed)).toBeNull();
        }
        expect(openField(keysOf(planted), NOTIFICATION_ID, "title", sealed)).toBeNull();
        expect(openField(keysOf(KEY_16), NOTIFICATION_ID, "title", sealed)).toBe("Secret");
    });

    it("keeps the largest private text within 11 KiB as stored", () => {
        // 16 and 8,141 bytes fill 8 KiB of plain JSON with the most padding and base64 overhead.
        const text = { title: "t".repeat(16), description: "d".repeat(8141) };
        expect(encodeUtf8(JSON.stringify({ v: 1, ...text })).byteLength).toBe(8192);

        const content = sealPrivateText(keysOf(KEY_16), NOTIFICATION_ID, text);
        const at = formatUtcDateTime(Date.UTC(2026, 10, 27));
        expect(content.length).toBe(11_027);
        expect(checkPrivateTextRow({
            notificationId: NOTIFICATION_ID, content, utcDateCreated: at, utcDateModified: at
        })).toBeNull();
    });
});
