import { attributes, isSetupAuthorized, isSetupAuthRequired, options, password as passwordService, password_encryption as passwordEncryptionService } from "@triliumnext/core";
import type { NextFunction, Request, Response } from "express";

import config from "./config.js";
import { isInternalElectronRequest } from "./electron_request.js";
import recoveryCodeService from "./encryption/recovery_codes.js";
import etapiTokenService from "./etapi_tokens.js";
import { getLog } from "@triliumnext/core";
import openID from "./open_id.js";
import sqlInit from "./sql_init.js";
import totp from "./totp.js";
import { isElectron } from "./utils.js";

let noAuthentication = false;
refreshAuth();

function checkAuth(req: Request, res: Response, next: NextFunction) {
    if (!sqlInit.isDbInitialized()) {
        // DB not initialized — let the request through so the client app
        // can show its setup UI based on the bootstrap response.
        return next();
    }

    if (!isElectron && !passwordService.isPasswordSet()) {
        // DB initialized but no password set yet — on the web/server the instance is
        // unprotected until the user sets one, so let the request through for the client
        // to fetch its bootstrap and render the set-password screen. Desktop never shows
        // this screen (it's handled by the internal-electron / session checks below), and
        // the API stays protected separately via checkApiAuth (which still requires a session).
        return next();
    }

    const currentTotpStatus = totp.isTotpEnabled();
    const currentSsoStatus = openID.isOpenIDEnabled();
    const lastAuthState = req.session.lastAuthState || { totpEnabled: false, ssoEnabled: false };

    if (isInternalElectronRequest(req) || noAuthentication) {
        next();
        return;
    } else if (!req.session.loggedIn && !noAuthentication) {
        // check redirectBareDomain option first

        // cannot use options.getOptionBool currently => it will throw an error on new installations
        // TriliumNextTODO: look into potentially creating an getOptionBoolOrNull instead
        const hasRedirectBareDomain = options.getOptionOrNull("redirectBareDomain") === "true";

        // The redirect targets only a bare document request for the root. The login
        // screen is served by the SPA at the root too, so an explicit login navigation
        // (GET /login redirects here with a `?login` marker) and SPA sub-requests such
        // as /bootstrap must fall through to it — otherwise enabling the option locks
        // the owner out of the instance entirely (#10552).
        const isBareRootRequest = req.path === "/" && req.query.login === undefined;

        if (hasRedirectBareDomain && isBareRootRequest) {
            // Only redirect to the share page when a share root is actually configured.
            // Otherwise (e.g. the owner's session expired before they set one up) fall back
            // to the login screen rather than stranding the user on a 404. See #7869.
            const shareRootNotes = attributes.getNotesWithLabel("shareRoot");
            if (shareRootNotes.length > 0) {
                res.redirect("share");
                return;
            }
        }
        // Otherwise serve the SPA, which renders the login screen from the bootstrap
        // `loggedIn: false` payload. The API stays protected separately via checkApiAuth.
        return next();
    } else if (currentTotpStatus !== lastAuthState.totpEnabled || currentSsoStatus !== lastAuthState.ssoEnabled) {
        req.session.destroy((err) => {
            if (err) console.error('Error destroying session:', err);
            res.redirect('login');
        });
        return;
    } else if (currentSsoStatus) {
        if (req.oidc?.isAuthenticated() && req.session.loggedIn) {
            next();
            return;
        }
        // SSO is enabled but the OIDC session has lapsed while the Trilium session still
        // carries loggedIn:true — e.g. express-openid-connect's absolute-duration cap
        // (default 7d) expired on a still-live, rolling trilium.sid (default 21d). Redirecting
        // to /login here loops forever: loginPage 302s straight back to "." (the SPA root),
        // which lands right back in this branch (#10589 follow-up). Treat the session as logged
        // out and serve the SPA, which renders the login screen from the bootstrap
        // loggedIn:false payload. The API stays protected separately via checkApiAuth.
        //
        // Persist the flip explicitly before handing off: express-session's implicit save
        // only runs on res.end(), so with an async store the SPA's immediately-following
        // /bootstrap sub-request could otherwise read the still-loggedIn session and bounce
        // back through this branch instead of seeing loggedIn:false.
        req.session.loggedIn = false;
        req.session.save((err) => {
            if (err) console.error("Error saving session after OIDC session lapse:", err);
            next();
        });
        return;
    } else {
        next();
    }
}

