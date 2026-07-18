/**
 * Single source of truth for the desktop app shell's custom scheme and origin.
 *
 * The renderer is served from `trilium-app://app/` — see the `loadURL` call
 * sites (window.ts, printing.ts) and the privileged-scheme registration in
 * protocol.ts. Several independent security gates must all agree on exactly
 * what "the app shell" is: the protocol dispatch origin check, the webRequest
 * frame guard, the navigation guard, and the permission-origin check. Deriving
 * each of them from the constants and predicate here keeps the layers from
 * drifting apart (a mismatch either bricks the app or silently weakens a gate).
 */

/** The privileged custom scheme the desktop UI is served from (no trailing colon). */
export const TRILIUM_APP_SCHEME = "trilium-app";

/** The sole host the app shell is ever loaded under. */
export const TRILIUM_APP_HOST = "app";

/** Canonical origin of the app shell, e.g. for exact `Origin`-header matching. */
export const TRILIUM_APP_ORIGIN = `${TRILIUM_APP_SCHEME}://${TRILIUM_APP_HOST}`;

/** Root URL the windows load (origin + `/`). */
export const TRILIUM_APP_BASE_URL = `${TRILIUM_APP_ORIGIN}/`;

/** True when `rawUrl` parses to the app shell origin (`trilium-app://app`). */
export function isTriliumAppShellUrl(rawUrl: string | null | undefined): boolean {
    if (!rawUrl) {
        return false;
    }
    try {
        const parsed = new URL(rawUrl);
        return parsed.protocol === `${TRILIUM_APP_SCHEME}:` && parsed.host === TRILIUM_APP_HOST;
    } catch {
        return false;
    }
}
