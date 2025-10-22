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
import userManagement from "../services/user_management_collaborative.js";
import sql from "../services/sql.js";

function loginPage(req: Request, res: Response) {
    // Login page is triggered twice. Once here, and another time (see sendLoginError) if the password is failed.
    // Check if multi-user mode is active
    const userCount = isMultiUserEnabled() ? sql.getValue(`SELECT COUNT(*) FROM users WHERE isActive = 1`) as number : 0;
    const multiUserMode = userCount > 1;
    
    res.render('login', {
        wrongPassword: false,
        wrongTotp: false,
        totpEnabled: totp.isTotpEnabled(),
        ssoEnabled: openID.isOpenIDEnabled(),
        ssoIssuerName: openID.getSSOIssuerName(),
        ssoIssuerIcon: openID.getSSOIssuerIcon(),
        multiUserMode,
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
 *     description: This will give you a Trilium session, which is required for some other API endpoints. `totpToken` is only required if the user configured TOTP authentication. In multi-user mode, `username` is also required.
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
 *               username:
 *                 type: string
 *                 description: Username (required in multi-user mode)
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
    const submittedUsername = req.body.username; // New field for multi-user mode

    if (totp.isTotpEnabled()) {
        if (!verifyTOTP(submittedTotpToken)) {
            sendLoginError(req, res, 'totp');
            return;
        }
    }

    // Check if multi-user mode is enabled
    const multiUserMode = isMultiUserEnabled();
    let authenticatedUser: any = null;

    if (multiUserMode) {
        if (submittedUsername) {
            // Multi-user authentication when username is provided
            authenticatedUser = await verifyMultiUserCredentials(submittedUsername, submittedPassword);
            if (!authenticatedUser) {
                sendLoginError(req, res, 'credentials');
                return;
            }
        } else {
            // Backward-compatible fallback: allow legacy password-only login
            if (!verifyPassword(submittedPassword)) {
                sendLoginError(req, res, 'password');
                return;
            }
        }
    } else {
        // Legacy single-user authentication
        if (!verifyPassword(submittedPassword)) {
            sendLoginError(req, res, 'password');
            return;
        }
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

        // Store user information in session for multi-user mode
        if (authenticatedUser) {
            req.session.userId = authenticatedUser.userId; // Store userId from users table
            req.session.username = authenticatedUser.username;
            req.session.isAdmin = authenticatedUser.role === 'admin';
        } else if (multiUserMode) {
            // If no username provided but multi-user mode, default to admin user
            req.session.userId = 1;
            req.session.username = 'admin';
            req.session.isAdmin = true;
        }

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

    return guess_hashed.equals(hashed_password);
}

/**
 * Check if multi-user mode is enabled (users table has users)
 */
function isMultiUserEnabled(): boolean {
    try {
        const count = sql.getValue(`SELECT COUNT(*) as count FROM users WHERE isActive = 1`) as number;
        return count > 0;
    } catch (e) {
        return false;
    }
}

/**
 * Authenticate using multi-user credentials (username + password)
 */
async function verifyMultiUserCredentials(username: string, password: string) {
    return await userManagement.validateCredentials(username, password);
}

function sendLoginError(req: Request, res: Response, errorType: 'password' | 'totp' | 'credentials' = 'password') {
    // note that logged IP address is usually meaningless since the traffic should come from a reverse proxy
    if (totp.isTotpEnabled()) {
        log.info(`WARNING: Wrong ${errorType} from ${req.ip}, rejecting.`);
    } else {
        log.info(`WARNING: Wrong password from ${req.ip}, rejecting.`);
    }

    const userCount = isMultiUserEnabled() ? sql.getValue(`SELECT COUNT(*) FROM users WHERE isActive = 1`) as number : 0;
    const multiUserMode = userCount > 1;

    res.status(401).render('login', {
        wrongPassword: errorType === 'password' || errorType === 'credentials',
        wrongTotp: errorType === 'totp',
        totpEnabled: totp.isTotpEnabled(),
        ssoEnabled: openID.isOpenIDEnabled(),
        multiUserMode,
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
