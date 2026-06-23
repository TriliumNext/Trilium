import { i18n, password as passwordService, user_service, ValidationError } from "@triliumnext/core";
import type { Request, Response } from 'express';

import appPath from "../services/app_path.js";
import assetPath, { assetUrlFragment } from "../services/asset_path.js";
import { verifyLoginCredentials } from "../services/auth.js";
import openIDEncryption from '../services/encryption/open_id_encryption.js';
import { getLog } from "@triliumnext/core";
import openID from '../services/open_id.js';
import totp from '../services/totp.js';

function loginPage(req: Request, res: Response) {
    // Login page is triggered twice. Once here, and another time (see sendLoginError) if the password is failed.
    // A failed SSO round-trip (wrong account / not yet enrolled) leaves a one-shot reason on the session in
    // the OIDC afterCallback; read and clear it so the message shows exactly once.
    const ssoError = req.session.ssoError;
    if (ssoError) {
        delete req.session.ssoError;
    }

    res.render('login', {
        wrongPassword: false,
        wrongTotp: false,
        ssoError,
        totpEnabled: totp.isTotpEnabled(),
        ssoEnabled: openID.isOpenIDEnabled(),
        ssoIssuerName: openID.getSSOIssuerName(),
        ssoIssuerIcon: openID.getSSOIssuerIcon(),
        assetPath,
        assetPathFragment: assetUrlFragment,
        appPath,
        currentLocale: i18n.getCurrentLocale()
    });
}

function setPasswordPage(req: Request, res: Response) {
    res.render("set_password", {
        error: false,
        assetPath,
        appPath,
        currentLocale: i18n.getCurrentLocale()
    });
}

async function setPassword(req: Request, res: Response) {
    if (passwordService.isPasswordSet()) {
        throw new ValidationError("Password has been already set");
    }

    let { password1, password2 } = req.body;
    password1 = password1.trim();
    password2 = password2.trim();

    let error;

    if (password1 !== password2) {
        error = "Entered passwords don't match.";
    } else if (password1.length < 4) {
        error = "Password must be at least 4 characters long.";
    }

    if (error) {
        res.render("set_password", {
            error,
            assetPath,
            appPath,
            currentLocale: i18n.getCurrentLocale()
        });
        return;
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
        req.session.userId = user_service.getAdminUserId();
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

    res.status(401).render('login', {
        wrongPassword: errorType === 'password',
        wrongTotp: errorType === 'totp',
        ssoError: false,
        totpEnabled: totp.isTotpEnabled(),
        ssoEnabled: openID.isOpenIDEnabled(),
        ssoIssuerName: openID.getSSOIssuerName(),
        ssoIssuerIcon: openID.getSSOIssuerIcon(),
        assetPath,
        assetPathFragment: assetUrlFragment,
        appPath,
        currentLocale: i18n.getCurrentLocale()
    });
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
