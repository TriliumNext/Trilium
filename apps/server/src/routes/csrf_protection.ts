import { doubleCsrf } from "csrf-csrf";
import type { NextFunction, Request, Response } from "express";

import { isInternalElectronRequest } from "../services/electron_request.js";
import sessionSecret from "../services/session_secret.js";
import config from "../services/config.js";
import sqlInit from "../services/sql_init.js";

export const CSRF_COOKIE_NAME = "trilium-csrf";

const doubleCsrfUtilities = doubleCsrf({
    getSecret: () => sessionSecret,
    cookieOptions: {
        path: "/",
        secure: config.Network.https,
        sameSite: "strict",
        httpOnly: true
    },
    cookieName: CSRF_COOKIE_NAME,
    getSessionIdentifier: (req) => req.session.id
});

export const { generateCsrfToken } = doubleCsrfUtilities;

// Skip CSRF validation only for requests dispatched via the `trilium-app://`
// custom protocol from our own renderer — Express sessions don't round-trip
// through that path, so the HMAC double-submit check has nothing meaningful
// to validate against. Keying off the per-request marker (rather than the
// process-wide `isElectron` flag) means TCP requests to the desktop's HTTP
// listener still get the full CSRF check. Auth is similarly gated in
// `services/auth.ts`.
export function doubleCsrfProtection(req: Request, res: Response, next: NextFunction) {
    if (isInternalElectronRequest(req)) {
        return next();
    }
    // Before the DB is initialized, sessions are never persisted (SQLiteSessionStore
    // no-ops), so every request carries a fresh session id and the session-bound CSRF
    // token can never validate — protected endpoints the setup wizard needs (sync/now
    // for resume/retry of the initial sync) would always 403. CSRF also has nothing to
    // protect at this stage: there is no authenticated session to ride. See #10548.
    if (!sqlInit.isDbInitialized()) {
        return next();
    }
    return doubleCsrfUtilities.doubleCsrfProtection(req, res, next);
}
