/**
 * @module
 *
 * Tracks the second factor of the server for the login: its state on this device, the count of
 * wrong codes, the words of `TRILIUM_RESET_SECOND_FACTOR` and the record of right passwords sent
 * without a right code. All of them are device options, which sync refuses.
 */
import type { WrongCodeCount } from "@triliumnext/commons";
import {
    cls,
    date_utils as dateUtils,
    device_records,
    getLog,
    notifications,
    options
} from "@triliumnext/core";

import recoveryCodeService from "./encryption/recovery_codes.js";
import totpEncryptionService from "./encryption/totp_encryption.js";
import sql from "./sql.js";
import totp from "./totp.js";
import { constantTimeCompare } from "./utils.js";

/**
 * `legacy`: the factor was sealed with a key from the database, so every older copy of the database
 * holds that key next to it. `blocked`: a sync peer planted one of its rows. `removed`:
 * `TRILIUM_RESET_SECOND_FACTOR` removed it, and the login takes the words of the variable as the
 * code until a new enrollment.
 */
export type SecondFactorState = "" | "legacy" | "blocked" | "removed";

/** What the login asks for after the password. */
export type SecondFactorCheck =
    /** Nothing. */
    | "none"
    /** A TOTP code or a recovery code. */
    | "code"
    /** A code it cannot check: the factor refuses every code until it is removed. */
    | "unreadable"
    /** The words of `TRILIUM_RESET_SECOND_FACTOR`, or nothing at all at a start without them. */
    | "words";

export const RESET_VARIABLE = "TRILIUM_RESET_SECOND_FACTOR";
const MINIMUM_WORDS_LENGTH = 16;

const WRONG_CODES_BEFORE_WAIT = 5;
const FIRST_WAIT_MS = 60 * 1000;
const LONGEST_WAIT_MS = 60 * 60 * 1000;
const COUNT_LAPSE_MS = 24 * 60 * 60 * 1000;

/** Read at startup and deleted from `process.env`, so that child processes do not inherit them. */
let resetWords: string | undefined;

/** Moves the words of `TRILIUM_RESET_SECOND_FACTOR` from `process.env` into memory. */
export function takeResetWords() {
    if (RESET_VARIABLE in process.env) {
        resetWords = process.env[RESET_VARIABLE];
        delete process.env[RESET_VARIABLE];
    }
}

export function getSecondFactorState(): SecondFactorState {
    const state = options.getOptionOrNull("secondFactorState");
    return state === "legacy" || state === "blocked" || state === "removed" ? state : "";
}

function setSecondFactorState(state: SecondFactorState) {
    options.setOption("secondFactorState", state);
}

/**
 * Runs at every start, after `initStartupOptions()` repairs planted device options. Seals a factor
 * that still uses a key from the database with the key file and marks it `legacy`, and removes a
 * factor that cannot be checked when `TRILIUM_RESET_SECOND_FACTOR` is set.
 */
export function startSecondFactor() {
    takeResetWords();
    const log = getLog();

    cls.init(() => sql.transactional(() => {
        const isSecretConverted = totpEncryptionService.convertLegacyTotpSecret();
        const areCodesConverted = recoveryCodeService.convertLegacyRecoveryCodes();
        if ((isSecretConverted || areCodesConverted) && getSecondFactorState() === "") {
            setSecondFactorState("legacy");
            log.info("Sealed the second factor with its key file. "
                + "Set it up again: older copies of the database hold it next to its key.");
        }

        if (resetWords === undefined) {
            return;
        }

        log.info(`The variable ${RESET_VARIABLE} is set.`);
        if (resetWords.length < MINIMUM_WORDS_LENGTH) {
            log.info(`The variable ${RESET_VARIABLE} is shorter than ${MINIMUM_WORDS_LENGTH} `
                + "characters and is ignored.");
            resetWords = undefined;
            return;
        }

        const state = getSecondFactorState();
        if (state !== "removed" && getSecondFactorCheck() !== "unreadable") {
            log.info(`The variable ${RESET_VARIABLE} is ignored: `
                + "it removes only a second factor that cannot be checked.");
            resetWords = undefined;
            return;
        }

        if (state !== "removed") {
            totpEncryptionService.resetTotpSecret();
            recoveryCodeService.clearRecoveryCodes();
            setSecondFactorState("removed");
            log.info("Removed the second factor. "
                + `Until a new enrollment the login asks for the words of ${RESET_VARIABLE}.`);
        }
        // The recovery codes, which skip a wait, were removed with the factor, so the count
        // starts again.
        writeWrongCodes({ count: 0, lastAt: dateUtils.utcNowDateTime() });
    }));
}

