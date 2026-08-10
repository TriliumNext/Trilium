import { BootstrapDefinition } from "@triliumnext/commons";
import { attributes, BNote, getSharedBootstrapItems, icon_packs as iconPackService, options as optionService, password as passwordService, sql_init, task_states } from "@triliumnext/core";
import type { Request, Response } from "express";

import packageJson from "../../package.json" with { type: "json" };
import appPath from "../services/app_path.js";
import assetPath from "../services/asset_path.js";
import config from "../services/config.js";
import { getLog } from "@triliumnext/core";
import { isInternalElectronRequest } from "../services/electron_request.js";
import port from "../services/port.js";
import openID from "../services/open_id.js";
import { isDev, isMac, supportsBackgroundMaterial } from "../services/utils.js";
import totp from "../services/totp.js";
import { generateCsrfToken } from "./csrf_protection.js";

type View = "desktop" | "mobile" | "print";

export function bootstrap(req: Request, res: Response) {
    // csrf-csrf v4 binds CSRF tokens to the session ID via HMAC. With saveUninitialized: false,
    // a brand-new session is never persisted unless explicitly modified, so its cookie is never
    // sent to the browser — meaning every request gets a different ephemeral session ID, and
    // CSRF validation fails. Setting this flag marks the session as modified, which causes
    // express-session to persist it and send the session cookie in this response.
    if (!req.session.csrfInitialized) {
        req.session.csrfInitialized = true;
    }

    const view = getView(req);
    const isDbInitialized = sql_init.isDbInitialized();
    // When auth is disabled the user is implicitly authenticated, so the set-password
    // and login pre-auth screens never apply — fall through to the full payload.
    const noAuthentication = config.General?.noAuthentication === true;
    // Whether *this request* is the trusted desktop renderer (arriving via the
    // trilium-app:// custom protocol, which tags it — see electron_request.ts).
    // The pre-auth screens and the Electron-only window chrome are gated on this
    // per-request marker, not the process-wide `isElectron` flag: on a desktop
    // build, a browser hitting the same HTTP listener is NOT the renderer and must
    // still go through the login screen and get a real session (#10589). Using the
    // global flag told every such browser it was already logged in, so it skipped
    // login and then had every API call rejected with "Logged in session not found".
    const isElectronRenderer = isInternalElectronRequest(req);
    const commonItems = {
        ...getSharedBootstrapItems(assetPath, isDbInitialized),
        baseApiUrl: "api/",
        appPath,
        isStandalone: false,
        // Reflects whether *this client* is the trusted desktop renderer, not whether
        // the server is a desktop build: a browser hitting the desktop's HTTP listener
        // is a plain web client and must not get the `electron` body class (which drops
        // web-only chrome like the login margins — #10589) or the renderer-only URLs below.
        isElectron: isElectronRenderer,
        isDev,
        platform: process.platform,
        triliumVersion: packageJson.version,
        device: view,
        TRILIUM_SAFE_MODE: !!process.env.TRILIUM_SAFE_MODE,
        instanceName: config.General ? config.General.instanceName : null,
        // The desktop renderer loads from trilium-app://, so location-based
        // ws:// URL derivation no longer works there. Send an absolute URL.
        // A browser has a real HTTP origin and derives its own, so only the
        // renderer gets this.
        wsBaseUrl: isElectronRenderer ? `ws://127.0.0.1:${port}/` : undefined,
        // Same reason for HTTP-origin-dependent UI (e.g. the MCP URL shown
        // in Options) — give the renderer a real loopback origin to display.
        httpBaseUrl: isElectronRenderer
            ? `${config["Network"]["https"] ? "https" : "http"}://127.0.0.1:${port}`
            : undefined
    };
    if (!isDbInitialized) {
        res.send({
            ...commonItems,
            hasNativeTitleBar: false,
            hasBackgroundEffects: isElectronRenderer && (supportsBackgroundMaterial || isMac),
            isMainWindow: true,
            appCssNoteIds: []
        } satisfies BootstrapDefinition);
        return;
    }

    if (!isElectronRenderer && !noAuthentication && !passwordService.isPasswordSet()) {
        // Pre-auth window: the DB is initialized but no password has been set yet.
        // The desktop renderer manages its protected-notes password through the options
        // UI and never gates the app on it — so we exclude only the trusted renderer here
        // (a browser hitting the desktop's HTTP listener still gets this screen), which
        // also means the Electron-only title-bar / background-effect flags are
        // unconditionally false. We serve a minimal payload (no CSRF token /
        // session data) carrying `passwordSet: false`; theme and icon-pack CSS still come
        // from commonItems so the screen matches the rest of the app.
        res.send({
            ...commonItems,
            passwordSet: false,
            hasNativeTitleBar: false,
            hasBackgroundEffects: false,
            isMainWindow: true
        } satisfies BootstrapDefinition);
        return;
    }

    if (!isElectronRenderer && !noAuthentication && !req.session.loggedIn) {
        // Pre-auth window: a password is set but the user hasn't logged in. Skipped only
        // for the trusted desktop renderer, which doesn't gate on a web session; a browser
        // reaching the desktop's HTTP listener still logs in here. Serve a minimal payload
        // (no CSRF token / session data) carrying `loggedIn: false` plus the login-screen
        // config, which the client uses to render the login screen. The one-shot SSO error
        // left by a failed OIDC round-trip is read and cleared here (previously done by the
        // login page).
        const ssoError = req.session.ssoError;
        if (ssoError) {
            delete req.session.ssoError;
        }
        // A round-trip that failed before the user was ever logged in lands here rather than on the
        // authenticated bootstrap below, so consume its one-shot detail too and surface it as a bare
        // flag — in SSO-only mode the login screen is the only place left to explain the bounce. The
        // technical detail is deliberately NOT forwarded: this payload is served pre-auth, and the
        // failure reason (TLS trust, DNS, refused connection) would leak infrastructure details to
        // anonymous visitors. It's already in the server log.
        const ssoConnectionFailed = Boolean(req.session.ssoConnectionFailed);
        delete req.session.ssoConnectionFailed;
        res.send({
            ...commonItems,
            loggedIn: false,
            login: {
                ssoEnabled: openID.isOpenIDEnabled(),
                ssoIssuerName: openID.getSSOIssuerName(),
                ssoIssuerIcon: openID.getSSOIssuerIcon(),
                totpEnabled: totp.isTotpEnabled(),
                ssoError,
                ssoConnectionFailed
            },
            hasNativeTitleBar: false,
            hasBackgroundEffects: false,
            isMainWindow: true
        } satisfies BootstrapDefinition);
        return;
    }


    const csrfToken = generateCsrfToken(req, res, {
        overwrite: false,
        validateOnReuse: false      // if validation fails, generate a new token instead of throwing an error
    });
    getLog().info(`CSRF token generation: ${csrfToken ? "Successful" : "Failed"}`);

    const options = optionService.getOptionMap();
    const nativeTitleBarVisible = options.nativeTitleBarVisible === "true";
    const iconPacks = iconPackService.getIconPacks();

    // One-shot: consume the enrollment flag set by the OIDC afterCallback so the client toasts the
    // successful connection exactly once after the post-enrollment redirect.
    const oauthJustEnrolled = req.session.ssoJustEnrolled === true;
    if (oauthJustEnrolled) {
        delete req.session.ssoJustEnrolled;
    }

    // Likewise one-shot: the counterpart detail set when the provider round-trip failed outright, so the
    // client can explain why the user was bounced back here instead of connecting.
    const oauthConnectionFailed = req.session.ssoConnectionFailed;
    if (oauthConnectionFailed) {
        delete req.session.ssoConnectionFailed;
    }

    res.send({
        ...commonItems,
        dbInitialized: true,
        passwordSet: true,
        loggedIn: true,
        csrfToken,
        oauthJustEnrolled,
        oauthConnectionFailed,
        hasNativeTitleBar: isElectronRenderer && nativeTitleBarVisible,
        hasBackgroundEffects: options.backgroundEffects === "true"
            && isElectronRenderer
            && (supportsBackgroundMaterial || isMac)
            && !nativeTitleBarVisible,
        isMainWindow: view === "mobile" ? true : !req.query.extraWindow,
        iconPackCss: [
            ...iconPacks
                .map((p: iconPackService.ProcessedIconPack) => iconPackService.generateCss(p, p.builtin
                    ? `${assetPath}/fonts/${p.fontAttachmentId}.${iconPackService.MIME_TO_EXTENSION_MAPPINGS[p.fontMime]}`
                    : `api/attachments/download/${p.fontAttachmentId}`)),
            task_states.generateTaskStateCss()
        ]
            .filter(Boolean)
            .join("\n\n"),
    } satisfies BootstrapDefinition);
}

