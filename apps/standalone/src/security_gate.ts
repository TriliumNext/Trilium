import type { SecurityToggleName, StandaloneSecurityApi } from "@triliumnext/commons";

import { requestSecurityChange } from "./local-bridge.js";

/**
 * What stands between a request to enable backend scripting and the file that grants it.
 *
 * The desktop asks the operating system to draw this dialog, because a note script can reach every
 * dialog the application draws for itself. Here the equivalent is `confirm()`: the browser draws
 * it, a page cannot overlay it, click it or read its answer, and script execution stops dead until
 * the user has answered. That makes a script calling {@link StandaloneSecurityApi} no better off
 * than a script clicking the toggle in the settings would be — it summons the real dialog, with
 * the real warning, and gets whatever the user says.
 *
 * Three things beyond the dialog itself, in the order they stop an attempt:
 *
 * - The function `confirm` was at load, captured below. A script that assigns `window.confirm =
 *   () => true` replaces what everything else on the page sees, not what this calls.
 * - Transient user activation, where the browser tracks it. A script on a timer has none, so it
 *   never reaches the dialog at all; the toggle the user just clicked does.
 * - A decline limit, which is the backstop where activation is not tracked (Firefox). A script
 *   that keeps asking gets {@link MAX_DECLINES} dialogs and then silence, so it cannot wear the
 *   user down into clicking OK. One accidental Cancel does not cost the user the toggle, and the
 *   limit covers granting only, so it can never stand between the user and turning a capability
 *   back off.
 *
 * @module
 */

/**
 * Captured while the page is still only its own code: this module is loaded from `main.ts`, long
 * before the client fetches a note's script bundle.
 */
const nativeConfirm: typeof window.confirm | null =
    typeof window.confirm === "function" ? window.confirm.bind(window) : null;

/** Declines before this stops asking, high enough that a misclick is not a lockout. */
const MAX_DECLINES = 2;

let declines = 0;

/** One dialog at a time, so a second request cannot be raised over the answer to the first. */
let asking = false;

export function createSecurityApi(): StandaloneSecurityApi {
    return {
        setBackendScriptingEnabled: (enabled) => requestChange("backendScriptingEnabled", enabled),
        setSqlConsoleEnabled: (enabled) => requestChange("sqlConsoleEnabled", enabled)
    };
}

/** Whether the user agreed, and the change reached the file. Every other answer is `false`. */
async function requestChange(
    setting: SecurityToggleName, enabled: boolean
): Promise<boolean> {
    // Only granting is limited. Turning a capability off is what the user does to get out of a
    // situation like this one, and a script that keeps asking for it can achieve nothing worse
    // than the user agreeing.
    const outOfDialogs = enabled && declines >= MAX_DECLINES;
    if (!nativeConfirm || asking || outOfDialogs || !hasUserActivation()) {
        return false;
    }

    asking = true;
    try {
        if (!nativeConfirm(await promptFor(setting, enabled))) {
            if (enabled) {
                declines++;
            }
            return false;
        }

        return await requestSecurityChange(setting, enabled);
    } finally {
        asking = false;
    }
}

/**
 * Whether the user did something just now, which is what a request nobody made lacks.
 *
 * Firefox exposes no `userActivation`, so there the dialog and the decline limit carry this alone.
 * Treating its absence as "no activation" would leave the toggle dead in that browser.
 */
function hasUserActivation(): boolean {
    const activation = navigator.userActivation;
    return !activation || activation.isActive;
}

/**
 * What the dialog says.
 *
 * The text belongs to this module rather than to whoever calls it: a caller that supplied its own
 * could describe the change as something else, and the caller is not necessarily the settings page.
 * The client's catalogue is loaded by the time any of this can be reached, so importing it here
 * costs nothing and keeps i18next out of the startup bundle.
 */
async function promptFor(
    setting: SecurityToggleName, enabled: boolean
): Promise<string> {
    const { t } = await import("../../client/src/services/i18n.js");
    const settingLabel = setting === "backendScriptingEnabled"
        ? t("security.backend_scripting_title")
        : t("security.sql_console_title");

    if (!enabled) {
        return t("security.standalone.confirm_disable", { setting: settingLabel });
    }

    const warning = setting === "backendScriptingEnabled"
        ? t("security.standalone.confirm_backend_scripting_warning")
        : t("security.standalone.confirm_sql_console_warning");

    return t("security.standalone.confirm_enable", { setting: settingLabel, warning });
}
