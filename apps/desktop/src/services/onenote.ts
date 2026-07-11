import type { OneNoteLoginResult } from "@triliumnext/commons";
import { getLog, utils as coreUtils } from "@triliumnext/core";
import { setDesktopSession } from "@triliumnext/server/src/services/import/onenote/desktop_session.js";
import graph from "@triliumnext/server/src/services/import/onenote/graph.js";
import { ONENOTE_OAUTH } from "@triliumnext/server/src/services/import/onenote/oauth.js";
import electron from "electron";

import { authorizeViaLoopback } from "./loopback_oauth.js";

/**
 * Main-process handler for the OneNote importer's Microsoft sign-in on the desktop build.
 *
 * Just the OneNote-specific glue: it runs the provider-agnostic loopback OAuth flow with the OneNote
 * config, then resolves the signed-in account and stores the token in the process-wide desktop session
 * store that the dispatched API requests read from (see apps/server/.../onenote_import.ts). The renderer
 * invokes this and waits for the result.
 */
export function setupOneNoteHandlers() {
    electron.ipcMain.handle("onenote-login", async (): Promise<OneNoteLoginResult> => {
        try {
            const tokens = await authorizeViaLoopback(ONENOTE_OAUTH);
            const account = await graph.getAccount(tokens.access_token);

            setDesktopSession({
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiresAt: Date.now() + tokens.expires_in * 1000,
                account
            });

            return { connected: true, account };
        } catch (e) {
            getLog().error(`OneNote desktop sign-in failed: ${coreUtils.safeExtractMessageAndStackFromError(e)}`);
            return { connected: false, error: e instanceof Error ? e.message : String(e) };
        }
    });
}
