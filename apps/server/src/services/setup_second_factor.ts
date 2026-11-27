import type { WrongCodeCount } from "@triliumnext/commons";
import { date_utils as dateUtils, type SetupSecondFactor } from "@triliumnext/core";

import recoveryCodeService, { RECOVERY_CODE_SHAPE } from "./encryption/recovery_codes.js";
import {
    getSecondFactorCheck,
    getWaitUntil,
    matchesResetWords,
    readWrongCodes
} from "./second_factor.js";
import totp from "./totp.js";

/**
 * The second factor the setup wizard asks for, where the instance behind it has one.
 *
 * Handed to core at start rather than reached for from there: what counts as a second factor is the
 * server's business, and the builds without a server have none. See `setup_auth` in core for what it
 * is used for and why the answer is checked without being spent.
 *
 * Everything here only reads. The wizard works on a database that no start has migrated, so the
 * factor can be sealed with the key file or still in the legacy form. Wrong codes are counted in
 * memory, starting from the count of the server, and the password alone is never enough when the
 * factor cannot be read.
 *
 * @module
 */
export const setupSecondFactor: SetupSecondFactor = {
    isRequired() {
        return getSecondFactorCheck() !== "none";
    },

    /**
     * A passcode from the authenticator, or one of the recovery codes standing in for it.
     *
     * The recovery code is matched and left where it is. Consuming it is impossible here — the
     * write would land on an unmigrated database with no entity changes recorded against it — and
     * refusing recovery codes outright would leave a user whose authenticator is gone shut out of a
     * wizard they have already sent their instance into, with nothing but the data directory to get
     * back out of it. The code stays single-use for logging in, which is where it matters.
     */
    verify(answer: string) {
        if (!answer) {
            return false;
        }

        const check = getSecondFactorCheck();
        if (check === "unreadable") {
            return false;
        }
        if (check === "code" && RECOVERY_CODE_SHAPE.test(answer)) {
            return recoveryCodeService.matchesRecoveryCode(answer);
        }

        wrongCodes ??= readWrongCodes();
        if (getWaitUntil(wrongCodes) !== null) {
            return false;
        }

        const isRight = check === "words" ? matchesResetWords(answer) : totp.validateTOTP(answer);
        if (!isRight) {
            wrongCodes = { count: wrongCodes.count + 1, lastAt: dateUtils.utcNowDateTime() };
        }
        return isRight;
    }
};

/** The wrong codes sent to the wizard, starting from the count of the server. */
let wrongCodes: WrongCodeCount | undefined;

/** Forgets the count, for the tests that need one process to look like a fresh one. */
export function resetSetupWrongCodes() {
    wrongCodes = undefined;
}
