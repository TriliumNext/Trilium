import { password as passwordService, ValidationError } from "@triliumnext/core";
import type { Request, Response } from 'express';

import { verifyLoginCredentials } from "../services/auth.js";
import openIDEncryption from '../services/encryption/open_id_encryption.js';
import { getLog } from "@triliumnext/core";
import openID from '../services/open_id.js';
import totp from '../services/totp.js';

function loginPage(req: Request, res: Response) {
    // The login screen is served by the SPA at the root now (driven by the bootstrap
    // `loggedIn: false` payload, which also surfaces any one-shot SSO error left by a
    // failed OIDC round-trip); redirect any direct hits there.
    res.redirect(".");
}

function setPasswordPage(req: Request, res: Response) {
    // The set-password screen is served by the SPA at the root now (driven by the
    // bootstrap `passwordSet: false` flag); redirect any direct hits there.
    res.redirect(".");
}

async function setPassword(req: Request, res: Response) {
    if (passwordService.isPasswordSet()) {
        throw new ValidationError("Password has been already set");
    }

    let { password1, password2 } = req.body;
    password1 = password1.trim();
    password2 = password2.trim();

    // The client validates these before submitting; the server checks are a safety
    // net, so a violation here is an exceptional case rather than normal flow.
    if (password1 !== password2) {
        throw new ValidationError("Entered passwords don't match.");
    } else if (password1.length < 4) {
        throw new ValidationError("Password must be at least 4 characters long.");
    }

    await passwordService.setPassword(password1);

    res.redirect("login");
}

/**
 * @swagger
 * /login:
 *   post:
 *     tags:
 *       - auth
 *     summary: Log in using password
 *     description: This will give you a Trilium session, which is required for some other API endpoints. `totpToken` is only required if the user configured TOTP authentication.
 *     operationId: login-normal
 *     externalDocs:
 *       description: HMAC calculation
 *       url: https://github.com/TriliumNext/Trilium/blob/v0.91.6/src/services/utils.ts#L62-L66
 *     requestBody:
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required:
 *               - password
 *             properties:
 *               password:
 *                 type: string
 *               totpToken:
 *                 type: string
 *     responses:
 *       '200':
 *         description: Successful operation
 *       '401':
 *         description: Password / TOTP mismatch
 */
async function login(req: Request, res: Response) {
    if (openID.isOpenIDEnabled()) {
        void res.oidc.login({ returnTo: '/' });
        return;
    }

    const submittedPassword = req.body.password;
    const submittedTotpToken = req.body.totpToken;

    const failedFactor = await verifyLoginCredentials(submittedPassword, submittedTotpToken);
    if (failedFactor) {
        sendLoginError(req, res, failedFactor);
        return;
    }

    const rememberMe = req.body.rememberMe;

    req.session.regenerate(() => {
        if (!rememberMe) {
            // unset default maxAge set by sessionParser
            // Cookie becomes non-persistent and expires
            // after current browser session (e.g. when browser is closed)
            req.session.cookie.maxAge = undefined;
        }

        req.session.lastAuthState = {
            totpEnabled: totp.isTotpEnabled(),
            ssoEnabled: openID.isOpenIDEnabled()
        };

        req.session.loggedIn = true;
        // The client submits via fetch (following this redirect, which applies the new
        // session cookie) and then navigates to the app. The 302 also keeps the login
        // rate limiter skipping successful attempts (it only counts >= 400 responses).
        res.redirect('.');
    });
}

function sendLoginError(req: Request, res: Response, errorType: 'password' | 'totp' = 'password') {
    // note that logged IP address is usually meaningless since the traffic should come from a reverse proxy
    if (totp.isTotpEnabled()) {
        getLog().info(`WARNING: Wrong ${errorType} from ${req.ip}, rejecting.`);
    } else {
        getLog().info(`WARNING: Wrong password from ${req.ip}, rejecting.`);
    }

    // The client submits via fetch; report the failed factor as JSON. The 401 keeps the
    // login rate limiter counting failed attempts (it skips successful, <400 responses).
    res.status(401).json({ success: false, factor: errorType });
}

function logout(req: Request, res: Response) {
    req.session.regenerate(() => {
        req.session.loggedIn = false;

        if (openID.isOpenIDEnabled() && openIDEncryption.isSubjectIdentifierSaved() && res.oidc) {
            // oidc.logout() already issues the redirect (to the provider's end-session
            // endpoint, or locally), so we must not send our own response afterwards.
            // res.oidc is only present once the OIDC middleware has initialised; if it
            // hasn't (e.g. a failed lazy init), fall through to the local redirect below.
            void res.oidc.logout({ returnTo: '/' });
            return;
        }

        res.redirect('login');
    });
}

export default {
    loginPage,
    setPasswordPage,
    setPassword,
    login,
    logout
};
