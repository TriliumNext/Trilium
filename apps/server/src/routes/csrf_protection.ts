import { doubleCsrf } from "csrf-csrf";
import sessionSecret from "../services/session_secret.js";
import { isElectron } from "../services/utils.js";

export const CSRF_COOKIE_NAME = "trilium-csrf";

const doubleCsrfUtilities = doubleCsrf({
    getSecret: () => sessionSecret,
    cookieOptions: {
        path: "/",
        secure: false,
        sameSite: "strict",
        httpOnly: !isElectron // set to false for Electron, see https://github.com/TriliumNext/Trilium/pull/966
    },
    cookieName: CSRF_COOKIE_NAME,
    getSessionIdentifier: (req) => req.session.id
});

export const { generateCsrfToken, doubleCsrfProtection } = doubleCsrfUtilities;
