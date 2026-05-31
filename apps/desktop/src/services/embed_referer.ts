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
 * is sent as the Referer; we replicate that for the desktop app. This fixes both
 * CKEditor's MediaEmbed and Trilium's own link embeds, since both point the
 * iframe at these same provider URLs.
 *
 * Add new entries here if another embed provider shows the same failure.
 */
const EMBED_PROVIDER_URLS = [
    "*://*.youtube.com/*",
    "*://*.youtube-nocookie.com/*"
];

let installed = false;

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
 * Must be called after `app.ready`. Idempotent — only the first call registers
 * the hook (Electron allows a single `onBeforeSendHeaders` listener per session).
 */
export function setupEmbedReferer(appOrigin: string, session: Session = electron.session.defaultSession) {
    if (installed) {
        return;
    }
    installed = true;

    session.webRequest.onBeforeSendHeaders({ urls: EMBED_PROVIDER_URLS }, (details, callback) => {
        details.requestHeaders["Referer"] = appOrigin;
        callback({ requestHeaders: details.requestHeaders });
    });
}
