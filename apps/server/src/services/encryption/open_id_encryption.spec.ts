import { data_encryption } from "@triliumnext/core";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import sql from "../sql.js";
import myScrypt from "./my_scrypt.js";
import openIDEncryption from "./open_id_encryption.js";

function clearEnrollment() {
    sql.transactional(() => {
        sql.execute("DELETE FROM oauth_enrollment");
        // Reset the admin user's name/email so saveUser() mutations don't bleed between tests.
        sql.execute("UPDATE users SET username = 'admin', email = NULL WHERE isAdmin = 1 AND isDeleted = 0");
    });
}

describe("open_id_encryption", () => {
    beforeAll(async () => {
        const sql_init = (await import("../sql_init.js")).default;
        sql_init.initializeDb();
        await sql_init.dbReady;
    });

    beforeEach(() => {
        clearEnrollment();
    });

    it("reports no saved identifier on an empty oauth_enrollment table", () => {
        expect(openIDEncryption.isSubjectIdentifierSaved()).toBe(false);
    });

    it("saveUser persists a user and marks it saved; a second saveUser is a no-op", () => {
        const saved = openIDEncryption.saveUser("subject-123", "Alice", "alice@example.com");
        expect(saved).toBe(true);

        expect(openIDEncryption.isSubjectIdentifierSaved()).toBe(true);

        // a second save short-circuits because a user already exists
        expect(openIDEncryption.saveUser("other", "Bob", "bob@example.com")).toBe(false);
    });

    it("verifySubjectIdentifier matches only the enrolled subject identifier", () => {
        // No account enrolled yet → nothing matches.
        expect(openIDEncryption.verifySubjectIdentifier("subject-123")).toBe(false);

        openIDEncryption.saveUser("subject-123", "Alice", "alice@example.com");

        expect(openIDEncryption.verifySubjectIdentifier("subject-123")).toBe(true);
        expect(openIDEncryption.verifySubjectIdentifier("someone-else")).toBe(false);
        // A prefix of the real identifier must not pass (length-safe comparison).
        expect(openIDEncryption.verifySubjectIdentifier("subject-12")).toBe(false);
    });

    it("setDataKey encrypts the data key so it can be recovered with the derived key", () => {
        const salt = "fixed-salt";
        const plainKey = "0123456789abcdef";
        const encrypted = openIDEncryption.setDataKey("subject-xyz", plainKey, salt);
        expect(typeof encrypted).toBe("string");

        const derivedKey = myScrypt.getSubjectIdentifierDerivedKey("subject-xyz", salt);
        expect(data_encryption.decryptString(derivedKey, encrypted)).toBe(plainKey);
    });
});
