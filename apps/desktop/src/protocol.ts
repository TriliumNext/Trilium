import electron, { protocol } from "electron";
import type { Application } from "express";

import { dispatch } from "./express_dispatch.js";
import { isTriliumAppShellUrl, TRILIUM_APP_ORIGIN, TRILIUM_APP_SCHEME } from "./services/trilium_app_origin.js";

/**
 * Where a `trilium-app://` request is answered: either the Express application
 * running in this process, or the backend `utilityProcess`, which answers over a
 * `MessagePort` and so exposes a `dispatch` of its own. An Express application is
 * itself a function, so the two are told apart by that property rather than by
 * type.
 */
export interface RequestDispatcher {
    dispatch(request: Request): Promise<Response>;
}

export type RequestSource =
    | Application
    | RequestDispatcher
    | Promise<Application | RequestDispatcher>;

/**
 * Registers the `trilium-app://` custom scheme as privileged so the renderer
 * can load the UI from `trilium-app://app/` with a proper origin & cookie jar,
 * fetch support, and CORS. The actual request handler is installed by
 * `setupTriliumAppProtocol` below, once `app.ready` has fired (the Express
 * app may still be building at that point — requests wait for it).
 *
 * **Must be called before `app.ready`.** Electron only honours
 * `registerSchemesAsPrivileged` if it runs synchronously during startup;
 * otherwise Chromium treats the scheme as non-standard with an opaque origin
 * and aborts navigation with `(blocked:origin)`.
 *
 * Shared between `apps/desktop` (main entry) and `apps/edit-docs`
 * (edit-docs / edit-demo entry).
 */
export function registerTriliumAppScheme() {
    protocol.registerSchemesAsPrivileged([
        {
            scheme: TRILIUM_APP_SCHEME,
            privileges: {
                standard: true,
                secure: true,
                supportFetchAPI: true,
                corsEnabled: true,
                // Chromium only code-caches http(s) scripts by default; without
                // this the renderer bundle is recompiled from source on every
                // launch instead of reusing bytecode from the Code Cache dir.
                codeCache: true
            }
        }
    ]);
}

/**
 * Bridges renderer-process requests on the `trilium-app://app/...` custom
 * protocol into the Express application running in the main process.
 *
 * The renderer loads the entire UI from this scheme, so every request the
 * page makes — page load, bootstrap, API calls, static assets — arrives here
 * as a Web Fetch `Request`. We synthesise an IncomingMessage-shaped
 * `Readable` for the request and a node-mocks-http response, then dispatch
 * through the Express app so the real session, CSRF, body-parser, multer and
 * error middleware all run.
 *
 * Accepts a promise of the Express app so the handler can be installed before
 * the server has finished building — windows can then be created (and the
 * renderer can spin up) concurrently with server startup; requests that
 * arrive early simply wait inside the handler until the app resolves.
 */
export function setupTriliumAppProtocol(app: RequestSource) {
    electron.app.whenReady().then(() => {
        installFrameOriginGuard();
        electron.protocol.handle(TRILIUM_APP_SCHEME, async (request) => {
            const origin = request.headers.get("origin");
            if (!isDispatchOriginAllowed(origin)) {
                console.error(`[trilium-app] blocked ${request.method} ${request.url} from origin '${origin}'`);
                return new Response("Forbidden", { status: 403 });
            }
            try {
                const source = await app;
                return "dispatch" in source
                    ? await source.dispatch(request)
                    : await dispatch(source, request);
            } catch (err) {
                console.error(`[trilium-app] dispatch failed for ${request.method} ${request.url}:`, err);
                return new Response("Internal Server Error", { status: 500 });
            }
        });
    });
}

