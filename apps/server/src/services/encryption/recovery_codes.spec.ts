import { cls, options } from "@triliumnext/core";
import { beforeAll, describe, expect, it } from "vitest";

import sql_init from "../sql_init.js";
import recoveryCodes from "./recovery_codes.js";

// A recovery code in this scheme is any string matching /^.{22}==$/ (24 chars
// ending in "=="). We use deterministic placeholder codes here.
const CODE_A = "AAAAAAAAAAAAAAAAAAAAAA==";
const CODE_B = "BBBBBBBBBBBBBBBBBBBBBB==";

describe("recovery_codes", () => {
    beforeAll(async () => {
        sql_init.initializeDb();
        await sql_init.dbReady;
    });

    it("returns [] when not set, and round-trips after setting", () => {
        cls.init(() => {
            options.setOption("encryptedRecoveryCodes", "false");
        });
        expect(recoveryCodes.isRecoveryCodeSet()).toBe(false);
        expect(recoveryCodes.getRecoveryCodes()).toEqual([]);

        cls.init(() => {
            recoveryCodes.setRecoveryCodes([CODE_A, CODE_B].join(","));
        });

        expect(recoveryCodes.isRecoveryCodeSet()).toBe(true);
        expect(recoveryCodes.getRecoveryCodes()).toEqual([CODE_A, CODE_B]);
    });

    it("rejects codes failing the format regex without consuming a code", () => {
        cls.init(() => {
            recoveryCodes.setRecoveryCodes([CODE_A, CODE_B].join(","));
        });

        let result: boolean | undefined;
        cls.init(() => {
            result = recoveryCodes.verifyRecoveryCode("too-short");
        });
        expect(result).toBe(false);
        // both codes still present
        expect(recoveryCodes.getRecoveryCodes()).toEqual([CODE_A, CODE_B]);
    });

    it("matches a valid code, consumes it (replaced with a date), and rejects reuse", () => {
        cls.init(() => {
            recoveryCodes.setRecoveryCodes([CODE_A, CODE_B].join(","));
        });

        let firstMatch: boolean | undefined;
        cls.init(() => {
            firstMatch = recoveryCodes.verifyRecoveryCode(CODE_A);
        });
        expect(firstMatch).toBe(true);

        // CODE_A has been replaced with a date string; the remaining real code is CODE_B
        const remaining = recoveryCodes.getRecoveryCodes();
        expect(remaining).toContain(CODE_B);
        expect(remaining).not.toContain(CODE_A);

        // reusing the now-consumed code fails (it no longer matches anything stored)
        let reuse: boolean | undefined;
        cls.init(() => {
            reuse = recoveryCodes.verifyRecoveryCode(CODE_A);
        });
        expect(reuse).toBe(false);
    });
});
