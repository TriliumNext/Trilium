import { options } from "@triliumnext/core";
import type { NextFunction, Request, Response } from "express";
import type { Session } from "express-openid-connect";

import config from "./config.js";
import openIDEncryption from "./encryption/open_id_encryption.js";
import sql from "./sql.js";
import sqlInit from "./sql_init.js";
import log from "./log.js";

function checkOpenIDConfig() {
    const missingVars: string[] = [];
    if (config.MultiFactorAuthentication.oauthBaseUrl === "") {
        missingVars.push("oauthBaseUrl");
    }
    if (config.MultiFactorAuthentication.oauthClientId === "") {
        missingVars.push("oauthClientId");
    }
    if (config.MultiFactorAuthentication.oauthClientSecret === "") {
        missingVars.push("oauthClientSecret");
    }
    return missingVars;
}

function isOpenIDEnabled() {
    return !(checkOpenIDConfig().length > 0) && options.getOptionOrNull('mfaMethod') === 'oauth';
}

function isUserSaved() {
    const data = sql.getValue<string>("SELECT isSetup FROM user_data;");
    return data === "true";
}

function getUsername() {
    const username = sql.getValue<string>("SELECT username FROM user_data;");
    return username;
}

function getUserEmail() {
    const email = sql.getValue<string>("SELECT email FROM user_data;");
    return email;
}

function clearSavedUser() {
    sql.execute("DELETE FROM user_data");
    options.setOption("userSubjectIdentifierSaved", false);
    return {
        success: true,
        message: "Account data removed."
    };
}

function getOAuthStatus() {
    return {
        success: true,
        name: getUsername(),
        email: getUserEmail(),
        enabled: isOpenIDEnabled(),
        missingVars: checkOpenIDConfig()
    };
}

/**
 * In-flight refresh promises keyed by trilium.sid session ID, so concurrent expired-token
 * requests share a single network call to the IdP. Without this, refresh-token rotation
 * (Authentik, Auth0, Okta default) breaks under load: the first request consumes the RT,
 * the rest see invalid_grant on a stale RT and would (per the policy below) be force-logged
 * out — exactly the spurious-logout failure mode reported in oauth2-proxy#1992,
 * openai/codex#10332, and similar issues.
 */
const inFlightRefreshes = new Map<string, Promise<void>>();

/** Test-only: clear the in-flight refresh cache between cases. Not exported in the default. */
export function _resetInFlightRefreshesForTesting() {
    inFlightRefreshes.clear();
}

/**
 * Express middleware that refreshes the OIDC access token in-place when it is expired.
 *
 * Why this exists: express-openid-connect stores `access_token` and `refresh_token` in the
 * appSession cookie but does not auto-refresh on expiry. Without this middleware:
 *   - The access token goes stale after the IdP-configured TTL (typically 1 hour) even
 *     though the appSession cookie itself lives for 21 days.
 *   - Any Trilium feature that calls an IdP-protected API on the user's behalf would
 *     silently fail with stale credentials.
 *   - We have no signal when the IdP has revoked the user's session — a successful refresh
 *     is the only way to learn revocation between login and the next manual logout.
 *
 * Behavior:
 *   - Skipped when the user is not OIDC-authenticated, the access token is still valid,
 *     or no refresh token is present (the chosen `oauthScope` didn't include `offline_access`
 *     and the provider ignored `access_type=offline`).
 *   - On `invalid_grant` (RFC 6749: refresh token revoked / expired / consent withdrawn /
 *     auth policy changed): marks the local session as not-authenticated. The downstream
 *     `auth.checkAuth` middleware sees `!req.session.loggedIn` and redirects to /login.
 *     This matches Auth0/Okta/Logto guidance that invalid_grant is terminal — the user
 *     must re-authenticate.
 *   - On other errors (network blip, IdP 5xx, etc.): logs and proceeds. The local
 *     trilium.sid session is the source of truth for "is this user logged in," so a
 *     transient IdP outage doesn't bounce the user.
 *   - Concurrent requests with the same trilium.sid share one in-flight refresh promise,
 *     preventing refresh-token-rotation races.
 */
function refreshOidcTokenIfNeeded(req: Request, res: Response, next: NextFunction) {
    if (!req.oidc?.isAuthenticated() || !req.session?.loggedIn) {
        return next();
    }

    const accessToken = req.oidc.accessToken;
    if (!accessToken || !accessToken.isExpired()) {
        return next();
    }

    if (!req.oidc.refreshToken) {
        return next();
    }

    const sessionId = req.sessionID;
    let refreshPromise = inFlightRefreshes.get(sessionId);
    if (!refreshPromise) {
        refreshPromise = req.oidc
            .refresh()
            .then(() => undefined)
            .finally(() => {
                inFlightRefreshes.delete(sessionId);
            });
        inFlightRefreshes.set(sessionId, refreshPromise);
    }

    refreshPromise
        .then(() => next())
        .catch((err: unknown) => {
            const oauthError = (err as { error?: string })?.error;
            const message = err instanceof Error ? err.message : String(err);
            if (oauthError === 'invalid_grant') {
                log.info(`OIDC refresh token rejected by IdP (invalid_grant): ${message}. Forcing re-authentication.`);
                req.session.loggedIn = false;
                return next();
            }
            log.info(`OIDC token refresh failed: ${message}. Continuing with expired access token.`);
            next();
        });
}

