import { getLog, options, user_service } from "@triliumnext/core";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Session } from "express-openid-connect";

import config from "./config.js";
import openIDEncryption from "./encryption/open_id_encryption.js";
import sql from "./sql.js";
import sqlInit from "./sql_init.js";

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

/**
 * Whether OAuth is configured and selected as the sign-in method. This is what gates the OIDC
 * middleware (so the provider round-trip — and therefore enrollment — is available) and is
 * deliberately independent of whether an account has been enrolled yet. Before enrollment the login
 * page still falls back to the password form, letting the owner sign in and enroll without a lockout.
 */
function isOpenIDConfigured() {
    return !(checkOpenIDConfig().length > 0) && options.getOptionOrNull('mfaMethod') === 'oauth';
}

/**
 * Whether OAuth is the *active* login method. Beyond being configured, this additionally requires an
 * enrolled account: until the owner has bound their provider identity (see {@link generateOAuthConfig}'s
 * `afterCallback`), SSO is not yet live and the login page keeps offering the password form. Mirrors
 * TOTP, where selecting the method isn't enough — a secret must be committed before it's enforced.
 */
function isOpenIDEnabled() {
    return isOpenIDConfigured() && openIDEncryption.isSubjectIdentifierSaved();
}

function isUserSaved() {
    return openIDEncryption.isSubjectIdentifierSaved();
}

function getAdminUser() {
    return sql.getRowOrNull<{ username: string; email: string | null }>(
        "SELECT username, email FROM users WHERE isAdmin = 1 AND isDeleted = 0 LIMIT 1"
    );
}

function getUsername() {
    return getAdminUser()?.username ?? null;
}

function getUserEmail() {
    return getAdminUser()?.email ?? null;
}

function clearSavedUser() {
    sql.transactional(() => {
        sql.execute("DELETE FROM oauth_enrollment");
        sql.execute("UPDATE users SET username = 'admin', email = NULL WHERE userId = (SELECT value FROM options WHERE name = 'adminUserId')");
    });
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
        enrolled: openIDEncryption.isSubjectIdentifierSaved(),
        missingVars: checkOpenIDConfig(),
        issuerName: getSSOIssuerName(),
        issuerUrl: config.MultiFactorAuthentication.oauthIssuerBaseUrl,
        issuerIcon: getSSOIssuerIcon()
    };
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
        } catch {
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
    const configuredIcon = config.MultiFactorAuthentication.oauthIssuerIcon;
    if (configuredIcon) {
        return configuredIcon;
    }

    // Fall back to the issuer's favicon so any OIDC provider gets a sensible default icon
    // without requiring explicit configuration.
    return deriveFaviconUrl(config.MultiFactorAuthentication.oauthIssuerBaseUrl);
}

function deriveFaviconUrl(baseUrl: string) {
    if (!baseUrl) {
        return "";
    }

    try {
        return new URL("/favicon.ico", baseUrl).toString();
    } catch {
        return "";
    }
}