/**
 * Rechecks whether authentication is needed or not by re-reading the config.
 * The value is cached to avoid reading at every request.
 *
 * Generally this method should only be called during tests.
 */
export function refreshAuth() {
    noAuthentication = (config.General && config.General.noAuthentication === true);
}

/**
 * Whether an uninitialized instance may let this request through unauthenticated.
 *
 * The bypass below exists because an instance with no database has nobody to authenticate and
 * nothing worth protecting. An instance sitting in the setup wizard with a knowledge base behind it
 * has both: the database is attached, and every route that reaches it through SQL rather than
 * through becca works exactly as it would on a running instance. Taking a backup of it and
 * downloading that backup are two such routes.
 *
 * So for the length of that window the bypass is conditional on the wizard's own token instead of
 * being granted outright. The exemptions are the ones `checkSetupAuth` makes, for the same reasons.
 */
function mayPassAsUninitialized(req: Request): boolean {
    if (sqlInit.isDbInitialized()) {
        return false;
    }
    if (!isSetupAuthRequired() || isInternalElectronRequest(req) || noAuthentication) {
        return true;
    }

    return isSetupAuthorized(readSetupAuthToken(req));
}

function readSetupAuthToken(req: Request): string | undefined {
    const token = req.headers["trilium-setup-auth"];

    return typeof token === "string" ? token : undefined;
}

// for electron things which need network stuff
//  currently, we're doing that for file upload because handling form data seems to be difficult
function checkApiAuthOrElectron(req: Request, res: Response, next: NextFunction) {
    if (mayPassAsUninitialized(req)) {
        return next();
    }

    if (!req.session.loggedIn && !isInternalElectronRequest(req) && !noAuthentication) {
        console.warn(`Missing session with ID '${req.sessionID}'.`);
        reject(req, res, "Logged in session not found");
    } else {
        next();
    }
}

function checkApiAuth(req: Request, res: Response, next: NextFunction) {
    if (mayPassAsUninitialized(req)) {
        return next();
    }

    // The desktop renderer is trusted (it's our own UI). API requests come in
    // via the `trilium-app://` custom protocol where Express sessions don't
    // round-trip — those carry the internal-electron marker and bypass auth.
    // Requests that arrive over the desktop's TCP HTTP listener (LAN, DNS-
    // rebound browser, co-resident process) do NOT carry the marker and go
    // through the normal session check.
    if (isInternalElectronRequest(req) || noAuthentication) {
        return next();
    }

    if (!req.session.loggedIn) {
        console.warn(`Missing session with ID '${req.sessionID}'.`);
        reject(req, res, "Logged in session not found");
    } else {
        next();
    }
}

function checkAppInitialized(_req: Request, _res: Response, next: NextFunction) {
    // Let the client app handle the uninitialized state via its setup UI.
    next();
}

function checkPasswordSet(req: Request, res: Response, next: NextFunction) {
    if (!isElectron && !passwordService.isPasswordSet()) {
        // The set-password screen is now served by the SPA at the root, driven by
        // the bootstrap `passwordSet: false` flag.
        res.redirect(".");
    } else {
        next();
    }
}

function checkPasswordNotSet(req: Request, res: Response, next: NextFunction) {
    if (!isElectron && passwordService.isPasswordSet()) {
        res.redirect("login");
    } else {
        next();
    }
}

function checkAppNotInitialized(req: Request, res: Response, next: NextFunction) {
    if (sqlInit.isDbInitialized()) {
        reject(req, res, "App already initialized.");
    } else {
        next();
    }
}