async function isTokenValid(req: Request, res: Response, next: NextFunction) {
    const userStatus = openIDEncryption.isSubjectIdentifierSaved();

    if (req.oidc !== undefined) {
        try {
            await req.oidc.fetchUserInfo();
            return {
                success: true,
                message: "Token is valid",
                user: userStatus,
            };
        } catch (err) {
            log.info(`OIDC token validation failed: ${err instanceof Error ? err.message : String(err)}`);
            return {
                success: false,
                message: "Token is not valid",
                user: userStatus,
            };
        }
    }

    return {
        success: false,
        message: "Token not set up",
        user: userStatus,
    };
}

function getSSOIssuerName() {
    return config.MultiFactorAuthentication.oauthIssuerName;
}

function getSSOIssuerIcon() {
    return config.MultiFactorAuthentication.oauthIssuerIcon;
}

function generateOAuthConfig() {
    const authRoutes = {
        callback: "/callback",
        login: "/authenticate",
        postLogoutRedirect: "/login",
        logout: "/logout",
    };

    const logoutParams = {
    };

    const authConfig = {
        authRequired: false,
        auth0Logout: false,
        baseURL: config.MultiFactorAuthentication.oauthBaseUrl,
        clientID: config.MultiFactorAuthentication.oauthClientId,
        issuerBaseURL: config.MultiFactorAuthentication.oauthIssuerBaseUrl,
        secret: config.MultiFactorAuthentication.oauthClientSecret,
        clientSecret: config.MultiFactorAuthentication.oauthClientSecret,
        authorizationParams: {
            response_type: "code",
            scope: config.MultiFactorAuthentication.oauthScope,
            access_type: "offline",
            prompt: "consent",
        },
        routes: authRoutes,
        idpLogout: true,
        logoutParams,
        // Override the library's default 5000 ms timeout for discovery / token-exchange / userinfo requests.
        httpTimeout: config.MultiFactorAuthentication.oauthHttpTimeout,
        // Match the OIDC appSession cookie lifetime to Trilium's own trilium.sid cookie. The library defaults
        // (24h rolling, 7d absolute) silently capped the effective Trilium session at 7 days when SSO was on.
        // Both bounds are set to cookieMaxAge (default 21d): rollingDuration is required when rolling: true,
        // and keeping absoluteDuration as a hard cap follows the OWASP / Auth0 guidance that every session
        // should have an upper bound regardless of activity.
        session: {
            rolling: true,
            rollingDuration: config.Session.cookieMaxAge,
            absoluteDuration: config.Session.cookieMaxAge,
        },
        afterCallback: async (req: Request, res: Response, session: Session) => {
            if (!sqlInit.isDbInitialized()) return session;

            if (!req.oidc.user) {
                log.error("OIDC callback received without user info; aborting login");
                return session;
            }

            openIDEncryption.saveUser(
                req.oidc.user.sub.toString(),
                req.oidc.user.name.toString(),
                req.oidc.user.email.toString()
            );

            // Mirror the password-login flow: regenerate the trilium.sid session to mint a fresh
            // session ID on login (defense-in-depth against session fixation), then set loggedIn
            // on the new session. Awaiting ensures the new session is persisted before the OIDC
            // middleware redirects to returnTo.
            await new Promise<void>((resolve, reject) => {
                req.session.regenerate((err) => {
                    if (err) {
                        log.error(`Failed to regenerate session on OIDC login: ${err}`);
                        return reject(err);
                    }
                    req.session.loggedIn = true;
                    req.session.lastAuthState = {
                        totpEnabled: false,
                        ssoEnabled: true
                    };
                    // Explicit save: afterCallback runs inside a Promise chain and the redirect is
                    // issued by the express-openid-connect middleware *after* this function returns,
                    // so we can't rely on res.end-triggered auto-save fully completing in time.
                    req.session.save((saveErr) => {
                        if (saveErr) {
                            log.error(`Failed to save session after OIDC regeneration: ${saveErr}`);
                            return reject(saveErr);
                        }
                        resolve();
                    });
                });
            });

            return session;
        },
    };
    return authConfig;
}

export default {
    generateOAuthConfig,
    getOAuthStatus,
    getSSOIssuerName,
    getSSOIssuerIcon,
    isOpenIDEnabled,
    clearSavedUser,
    isTokenValid,
    isUserSaved,
    refreshOidcTokenIfNeeded,
};
