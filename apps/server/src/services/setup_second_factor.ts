import type { SetupSecondFactor } from "@triliumnext/core";

import recoveryCodeService from "./encryption/recovery_codes.js";
import totp from "./totp.js";

/**
 * The second factor the setup wizard asks for, where the instance behind it has one.
 *
 * Handed to core at start rather than reached for from there: what counts as a second factor is the
 * server's business, and the builds without a server have none. See `setup_auth` in core for what it
 * is used for and why the answer is checked without being spent.
 *
 * Everything here is a read. The TOTP secret is decrypted with a salt of its own rather than with
 * the password-derived data key, so no protected session is involved, and every option it needs is
 * read through the fallback that serves a database which is attached but has no becca over it.
 *
 * @module
 */
export const setupSecondFactor: SetupSecondFactor = {
    isRequired() {
        return totp.isTotpEnabled();
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

        return totp.validateTOTP(answer) || recoveryCodeService.matchesRecoveryCode(answer);
    }
};
