/**
 * Optional persistence bridge for native desktop shells (e.g. the Deno
 * Desktop prototype in `apps/desktop-deno`).
 *
 * When the standalone bundle is served by a native shell instead of a plain
 * web server, the shell can expose a loopback endpoint that stores the SQLite
 * database on the host filesystem. This provides persistence in webviews
 * that lack OPFS (e.g. WebKitGTK). The endpoint is probed at runtime, so the
 * same bundle keeps working unchanged under plain static hosting, where the
 * probe simply fails.
 *
 * Protocol (all on the page's own origin):
 * - `GET /desktop-db` → `200` with the stored database bytes, or `204` if
 *   the bridge is present but nothing has been saved yet. Any other status —
 *   or a body without the SQLite magic (e.g. an SPA fallback page) — means
 *   there is no bridge.
 * - `PUT /desktop-db` with the serialized database as the body persists it.
 */

const DB_ENDPOINT = "/desktop-db";
const SAVE_INTERVAL_MS = 15_000;

export type DesktopDatabaseProbe =
    | { available: false }
    | { available: true; buffer: Uint8Array | null };

/**
 * Checks whether a desktop shell persistence bridge is present and, if so,
 * returns the previously stored database (or `null` when none was saved yet).
 */
export async function fetchDesktopDatabase(): Promise<DesktopDatabaseProbe> {
    let response: Response;
    try {
        response = await fetch(DB_ENDPOINT);
    } catch {
        return { available: false };
    }

    if (response.status === 204) {
        return { available: true, buffer: null };
    }
    if (!response.ok) {
        return { available: false };
    }

    const buffer = new Uint8Array(await response.arrayBuffer());
    if (!hasSqliteMagic(buffer)) {
        // A static host answered this route with the SPA fallback page.
        return { available: false };
    }
    return { available: true, buffer };
}

/**
 * Periodically serializes the database and PUTs it to the shell.
 * Prototype-grade: saves unconditionally on an interval rather than tracking
 * dirty state.
 */
export function startDesktopDatabaseSync(
    serialize: () => Uint8Array,
    log: (message: string) => void
): void {
    let saving = false;

    setInterval(async () => {
        if (saving) {
            return;
        }
        saving = true;
        try {
            const body = serialize();
            const response = await fetch(DB_ENDPOINT, { method: "PUT", body });
            if (!response.ok) {
                log(`[DesktopPersistence] Save failed: HTTP ${response.status}`);
            }
        } catch (e) {
            log(`[DesktopPersistence] Save failed: ${e}`);
        } finally {
            saving = false;
        }
    }, SAVE_INTERVAL_MS);

    log(`[DesktopPersistence] Syncing database to the desktop shell every ${SAVE_INTERVAL_MS / 1000}s`);
}

function hasSqliteMagic(buffer: Uint8Array): boolean {
    return new TextDecoder().decode(buffer.subarray(0, 15)) === "SQLite format 3";
}
