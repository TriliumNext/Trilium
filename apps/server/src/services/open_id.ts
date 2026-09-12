import { getLog, options } from "@triliumnext/core";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Session } from "express-openid-connect";

import { describeError } from "../routes/error_handlers.js";
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

/**
 * The routes express-openid-connect owns. Hoisted out of {@link generateOAuthConfig} so
 * {@link OIDC_NAVIGATION_PATHS} is derived from the same source rather than repeating the literals.
 */
const OIDC_ROUTES = {
    callback: "/callback",
    login: "/authenticate",
    postLogoutRedirect: "/login",
    logout: "/logout",
} as const;

function generateOAuthConfig(
    endSessionSupported = false,
    issuerBaseUrl = config.MultiFactorAuthentication.oauthIssuerBaseUrl,
    idTokenSigningAlg = resolveIdTokenSigningAlg(null)
) {
    const logoutParams = {
    };

    const authConfig = {
        authRequired: false,
        auth0Logout: false,
        baseURL: config.MultiFactorAuthentication.oauthBaseUrl,
        clientID: config.MultiFactorAuthentication.oauthClientId,
        // Not read straight from config: openid-client v6 requires this to match the issuer the provider
        // advertises character for character, so it comes from the discovery probe via
        // reconcileIssuerBaseUrl. Defaulted to the raw config value for callers that don't probe.
        issuerBaseURL: issuerBaseUrl,
        secret: config.MultiFactorAuthentication.oauthClientSecret,
        clientSecret: config.MultiFactorAuthentication.oauthClientSecret,
        clientAuthMethod: resolveClientAuthMethod(),
        // Also not read straight from config: express-openid-connect hardcodes RS256 unless told
        // otherwise, so this comes from the discovery probe via resolveIdTokenSigningAlg. Defaulted for
        // callers that don't probe.
        idTokenSigningAlg,
        authorizationParams: {
            response_type: "code",
            scope: config.MultiFactorAuthentication.oauthScope,
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
        routes: { ...OIDC_ROUTES },
        // Only enable RP-Initiated Logout when the provider actually advertises an end_session_endpoint
        // (see supportsRpInitiatedLogout). With idpLogout on, express-openid-connect unconditionally
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
    /** Discovery probe supplying the issuer identifier and RP-Initiated Logout support. */
    probeDiscovery: () => Promise<DiscoveryProbe>;
    /** Builds the express-openid-connect config for the current provider settings. */
    generateOAuthConfig: (endSessionSupported: boolean, issuerBaseUrl: string, idTokenSigningAlg: string) => Parameters<AuthBuilder>[0];
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
 * ({@link probeDiscovery}) only depends on the issuer — which is fixed in config and changes solely on
 * restart — so it is resolved once on that first use. An in-flight guard ensures concurrent first
 * requests build the handler exactly once.
 */
export function createReactiveOidcMiddleware(deps: Partial<ReactiveOidcDeps> = {}): RequestHandler {
    const {
        isConfigured = isOpenIDConfigured,
        probeDiscovery: probe = probeDiscovery,
        generateOAuthConfig: buildOAuthConfig = generateOAuthConfig,
        buildAuth
    } = deps;

    let oidcMiddleware: RequestHandler | null = null;
    let oidcInit: Promise<RequestHandler> | null = null;

    return async (req: Request, res: Response, next: NextFunction) => {
        // OAuth not selected as the sign-in method → behave as if the middleware were never mounted.
        if (!isConfigured()) {
            return next();
        }

        let handler = oidcMiddleware;
        if (!handler) {
            const init = (oidcInit ??= (async () => {
                // Load express-openid-connect lazily so the (heavy) library and its transitive deps are
                // only evaluated the first time OAuth is actually used, never on a server that runs with
                // OAuth unselected. The sole static reference to the package is the erased `Session` type
                // import, so the bundler keeps it out of the eager-init graph (see scripts/build-utils.ts).
                // `express-openid-connect` is CommonJS, and the ESM split build emits it as a chunk
                // whose only export is `default`, so reading `.auth` off the namespace yields
                // undefined. Go through the interop.
                const oidc = await import("express-openid-connect");
                const authFactory = buildAuth ?? (oidc.default ?? oidc).auth;
                const { endSessionSupported, issuerBaseUrl, idTokenSigningAlg, metadataAvailable } = await probe();
                const built = authFactory(buildOAuthConfig(endSessionSupported, issuerBaseUrl, idTokenSigningAlg));

                // Only commit to the handler when the probe actually read the provider's document.
                //
                // A probe that couldn't reach the issuer degrades to fallbacks rather than throwing (see
                // probeDiscovery), and `auth()` does not itself perform discovery — it only validates
                // config and builds a router — so the build succeeds and nothing here would notice. The
                // library recovers from the same blip on its own (it discovers per request, behind a
                // cache it drops on failure), but these values are frozen into the config object handed
                // to `auth()`. Caching them would outlive the blip: a provider that signs EdDSA would be
                // pinned to the RS256 fallback and reject every valid ID token until a restart — exactly
                // the failure this resolution exists to prevent.
                if (metadataAvailable) {
                    oidcMiddleware = built;
                }
                return built;
            })());

            try {
                handler = await init;
            } catch (error) {
                // Reset so the next request can retry — otherwise a single failed init (a malformed
                // config `auth()` rejects, an import failure, etc.) would leave the rejected promise
                // cached and break every subsequent OAuth request until a server restart.
                if (oidcInit === init) {
                    oidcInit = null;
                }
                return failRoundTrip(req, res, next, error);
            }

            // Settled, so drop the in-flight guard — its only job is to make concurrent first requests
            // share one build. When the probe read the document `oidcMiddleware` now holds the handler
            // and this is never consulted again; when it didn't, the next request re-probes. The identity
            // check keeps a request from clearing a *newer* build's guard.
            if (oidcInit === init) {
                oidcInit = null;
            }
        }

        // Hand off entirely to the express-openid-connect handler: it drives the request by side effect
        // (sends a response/redirect or calls next() itself) and returns undefined. We must NOT call
        // next() ourselves afterwards — doing so double-invokes the downstream pipeline and triggers
        // "Cannot set headers after they are sent". The guard only covers a failed build.
        if (!handler) {
            return next();
        }

        // The library reports a broken round-trip by calling next(err) rather than by rejecting, so the
        // interception has to happen on `next` — a try/catch around this call would never see it. A bare
        // next() (the pass-through for non-OIDC routes) must still propagate untouched.
        return handler(req, res, (error?: unknown) => {
            if (!error) {
                return next();
            }
            return failRoundTrip(req, res, next, error);
        });
    };
}

/**
 * Handles an OIDC round-trip that failed outright — as opposed to one that completed with a rejection
 * (wrong account, not enrolled), which `afterCallback` already reports via `ssoError`.
 *
 * Previously such a failure fell through to the generic error handler, which answers with JSON. Since
 * `/authenticate` is a full-page navigation, that stranded the user on a raw `{"message":"fetch failed"}`
 * page with no way back — particularly unhelpful during first-time setup, where reaching the provider is
 * exactly what's being configured. Instead we mirror the success path: flag the session and redirect to
 * the app root, letting the client surface a toast carrying the technical detail.
 */
function failRoundTrip(req: Request, res: Response, next: NextFunction, error: unknown) {
    // `describeError` unwraps the `.cause` chain, which is where the actionable reason actually lives:
    // undici surfaces only "fetch failed" at the top level, with e.g. "self-signed certificate
    // [DEPTH_ZERO_SELF_SIGNED_CERT]" nested underneath. Kept non-empty — its presence is what marks the
    // failure downstream, so an error that describes to nothing must not read as "no failure".
    const detail = describeError(error) || String(error) || "unknown error";
    getLog().error(`OAuth provider round-trip failed on ${req.method} ${req.url}: ${detail}`);

    // Nothing to redirect if the library already started answering; let Express finish it.
    if (res.headersSent) {
        return next(error);
    }

    // Redirecting only makes sense for the provider round-trip itself, which is a full-page navigation.
    // This middleware is mounted ahead of every route, so without this guard two things break:
    //
    // - An `/api/*` XHR caught by a failed lazy init would receive a 302 to HTML where it expects JSON.
    // - A failure on `/` would redirect `/` to `/`. Transient failures self-heal (the init promise is
    //   reset, so the next request retries), but a persistent one — a malformed `oauthBaseUrl` that
    //   `auth()` rejects on every build, say — would loop the browser until it gave up, replacing a
    //   JSON error that named the bad config with an opaque ERR_TOO_MANY_REDIRECTS.
    //
    // Everything else keeps the old behaviour and goes to the generic handler, which answers JSON.
    if (!OIDC_NAVIGATION_PATHS.has(req.path)) {
        return next(error);
    }

    // Bounded: this rides in the session store until the next bootstrap consumes it, and a deep cause
    // chain would otherwise be unbounded.
    req.session.ssoConnectionFailed = detail.slice(0, MAX_CONNECTION_FAILURE_DETAIL_LENGTH);
    return res.redirect("/");
}

/**
 * The subset of {@link OIDC_ROUTES} the user reaches by navigating, and therefore the only paths where
 * answering a failure with a redirect (rather than an error) is right. `postLogoutRedirect` is excluded:
 * it is where the library sends the browser afterwards, not a route it handles.
 */
const OIDC_NAVIGATION_PATHS = new Set<string>([
    OIDC_ROUTES.login,
    OIDC_ROUTES.callback,
    OIDC_ROUTES.logout
]);

/** Upper bound on the technical detail carried to the client; enough for a full cause chain. */
const MAX_CONNECTION_FAILURE_DETAIL_LENGTH = 300;

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
    probeDiscovery,
};

// Cap the startup discovery probe so a slow/unreachable provider can't stall server boot.
const DISCOVERY_TIMEOUT_MS = 10_000;

/** What {@link probeDiscovery} extracts from the provider's discovery document. */
interface DiscoveryProbe {
    /** Whether `idpLogout` can be safely enabled — see {@link supportsRpInitiatedLogout}. */
    endSessionSupported: boolean;
    /** The issuer to hand express-openid-connect — see {@link reconcileIssuerBaseUrl}. */
    issuerBaseUrl: string;
    /** The ID token signature algorithm to expect — see {@link resolveIdTokenSigningAlg}. */
    idTokenSigningAlg: string;
    /**
     * Whether the provider's discovery document was actually read. False means every field above is a
     * fallback rather than an answer, which is what stops {@link createReactiveOidcMiddleware} from
     * caching a handler built from it.
     */
    metadataAvailable: boolean;
}

/**
 * Probes the configured OIDC issuer's discovery document for the facts that must be settled before
 * express-openid-connect can be built: whether RP-Initiated Logout is available, which spelling of the
 * issuer identifier the provider actually advertises, and which algorithm it signs ID tokens with. The
 * issuer is fixed in config.ini/env and only changes on restart, so this is resolved once at first use
 * rather than per request.
 *
 * Any fetch/parse failure degrades to the configured issuer with logout support off and the RS256
 * default, leaving a transient network blip to break neither sign-in (express-openid-connect runs its
 * own discovery, which either succeeds or reports the real error) nor logout (which falls back to
 * clearing the local session). Such a result is flagged `metadataAvailable: false` so the caller can
 * tell a fallback from an answer and decline to cache it — see {@link createReactiveOidcMiddleware}.
 */
async function probeDiscovery(): Promise<DiscoveryProbe> {
    const configuredIssuer = config.MultiFactorAuthentication.oauthIssuerBaseUrl;
    const metadata = await fetchDiscoveryMetadata(configuredIssuer);

    return {
        endSessionSupported: supportsRpInitiatedLogout(metadata),
        issuerBaseUrl: reconcileIssuerBaseUrl(configuredIssuer, readAdvertisedIssuer(metadata)),
        idTokenSigningAlg: resolveIdTokenSigningAlg(metadata),
        metadataAvailable: metadata !== null
    };
}

/** Fetches the issuer's discovery document, or null if it can't be retrieved or parsed. */
async function fetchDiscoveryMetadata(configuredIssuer: string): Promise<unknown> {
    const issuer = configuredIssuer.replace(/\/+$/, "");
    if (!issuer) {
        return null;
    }

    const metadataUrl = discoveryUrlFor(issuer);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
    try {
        const response = await fetch(metadataUrl, { signal: controller.signal });
        if (!response.ok) {
            getLog().info(`OAuth: discovery for ${issuer} returned HTTP ${response.status}; using the configured issuer and treating RP-Initiated Logout as unsupported.`);
            return null;
        }
        return await response.json();
    } catch (error) {
        getLog().info(`OAuth: discovery fetch for ${issuer} failed, using the configured issuer and treating RP-Initiated Logout as unsupported. ${error instanceof Error ? error.message : error}`);
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Where an issuer's discovery document lives.
 *
 * Normally `{issuer}/.well-known/openid-configuration`, appended to the *full* issuer (which may carry a
 * path, e.g. Keycloak realms) rather than resolved against the origin root. Callers strip trailing
 * slashes first, so both spellings of a path-bearing issuer reach the same URL.
 *
 * An issuer that already points *at* a discovery document is used as-is. openid-client does exactly the
 * same — `performDiscovery` skips resolution for any URL containing `/.well-known/`, and skips the
 * issuer equality check along with it — which is what makes an explicit `.well-known` URL the documented
 * way out of Authentik's "global" issuer mode (see {@link reconcileIssuerBaseUrl}). Appending a second
 * `.well-known` there 404s, so the probe would come back blind on a configuration the library itself
 * handles perfectly well, and everything derived from the document — the signing algorithm above all —
 * would silently fall back. The `/.well-known/` test is the library's, character for character, so the
 * two cannot disagree about which URLs are already discovery endpoints.
 */
export function discoveryUrlFor(issuer: string) {
    return issuer.includes("/.well-known/") ? issuer : `${issuer}/.well-known/openid-configuration`;
}

/**
 * The fields of the OIDC discovery document we consume. The full metadata is large and arrives as
 * untrusted network JSON, so rather than pull in (and pin) openid-client's transitive `ServerMetadata`
 * type for two properties, we mirror just what we read and validate it at runtime.
 */
interface OidcDiscoveryMetadata {
    end_session_endpoint?: string;
    issuer?: string;
    id_token_signing_alg_values_supported?: unknown;
}

function readAdvertisedIssuer(metadata: unknown) {
    if (typeof metadata !== "object" || metadata === null) {
        return undefined;
    }
    return (metadata as OidcDiscoveryMetadata).issuer;
}

/**
 * Picks the issuer identifier to hand express-openid-connect, reconciling what the user configured with
 * what the provider advertises when the two differ only by a trailing slash.
 *
 * openid-client v6 asserts `new URL(advertised).href === new URL(configured).href` after fetching the
 * discovery document, and fails the whole round-trip with `OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED`
 * otherwise (#10695). v5 never compared them, so 0.104.0 turned a harmless spelling difference into a
 * hard sign-in failure. `href` supplies a trailing slash for an *empty* path but neither adds nor strips
 * one on a non-empty path, so the mismatch only bites issuers carrying a path — and it bites in both
 * directions: Authentik advertises `…/application/o/<slug>/` while Keycloak advertises `…/realms/<name>`.
 * Normalising in either single direction would therefore fix one provider by breaking the other.
 *
 * Adopting the advertised spelling costs nothing in security: it is only taken when it is identical to
 * the configured issuer up to trailing slashes, so a document claiming a different host, path or scheme
 * still falls through to the configured value and still fails the library's check. That deliberately
 * leaves Authentik's "global" issuer mode (every provider reports the instance root, while the document
 * is served under the per-application path) failing — the difference there is a real one, and the way
 * out is to configure the issuer as an explicit `.well-known` URL.
 */
export function reconcileIssuerBaseUrl(configuredIssuer: string, advertisedIssuer: unknown) {
    if (typeof advertisedIssuer !== "string" || !advertisedIssuer) {
        return configuredIssuer;
    }

    let configuredHref: string;
    let advertisedHref: string;
    try {
        configuredHref = new URL(configuredIssuer).href;
        advertisedHref = new URL(advertisedIssuer).href;
    } catch {
        // A malformed issuer on either side: leave the configured value alone and let
        // express-openid-connect report it, rather than silently substituting a guess.
        return configuredIssuer;
    }

    if (configuredHref === advertisedHref) {
        return configuredIssuer;
    }

    const withoutTrailingSlashes = (url: string) => url.replace(/\/+$/, "");
    if (withoutTrailingSlashes(configuredHref) !== withoutTrailingSlashes(advertisedHref)) {
        return configuredIssuer;
    }

    getLog().info(`OAuth: issuer '${configuredIssuer}' differs from the advertised '${advertisedIssuer}' only by a trailing slash; using the advertised spelling.`);
    return advertisedIssuer;
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
 * What express-openid-connect assumes when `idTokenSigningAlg` is left unset, and what OIDC Core
 * requires every provider to support — so it stays the fallback whenever discovery can't tell us better.
 */
export const DEFAULT_ID_TOKEN_SIGNING_ALG = "RS256";

/**
 * Picks the JWS algorithm to expect on ID tokens.
 *
 * express-openid-connect defaults `idTokenSigningAlg` to RS256 and passes it to openid-client as the
 * client's registered `id_token_signed_response_alg`, which is then enforced on every ID token. Trilium
 * never set it, so a provider signing with anything else failed the round-trip with
 * "unexpected JWT alg received, expected RS256, got: EdDSA"
 * (https://github.com/orgs/TriliumNext/discussions/6318). RS256 is merely the *legacy* default: Pocket
 * ID and Kanidm sign with Ed25519 by default, and others offer ES256.
 *
 * The provider already publishes the answer as `id_token_signing_alg_values_supported`, so it is read
 * from the discovery probe rather than demanded from the user. RS256 wins whenever it's advertised —
 * that keeps every currently-working deployment on exactly the algorithm it uses today, and the fallback
 * only engages for the providers that don't offer RS256 at all, which are precisely the broken ones.
 * `none` is skipped: unsigned ID tokens are not acceptable here (and express-openid-connect's own schema
 * rejects the value outright, which would take the OIDC round-trip down at build time).
 *
 * `oauthIdTokenSigningAlg` overrides all of it, for a provider that misadvertises or signs with an
 * algorithm we'd rank differently.
 */
export function resolveIdTokenSigningAlg(metadata: unknown): string {
    const configured = config.MultiFactorAuthentication.oauthIdTokenSigningAlg.trim();
    if (configured) {
        if (configured.toLowerCase() !== "none") {
            return configured;
        }
        getLog().error(`OAuth: ignoring oauthIdTokenSigningAlg '${configured}' — unsigned ID tokens are not supported.`);
    }

    const advertised = readAdvertisedSigningAlgs(metadata);
    if (advertised.length === 0 || advertised.includes(DEFAULT_ID_TOKEN_SIGNING_ALG)) {
        return DEFAULT_ID_TOKEN_SIGNING_ALG;
    }

    const [preferred] = advertised;
    getLog().info(`OAuth: the issuer does not sign ID tokens with ${DEFAULT_ID_TOKEN_SIGNING_ALG}; expecting ${preferred} (advertised: ${advertised.join(", ")}).`);
    return preferred;
}

/** The usable entries of `id_token_signing_alg_values_supported`, or an empty list if there are none. */
function readAdvertisedSigningAlgs(metadata: unknown): string[] {
    if (typeof metadata !== "object" || metadata === null) {
        return [];
    }
    const advertised = (metadata as OidcDiscoveryMetadata).id_token_signing_alg_values_supported;
    if (!Array.isArray(advertised)) {
        return [];
    }
    return advertised.filter((alg): alg is string => typeof alg === "string" && alg !== "" && alg.toLowerCase() !== "none");
}

export const CLIENT_AUTH_METHODS = ["client_secret_basic", "client_secret_post"] as const;
export type ClientAuthMethod = (typeof CLIENT_AUTH_METHODS)[number];

/**
 * Issuers whose token endpoint does **not** percent-decode HTTP Basic credentials.
 *
 * `client_secret_basic` — the OIDC Core default, and what express-openid-connect picks on its own —
 * form-url-encodes the client_id/secret per RFC 6749 §2.3.1 ("-" → %2D, "_" → %5F, "." → %2E) *inside*
 * the Basic header. A provider that base64-decodes that header without percent-decoding it therefore
 * compares against corrupted credentials and rejects the token exchange:
 *
 * - **Google** — client_ids always contain "-" and "."; fails with
 *   "invalid_client: The OAuth client was not found."
 * - **GitLab** — client secrets are `gloas-` prefixed; fails with OAUTH_WWW_AUTHENTICATE_CHALLENGE
 *   (#10585, a regression from the openid-client v5 → v6 upgrade, where v5's plainer
 *   `encodeURIComponent` left those characters intact).
 *
 * This deliberately is *not* derived from the discovery document. `token_endpoint_auth_methods_supported`
 * advertises what the **server** supports, but the method is agreed **per client** at registration and
 * is not discoverable — Authelia, for instance, advertises all five methods while defaulting confidential
 * clients to `client_secret_basic` and rejecting anything else with `invalid_client`. Preferring
 * `client_secret_post` on the strength of discovery alone therefore breaks spec-compliant providers.
 *
 * Only exact issuer matches are listed, so a self-hosted GitLab needs `oauthClientAuthMethod` set
 * explicitly — see {@link resolveClientAuthMethod}.
 */
const BASIC_AUTH_INCOMPATIBLE_ISSUERS = new Set([
    "https://accounts.google.com",
    "https://gitlab.com"
]);

/**
 * Chooses the token-endpoint client authentication method.
 *
 * An explicit `oauthClientAuthMethod` always wins — it's the escape hatch for any provider we don't
 * know about, notably self-hosted instances of the ones in {@link BASIC_AUTH_INCOMPATIBLE_ISSUERS}.
 * Otherwise known-incompatible issuers get `client_secret_post` and everyone else gets the spec
 * default, `client_secret_basic`.
 */
export function resolveClientAuthMethod(): ClientAuthMethod {
    const configured = config.MultiFactorAuthentication.oauthClientAuthMethod.trim();
    if (configured) {
        if (isClientAuthMethod(configured)) {
            return configured;
        }
        getLog().error(`OAuth: ignoring unrecognised oauthClientAuthMethod '${configured}', expected one of ${CLIENT_AUTH_METHODS.join(", ")}.`);
    }

    const issuer = config.MultiFactorAuthentication.oauthIssuerBaseUrl.replace(/\/+$/, "");
    return BASIC_AUTH_INCOMPATIBLE_ISSUERS.has(issuer) ? "client_secret_post" : "client_secret_basic";
}

function isClientAuthMethod(value: string): value is ClientAuthMethod {
    return (CLIENT_AUTH_METHODS as readonly string[]).includes(value);
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