function generateOAuthConfig(endSessionSupported = false) {
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
        clientAuthMethod: resolveClientAuthMethod(),
        authorizationParams: {
            response_type: "code",
            scope: "openid profile email",
        },
        routes: authRoutes,
        // Only enable RP-Initiated Logout when the provider actually advertises an end_session_endpoint
        // (see isRpInitiatedLogoutSupported). With idpLogout on, express-openid-connect unconditionally
        // builds a redirect to that endpoint at logout; providers without one (e.g. Google, Authelia)
        // would otherwise crash POST /logout with a 500. When false, logout falls back to clearing the
        // local session and redirecting to postLogoutRedirect.
        idpLogout: endSessionSupported,
        logoutParams,
        afterCallback: async (req: Request, res: Response, session: Session) => {
            if (!sqlInit.isDbInitialized()) return session;

            const user = req.oidc.user;
            if (!user || user.sub === undefined || user.sub === null) {
                getLog().info("OAuth callback received without a usable user; ignoring.");
                return session;
            }

            const incomingSubject = user.sub.toString();
            // Distinguishes the owner binding their account for the first time (enrollment) from a routine
            // login, so we can surface a one-shot "connected" toast only on enrollment (see below).
            const isEnrollment = !openIDEncryption.isSubjectIdentifierSaved();

            if (openIDEncryption.isSubjectIdentifierSaved()) {
                // An account is already enrolled, so this is a login attempt. Only the enrolled identity
                // may proceed — otherwise any user the IdP authenticates could sign in to this instance.
                if (!openIDEncryption.verifySubjectIdentifier(incomingSubject)) {
                    getLog().info("OAuth login rejected: the authenticated account is not the enrolled one.");
                    req.session.loggedIn = false;
                    req.session.ssoError = "wrong_account";
                    return session;
                }
            } else {
                // No account is enrolled yet. Binding the identity is only allowed when the request comes
                // from an already-authenticated session — i.e. the owner enrolling from Settings. A
                // sign-in from an anonymous session is refused so a stranger can't claim the instance by
                // simply being the first to authenticate.
                if (!req.session.loggedIn) {
                    getLog().info("OAuth enrollment rejected: sign-in attempted before an account was enrolled.");
                    req.session.ssoError = "not_enrolled";
                    return session;
                }

                // The profile claims (name/email) aren't guaranteed to be in the ID token under the
                // authorization-code flow — spec-compliant providers (Authelia, Zitadel, Keycloak) only
                // return them from the UserInfo endpoint. Fetch it and merge so enrollment records a real
                // name/email regardless of provider; on failure we fall back to whatever the ID token
                // carried (e.g. Google, which does include them).
                let userInfo: Record<string, unknown> | undefined;
                try {
                    userInfo = await req.oidc.fetchUserInfo();
                } catch (error) {
                    getLog().info(`OAuth enrollment: UserInfo fetch failed, using ID token claims only. ${error instanceof Error ? error.message : error}`);
                }

                const { name, email } = resolveOAuthIdentity(user, userInfo);
                openIDEncryption.saveUser(incomingSubject, name, email);
            }

            // Regenerate the session to prevent session fixation — mirroring the password and sync login
            // paths. This is the privilege-elevation point (anonymous/owner session → bound OAuth identity),
            // so the post-login session ID must be server-chosen rather than one an attacker could have
            // planted. Fail closed: if regeneration errors, leave the session unauthenticated rather than
            // flipping loggedIn on the old ID.
            try {
                await new Promise<void>((resolve, reject) => {
                    req.session.regenerate((err) => (err ? reject(err) : resolve()));
                });
            } catch (error) {
                getLog().error(`OAuth session regeneration failed, refusing login: ${error instanceof Error ? error.message : error}`);
                req.session.loggedIn = false;
                return session;
            }

            req.session.loggedIn = true;
            req.session.userId = user_service.getAdminUserId();
            req.session.lastAuthState = {
                totpEnabled: false,
                ssoEnabled: true
            };
            // Set after regeneration (which wipes the prior session) so /bootstrap can deliver a one-shot
            // "account connected" signal to the client when it reloads onto the app root post-redirect.
            if (isEnrollment) {
                req.session.ssoJustEnrolled = true;
            }

            return session;
        },
    };
    return authConfig;
}

type AuthBuilder = typeof import("express-openid-connect").auth;

interface ReactiveOidcDeps {
    /** Whether OAuth is currently configured and selected as the sign-in method. Re-checked per request. */
    isConfigured: () => boolean;
    /** Discovery probe deciding whether RP-Initiated Logout (idpLogout) can be safely enabled. */
    isRpInitiatedLogoutSupported: () => Promise<boolean>;
    /** Builds the express-openid-connect config for the current provider settings. */
    generateOAuthConfig: (endSessionSupported: boolean) => Parameters<AuthBuilder>[0];
    /** The express-openid-connect `auth()` factory (injectable so the middleware is unit-testable). */
    buildAuth: AuthBuilder;
}

