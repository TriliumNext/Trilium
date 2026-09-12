import type { SetupTargetScreen } from "@triliumnext/commons";

import { t } from "./i18n";
import server from "./server";
import { isElectron, isStandalone, restartDesktopApp } from "./utils";

/**
 * Sends the instance into the setup wizard, from inside the running app.
 *
 * Some things a user can ask for need the setup screen and need the database closed while they
 * happen: restoring a backup is the first of them. Rather than doing that underneath a running app,
 * the instance writes down what was asked for and starts again, and the start that follows finds the
 * marker and comes up as the wizard. See `setup_mode` in core for the other half.
 *
 * The language is not passed from here. It is filled in on the way out from the instance's own
 * option, because it has to be the language of the database that is about to be left closed.
 *
 * @param options where the wizard should open, and nothing else yet.
 * @throws Error where this build cannot start again, so no marker is left to be found much later.
 */
export async function bootToSetup(options: { targetScreen?: SetupTargetScreen } = {}): Promise<void> {
    if (!canBootToSetup()) {
        throw new Error("This build cannot restart itself, so it cannot boot into setup.");
    }

    await server.post("setup/boot", { targetScreen: options.targetScreen });

    // Electron relaunches, which is a real start with nothing attached. Everywhere else reloads,
    // which for the browser-only build tears down the worker holding the database and amounts to
    // the same thing.
    restartDesktopApp();
}

/**
 * Whether this build can act on a marker at all.
 *
 * The desktop relaunches and the browser-only build reloads its worker, so both come back to a start
 * that reads the marker. A browser talking to a server reloads only itself, leaving the server
 * running with the database open and the marker unread until it is next restarted, which could be
 * days later and would be the last thing the user expected. So it is not offered there yet.
 */
export function canBootToSetup(): boolean {
    return isElectron() || isStandalone;
}

/**
 * What became of a start-over the user asked for.
 *
 * `restarting` is the ordinary answer and nothing follows it: the application is on its way down.
 * `pending` belongs to a server, which is restarted by whoever runs it rather than by itself, so
 * the request sits in the data directory until then and the interface has to say so.
 */
export type StartOverOutcome = "cancelled" | "restarting" | "pending";

/**
 * Sends the instance back to the setup screen, from the top.
 *
 * The same marker every other way into the wizard writes, with no screen named: the wizard opens on
 * its first screen, offers a copy of the knowledge base, and then offers every way of starting one.
 * Nothing is erased here, and nothing is erased by the restart either.
 *
 * The confirmation is the operating system's own rather than one of the application's: a note
 * script can reach every dialog Trilium draws for itself, and this is the way to a screen that can
 * replace a knowledge base.
 */
export async function startOver(): Promise<StartOverOutcome> {
    if (!await confirmStartOver()) {
        return "cancelled";
    }

    await server.post("setup/boot");

    if (!canBootToSetup()) {
        // Reloading would only restart the browser, leaving the server up with the database open
        // and the marker unread. The owner restarts it, and until they do the request stands.
        return "pending";
    }

    restartDesktopApp();

    return "restarting";
}

/** Whether a start-over asked for earlier is still waiting for the restart that acts on it. */
export async function isStartOverPending(): Promise<boolean> {
    const { requested } = await server.get<{ requested: boolean }>("setup/boot");

    return requested;
}

/** Takes the request back, which only means anything before that restart. */
export async function cancelStartOver(): Promise<void> {
    await server.remove("setup/boot");
}

/**
 * The last thing between a knowledge base and the screen that can replace it.
 *
 * An OS message box on the desktop, for the reason the security toggles use one, and the browser's
 * own `confirm` everywhere else: both are drawn by something other than Trilium, so neither can be
 * dismissed by a script running inside it.
 */
async function confirmStartOver(): Promise<boolean> {
    if (window.electronApi) {
        return await window.electronApi.dialog.confirmStartOver();
    }

    return window.confirm(t("database.start_over_confirm"));
}
