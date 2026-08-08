import type { SetupTargetScreen } from "@triliumnext/commons";

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
