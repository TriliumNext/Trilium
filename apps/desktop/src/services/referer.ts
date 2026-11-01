import electron, { type Session } from "electron";

/**
 * Hosts that turn away a request carrying no valid HTTP `Referer`. The desktop renderer is loaded
 * from the custom `trilium-app://app` origin (see {@link ../protocol.ts}), and a referrer whose
 * scheme is not http(s) is dropped by the browser before the request leaves — so the desktop app
 * tells these hosts nothing about itself, whatever referrer policy it asks for.
 *
 * The browser/server client works because its real origin (`http://localhost:<port>`) is sent as the
 * Referer; we replicate that here, in the one place a header can still be set by hand.
 *
 * - **YouTube** rejects the embedded player ("Video player configuration error" — code 153 with no
 *   Referer, code 152 with an invalid one); their Terms of Service now require a valid one. This
 *   covers Trilium's link embeds and any other embedded YouTube/Vimeo iframe, since they point at
 *   these same provider URLs.
 * - **OpenStreetMap's tile servers** answer an unidentified request with a 403 *drawn into the
 *   tile* — an image reading "Access blocked", served as HTTP 200, so the geo map shows tiled
 *   complaint rather than a map and nothing on the page ever sees an error. Their tile usage policy
 *   requires either a Referer or a User-Agent identifying the app; the browser client sends its
 *   origin (see the geo map's own `transformRequest`), and this is the desktop's answer to the same
 *   requirement.
 *
 * Add new entries here if another host shows the same failure. Only hosts that need it: a Referer
 * says where the reader is, and there is no reason to volunteer that to anyone who has not asked.
 */
const REFERER_REQUIRED_URLS = [
    "*://*.youtube.com/*",
    "*://*.youtube-nocookie.com/*",
    "*://tile.openstreetmap.org/*",
    "*://*.tile.openstreetmap.org/*"
];

/**
 * Sessions already carrying the hook. Keyed on the session rather than a module-wide flag so that a
 * second session (and each test) can install its own — Electron allows one `onBeforeSendHeaders`
 * listener per session, not one per process.
 */
const installedSessions = new WeakSet<Session>();

/**
 * Installs a single `onBeforeSendHeaders` hook on the session (default: the
 * shared default session used by all desktop windows) that sets `appOrigin` as
 * the `Referer` on requests to the hosts above.
 *
 * `appOrigin` must be a normal http(s) origin that YouTube accepts as an embed
 * host — e.g. the desktop's own local server, `http://localhost:<port>`, which
 * is exactly what the working browser client sends. It must NOT be the
 * provider's own domain (`https://www.youtube.com`): YouTube rejects that as an
 * invalid embed host (Error 152).
 *
 * Must be called after `app.ready`. Idempotent per session — a repeat call for a session that
 * already has the hook does nothing.
 */
export function setupReferer(appOrigin: string, session: Session = electron.session.defaultSession) {
    if (installedSessions.has(session)) {
        return;
    }
    installedSessions.add(session);

    session.webRequest.onBeforeSendHeaders({ urls: REFERER_REQUIRED_URLS }, (details, callback) => {
        // Header names are case-insensitive, but `requestHeaders` is a plain object with
        // case-sensitive keys: assigning "Referer" alongside an existing "referer" would send the
        // header twice, and YouTube rejects a request whose embed host it cannot pin down.
        for (const name of Object.keys(details.requestHeaders)) {
            if (name.toLowerCase() === "referer") {
                delete details.requestHeaders[name];
            }
        }
        details.requestHeaders["Referer"] = appOrigin;

        callback({ requestHeaders: details.requestHeaders });
    });
}
