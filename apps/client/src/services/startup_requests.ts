/**
 * Sends the API requests the app makes as it starts, as soon as `/bootstrap` has answered, so they
 * travel while the entry's modules load. `server.get()` hands each response to the first caller
 * that asks for it, which would otherwise have sent the request only once its module had loaded.
 *
 * Kept free of imports, as `index.ts` loads it before the app's modules.
 */

/** What `options.ts`, `froca.ts` and `keyboard_actions.ts` ask for as soon as they load. */
const STARTUP_URLS = [ "options", "tree", "keyboard-actions" ];

/**
 * How long a startup request can take, body included, before it fails and `server.ts` sends it
 * again. Matches `DEFAULT_TIMEOUT` in `server.ts`, which the request it replaces would have had.
 */
const STARTUP_TIMEOUT_MS = 60_000;

const pendingRequests = new Map<string, Promise<Response>>();

/** Starts the requests of {@link STARTUP_URLS}, for {@link takeStartupResponse} to collect. */
export function requestStartupData() {
    const headers: Record<string, string> = {
        "trilium-component-id": window.glob.componentId ?? "",
        "x-csrf-token": window.glob.csrfToken ?? ""
    };

    for (const url of STARTUP_URLS) {
        // `/bootstrap` brings them to a client with a session.
        if (url === "options" && window.glob.options) continue;
        // The abort also fails a read of the body that stalls.
        const controller = new AbortController();
        setTimeout(() => controller.abort(), STARTUP_TIMEOUT_MS);
        const request = fetch(`${window.glob.baseApiUrl}${url}`, { headers, signal: controller.signal });
        // A failure goes to whoever takes the request, which then sends it again, not as an
        // unhandled rejection.
        request.catch(() => {});
        pendingRequests.set(url, request);
    }
}

/** Returns the response of the request started for `url`, once, or `undefined` if there is none. */
export function takeStartupResponse(url: string) {
    const request = pendingRequests.get(url);
    pendingRequests.delete(url);
    return request;
}
