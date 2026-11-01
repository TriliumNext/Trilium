import { SETUP_MARKER_FILE_NAME, type SetupMarker } from "@triliumnext/commons";
import { getLog, getSql, parseSetupMarker, type SetupPlatform } from "@triliumnext/core";
import fs from "fs";
import path from "path";

import config from "./config.js";
import dataDirs from "./data_dir.js";

/**
 * The `setup.json` marker on a filesystem, for the server and the desktop.
 *
 * Reading it is separate from everything else here because of when it happens: before the database
 * is opened and before core exists, since what it says is whether to open the database at all. See
 * `setup_mode` in core for what it is for.
 *
 * @module
 */

function markerPath(): string {
    return path.join(dataDirs.TRILIUM_DATA_DIR, SETUP_MARKER_FILE_NAME);
}

/**
 * Reads the marker this start was left, and deletes it.
 *
 * Deleted on read rather than when the wizard is done with it: a marker that outlives its purpose
 * puts the instance in setup with no way out, which is worse than the reload it protects against.
 * What it asked for lives on in memory for this process, so a page reloaded mid-wizard still comes
 * back to the same screen, while a genuine restart comes back to the app.
 *
 * Never throws. A marker that cannot be read is one the instance is better off without.
 */
export function consumeSetupMarker(): SetupMarker | null {
    const filePath = markerPath();

    let raw: string;
    try {
        raw = fs.readFileSync(filePath, "utf8");
    } catch {
        // Overwhelmingly: there is no marker, which is what an ordinary start looks like.
        return null;
    }

    try {
        fs.rmSync(filePath, { force: true });
    } catch (e) {
        // Left behind, it would send the next start into setup as well. Worth saying out loud.
        getLog().error(`Could not remove the setup marker: ${e instanceof Error ? e.message : String(e)}`);
    }

    const marker = parseSetupMarker(raw);
    if (!marker) {
        getLog().error("The setup marker could not be read and was ignored.");
    }

    return marker;
}

/** What setup reaches for on this platform: the marker file, and the database beside it. */
export const setupPlatform: SetupPlatform = {
    async writeMarker(marker: SetupMarker) {
        fs.writeFileSync(markerPath(), JSON.stringify(marker, null, 4), "utf8");
    },

    async hasMarker() {
        return fs.existsSync(markerPath());
    },

    async removeMarker() {
        fs.rmSync(markerPath(), { force: true });
    },

    async removeDatabase() {
        // Detached first: on Windows an open handle is enough to make the file undeletable, and
        // leaving the connection attached to a file that is gone is worse than either. Closing also
        // folds the -wal back into the database, so what goes below is already spent.
        getSql().detachConnection();

        const document = dataDirs.DOCUMENT_PATH;
        try {
            // The sidecars before the database itself, so a removal that stops part-way leaves a
            // whole database rather than half of one. The other order can leave a stale -wal beside
            // a freshly created database of the same name, which SQLite would try to replay into it.
            for (const file of [ `${document}-wal`, `${document}-shm`, document ]) {
                fs.rmSync(file, { force: true });
            }
        } finally {
            // Whatever happened above, this process has to come back holding a connection: opening
            // a path with nothing at it creates it empty, which is the state a first run begins in.
            // Without one, every later request answers "DB not open" until the application is
            // restarted — including the ones the wizard needs to report what went wrong and let the
            // user try again. A removal that failed leaves the database whole, and reopens onto it.
            getSql().attachFromFile(document, config.General.readOnly);
        }
    }
};
