import { data_encryption } from "@triliumnext/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import sql from "../sql.js";
import sqlInit from "../sql_init.js";
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
        // once a user is set up, verifyOpenIDSubjectIdentifier short-circuits to false
        expect(openIDEncryption.verifyOpenIDSubjectIdentifier("subject-123")).toBe(false);

        // a second save short-circuits because a user already exists
        expect(openIDEncryption.saveUser("other", "Bob", "bob@example.com")).toBe(false);
    });

    it("setDataKey / getDataKey round-trips the plaintext data key", () => {
        const salt = "fixed-salt";
        const plainKey = "0123456789abcdef";
        const encrypted = openIDEncryption.setDataKey("subject-xyz", plainKey, salt);
        expect(typeof encrypted).toBe("string");

        sql.transactional(() => {
            sql.upsert("user_data", "tmpID", {
                tmpID: 0,
                salt,
                userIDEncryptedDataKey: encrypted
            });
        });

        const decrypted = openIDEncryption.getDataKey("subject-xyz");
        expect(Buffer.from(decrypted as Uint8Array).toString()).toBe(plainKey);
    });

    it("getDataKey returns undefined when no encrypted data key is stored", () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        sql.transactional(() => {
            sql.upsert("user_data", "tmpID", { tmpID: 0, salt: "s" });
        });
        expect(openIDEncryption.getDataKey("subject")).toBeUndefined();
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    it("getDataKey returns undefined when the derived key cannot be produced", () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        sql.transactional(() => {
            sql.upsert("user_data", "tmpID", { tmpID: 0, salt: "s", userIDEncryptedDataKey: "abc" });
        });
        const spy = vi.spyOn(myScrypt, "getSubjectIdentifierDerivedKey").mockReturnValue(undefined);
        expect(openIDEncryption.getDataKey("subject")).toBeUndefined();
        expect(errorSpy).toHaveBeenCalled();
        spy.mockRestore();
        errorSpy.mockRestore();
    });

    it("setDataKey returns undefined when the derived key cannot be produced", () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const spy = vi
            .spyOn(myScrypt, "getSubjectIdentifierDerivedKey")
            .mockReturnValue(undefined);
        expect(openIDEncryption.setDataKey("subject", "key", "salt")).toBeUndefined();
        expect(errorSpy).toHaveBeenCalled();
        spy.mockRestore();
        errorSpy.mockRestore();
    });

    describe("verifyOpenIDSubjectIdentifier", () => {
        it("throws when the database is not initialized", () => {
            const spy = vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(false);
            expect(() => openIDEncryption.verifyOpenIDSubjectIdentifier("subject")).toThrow();
            spy.mockRestore();
        });

        it("returns undefined when salt is missing", () => {
            const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
            // row exists (so isUserSaved=false) but salt is null
            sql.transactional(() => {
                sql.upsert("user_data", "tmpID", { tmpID: 0, isSetup: "false" });
            });
            expect(openIDEncryption.verifyOpenIDSubjectIdentifier("subject")).toBeUndefined();
            // Disambiguate from the other undefined-returning branch (hash undefined):
            // this must be the missing-salt branch.
            expect(logSpy).toHaveBeenCalledWith("Salt undefined");
            logSpy.mockRestore();
        });

        it("returns the constant-time comparison of stored vs computed hashes", () => {
            const subject = "subject-verify";
            const salt = "the-salt";
            const hash = myScrypt.getSubjectIdentifierVerificationHash(subject, salt)!.toString("base64");
            sql.transactional(() => {
                sql.upsert("user_data", "tmpID", {
                    tmpID: 0,
                    isSetup: "false",
                    salt,
                    userIDVerificationHash: hash
                });
            });

            expect(openIDEncryption.verifyOpenIDSubjectIdentifier(subject)).toBe(true);
            expect(openIDEncryption.verifyOpenIDSubjectIdentifier("wrong-subject")).toBe(false);
        });

        it("returns undefined when the computed subject-id hash is undefined", () => {
            const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
            sql.transactional(() => {
                sql.upsert("user_data", "tmpID", { tmpID: 0, isSetup: "false", salt: "s" });
            });
            const spy = vi
                .spyOn(myScrypt, "getSubjectIdentifierVerificationHash")
                .mockReturnValue(undefined);
            expect(openIDEncryption.verifyOpenIDSubjectIdentifier("subject")).toBeUndefined();
            spy.mockRestore();
            logSpy.mockRestore();
        });

    });

    describe("saveUser defensive branches", () => {
        it("throws when the verification hash cannot be computed", () => {
            const spy = vi
                .spyOn(myScrypt, "getSubjectIdentifierVerificationHash")
                .mockReturnValue(undefined);
            expect(() => openIDEncryption.saveUser("s", "n", "e@x.com")).toThrow();
            spy.mockRestore();
        });

        it("returns undefined when the encrypted data key cannot be produced", () => {
            const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            const encryptSpy = vi.spyOn(data_encryption, "encrypt");
            const derivedSpy = vi
                .spyOn(myScrypt, "getSubjectIdentifierDerivedKey")
                .mockReturnValue(undefined);
            expect(openIDEncryption.saveUser("s", "n", "e@x.com")).toBeUndefined();
            expect(encryptSpy).not.toHaveBeenCalled();
            derivedSpy.mockRestore();
            encryptSpy.mockRestore();
            errorSpy.mockRestore();
        });
    });
});