/** What the login asks for after the password, by the state of the device and of the factor. */
export function getSecondFactorCheck(): SecondFactorCheck {
    const state = getSecondFactorState();
    if (state === "removed") {
        return "words";
    }
    if (options.getOptionOrNull("mfaMethod") !== "totp") {
        return "none";
    }
    if (state === "blocked") {
        return "unreadable";
    }
    if (!totp.isTotpEnabled()) {
        return "none";
    }
    return totp.getTotpSecret() === null ? "unreadable" : "code";
}

/** Whether the answer is the words of the variable that removed the factor at this start. */
export function matchesResetWords(answer: string): boolean {
    return resetWords !== undefined && constantTimeCompare(answer, resetWords);
}

/** Whether the login takes the words of `TRILIUM_RESET_SECOND_FACTOR` at this start. */
export function hasResetWords(): boolean {
    return resetWords !== undefined;
}

/** Clears the state after a new enrollment, since a new secret makes every older copy worthless. */
export function markEnrolled() {
    setSecondFactorState("");
    resetWords = undefined;
}

/** Reads the count of wrong codes. A count that is not a whole number counts as five. */
export function readWrongCodes(now = Date.now()): WrongCodeCount {
    let stored: Partial<WrongCodeCount> | null = null;
    try {
        stored = JSON.parse(options.getOptionOrNull("totpWrongCodeCount") || "null");
    } catch {
        stored = { count: WRONG_CODES_BEFORE_WAIT };
    }
    if (!stored) {
        return { count: 0, lastAt: "" };
    }

    const storedCount = Number.isInteger(stored.count) ? Number(stored.count) : -1;
    const count = storedCount >= 0 ? storedCount : WRONG_CODES_BEFORE_WAIT;
    const parsed = Date.parse(stored.lastAt ?? "");
    const lastAt = Number.isNaN(parsed) || parsed > now ? now : parsed;
    if (now - lastAt >= COUNT_LAPSE_MS) {
        return { count: 0, lastAt: "" };
    }
    return { count, lastAt: dateUtils.utcDateTimeStr(new Date(lastAt)) };
}

function writeWrongCodes(count: WrongCodeCount) {
    options.setOption("totpWrongCodeCount", JSON.stringify(count));
}

/** Returns until when TOTP codes are refused after five wrong ones in a row, or `null`. */
export function getWaitUntil(count: WrongCodeCount, now = Date.now()): number | null {
    if (count.count < WRONG_CODES_BEFORE_WAIT) {
        return null;
    }

    const wait = Math.min(
        FIRST_WAIT_MS * 2 ** (count.count - WRONG_CODES_BEFORE_WAIT),
        LONGEST_WAIT_MS
    );
    const until = Date.parse(count.lastAt) + wait;
    return until > now ? until : null;
}

/**
 * Counts a wrong code after a right password, for the whole server and across restarts. From the
 * fifth in a row on, a notice names them, at most once an hour.
 */
export function countWrongCode(now = Date.now()) {
    const count = readWrongCodes(now).count + 1;
    writeWrongCodes({ count, lastAt: dateUtils.utcDateTimeStr(new Date(now)) });
    if (count >= WRONG_CODES_BEFORE_WAIT) {
        notifications.raiseWrongCodeNotice(count);
    }
}

export type SignInAttempt = "no-code" | "wrong-code" | "wrong-recovery-code";

/** Records a right password sent without a right code, for the sign-in settings. */
export function recordSignInAttempt(attempt: SignInAttempt) {
    device_records.addDeviceRecordEntries("signInAttemptRecord", [ attempt ]);
}
