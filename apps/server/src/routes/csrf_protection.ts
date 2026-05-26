import { doubleCsrf } from "csrf-csrf";
import type { NextFunction, Request, Response } from "express";

import { isInternalElectronRequest } from "../services/electron_request.js";
import sessionSecret from "../services/session_secret.js";

export const CSRF_COOKIE_NAME = "trilium-csrf";

const doubleCsrfUtilities = doubleCsrf({
    getSecret: () => sessionSecret,
    cookieOptions: {
        path: "/",
        secure: false,
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
    return doubleCsrfUtilities.doubleCsrfProtection(req, res, next);
}
