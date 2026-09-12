import { getCrypto } from "./encryption/crypto.js";
import { isPasswordSet } from "./encryption/password.js";
import passwordEncryptionService from "./encryption/password_encryption.js";
import { getLog } from "./log.js";
import { hasExistingData } from "./setup_mode.js";
import { encodeUtf8 } from "./utils/binary.js";
import { randomSecureToken } from "./utils/index.js";

/**
 * Who is allowed to drive the setup wizard when there is a knowledge base behind it.
 *
 * Setup is ordinarily unauthenticated, and rightly so: before a database exists there is nobody to
 * authenticate and nothing to protect. An instance the app sent back to setup is the other case
 * entirely. Its database is sitting right there, unopened, and every guard that normally protects it
 * has stood down, because each of them gives way when the instance reports itself uninitialized.
 * That is exactly what setup mode makes it report.
 *
 * On a desktop that matters little. On a server it is the whole thing: the setup screen is served
 * over the network to whoever asks, and the wizard can erase the knowledge base, replace it from a
 * backup, or point it at somebody else's sync server. So the password that guarded the instance a
 * moment ago guards it here too, read straight from the options table, which is legible while the
 * database is attached but not initialized.
 *
 * What is issued in exchange lives in memory for this process only. Sessions cannot serve here: the
 * session store answers nothing while the database is uninitialized, so a user who was logged in a
 * minute ago is a stranger to it now.
 *
 * @module
 */

/**
 * Whether the wizard has to be unlocked before it will do anything.
 *
 * Two things have to hold. There has to be something to protect, which stops being true the moment
 * the user picks a path and the database goes; from then on the instance is as bare as a first run
 * and is treated as one. And there has to be a password to check against, since an instance that
 * never had one has nothing to ask for and would otherwise be locked out of its own wizard.
 */
export function isSetupAuthRequired(): boolean {
    return hasExistingData() && isPasswordSet();
}

/**
 * The second factor, where the instance guarding the knowledge base has one.
 *
 * Injected rather than reached for: what counts as a second factor is the server's business (TOTP
 * and the recovery codes beside it live there), and the builds without a server have none.
 */
export interface SetupSecondFactor {
    /** Whether this instance asks for one at all. */
    isRequired(): boolean;
    /**
     * Whether the answer is the right one.
     *
     * Must not consume what it checks. The wizard runs against a database that is attached but not
     * migrated, with becca unloaded and nothing tracking entity changes, so `setOption` here would
     * create a duplicate row rather than update one — and a single-use code spent in this state
     * would still read as unspent on every other instance in a sync cluster. So a recovery code
     * answered here stays answerable here, which is the price of not locking a user out of their
     * own wizard when their authenticator is gone.
     */
    verify(answer: string): boolean;
}

let secondFactor: SetupSecondFactor | null = null;

export function initSetupSecondFactor(instance: SetupSecondFactor | null): void {
    secondFactor = instance;
}

/** Whether unlocking asks for a second factor as well as the password. */
export function isSetupSecondFactorRequired(): boolean {
    return isSetupAuthRequired() && secondFactor?.isRequired() === true;
}

/**
 * Checks the instance's own credentials and, where they match, issues the token that unlocks the
 * rest of the wizard.
 *
 * The password first and the second factor after it, in that order and never the other way round:
 * the answer to a second factor is often a recovery code, and checking one at all is worth doing
 * only once the rest of the login is known to be right.
 *
 * @returns the token, or `null` where the answer was wrong. Which of the two was wrong is
 *          deliberately not said: the screen asks for both together and reports one failure.
 */
export async function authenticateSetup(password: string, secondFactorAnswer = ""): Promise<string | null> {
    if (!await passwordEncryptionService.verifyPassword(password)) {
        getLog().info("Setup: a wrong password was given for the existing knowledge base.");
        return null;
    }

    if (isSetupSecondFactorRequired() && !secondFactor?.verify(secondFactorAnswer)) {
        getLog().info("Setup: a wrong second factor was given for the existing knowledge base.");
        return null;
    }

    issued = { token: randomSecureToken(32), expires: Date.now() + TOKEN_LIFETIME_MS };
    getLog().info("Setup: the existing knowledge base was unlocked.");

    return issued.token;
}

/** Whether a token presented by a request is the one this process issued, and still current. */
export function isSetupAuthorized(token: string | undefined): boolean {
    if (!issued || !token) {
        return false;
    }
    if (Date.now() > issued.expires) {
        issued = null;
        return false;
    }

    // Compared the way the password itself is: the token is a bearer secret, and a comparison that
    // stops at the first wrong byte says how much of it was right.
    return getCrypto().constantTimeCompare(encodeUtf8(token), encodeUtf8(issued.token));
}

/** Forgets it, for the tests that need one process to look like a fresh one. */
export function resetSetupAuth(): void {
    issued = null;
    secondFactor = null;
}

/**
 * How long an unlocked wizard stays unlocked.
 *
 * Long enough to cover what the user might do inside it: backing up a large knowledge base runs
 * into the tens of minutes, and being asked for the password again halfway through would be asking
 * it of somebody who has already walked away from the screen.
 */
const TOKEN_LIFETIME_MS = 12 * 60 * 60 * 1000;

let issued: { token: string; expires: number } | null = null;
