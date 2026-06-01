import { cls, data_encryption } from "@triliumnext/core";
import { beforeAll, describe, expect, it, vi } from "vitest";

import sql_init from "../sql_init.js";
import totpEncryption from "./totp_encryption.js";

const SECRET = "JBSWY3DPEHPK3PXP";

describe("totp_encryption", () => {
    beforeAll(async () => {
        sql_init.initializeDb();
        await sql_init.dbReady;
    });

    it("throws when setting an empty secret", () => {
        cls.init(() => {
            expect(() => totpEncryption.setTotpSecret("")).toThrow();
        });
    });

    it("round-trips a secret and verifies it", () => {
        cls.init(() => {
            totpEncryption.setTotpSecret(SECRET);
        });

        expect(totpEncryption.isTotpSecretSet()).toBe(true);
        // getTotpSecret returns a non-null decrypted value whose bytes are the secret
        const stored = totpEncryption.getTotpSecret();
        expect(stored).not.toBeNull();
        const bytes = Uint8Array.from((stored as string).split(",").map(Number));
        expect(Buffer.from(bytes).toString("utf-8")).toBe(SECRET);
        // verification re-hashes the original secret with the password salt
        expect(totpEncryption.verifyTotpSecret(SECRET)).toBe(true);
        expect(totpEncryption.verifyTotpSecret("wrong-secret")).toBe(false);
    });

    it("returns null from getTotpSecret when decryption yields a falsy result", () => {
        cls.init(() => {
            totpEncryption.setTotpSecret(SECRET);
        });
        const decryptSpy = vi.spyOn(data_encryption, "decrypt").mockReturnValue(false);

        expect(totpEncryption.getTotpSecret()).toBeNull();

        decryptSpy.mockRestore();
    });

    it("returns null and logs when decryption throws", () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        cls.init(() => {
            totpEncryption.setTotpSecret(SECRET);
        });
        const decryptSpy = vi.spyOn(data_encryption, "decrypt").mockImplementation(() => {
            throw new Error("boom");
        });

        expect(totpEncryption.getTotpSecret()).toBeNull();
        expect(errorSpy).toHaveBeenCalled();

        decryptSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it("reset clears the secret and verification flips off", () => {
        cls.init(() => {
            totpEncryption.setTotpSecret(SECRET);
        });
        expect(totpEncryption.isTotpSecretSet()).toBe(true);

        cls.init(() => {
            totpEncryption.resetTotpSecret();
        });

        expect(totpEncryption.isTotpSecretSet()).toBe(false);
        expect(totpEncryption.getTotpSecret()).toBeNull();
        expect(totpEncryption.verifyTotpSecret(SECRET)).toBe(false);
    });
});
