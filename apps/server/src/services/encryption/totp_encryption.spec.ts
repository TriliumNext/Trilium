import { cls, data_encryption, options } from "@triliumnext/core";
import fs from "fs";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import sql_init from "../sql_init.js";
import { getKeyFilePath, isSealed } from "./second_factor_key.js";
import totpEncryption from "./totp_encryption.js";

const SECRET = "JBSWY3DPEHPK3PXP";

describe("totp_encryption", () => {
    beforeAll(async () => {
        sql_init.initializeDb();
        await sql_init.dbReady;
    });

    afterEach(() => cls.init(() => totpEncryption.resetTotpSecret()));

    it("throws when setting an empty secret", () => {
        cls.init(() => {
            expect(() => totpEncryption.setTotpSecret("")).toThrow();
        });
    });

    it("seals a secret under the key file, with nothing beside it in the database", () => {
        cls.init(() => totpEncryption.setTotpSecret(SECRET));

        expect(totpEncryption.isTotpSecretSet()).toBe(true);
        expect(isSealed(options.getOption("totpEncryptedSecret"))).toBe(true);
        expect(options.getOption("totpEncryptionSalt")).toBe("");
        expect(totpEncryption.getTotpSecret()).toBe(SECRET);
        if (process.platform !== "win32") {
            expect(fs.statSync(getKeyFilePath()).mode & 0o777).toBe(0o600);
        }
    });

    it("reads a legacy secret, and seals it with the key file once", () => {
        plantLegacySecret();
        expect(totpEncryption.getTotpSecret()).toBe(SECRET);

        expect(cls.init(() => totpEncryption.convertLegacyTotpSecret())).toBe(true);
        expect(isSealed(options.getOption("totpEncryptedSecret"))).toBe(true);
        expect(options.getOption("totpEncryptionSalt")).toBe("");
        expect(totpEncryption.getTotpSecret()).toBe(SECRET);

        expect(cls.init(() => totpEncryption.convertLegacyTotpSecret())).toBe(false);
    });

    it("leaves a legacy secret that does not open, and a missing one", () => {
        expect(cls.init(() => totpEncryption.convertLegacyTotpSecret())).toBe(false);

        plantLegacySecret();
        cls.init(() => options.setOption("totpEncryptionSalt", ""));
        expect(totpEncryption.getTotpSecret()).toBeNull();

        cls.init(() => options.setOption("totpEncryptionSalt", "another-salt"));
        expect(totpEncryption.getTotpSecret()).toBeNull();
        expect(cls.init(() => totpEncryption.convertLegacyTotpSecret())).toBe(false);
    });

    it("opens no secret whose tag does not fit, nor one sealed for another field", () => {
        cls.init(() => totpEncryption.setTotpSecret(SECRET));
        const sealed = options.getOption("totpEncryptedSecret");

        const bytes = Buffer.from(sealed.slice("sealed1:".length), "base64");
        bytes[bytes.length - 1] ^= 1;
        cls.init(() => options.setOption(
            "totpEncryptedSecret", `sealed1:${bytes.toString("base64")}`));
        expect(totpEncryption.getTotpSecret()).toBeNull();

        // A value sealed for another field does not open as the secret either.
        cls.init(() => options.setOption("totpEncryptedSecret", "sealed1:AAAA"));
        expect(totpEncryption.getTotpSecret()).toBeNull();
    });

    it("reset clears the secret", () => {
        cls.init(() => totpEncryption.setTotpSecret(SECRET));

        cls.init(() => totpEncryption.resetTotpSecret());

        expect(totpEncryption.isTotpSecretSet()).toBe(false);
        expect(totpEncryption.getTotpSecret()).toBeNull();
    });
});

/** Stores the secret in the legacy form, encrypted with `totpEncryptionSalt`. */
function plantLegacySecret() {
    cls.init(() => {
        options.setOption("totpEncryptionSalt", "legacy-salt");
        options.setOption("totpEncryptedSecret",
            data_encryption.encrypt(Buffer.from("legacy-salt"), SECRET));
        options.setOption("totpVerificationHash", "hash");
    });
}
