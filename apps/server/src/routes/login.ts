import crypto from "crypto";
import utils from "../services/utils.js";
import optionService from "../services/options.js";
import myScryptService from "../services/encryption/my_scrypt.js";
import log from "../services/log.js";
import passwordService from "../services/encryption/password.js";
import assetPath, { assetUrlFragment } from "../services/asset_path.js";
import appPath from "../services/app_path.js";
import ValidationError from "../errors/validation_error.js";
import type { Request, Response } from 'express';
import totp from '../services/totp.js';
import recoveryCodeService from '../services/encryption/recovery_codes.js';
import openID from '../services/open_id.js';
import openIDEncryption from '../services/encryption/open_id_encryption.js';
import { getCurrentLocale } from "../services/i18n.js";

function loginPage(req: Request, res: Response) {
    // Login page is triggered twice. Once here, and another time (see sendLoginError) if the password is failed.
    res.render('login', {
        wrongPassword: false,
        wrongTotp: false,
        totpEnabled: totp.isTotpEnabled(),
        ssoEnabled: openID.isOpenIDEnabled(),
        ssoIssuerName: openID.getSSOIssuerName(),
        ssoIssuerIcon: openID.getSSOIssuerIcon(),
        assetPath: assetPath,
        assetPathFragment: assetUrlFragment,
        appPath: appPath,
        currentLocale: getCurrentLocale()
    });
}

function setPasswordPage(req: Request, res: Response) {
    res.render("set_password", {
        error: false,
        assetPath,
        appPath,
        currentLocale: getCurrentLocale()
    });
}

function setPassword(req: Request, res: Response) {
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
            currentLocale: getCurrentLocale()
        });
        return;
    }

    passwordService.setPassword(password1);

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
function login(req: Request, res: Response) {
    if (openID.isOpenIDEnabled()) {
        res.oidc.login({
            returnTo: '/',
            authorizationParams: {
                prompt: 'consent',
                access_type: 'offline'
            }
        });
        return;
    }

    const submittedPassword = req.body.password;
    const submittedTotpToken = req.body.totpToken;

    if (totp.isTotpEnabled()) {
        if (!verifyTOTP(submittedTotpToken)) {
            sendLoginError(req, res, 'totp');
            return;
        }
    }

    if (!verifyPassword(submittedPassword)) {
        sendLoginError(req, res, 'password');
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
        res.redirect('.');
    });
}

function verifyTOTP(submittedTotpToken: string) {
    if (totp.validateTOTP(submittedTotpToken)) return true;

    const recoveryCodeValidates = recoveryCodeService.verifyRecoveryCode(submittedTotpToken);

    return recoveryCodeValidates;
}

function verifyPassword(submittedPassword: string) {
    const hashed_password = utils.fromBase64(optionService.getOption("passwordVerificationHash"));

    const guess_hashed = myScryptService.getVerificationHash(submittedPassword);

    // Use constant-time comparison to prevent timing attacks
    if (hashed_password.length !== guess_hashed.length) {
        return false;
    }
    return crypto.timingSafeEqual(guess_hashed, hashed_password);
}

function sendLoginError(req: Request, res: Response, errorType: 'password' | 'totp' = 'password') {
    // note that logged IP address is usually meaningless since the traffic should come from a reverse proxy
    if (totp.isTotpEnabled()) {
        log.info(`WARNING: Wrong ${errorType} from ${req.ip}, rejecting.`);
    } else {
        log.info(`WARNING: Wrong password from ${req.ip}, rejecting.`);
    }

    res.status(401).render('login', {
        wrongPassword: errorType === 'password',
        wrongTotp: errorType === 'totp',
        totpEnabled: totp.isTotpEnabled(),
        ssoEnabled: openID.isOpenIDEnabled(),
        assetPath: assetPath,
        assetPathFragment: assetUrlFragment,
        appPath: appPath,
        currentLocale: getCurrentLocale()
    });
}

function logout(req: Request, res: Response) {
    req.session.regenerate(() => {
        req.session.loggedIn = false;

        if (openID.isOpenIDEnabled() && openIDEncryption.isSubjectIdentifierSaved()) {
            res.oidc.logout({ returnTo: '/' });
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