/**
 * Builds the always-mounted OIDC middleware.
 *
 * The provider round-trip used to be mounted only once, at server startup, gated on whether OAuth was
 * the selected sign-in method at that moment. That coupled a *permanent* mounting decision to the
 * *runtime-mutable* `mfaMethod` option, so switching to OpenID in Settings did nothing until a restart.
 *
 * This middleware is mounted unconditionally and instead re-evaluates `isOpenIDConfigured()` on every
 * request: while OAuth is unselected it simply passes through, and the first time OAuth is actually in
 * use it lazily builds the underlying express-openid-connect handler and caches it. The discovery probe
 * (endSessionSupported) only depends on the issuer — which is fixed in config and changes solely on
 * restart — so it is resolved once on that first use. An in-flight guard ensures concurrent first
 * requests build the handler exactly once.
 */
export function createReactiveOidcMiddleware(deps: Partial<ReactiveOidcDeps> = {}): RequestHandler {
    const {
        isConfigured = isOpenIDConfigured,
        isRpInitiatedLogoutSupported: probeRpLogout = isRpInitiatedLogoutSupported,
        generateOAuthConfig: buildOAuthConfig = generateOAuthConfig,
        buildAuth
    } = deps;

    let oidcMiddleware: RequestHandler | null = null;
    let oidcInit: Promise<void> | null = null;

    return async (req: Request, res: Response, next: NextFunction) => {
        // OAuth not selected as the sign-in method → behave as if the middleware were never mounted.
        if (!isConfigured()) {
            return next();
        }

        if (!oidcMiddleware) {
            oidcInit ??= (async () => {
                // Load express-openid-connect lazily so the (heavy) library and its transitive deps are
                // only evaluated the first time OAuth is actually used, never on a server that runs with
                // OAuth unselected. The sole static reference to the package is the erased `Session` type
                // import, so the bundler keeps it out of the eager-init graph (see scripts/build-utils.ts).
                const authFactory = buildAuth ?? (await import("express-openid-connect")).auth;
                const endSessionSupported = await probeRpLogout();
                oidcMiddleware = authFactory(buildOAuthConfig(endSessionSupported));
            })();
            try {
                await oidcInit;
            } catch (error) {
                // Reset so the next request can retry — otherwise a single failed init (transient
                // discovery-probe failure, malformed config, etc.) would leave the rejected promise
                // cached and break every subsequent OAuth request until a server restart.
                oidcInit = null;
                throw error;
            }
        }

        // Hand off entirely to the express-openid-connect handler: it drives the request by side effect
        // (sends a response/redirect or calls next() itself) and returns undefined. We must NOT call
        // next() ourselves afterwards — doing so double-invokes the downstream pipeline and triggers
        // "Cannot set headers after they are sent". The guard only covers a failed build.
        if (!oidcMiddleware) {
            return next();
        }
        return oidcMiddleware(req, res, next);
    };
}

export default {
    generateOAuthConfig,
    getOAuthStatus,
    getSSOIssuerName,
    getSSOIssuerIcon,
    isOpenIDConfigured,
    isOpenIDEnabled,
    clearSavedUser,
    isTokenValid,
    isUserSaved,
    isRpInitiatedLogoutSupported,
};

const GOOGLE_ISSUER = "https://accounts.google.com";

// Cap the startup discovery probe so a slow/unreachable provider can't stall server boot.
const DISCOVERY_TIMEOUT_MS = 10_000;

/**
 * Probes the configured OIDC issuer's discovery document to decide whether RP-Initiated Logout is
 * available, i.e. whether `idpLogout` can be safely enabled in {@link generateOAuthConfig}. The issuer
 * is fixed in config.ini/env and only changes on restart, so this is resolved once at startup rather
 * than per logout. Any fetch/parse failure is treated as "unsupported" so a transient network blip
 * degrades to a working local logout rather than breaking it.
 */
