import electron, { type Session } from "electron";

/**
 * Embed providers whose players reject requests that carry no valid HTTP
 * `Referer`. The desktop renderer is loaded from the custom `trilium-app://app`
 * origin (see {@link ../protocol.ts}), which sends no http(s) Referer, so these
 * embeds fail (YouTube "Video player configuration error" — code 153 with no
 * Referer, code 152 with an invalid one). YouTube's Terms of Service now
 * require a valid Referer for embeds.
 *
 * The browser/server client works because its real origin (`http://localhost:<port>`)
 * is sent as the Referer; we replicate that for the desktop app. This fixes
 * Trilium's link embeds (and any other embedded YouTube/Vimeo iframe), since
 * they point the iframe at these same provider URLs.
 *
 * Add new entries here if another embed provider shows the same failure.
 */
const EMBED_PROVIDER_URLS = [
    "*://*.youtube.com/*",
    "*://*.youtube-nocookie.com/*"
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
 * the `Referer` on requests to the embed providers above.
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
export function setupEmbedReferer(appOrigin: string, session: Session = electron.session.defaultSession) {
    if (installedSessions.has(session)) {
        return;
    }
    installedSessions.add(session);

    session.webRequest.onBeforeSendHeaders({ urls: EMBED_PROVIDER_URLS }, (details, callback) => {
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
