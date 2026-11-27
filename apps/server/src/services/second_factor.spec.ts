import {
    cls,
    data_encryption,
    device_records,
    getLog,
    notifications,
    options
} from "@triliumnext/core";
import crypto from "crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import recoveryCodeService from "./encryption/recovery_codes.js";
import { isSealed } from "./encryption/second_factor_key.js";
import totpEncryption from "./encryption/totp_encryption.js";
import {
    countWrongCode,
    getSecondFactorCheck,
    getSecondFactorState,
    getWaitUntil,
    hasResetWords,
    markEnrolled,
    matchesResetWords,
    readWrongCodes,
    recordSignInAttempt,
    RESET_VARIABLE,
    startSecondFactor,
    takeResetWords
} from "./second_factor.js";
import sql_init from "./sql_init.js";

const SECRET = "JBSWY3DPEHPK3PXP";
const WORDS = "the owner's long words of reset";
const MINUTE = 60 * 1000;

describe("the second factor of the server", () => {
    beforeAll(async () => {
        sql_init.initializeDb();
        await sql_init.dbReady;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete process.env[RESET_VARIABLE];
        cls.init(() => {
            totpEncryption.resetTotpSecret();
            recoveryCodeService.clearRecoveryCodes();
            for (const name of [
                "secondFactorState",
                "totpWrongCodeCount",
                "signInAttemptRecord"
            ] as const) {
                options.setOption(name, "");
            }
            options.setOption("mfaMethod", "totp");
            markEnrolled();
        });
    });

    it("seals a legacy factor with the key file at startup, and marks it legacy", () => {
        cls.init(() => {
            options.setOption("totpEncryptionSalt", "legacy-salt");
            options.setOption(
                "totpEncryptedSecret",
                data_encryption.encrypt(Buffer.from("legacy-salt"), SECRET)
            );
            options.setOption("totpVerificationHash", "hash");
        });

        startSecondFactor();

        expect(isSealed(options.getOption("totpEncryptedSecret"))).toBe(true);
        expect(totpEncryption.getTotpSecret()).toBe(SECRET);
        expect(getSecondFactorState()).toBe("legacy");
        expect(getSecondFactorCheck()).toBe("code");

        cls.init(() => markEnrolled());
        expect(getSecondFactorState()).toBe("");
    });

    it("keeps the blocked state of a planted factor over the legacy one", () => {
        // Recovery codes in the legacy form, with their key and IV kept in options.
        const iv = crypto.randomBytes(16);
        const key = crypto.randomBytes(32);
        const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
        cls.init(() => {
            options.setOption("secondFactorState", "blocked");
            options.setOption("recoveryCodeInitialVector", iv.toString("hex"));
            options.setOption("recoveryCodeSecurityKey", key.toString("hex"));
            options.setOption(
                "recoveryCodesEncrypted",
                cipher.update("a,b", "utf-8", "hex") + cipher.final("hex")
            );
            options.setOption("encryptedRecoveryCodes", "true");
        });

        startSecondFactor();

        expect(isSealed(options.getOption("recoveryCodesEncrypted"))).toBe(true);
        expect(recoveryCodeService.getRecoveryCodes()).toEqual([ "a", "b" ]);
        expect(getSecondFactorState()).toBe("blocked");
        expect(getSecondFactorCheck()).toBe("unreadable");
    });

    it("tells what the login asks for by the state of the device and of the factor", () => {
        cls.init(() => options.setOption("mfaMethod", "oauth"));
        expect(getSecondFactorCheck()).toBe("none");

        cls.init(() => options.setOption("mfaMethod", "totp"));
        expect(getSecondFactorCheck()).toBe("none");

        cls.init(() => totpEncryption.setTotpSecret(SECRET));
        expect(getSecondFactorCheck()).toBe("code");

        // A sealed value that does not open, as without the key file.
        cls.init(() => options.setOption("totpEncryptedSecret", "sealed1:AAAA"));
        expect(getSecondFactorCheck()).toBe("unreadable");

        cls.init(() => options.setOption("secondFactorState", "removed"));
        expect(getSecondFactorCheck()).toBe("words");
    });

    it("removes an unreadable factor with the variable's words, and deletes the variable", () => {
        const info = vi.spyOn(getLog(), "info");
        cls.init(() => {
            totpEncryption.setTotpSecret(SECRET);
            options.setOption("totpEncryptedSecret", "sealed1:AAAA");
            options.setOption(
                "totpWrongCodeCount",
                JSON.stringify({ count: 9, lastAt: new Date().toISOString() })
            );
        });
        process.env[RESET_VARIABLE] = WORDS;

        startSecondFactor();

        expect(process.env[RESET_VARIABLE]).toBeUndefined();
        expect(getSecondFactorState()).toBe("removed");
        expect(totpEncryption.isTotpSecretSet()).toBe(false);
        expect(readWrongCodes().count).toBe(0);
        expect(hasResetWords()).toBe(true);
        expect(matchesResetWords(WORDS)).toBe(true);
        expect(matchesResetWords("not them")).toBe(false);
        expect(info).toHaveBeenCalledWith(`The variable ${RESET_VARIABLE} is set.`);
        expect(info.mock.calls.flat().join("\n")).not.toContain(WORDS);
    });

    it("resets the count in the removed state with the variable, and asks nothing else", () => {
        cls.init(() => {
            options.setOption("secondFactorState", "removed");
            options.setOption(
                "totpWrongCodeCount",
                JSON.stringify({ count: 7, lastAt: new Date().toISOString() })
            );
        });
        process.env[RESET_VARIABLE] = WORDS;

        startSecondFactor();

        expect(getSecondFactorState()).toBe("removed");
        expect(readWrongCodes().count).toBe(0);
        expect(matchesResetWords(WORDS)).toBe(true);
    });

    it("leaves a checkable factor, and removes nothing with fewer than 16 characters", () => {
        const info = vi.spyOn(getLog(), "info");
        cls.init(() => totpEncryption.setTotpSecret(SECRET));

        process.env[RESET_VARIABLE] = WORDS;
        startSecondFactor();
        expect(getSecondFactorState()).toBe("");
        expect(hasResetWords()).toBe(false);

        cls.init(() => options.setOption("totpEncryptedSecret", "sealed1:AAAA"));
        process.env[RESET_VARIABLE] = "too short";
        startSecondFactor();
        expect(getSecondFactorState()).toBe("");
        expect(hasResetWords()).toBe(false);
        expect(info.mock.calls.flat().join("\n")).toContain("shorter than 16 characters");
    });

    it("takes the words once, and a start without them asks for them still", () => {
        process.env[RESET_VARIABLE] = WORDS;
        takeResetWords();
        expect(process.env[RESET_VARIABLE]).toBeUndefined();
        takeResetWords();
        expect(matchesResetWords(WORDS)).toBe(true);
    });

    it("reads the count of wrong codes strictly, and lapses it a day after the last one", () => {
        const now = Date.parse("2026-11-26T12:00:00.000Z");
        const store = (value: string) =>
            cls.init(() => options.setOption("totpWrongCodeCount", value));

        store("");
        expect(readWrongCodes(now).count).toBe(0);
        for (const garbage of [
            "{not json",
            JSON.stringify({ count: -1, lastAt: "2026-11-26 11:00:00.000Z" }),
            JSON.stringify({ count: 2.5 })
        ]) {
            store(garbage);
            expect(readWrongCodes(now).count, garbage).toBe(5);
        }

        store(JSON.stringify({ count: 3, lastAt: "2027-01-01 00:00:00.000Z" }));
        expect(readWrongCodes(now)).toEqual({ count: 3, lastAt: "2026-11-26 12:00:00.000Z" });

        store(JSON.stringify({ count: 3, lastAt: "2026-11-25 11:59:59.000Z" }));
        expect(readWrongCodes(now).count).toBe(0);
    });

    it("makes a code wait after five wrong ones, a minute at first, doubling up to an hour", () => {
        const now = Date.parse("2026-11-26T12:00:00.000Z");
        const at = (count: number) =>
            getWaitUntil({ count, lastAt: "2026-11-26 12:00:00.000Z" }, now);

        expect(at(4)).toBeNull();
        expect(at(5)).toBe(now + MINUTE);
        expect(at(6)).toBe(now + 2 * MINUTE);
        expect(at(20)).toBe(now + 60 * MINUTE);
        expect(getWaitUntil({ count: 5, lastAt: "2026-11-26 11:58:00.000Z" }, now)).toBeNull();

        cls.init(() => {
            countWrongCode(now);
            countWrongCode(now);
        });
        expect(readWrongCodes(now).count).toBe(2);
    });

    it("records a right password that came without a right code", () => {
        cls.init(() => recordSignInAttempt("no-code"));

        expect(device_records.readDeviceRecord("signInAttemptRecord").map(({ name }) => name))
            .toEqual([ "no-code" ]);
    });

    it("raises a notice from the fifth wrong code on, and keeps the count after it", () => {
        const now = Date.now();
        const notice = () => cls.init(() =>
            notifications.getNotificationService().getById("trilium:security:wrong-codes"));
        cls.init(() => {
            for (let index = 0; index < 4; index++) {
                countWrongCode(now);
            }
        });
        expect(notice()).toBeNull();

        cls.init(() => countWrongCode(now));
        expect(notice()).toMatchObject({ attentionLevel: "high", producer: "trilium:security" });

        cls.init(() => notifications.getNotificationService().dismissById(
            "trilium:security:wrong-codes"));
        cls.init(() => countWrongCode(now));
        expect(notice()).toBeNull();
        expect(readWrongCodes(now).count).toBe(6);
    });
});