async function isRpInitiatedLogoutSupported() {
    const issuer = config.MultiFactorAuthentication.oauthIssuerBaseUrl.replace(/\/+$/, "");
    if (!issuer) {
        return false;
    }

    // The discovery document lives at `{issuer}/.well-known/openid-configuration` — appended to the full
    // issuer (which may carry a path, e.g. Keycloak realms) rather than resolved against the origin root.
    const metadataUrl = `${issuer}/.well-known/openid-configuration`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
    try {
        const response = await fetch(metadataUrl, { signal: controller.signal });
        if (!response.ok) {
            getLog().info(`OAuth: discovery for ${issuer} returned HTTP ${response.status}; treating RP-Initiated Logout as unsupported.`);
            return false;
        }
        const metadata: unknown = await response.json();
        return supportsRpInitiatedLogout(metadata);
    } catch (error) {
        getLog().info(`OAuth: discovery fetch for ${issuer} failed, treating RP-Initiated Logout as unsupported. ${error instanceof Error ? error.message : error}`);
        return false;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * The single field of the OIDC discovery document we consume. The full metadata is large and arrives as
 * untrusted network JSON, so rather than pull in (and pin) openid-client's transitive `ServerMetadata`
 * type for one property, we mirror just what we read and validate it at runtime.
 */
interface OidcDiscoveryMetadata {
    end_session_endpoint?: string;
}

/**
 * Pure predicate: does an OIDC discovery document advertise a usable `end_session_endpoint`? Extracted
 * from the network probe so the support decision can be unit-tested without a live provider.
 */
export function supportsRpInitiatedLogout(metadata: unknown) {
    if (typeof metadata !== "object" || metadata === null) {
        return false;
    }
    const { end_session_endpoint } = metadata as OidcDiscoveryMetadata;
    return typeof end_session_endpoint === "string" && end_session_endpoint.length > 0;
}

/**
 * Chooses the token-endpoint client authentication method based on the issuer.
 *
 * - **Google** → `client_secret_post`. express-openid-connect defaults to `client_secret_basic`,
 *   whose oauth4webapi implementation form-url-encodes the client_id/secret per RFC 6749 §2.3.1
 *   ("-" → %2D, "." → %2E) inside the HTTP Basic header. Google does not decode Basic credentials, so
 *   a Google client_id (which always contains "-" and ".") arrives corrupted and the token exchange
 *   fails with "invalid_client: The OAuth client was not found." Posting the credentials in the body
 *   sidesteps the Basic-auth encoding.
 * - **Any other issuer** → `client_secret_basic`, the OIDC default a spec-compliant provider expects
 *   (e.g. Authelia/Keycloak register confidential clients as `client_secret_basic` and reject a
 *   mismatched method).
 */
function resolveClientAuthMethod() {
    const issuer = config.MultiFactorAuthentication.oauthIssuerBaseUrl.replace(/\/+$/, "");
    return issuer === GOOGLE_ISSUER ? "client_secret_post" : "client_secret_basic";
}

/**
 * Resolves the display name and email to enroll for an OAuth account. These profile claims may live in
 * the ID token (e.g. Google) or only be available from the UserInfo endpoint (e.g. Authelia, Zitadel,
 * Keycloak), so each field is taken from the ID token when present and falls back to UserInfo. A field
 * absent from both yields an empty string, matching the previous behaviour.
 */
export function resolveOAuthIdentity(
    idTokenClaims: Record<string, unknown> | undefined,
    userInfo: Record<string, unknown> | undefined
) {
    return {
        name: firstNonEmptyString(idTokenClaims?.name, userInfo?.name) ?? "",
        email: firstNonEmptyString(idTokenClaims?.email, userInfo?.email) ?? ""
    };
}

function firstNonEmptyString(...values: unknown[]) {
    for (const value of values) {
        if (typeof value === "string" && value.length > 0) {
            return value;
        }
    }
    return undefined;
}
