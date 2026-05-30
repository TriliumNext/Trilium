import { beforeAll, describe, expect, it, vi } from "vitest";

import sql from "../sql.js";
import sql_init from "../sql_init.js";
import myScrypt from "./my_scrypt.js";

describe("my_scrypt (OpenID scrypt helpers)", () => {
    beforeAll(async () => {
        sql_init.initializeDb();
        await sql_init.dbReady;
    });

    it("derives deterministic, salt-dependent hashes when salt is given explicitly", () => {
        const a = myScrypt.getSubjectIdentifierVerificationHash("subject", "salt-one");
        const a2 = myScrypt.getSubjectIdentifierVerificationHash("subject", "salt-one");
        const b = myScrypt.getSubjectIdentifierVerificationHash("subject", "salt-two");

        expect(a).toBeInstanceOf(Buffer);
        expect(a).toHaveLength(32);
        expect(a!.equals(a2!)).toBe(true);
        expect(a!.equals(b!)).toBe(false);

        // createSubjectIdentifierDerivedKey shares the same underlying sync hash
        const derived = myScrypt.createSubjectIdentifierDerivedKey("subject", "salt-one");
        expect(derived.equals(a!)).toBe(true);

        // getSubjectIdentifierDerivedKey with explicit salt matches as well
        const derivedKey = myScrypt.getSubjectIdentifierDerivedKey("subject", "salt-one");
        expect(derivedKey!.equals(a!)).toBe(true);
    });

    it("reads salt from user_data when none is given", () => {
        sql.transactional(() => {
            sql.execute("DELETE FROM user_data");
            sql.upsert("user_data", "tmpID", { tmpID: 0, salt: "db-salt" });
        });

        const fromDb = myScrypt.getSubjectIdentifierVerificationHash("subject");
        const explicit = myScrypt.getSubjectIdentifierVerificationHash("subject", "db-salt");
        expect(fromDb!.equals(explicit!)).toBe(true);

        const derivedFromDb = myScrypt.getSubjectIdentifierDerivedKey("subject");
        expect(derivedFromDb!.equals(explicit!)).toBe(true);
    });

    it("returns undefined and logs when no salt is stored", () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        sql.transactional(() => {
            sql.execute("DELETE FROM user_data");
        });

        expect(myScrypt.getSubjectIdentifierVerificationHash("subject")).toBeUndefined();
        expect(errorSpy).toHaveBeenCalled();
        expect(myScrypt.getSubjectIdentifierDerivedKey("subject")).toBeUndefined();

        errorSpy.mockRestore();
    });
});
