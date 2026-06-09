import { data_encryption } from "@triliumnext/core";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import sql from "../sql.js";
import myScrypt from "./my_scrypt.js";
import openIDEncryption from "./open_id_encryption.js";

function clearUserData() {
    sql.transactional(() => {
        sql.execute("DELETE FROM user_data");
    });
}

describe("open_id_encryption", () => {
    beforeAll(async () => {
        const sql_init = (await import("../sql_init.js")).default;
        sql_init.initializeDb();
        await sql_init.dbReady;
    });

    beforeEach(() => {
        clearUserData();
    });

    it("reports no saved identifier on an empty user_data table", () => {
        expect(openIDEncryption.isSubjectIdentifierSaved()).toBe(false);
    });

    it("saveUser persists a user and marks it saved; a second saveUser is a no-op", () => {
        const saved = openIDEncryption.saveUser("subject-123", "Alice", "alice@example.com");
        expect(saved).toBe(true);

        expect(openIDEncryption.isSubjectIdentifierSaved()).toBe(true);

        // a second save short-circuits because a user already exists
        expect(openIDEncryption.saveUser("other", "Bob", "bob@example.com")).toBe(false);
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
