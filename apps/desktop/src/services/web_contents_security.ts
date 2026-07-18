import { WEBVIEW_SESSION_PARTITION } from "@triliumnext/commons";
import { getLog } from "@triliumnext/core";
import electron from "electron";
import url from "url";

import { validateOpenExternalUrl } from "./shell.js";
import { isTriliumAppShellUrl, TRILIUM_APP_HOST, TRILIUM_APP_SCHEME } from "./trilium_app_origin.js";

/**
 * Security guard for `<webview>` attachment.
 *
 * Main and extra windows are created with `webviewTag: true` so the Web View
 * note type can embed remote pages. The webview tag is renderer-controlled
 * markup, which means a single XSS in the renderer could otherwise inject
 * `<webview nodeintegration src=...>` or attach a `preload` attribute and
 * regain the full Node.js access that `nodeIntegration: false` +
 * `contextIsolation: true` were introduced to remove.
 *
 * Per the Electron security checklist, `will-attach-webview` fires in the main
 * process before a guest is created and is the only reliable place to vet the
 * web preferences the embedder requested.
 */

/**
 * Registers a main-process hook that applies a uniform security policy to
 * every WebContents the app ever creates (main, extra, setup and print
 * windows as well as `<webview>` guests):
 *
 * - vets every `<webview>` before it attaches,
 * - denies all window-open requests, routing allowlisted URLs to the OS
 *   browser instead,
 * - blocks navigation away from the app shell,
 * - installs deny-by-default permission handlers on both the app session and
 *   the dedicated `<webview>` guest session.
 *
 * Attach attempts that explicitly request a dangerous capability (Node
 * integration, a preload script, disabled web security) are denied outright —
 * the legitimate Web View note type never requests any of them, so a
 * violation can only come from injected markup. Benign attaches proceed with
 * their preferences hardened as defense in depth.
 *
 * Call once during startup, before any window is created.
 */
export function setupWebContentsSecurity() {
    electron.app.on("web-contents-created", (_event, webContents) => {
        webContents.on("will-attach-webview", (attachEvent, webPreferences, params) => {
            // Depending on the Electron version the `partition` attribute
            // surfaces on `webPreferences` or only on the attach params, so
            // feed both into the check.
            const violations = hardenWebviewPreferences(webPreferences, params.partition);
            if (violations.length > 0) {
                attachEvent.preventDefault();
                getLog().error(`Blocked <webview> attach requesting [${violations.join(", ")}] for src: ${params.src}`);
            }
        });

        installWindowOpenPolicy(webContents);
        installNavigationGuard(webContents);
    });

    // Sessions only exist once the app is ready; both handlers below replace
    // Electron's default behaviour of granting every permission request.
    electron.app.whenReady().then(() => {
        installPermissionPolicy(electron.session.defaultSession, "app");
        installPermissionPolicy(electron.session.fromPartition(WEBVIEW_SESSION_PARTITION), "guest");
        installYouTubeEmbedReferer(electron.session.defaultSession);
    });
}

/**
 * Strips dangerous capabilities from the web preferences a `<webview>`
 * requested and returns the list of explicit violations found (empty for a
 * benign attach).
 *
 * `contextIsolation` and `sandbox` are forced on silently rather than
 * reported: Electron may legitimately pass them unset for guests, so they are
 * normalization, not evidence of hostile markup.
 */
export function hardenWebviewPreferences(webPreferences: Electron.WebPreferences, requestedPartition?: string): string[] {
    const violations: string[] = [];

    // `preloadURL` is the legacy alias of `preload`; Electron still honours it.
    const prefs = webPreferences as Electron.WebPreferences & { preloadURL?: string };
    if (prefs.preload !== undefined || prefs.preloadURL !== undefined) {
        violations.push("preload script");
    }
    delete prefs.preload;
    delete prefs.preloadURL;

    if (prefs.nodeIntegration) {
        violations.push("nodeIntegration");
    }
    if (prefs.nodeIntegrationInSubFrames) {
        violations.push("nodeIntegrationInSubFrames");
    }
    if (prefs.webSecurity === false) {
        violations.push("webSecurity disabled");
    }
    if (prefs.allowRunningInsecureContent) {
        violations.push("allowRunningInsecureContent");
    }
    // The only legitimate <webview> (the Web View note type) always declares
    // the dedicated guest partition. Anything else is a violation: a different
    // partition is hostile markup, and an unset/empty one (Electron surfaces an
    // omitted attribute as "") would otherwise risk attaching the guest into
    // the *default* session — shared cookie jar and trilium-app:// registry.
    // Requiring an exact match keeps a single source of truth; supporting
    // per-note partitions later means relaxing this to a `persist:webview`
    // prefix check AND having WebView.tsx set the chosen value.
    const partition = prefs.partition ?? requestedPartition;
    if (partition !== WEBVIEW_SESSION_PARTITION) {
        violations.push(`partition '${partition ?? "<unset>"}'`);
    }

    prefs.partition = WEBVIEW_SESSION_PARTITION;
    prefs.nodeIntegration = false;
    prefs.nodeIntegrationInSubFrames = false;
    prefs.webSecurity = true;
    prefs.allowRunningInsecureContent = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;

    return violations;
}

