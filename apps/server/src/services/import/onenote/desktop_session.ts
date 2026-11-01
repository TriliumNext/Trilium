/**
 * Process-wide store for the OneNote importer's delegated-Graph token on the desktop build.
 *
 * On the server/web build the token lives in the user's express-session (see onenote_import.ts): the
 * device-flow sign-in is driven entirely by the same browser session that later runs the import, so
 * the session is the natural scope. The desktop build has no such session: it runs an
 * authorization-code flow whose OAuth callback arrives over a throwaway loopback HTTP server in the
 * main process, outside any Express session — the renderer talks to Express over the `trilium-app://`
 * custom protocol — so a session cookie cannot carry the sign-in result.
 *
 * Desktop is single-user and single-process, so a module-level singleton is the correct scope: the
 * main process writes the token here after a successful sign-in (see apps/desktop/src/services/onenote.ts)
 * and the dispatched API requests read it back from the same module instance.
 */

import type { GraphAccount } from "./graph.js";

export interface OneNoteTokenSession {
    accessToken?: string;
    refreshToken?: string;
    /** Epoch millis at which the access token expires. */
    expiresAt?: number;
    account?: GraphAccount;
}

let desktopSession: OneNoteTokenSession | null = null;

export function getDesktopSession(): OneNoteTokenSession | null {
    return desktopSession;
}

export function setDesktopSession(data: OneNoteTokenSession | null): void {
    desktopSession = data;
}
