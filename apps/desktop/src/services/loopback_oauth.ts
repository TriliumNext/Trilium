import oauth, { type OAuthProviderConfig, type TokenResponse } from "@triliumnext/server/src/services/oauth/oauth.js";
import electron from "electron";
import http from "node:http";

/**
 * Generic desktop OAuth authorization-code-with-PKCE flow over a loopback redirect.
 *
 * Provider-agnostic: given any {@link OAuthProviderConfig} it runs the whole sign-in in the main
 * process and returns the raw token response, leaving provider-specific follow-up (account lookup,
 * token storage) to the caller. The first consumer is the OneNote importer (see ./onenote.ts).
 *
 * Why this lives in the main process at all: the renderer talks to Express over the `trilium-app://`
 * custom protocol, so a request-derived redirect URI is unreachable (`http://app/...`) and the OAuth
 * callback would land in a different session than the one the renderer polls. Running the flow here,
 * with a throwaway loopback server as the redirect target, avoids both problems.
 *
 * The provider's app registration must list `http://localhost` as a redirect URI ("Mobile and desktop
 * applications" platform); providers match loopback redirects on host only, so the dynamic port is fine.
 */

/** How long to wait for the user to complete sign-in before giving up and tearing the server down. */
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

export async function authorizeViaLoopback(config: OAuthProviderConfig): Promise<TokenResponse> {
    const { verifier, challenge } = oauth.generatePkce();
    const state = oauth.generateState();

    const loopback = await startLoopbackServer(state);
    const redirectUri = `http://localhost:${loopback.port}/`;
    try {
        electron.shell.openExternal(oauth.buildAuthorizationUrl(config, { redirectUri, state, challenge }));

        const code = await loopback.waitForCode;
        return await oauth.exchangeCodeForToken(config, { code, verifier, redirectUri });
    } finally {
        loopback.close();
    }
}

interface Loopback {
    port: number;
    /** Resolves with the OAuth `code` once the browser is redirected back; rejects on error/timeout. */
    waitForCode: Promise<string>;
    close(): void;
}

function startLoopbackServer(expectedState: string): Promise<Loopback> {
    return new Promise<Loopback>((resolveServer, rejectServer) => {
        let resolveCode!: (code: string) => void;
        let rejectCode!: (err: Error) => void;
        const waitForCode = new Promise<string>((resolve, reject) => {
            resolveCode = resolve;
            rejectCode = reject;
        });

        const server = http.createServer((req, res) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            const code = url.searchParams.get("code");
            const error = url.searchParams.get("error");
            const returnedState = url.searchParams.get("state");

            // Browsers fetch /favicon.ico and similar alongside the redirect; only the request that
            // actually carries the OAuth result should settle (and respond to) the flow.
            if (!code && !error) {
                res.writeHead(404).end();
                return;
            }

            if (error) {
                respond(res, `Sign-in failed: ${error}. You can close this window and try again.`);
                rejectCode(new Error(`Sign-in failed: ${error}`));
            } else if (!code || returnedState !== expectedState) {
                respond(res, "Sign-in could not be completed (invalid or expired state). Please close this window and try again.");
                rejectCode(new Error("Sign-in could not be completed (invalid or expired state)."));
            } else {
                respond(res, "Connected. You can close this window and return to Trilium.");
                resolveCode(code);
            }
        });

        const timeout = setTimeout(() => rejectCode(new Error("Timed out waiting for sign-in.")), SIGN_IN_TIMEOUT_MS);
        const guardedWaitForCode = waitForCode.finally(() => clearTimeout(timeout));

        server.on("error", rejectServer);
        // Listen on the same loopback name used in the redirect URI so the browser resolves to exactly
        // the address we bound, and let the OS pick a free port.
        server.listen(0, "localhost", () => {
            const address = server.address();
            const port = typeof address === "object" && address ? address.port : 0;
            resolveServer({
                port,
                waitForCode: guardedWaitForCode,
                // Clear the timeout here too: if the flow errors before waitForCode settles (e.g.
                // openExternal throws), the finally-block close() must not leave the timer pending.
                close: () => {
                    server.close();
                    clearTimeout(timeout);
                }
            });
        });
    });
}

function respond(res: http.ServerResponse, message: string) {
    res.writeHead(200, { "Content-Type": "text/html" }).end(
        `<!doctype html><html><head><meta charset="utf-8"><title>Sign-in</title></head>` +
        `<body style="font-family: sans-serif; padding: 2rem; text-align: center;">` +
        `<p>${escapeHtml(message)}</p><script>setTimeout(() => window.close(), 1500);</script></body></html>`
    );
}

function escapeHtml(text: string): string {
    return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}