/**
 * Permission allowlists per session kind. Unset handlers make Electron GRANT
 * every request, so anything not listed here (camera, microphone, geolocation,
 * notifications, MIDI, HID, serial, USB, pointer lock, clipboard read, …) is
 * denied.
 *
 * - `app`: the default session — the Trilium renderer itself. It legitimately
 *   writes to the clipboard (copy note content/links), toggles fullscreen
 *   (e.g. presentations, zen mode) and shows notifications (user scripts
 *   commonly call `new Notification()` for reminders; the renderer only runs
 *   trusted code, so this stays available to the scripting ecosystem).
 *   Clipboard *read* stays denied on purpose: the renderer reads via the
 *   main-process `electronApi.clipboard.readText()` bridge, so the sensitive
 *   `clipboard-read` permission never has to be granted to the whole session
 *   (which would also expose it to embedded remote iframes).
 * - `guest`: the `<webview>` partition hosting arbitrary remote pages from
 *   Web View notes. Fullscreen only (embedded video players) — a remote page
 *   must not show OS notifications that appear to come from Trilium.
 *
 * The `app` allowlist is gated by request origin (see
 * {@link isPermissionAllowedForOrigin}): only the `trilium-app://app` shell
 * gets clipboard-write / notifications, not remote `<iframe>` embeds that share
 * the default session. Fullscreen is the exception — granted for any origin.
 */
const PERMISSION_ALLOWLIST = {
    app: new Set(["clipboard-sanitized-write", "fullscreen", "notifications"]),
    guest: new Set(["fullscreen"])
} as const;

export type SessionKind = keyof typeof PERMISSION_ALLOWLIST;

/** Pure policy check: is `permission` allowed for the given session kind? */
export function isPermissionAllowed(kind: SessionKind, permission: string): boolean {
    return PERMISSION_ALLOWLIST[kind].has(permission);
}

/**
 * Full permission decision: the per-session allowlist {@link isPermissionAllowed}
 * AND an origin check. The default (`app`) session hosts not only the trusted
 * app shell but also remote `<iframe>` embeds (e.g. the YouTube preview in
 * `link_embed.tsx`) — those run with the app session's permissions unless the
 * request origin is checked. So every allowlisted permission additionally
 * requires the request to come from the `trilium-app://app` shell, which keeps
 * a remote embed from inheriting the renderer's clipboard / notification grants.
 *
 * `fullscreen` is the deliberate exception: it is allowed for any origin
 * (embedded video players — both the YouTube `<iframe>` and `<webview>` guests —
 * legitimately request it, and it carries no exfiltration / spoofing risk that
 * an origin check would mitigate).
 */
export function isPermissionAllowedForOrigin(kind: SessionKind, permission: string, requestingUrl: string | null | undefined): boolean {
    if (!isPermissionAllowed(kind, permission)) {
        return false;
    }
    if (permission === "fullscreen") {
        return true;
    }
    return isTriliumAppShellUrl(requestingUrl);
}

/**
 * Decides whether a renderer-initiated navigation (link click, drag & drop,
 * meta refresh) may proceed. Only the app shell itself is allowed: the
 * `trilium-app://app` origin (the sole host ever served — see the loadURL
 * call sites), and only at the root path. Anything deeper is in-page SPA
 * routing (which `will-navigate` does not fire for) or hostile.
 *
 * `localhost` was previously allowed too, from the era when the desktop
 * renderer was served over `http://127.0.0.1:<port>`. The custom-protocol
 * migration made the shell load exclusively from `trilium-app://app/`, so the
 * carve-out is now dead — and dangerous: it let a crafted link navigate the
 * privileged window (which keeps the preload bridge) to any local listener.
 */
export function isNavigationAllowed(targetUrl: string): boolean {
    const parsedUrl = url.parse(targetUrl);

    const isAppShell = parsedUrl.protocol === `${TRILIUM_APP_SCHEME}:` && parsedUrl.hostname === TRILIUM_APP_HOST;
    return isAppShell && (!parsedUrl.path || parsedUrl.path === "/" || parsedUrl.path === "/?");
}

