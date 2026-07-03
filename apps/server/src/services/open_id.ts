import { getLog, options } from "@triliumnext/core";
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

/**
 * In-flight refresh promises keyed by trilium.sid session ID, so concurrent expired-token requests
 * share a single network call to the IdP. Without this, refresh-token rotation (Authentik, Auth0,
 * Okta default) breaks under load: the first request consumes the refresh token, the rest see
 * invalid_grant on a now-stale token and would (per the policy below) be force-logged-out.
 *
 * Each promise resolves with a snapshot of the refreshed token fields so piggybacking requests can
 * copy them into their own appSession (see {@link snapshotRefreshedTokens}).
 */
const inFlightRefreshes = new Map<string, Promise<Record<string, unknown> | undefined>>();

/** Test-only: clear the in-flight refresh cache between cases. */
export function _resetInFlightRefreshesForTesting() {
    inFlightRefreshes.clear();
}

/**
 * The token fields express-openid-connect persists in the appSession cookie and updates on refresh
 * (see the library's context.js `refresh()`).
 */
const OIDC_TOKEN_FIELDS = ["id_token", "access_token", "refresh_token", "token_type", "expires_at"] as const;

/**
 * The library keeps each request's decoded session at `req.appSession` (the default
 * `config.session.name`); it is not part of the typed public API, hence the indexed access.
 */
function getAppSession(req: Request): Record<string, unknown> | undefined {
    const session = (req as unknown as Record<string, unknown>).appSession;
    return typeof session === "object" && session !== null ? session as Record<string, unknown> : undefined;
}

/** Captures the post-refresh token fields from the initiating request's appSession. */
function snapshotRefreshedTokens(req: Request): Record<string, unknown> | undefined {
    const session = getAppSession(req);
    if (!session) {
        return undefined;
    }
    const tokens: Record<string, unknown> = {};
    for (const field of OIDC_TOKEN_FIELDS) {
        if (session[field] !== undefined) {
            tokens[field] = session[field];
        }
    }
    return tokens;
}

/**
 * Express middleware that refreshes the OIDC access token in-place when it is expired.
 *
 * Why this exists: express-openid-connect stores `access_token` and `refresh_token` in the appSession
 * cookie but does not auto-refresh on expiry. Without this middleware the access token goes stale after
 * the IdP-configured TTL (typically 1 hour) even though the appSession cookie itself lives for
 * `cookieMaxAge` (21 days), and Trilium never learns about an upstream revocation until the next manual
 * logout.
 *
 * Behavior:
 *   - Skipped when the user is not OIDC-authenticated, the access token is still valid, or no refresh
 *     token is present (the configured `oauthScope` didn't include `offline_access`, so the provider
 *     never issued one — the common case, and a no-op here).
 *   - On `invalid_grant` (RFC 6749: refresh token revoked / expired / consent withdrawn): marks the
 *     local session as not-authenticated. The downstream `auth.checkAuth` sees `!loggedIn` and redirects
 *     to /login. This matches Auth0/Okta/Logto guidance that invalid_grant is terminal.
 *   - On other errors (network blip, IdP 5xx): logs and proceeds. The local trilium.sid session is the
 *     source of truth for "is this user logged in," so a transient IdP outage doesn't bounce the user.
 *   - Concurrent requests with the same trilium.sid share one in-flight refresh promise, preventing
 *     refresh-token-rotation races.
 */
