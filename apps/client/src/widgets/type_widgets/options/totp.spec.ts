import { describe, expect, it } from "vitest";

import { formatRecoveryCodeUsedDate, isUnusedRecoveryCode } from "./totp";

describe("isUnusedRecoveryCode", () => {
    it("treats purely-numeric entries as unused and anything else as used", () => {
        expect(isUnusedRecoveryCode("0")).toBe(true);
        expect(isUnusedRecoveryCode("7")).toBe(true);
        expect(isUnusedRecoveryCode("2026/06/17T12:34:56.789Z")).toBe(false);
        expect(isUnusedRecoveryCode("aGVsbG8=")).toBe(false);
    });
});

describe("formatRecoveryCodeUsedDate", () => {
    it("formats a stored timestamp and passes through unparseable input unchanged", () => {
        const stored = "2026/06/17T12:34:56.789Z";
        const formatted = formatRecoveryCodeUsedDate(stored);
        expect(formatted).not.toBe(stored);
        expect(formatted).toBe(new Date("2026-06-17T12:34:56.789Z").toLocaleString());

        expect(formatRecoveryCodeUsedDate("not-a-date")).toBe("not-a-date");
    });
});