/**
 * Denies every window-open request (`window.open`, `target=_blank`). For app
 * windows the URL is routed to the OS browser instead, after passing the same
 * scheme allowlist as the open-external IPC channel — a link in note content
 * is just as attacker-controllable as an IPC payload, so Follina-class
 * (`ms-msdt:`) and credential-leak (`smb:`) URLs must not bypass it here.
 *
 * `<webview>` guests are denied without the external dispatch: the tag never
 * sets `allowpopups`, so popups are already impossible there — this keeps it
 * that way even if a future Electron version changes the default, and stops
 * remote pages from triggering OS protocol handlers.
 */
function installWindowOpenPolicy(webContents: Electron.WebContents) {
    webContents.setWindowOpenHandler((details) => {
        if (webContents.getType() === "webview") {
            getLog().error(`Blocked window.open from <webview> guest for URL: ${details.url}`);
            return { action: "deny" };
        }

        async function openExternal() {
            const validated = validateOpenExternalUrl(details.url);
            await electron.shell.openExternal(validated.toString());
        }

        openExternal().catch(err => {
            getLog().error(`Blocked or failed to open external URL ${details.url}: ${err}`);
        });
        return { action: "deny" };
    });
}

/**
 * Prevents drag & drop, link clicks etc. from navigating an app window away
 * from Trilium. `<webview>` guests are exempt — they are embedded browsers
 * the user navigates freely. Main-process `loadURL` calls are unaffected
 * (`will-navigate` does not fire for them).
 */
function installNavigationGuard(webContents: Electron.WebContents) {
    if (webContents.getType() === "webview") {
        return;
    }

    webContents.on("will-navigate", (ev, targetUrl) => {
        if (!isNavigationAllowed(targetUrl)) {
            ev.preventDefault();
        }
    });
}

function installPermissionPolicy(session: Electron.Session, kind: SessionKind) {
    // Asynchronous requests (e.g. getUserMedia prompting for the camera).
    session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
        const allowed = isPermissionAllowedForOrigin(kind, permission, details.requestingUrl);
        if (!allowed) {
            getLog().error(`Denied '${permission}' permission request from ${details.requestingUrl} (${kind} session)`);
        }
        callback(allowed);
    });
    // Synchronous checks (e.g. navigator.permissions.query, push subscription
    // state) — without this handler Electron reports everything as granted.
    session.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
        isPermissionAllowedForOrigin(kind, permission, requestingOrigin));
}

/** Host filters for the YouTube embed player (see {@link installYouTubeEmbedReferer}). */
const YOUTUBE_EMBED_URL_FILTERS = ["https://www.youtube-nocookie.com/*", "https://www.youtube.com/*"];

// A valid third-party web referrer to present for the embed (the desktop
// renderer has none). Must NOT be a youtube.com URL — YouTube reads its own
// domain as a self-embed and blocks playback ("video unavailable"); any normal
// embedding origin works, exactly as the server build's own origin does.
const YOUTUBE_EMBED_REFERER = "https://triliumnotes.org/";

/**
 * Supplies a `Referer` for the YouTube embed player (the `link_embed.tsx` Web
 * View preview). On desktop the renderer is served from `trilium-app://app`,
 * which is not an `http(s)` origin, so the embed document request goes out with
 * no `Referer` — YouTube's player then refuses to configure ("video player
 * configuration error"). A normal browser embed sends the embedding page's
 * origin as `Referer` (and no `Origin`, since it's a GET navigation), so we
 * inject an equivalent here.
 *
 * Scoped to the default session (the app renderer); `<webview>` guests in the
 * dedicated partition browse YouTube normally and are untouched. The existing
 * header is never overwritten, so the player's own same-origin sub-requests
 * (which already carry a correct `Referer`) are unaffected.
 */
function installYouTubeEmbedReferer(session: Electron.Session) {
    session.webRequest.onBeforeSendHeaders({ urls: YOUTUBE_EMBED_URL_FILTERS }, (details, callback) => {
        callback({ requestHeaders: withYouTubeEmbedReferer(details.requestHeaders) });
    });
}

/** Pure header transform behind {@link installYouTubeEmbedReferer}; exported for tests. */
export function withYouTubeEmbedReferer(requestHeaders: Record<string, string>): Record<string, string> {
    const hasReferer = Object.keys(requestHeaders).some((name) => name.toLowerCase() === "referer");
    if (hasReferer) {
        return requestHeaders;
    }
    return { ...requestHeaders, Referer: YOUTUBE_EMBED_REFERER };
}