/**
 * The primary gate in front of `dispatch`. Every dispatched request is tagged
 * with `markAsInternalElectronRequest`, which bypasses auth and CSRF — so a
 * request may only reach `dispatch` if it comes from the app shell itself.
 *
 * Request headers cannot make that distinction. Empirically (Electron 41, and
 * contrary to how http(s) origins behave) Chromium stamps **no** identifying
 * headers on requests to a privileged custom scheme: same-origin renderer
 * requests carry no `Origin` even on POST/PUT, cross-origin `fetch()` calls
 * from foreign http(s) or sandboxed frames *also* arrive without `Origin`,
 * and no `Sec-Fetch-*` or `Referer` headers exist at all. Worse, `corsEnabled`
 * is not actually enforced for reads — a foreign frame can both send and read
 * responses. Only navigation-style requests (e.g. `<form>` POSTs) get an
 * `Origin` stamped. Custom marker headers are no help either: foreign frames
 * can attach them without triggering a CORS preflight.
 *
 * What Chromium *does* expose truthfully is the requesting frame, via
 * `webRequest` — `details.frame` and its `parent` chain are main-process-side
 * state that renderer content cannot forge. So the policy is enforced in
 * `onBeforeRequest`, before the protocol handler ever runs:
 *
 * - Top-level navigations are allowed: they originate from main-process
 *   `loadURL` calls (main / extra / setup / print windows) or are already
 *   vetted by the `will-navigate` guard in `web_contents_security.ts`.
 * - Every other request — subframe navigations, fetch/XHR, scripts, images —
 *   must come from a frame chain consisting solely of the app shell
 *   (`trilium-app://app`, the sole origin ever loaded — see the loadURL call
 *   sites). Uncommitted frames (`about:blank` / `about:srcdoc` / empty URL)
 *   inherit their embedder's trust, mirroring Chromium's own origin
 *   inheritance; the chain still has to contain at least one committed app
 *   frame. This denies requests from foreign frames anywhere in the chain —
 *   e.g. a remote page loaded into an iframe — including frames *nested
 *   inside* such content.
 * - DevTools frames are allowed so source-map fetches for `trilium-app://`
 *   scripts keep working; page content can never navigate a frame to the
 *   privileged `devtools://` scheme.
 *
 * `<webview>` guests are out of scope by construction: they live in a
 * dedicated session partition where the `trilium-app://` handler is not even
 * registered, so the scheme does not resolve there at all.
 */
function installFrameOriginGuard() {
    electron.session.defaultSession.webRequest.onBeforeRequest({ urls: [`${TRILIUM_APP_SCHEME}://*/*`] }, (details, callback) => {
        let frameUrls: string[];
        try {
            frameUrls = [];
            for (let frame = details.frame; frame; frame = frame.parent) {
                frameUrls.push(frame.url);
            }
        } catch {
            // Accessing a disposed frame throws; with no attestation left the
            // requester is gone anyway, so deny.
            frameUrls = ["<disposed frame>"];
        }

        const allowed = isRequestorChainTrusted(details.resourceType, frameUrls);
        if (!allowed) {
            console.error(`[trilium-app] blocked ${details.method} ${details.url} from frame chain [${frameUrls.join(" ← ")}]`);
        }
        callback({ cancel: !allowed });
    });
}

/** Pure policy behind {@link installFrameOriginGuard}; exported for tests. */
export function isRequestorChainTrusted(resourceType: string, frameUrls: string[]): boolean {
    if (resourceType === "mainFrame") {
        return true;
    }
    const committed = frameUrls.filter((frameUrl) => frameUrl !== "" && frameUrl !== "about:blank" && frameUrl !== "about:srcdoc");
    if (committed.length === 0) {
        return false;
    }
    return committed.every(isTrustedFrameUrl);
}

function isTrustedFrameUrl(frameUrl: string): boolean {
    if (isTriliumAppShellUrl(frameUrl)) {
        return true;
    }
    try {
        return new URL(frameUrl).protocol === "devtools:";
    } catch {
        return false;
    }
}

/**
 * Second, weaker layer behind the frame-origin guard: rejects any request
 * that *positively* attests a foreign origin. As described above, the only
 * requests that carry an `Origin` on this scheme are navigation-style ones
 * (e.g. a hostile `<form method=POST>` targeting `trilium-app://`); the app's
 * own traffic and — unfortunately — foreign `fetch()` calls carry none, so
 * the absence of the header proves nothing and must be allowed through.
 */
export function isDispatchOriginAllowed(origin: string | null): boolean {
    return origin === null || origin === TRILIUM_APP_ORIGIN;
}

export { dispatch } from "./express_dispatch.js";
