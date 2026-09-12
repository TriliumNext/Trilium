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
            recoveryCodes.setRecoveryCodes([ CODE_A, CODE_B ].join(","));
        });

        expect(recoveryCodes.isRecoveryCodeSet()).toBe(true);
        expect(recoveryCodes.getRecoveryCodes()).toEqual([ CODE_A, CODE_B ]);
    });

    it("clearRecoveryCodes wipes the stored codes", () => {
        cls.init(() => {
            recoveryCodes.setRecoveryCodes([ CODE_A, CODE_B ].join(","));
        });
        expect(recoveryCodes.isRecoveryCodeSet()).toBe(true);

        cls.init(() => {
            recoveryCodes.clearRecoveryCodes();
        });

        expect(recoveryCodes.isRecoveryCodeSet()).toBe(false);
        expect(recoveryCodes.getRecoveryCodes()).toEqual([]);
    });

    it("createRecoveryCodes returns 8 well-formed codes without persisting them", () => {
        cls.init(() => {
            recoveryCodes.clearRecoveryCodes();
        });

        const codes = recoveryCodes.createRecoveryCodes();
        expect(codes).toHaveLength(8);
        // Each code matches the verification format (24 chars ending in "==").
        expect(codes.every((c) => /^.{22}==$/.test(c))).toBe(true);
        // Creating must not store anything — that's what enrollment's "enable" step is for.
        expect(recoveryCodes.isRecoveryCodeSet()).toBe(false);
    });

    it("matches a code without spending it, for the setup wizard that cannot spend one", () => {
        // The wizard runs against a database that is attached but not migrated, with becca
        // unloaded, so the write that consuming needs would land as a duplicate option row — and a
        // code spent there would still read as unspent everywhere else in a sync cluster. It trades
        // the single use for being able to ask at all. See `setup_auth` in core.
        cls.init(() => {
            recoveryCodes.setRecoveryCodes([ CODE_A, CODE_B ].join(","));
        });

        expect(recoveryCodes.matchesRecoveryCode(CODE_A)).toBe(true);
        // Still both there, and still answerable: the same code twice over is the price.
        expect(recoveryCodes.getRecoveryCodes()).toEqual([ CODE_A, CODE_B ]);
        expect(recoveryCodes.matchesRecoveryCode(CODE_A)).toBe(true);

        expect(recoveryCodes.matchesRecoveryCode(CODE_B)).toBe(true);
        expect(recoveryCodes.matchesRecoveryCode("CCCCCCCCCCCCCCCCCCCCCC==")).toBe(false);
        // Refused on shape before anything is decrypted, exactly as the consuming check does.
        expect(recoveryCodes.matchesRecoveryCode("too-short")).toBe(false);
    });

    it("answers the same way however many times the shape check is run", () => {
        // The pattern is shared between the two checks now. Held in a variable with the `g` flag it
        // would remember where it last matched and answer correctly only every other call.
        cls.init(() => {
            recoveryCodes.setRecoveryCodes([ CODE_A, CODE_B ].join(","));
        });

        for (let attempt = 0; attempt < 4; attempt++) {
            expect(recoveryCodes.matchesRecoveryCode(CODE_B)).toBe(true);
        }
    });

    it("rejects codes failing the format regex without consuming a code", () => {
        cls.init(() => {
            recoveryCodes.setRecoveryCodes([ CODE_A, CODE_B ].join(","));
        });

        let result: boolean | undefined;
        cls.init(() => {
            result = recoveryCodes.verifyRecoveryCode("too-short");
        });
        expect(result).toBe(false);
        // both codes still present
        expect(recoveryCodes.getRecoveryCodes()).toEqual([ CODE_A, CODE_B ]);
    });

    it("matches a valid code, consumes it (replaced with a date), and rejects reuse", () => {
        cls.init(() => {
            recoveryCodes.setRecoveryCodes([ CODE_A, CODE_B ].join(","));
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
