import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as passwordService from "./encryption/password.js";
import passwordEncryptionService from "./encryption/password_encryption.js";
import {
    authenticateSetup,
    initSetupSecondFactor,
    isSetupAuthorized,
    isSetupAuthRequired,
    isSetupSecondFactorRequired,
    resetSetupAuth
} from "./setup_auth.js";
import { enterSetupMode, leaveSetupMode, markExistingDataDiscarded } from "./setup_mode.js";

/** An instance with a password, which is the only kind the gate has anything to check against. */
function instanceHasPassword(hasOne: boolean) {
    vi.spyOn(passwordService, "isPasswordSet").mockReturnValue(hasOne);
}

/** What the password check answers, without going anywhere near a real hash. */
function passwordIs(correct: string) {
    vi.spyOn(passwordEncryptionService, "verifyPassword")
        .mockImplementation(async (given: string) => given === correct);
}

beforeEach(() => {
    resetSetupAuth();
    // An instance the app sent back to setup, with a knowledge base still behind the wizard.
    enterSetupMode({ lang: "en" });
    instanceHasPassword(true);
});

afterEach(() => {
    leaveSetupMode();
    resetSetupAuth();
    vi.restoreAllMocks();
});

describe("whether the wizard has to be unlocked", () => {
    it("is asked for where there is a knowledge base behind it and a password that guarded it", () => {
        expect(isSetupAuthRequired()).toBe(true);
    });

    it("is not asked for on a first run, which has nothing behind it and nobody to be", () => {
        leaveSetupMode();

        expect(isSetupAuthRequired()).toBe(false);
    });

    it("is not asked for where no password was ever set, since there is nothing to ask", () => {
        instanceHasPassword(false);

        expect(isSetupAuthRequired()).toBe(false);
    });

    it("stops being asked for once the knowledge base is gone, which is when a first run begins", () => {
        markExistingDataDiscarded();

        expect(isSetupAuthRequired()).toBe(false);
    });
});

describe("unlocking it", () => {
    it("issues a token for the right password, and the token is what the routes accept", async () => {
        passwordIs("hunter2");

        const token = await authenticateSetup("hunter2");

        expect(token).toBeTruthy();
        expect(isSetupAuthorized(token ?? "")).toBe(true);
    });

    it("says no to the wrong password, and issues nothing", async () => {
        passwordIs("hunter2");

        expect(await authenticateSetup("hunter3")).toBeNull();
        expect(isSetupAuthorized("hunter3")).toBe(false);
    });

    it("accepts nothing before a token has been issued, and nothing that is not one", async () => {
        expect(isSetupAuthorized("anything")).toBe(false);
        expect(isSetupAuthorized(undefined)).toBe(false);

        passwordIs("hunter2");
        await authenticateSetup("hunter2");

        expect(isSetupAuthorized("anything")).toBe(false);
        expect(isSetupAuthorized("")).toBe(false);
    });

    it("replaces the last token rather than keeping both current", async () => {
        passwordIs("hunter2");

        const first = await authenticateSetup("hunter2");
        const second = await authenticateSetup("hunter2");

        expect(first).not.toBe(second);
        expect(isSetupAuthorized(first ?? "")).toBe(false);
        expect(isSetupAuthorized(second ?? "")).toBe(true);
    });

    describe("where the instance guards itself with a second factor as well", () => {
        /** Records what the factor was asked, and answers to whatever it is told is right. */
        function secondFactorAccepting(right: string, required = true) {
            const asked: string[] = [];

            initSetupSecondFactor({
                isRequired: () => required,
                verify: (answer) => {
                    asked.push(answer);
                    return answer === right;
                }
            });

            return asked;
        }

        it("says it wants one, but only where there is a knowledge base to want it for", () => {
            secondFactorAccepting("123456");
            expect(isSetupSecondFactorRequired()).toBe(true);

            leaveSetupMode();
            expect(isSetupSecondFactorRequired()).toBe(false);
        });

        it("wants none where the instance has none, however it is guarded otherwise", () => {
            secondFactorAccepting("123456", false);

            expect(isSetupAuthRequired()).toBe(true);
            expect(isSetupSecondFactorRequired()).toBe(false);
        });

        it("issues a token only once both have been answered", async () => {
            passwordIs("hunter2");
            secondFactorAccepting("123456");

            expect(await authenticateSetup("hunter2", "000000")).toBeNull();
            expect(await authenticateSetup("hunter2", "123456")).toBeTruthy();
        });

        it("never reaches the second factor on a wrong password", async () => {
            // The answer is often a recovery code. Checking one at all is worth doing only once the
            // rest of the login is known to be right, which is the order login itself uses.
            passwordIs("hunter2");
            const asked = secondFactorAccepting("123456");

            expect(await authenticateSetup("wrong", "123456")).toBeNull();
            expect(asked).toEqual([]);
        });

        it("asks for nothing extra where the instance has no second factor", async () => {
            passwordIs("hunter2");
            const asked = secondFactorAccepting("123456", false);

            expect(await authenticateSetup("hunter2")).toBeTruthy();
            expect(asked).toEqual([]);
        });
    });

    it("stops accepting one that has been held too long", async () => {
        vi.useFakeTimers();
        try {
            passwordIs("hunter2");
            const token = await authenticateSetup("hunter2");

            vi.advanceTimersByTime(12 * 60 * 60 * 1000 - 1000);
            expect(isSetupAuthorized(token ?? "")).toBe(true);

            vi.advanceTimersByTime(2000);
            expect(isSetupAuthorized(token ?? "")).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });
});