export function getView(req: Request): View {
    // Special override for printing.
    if ("print" in req.query) {
        return "print";
    }

    // The trusted Electron renderer always uses the desktop view. This must key
    // off the per-request marker, not the process-wide `isElectron` flag: on a
    // desktop build a plain browser hits the same HTTP listener, and forcing
    // "desktop" for it ignored the `trilium-device=mobile` cookie set by
    // "Switch to Mobile Version" (#10720). Same per-request vs. global fix as #10589.
    if (isInternalElectronRequest(req)) {
        return "desktop";
    }

    // Respect user's manual override via URL.
    if ("desktop" in req.query) {
        return "desktop";
    } else if ("mobile" in req.query) {
        return "mobile";
    }

    // Respect user's manual override via cookie.
    const cookie = req.cookies?.["trilium-device"];
    if (cookie === "mobile" || cookie === "desktop") {
        return cookie;
    }

    // Try to detect based on user agent.
    const userAgent = req.headers["user-agent"];
    if (userAgent) {
        // TODO: Deduplicate regex with client-side login.ts.
        const mobileRegex = /\b(Android|iPhone|iPad|iPod|Windows Phone|BlackBerry|webOS|IEMobile)\b/i;
        if (mobileRegex.test(userAgent)) {
            return "mobile";
        }
    }

    return "desktop";
}