export function refreshOidcTokenIfNeeded(req: Request, res: Response, next: NextFunction) {
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
        // The library exposes refresh() on the AccessToken (it performs the refresh_token grant and
        // updates the appSession in place), not on req.oidc itself.
        refreshPromise = accessToken
            .refresh()
            .then(() => snapshotRefreshedTokens(req))
            .finally(() => {
                inFlightRefreshes.delete(sessionId);
            });
        inFlightRefreshes.set(sessionId, refreshPromise);
    }

    refreshPromise
        .then((refreshedTokens) => {
            // Each coalesced request decodes its *own* copy of the appSession cookie, and the library
            // re-encrypts that copy into a Set-Cookie on every response (rolling sessions). Copy the
            // refreshed tokens into this request's session too — otherwise a piggybacking response
            // written after the initiator's would clobber the rotated tokens with the stale,
            // already-consumed pair, and the next request would hit invalid_grant.
            const session = getAppSession(req);
            if (session && refreshedTokens) {
                Object.assign(session, refreshedTokens);
            }
            next();
        })
        .catch((err: unknown) => {
            const oauthError = (err as { error?: string })?.error;
            const message = err instanceof Error ? err.message : String(err);
            if (oauthError === "invalid_grant") {
                getLog().info(`OIDC refresh token rejected by IdP (invalid_grant): ${message}. Forcing re-authentication.`);
                req.session.loggedIn = false;
                return next();
            }
            getLog().info(`OIDC token refresh failed: ${message}. Continuing with the expired access token.`);
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
            getLog().info(`OIDC token validation failed: ${err instanceof Error ? err.message : String(err)}`);
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

    // Refresh tokens are only issued when the operator opts in by adding `offline_access` to oauthScope.
    // How that opt-in is expressed to the provider differs by issuer:
    //   - Spec-compliant providers (Keycloak, Authentik, Okta, Auth0, ...): the `offline_access` scope
    //     itself is the request for a refresh token — no extra parameters, and no `prompt=consent`,
    //     which would otherwise force the consent screen on every single login.
    //   - Google: does not accept `offline_access` as a scope (the authorization request fails with
    //     invalid_scope), so the scope token is stripped and replaced with Google's own mechanism:
    //     `access_type=offline` plus `prompt=consent` (without which Google only issues a refresh token
    //     on the very first consent).
    // Without the opt-in, neither is sent — the standard sign-in flow is unchanged, matching upstream's
    // earlier removal of the unconditional offline params.
    const scopeTokens = config.MultiFactorAuthentication.oauthScope.split(/\s+/);
    const wantsOfflineAccess = scopeTokens.includes("offline_access");
    const google = isGoogleIssuer();
    const scope = wantsOfflineAccess && google
        ? scopeTokens.filter((token) => token !== "offline_access").join(" ")
        : config.MultiFactorAuthentication.oauthScope;
    const offlineAccessParams = wantsOfflineAccess && google
        ? { access_type: "offline", prompt: "consent" }
        : {};

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
            scope,
            ...offlineAccessParams,
        },
        // Override the library's default 5000 ms timeout for discovery / token-exchange / userinfo requests.
        // Cold-start IdP responses (e.g. a scaled-to-zero provider) routinely exceed 5s and manifest as a
        // spurious "login twice" failure; the default is raised to 30s and is configurable via oauthHttpTimeout.
        httpTimeout: config.MultiFactorAuthentication.oauthHttpTimeout,
        // Match the OIDC appSession cookie lifetime to Trilium's own trilium.sid cookie. The library defaults
        // (24h rolling, 7d absolute) silently capped the effective Trilium session at 7 days when SSO was on.
        // Both bounds are set to cookieMaxAge (seconds; default 21d): rollingDuration is required when
        // rolling: true, and keeping absoluteDuration as a hard cap follows OWASP / Auth0 guidance that every
        // session should have an upper bound regardless of activity.
        session: {
            rolling: true,
            rollingDuration: config.Session.cookieMaxAge,
            absoluteDuration: config.Session.cookieMaxAge,
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
    refreshOidcTokenIfNeeded,
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
    return isGoogleIssuer() ? "client_secret_post" : "client_secret_basic";
}

/** Whether the configured issuer is Google (trailing slashes tolerated), which deviates from the OIDC
 * spec in several places (Basic-auth credential encoding, offline-access mechanics). */
function isGoogleIssuer() {
    return config.MultiFactorAuthentication.oauthIssuerBaseUrl.replace(/\/+$/, "") === GOOGLE_ISSUER;
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