/**
 * Guards the setup routes that could replace or erase a knowledge base sitting behind the wizard.
 *
 * The rest of the authentication in this file stands down while the database is uninitialized, which
 * is exactly what an instance in setup mode reports, so nothing else here covers these routes. See
 * `setup_auth` in core for why the session cannot be used and what is used instead.
 *
 * Three ways past it, all of them cases where there is nothing to guard against: an instance with no
 * knowledge base behind the wizard, which is the ordinary first run; the desktop's own renderer,
 * which reaches the server over the custom protocol and is the application itself; and an instance
 * configured for no authentication, which has already said it trusts whoever can reach it.
 */
function checkSetupAuth(req: Request, res: Response, next: NextFunction) {
    if (!isSetupAuthRequired() || isInternalElectronRequest(req) || noAuthentication) {
        return next();
    }

    if (!isSetupAuthorized(readSetupAuthToken(req))) {
        reject(req, res, "The existing knowledge base has not been unlocked.");
        return;
    }

    next();
}

function checkEtapiToken(req: Request, res: Response, next: NextFunction) {
    if (etapiTokenService.isValidAuthHeader(req.headers.authorization)) {
        next();
    } else {
        reject(req, res, "Token not found");
    }
}

function reject(req: Request, res: Response, message: string) {
    getLog().info(`${req.method} ${req.path} rejected with 401 ${message}`);

    res.setHeader("Content-Type", "text/plain").status(401).send(message);
}

async function checkCredentials(req: Request, res: Response, next: NextFunction) {
    if (!sqlInit.isDbInitialized()) {
        res.setHeader("Content-Type", "text/plain").status(400).send("Database is not initialized yet.");
        return;
    }

    if (!passwordService.isPasswordSet()) {
        res.setHeader("Content-Type", "text/plain").status(400).send("Password has not been set yet. Please set a password and repeat the action");
        return;
    }

    const header = req.headers["trilium-cred"] || "";
    if (typeof header !== "string") {
        res.setHeader("Content-Type", "text/plain").status(400).send("Invalid data type for trilium-cred.");
        return;
    }

    const auth = Buffer.from(header, "base64").toString();
    const colonIndex = auth.indexOf(":");
    const password = colonIndex === -1 ? "" : auth.substr(colonIndex + 1);
    // username is ignored

    if (!(await passwordEncryptionService.verifyPassword(password))) {
        res.setHeader("Content-Type", "text/plain").status(401).send("Incorrect password");
        getLog().info(`WARNING: Wrong password from ${req.ip}, rejecting.`);
    } else {
        next();
    }
}

export type LoginFactor = "password" | "totp";

/**
 * Verifies submitted login credentials, returning the factor that failed or `null` when they are all
 * valid.
 *
 * The password is checked BEFORE the TOTP / recovery-code second factor on purpose: verifying a
 * recovery code consumes it (codes are single-use, see {@link recoveryCodeService.verifyRecoveryCode}).
 * Checking the second factor first would burn a recovery code on a login attempt that then fails on a
 * wrong password — silently wasting one of the user's limited codes. Password-first guarantees a
 * recovery code is only ever consumed once the rest of the login is known to succeed.
 */
export async function verifyLoginCredentials(password: string, totpToken: string): Promise<LoginFactor | null> {
    if (!(await passwordEncryptionService.verifyPassword(password))) {
        return "password";
    }

    if (totp.isTotpEnabled() && !verifyTOTP(totpToken)) {
        return "totp";
    }

    return null;
}

function verifyTOTP(submittedTotpToken: string) {
    if (totp.verifyTOTP(submittedTotpToken)) {
        return true;
    }

    return recoveryCodeService.verifyRecoveryCode(submittedTotpToken);
}

export default {
    checkAuth,
    checkApiAuth,
    checkAppInitialized,
    checkPasswordSet,
    checkPasswordNotSet,
    checkAppNotInitialized,
    checkSetupAuth,
    checkApiAuthOrElectron,
    checkEtapiToken,
    checkCredentials
};
