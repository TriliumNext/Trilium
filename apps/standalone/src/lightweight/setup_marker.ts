import { SETUP_MARKER_FILE_NAME, type SetupMarker } from "@triliumnext/commons";
import { parseSetupMarker } from "@triliumnext/core";

/**
 * The `setup.json` marker in the browser's own storage.
 *
 * The same file the server and the desktop keep in the data directory, kept here in the origin's
 * private filesystem beside the database pointer, for the same reason and read at the same moment:
 * before the database is opened, since what it says is whether to open it at all. See `setup_mode`
 * in core.
 *
 * Reloading the page is what a restart is here, since it tears down the worker that holds the
 * database and starts another one, so this platform gets the same boot-into-setup that a relaunch
 * gives the desktop.
 *
 * @module
 */

/**
 * Reads the marker this start was left, and deletes it.
 *
 * Deleted on read for the reason the other platforms delete it: a marker that outlives its purpose
 * puts the instance in setup with no way out. What it asked for lives on in memory for as long as
 * this worker does.
 *
 * Never throws. A marker that cannot be read is one the instance is better off without.
 */
export async function consumeSetupMarker(): Promise<SetupMarker | null> {
    let raw: string;

    try {
        const root = await navigator.storage.getDirectory();
        const handle = await root.getFileHandle(SETUP_MARKER_FILE_NAME);
        raw = await (await handle.getFile()).text();
        await root.removeEntry(SETUP_MARKER_FILE_NAME);
    } catch {
        // Overwhelmingly: there is no marker, which is what an ordinary start looks like.
        return null;
    }

    return parseSetupMarker(raw);
}

/** Whether one is lying there waiting to be read, which on this platform is only ever briefly. */
export async function hasSetupMarker(): Promise<boolean> {
    try {
        const root = await navigator.storage.getDirectory();
        await root.getFileHandle(SETUP_MARKER_FILE_NAME);
        return true;
    } catch {
        return false;
    }
}

/** Leaves the marker that makes the next start the wizard. */
export async function writeSetupMarker(marker: SetupMarker): Promise<void> {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(SETUP_MARKER_FILE_NAME, { create: true });
    const writable = await handle.createWritable();

    try {
        await writable.write(JSON.stringify(marker, null, 4));
    } finally {
        await writable.close();
    }
}

/** Takes it back, for a request that was made and then abandoned. */
export async function removeSetupMarker(): Promise<void> {
    try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry(SETUP_MARKER_FILE_NAME);
    } catch {
        // Nothing to remove, which is the state the caller wanted anyway.
    }
}
