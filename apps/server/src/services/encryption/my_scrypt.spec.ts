import { describe, expect, it } from "vitest";

import myScrypt from "./my_scrypt.js";

describe("my_scrypt (OpenID scrypt helpers)", () => {
    it("derives deterministic, salt-dependent hashes", () => {
        const a = myScrypt.getSubjectIdentifierVerificationHash("subject", "salt-one");
        const a2 = myScrypt.getSubjectIdentifierVerificationHash("subject", "salt-one");
        const b = myScrypt.getSubjectIdentifierVerificationHash("subject", "salt-two");

        expect(a).toBeInstanceOf(Buffer);
        expect(a).toHaveLength(32);
        expect(a.equals(a2)).toBe(true);
        expect(a.equals(b)).toBe(false);

        // getSubjectIdentifierDerivedKey shares the same underlying sync hash
        const derivedKey = myScrypt.getSubjectIdentifierDerivedKey("subject", "salt-one");
        expect(derivedKey.equals(a)).toBe(true);
    });
});
