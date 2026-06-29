/**
 * REST endpoints for the OneNote importer. Implements the OAuth authorization-code-with-PKCE flow
 * (delegated Microsoft Graph access) and the actual import. Tokens live in the user's session only —
 * they are never written to the synced options store.
 *
 * Flow:
 *   1. GET  /api/onenote-import/auth-url  -> { authUrl }   (client opens it in a browser)
 *   2. GET  /api/onenote-import/callback  -> browser lands here after sign-in; tokens are stored
 *   3. GET  /api/onenote-import/status    -> { connected, account }   (client polls)
 *   4. GET  /api/onenote-import/notebooks -> { notebooks }
 *   5. POST /api/onenote-import/import    -> { noteId }
 */

import type { OneNoteSectionSelection } from "@triliumnext/commons";
import { becca, ValidationError } from "@triliumnext/core";
import type { Request, Response } from "express";

import { isInternalElectronRequest } from "../../services/electron_request.js";
import { getDesktopSession, type OneNoteTokenSession, setDesktopSession } from "../../services/import/onenote/desktop_session.js";
import graph from "../../services/import/onenote/graph.js";
import importer from "../../services/import/onenote/importer.js";
import { ONENOTE_OAUTH } from "../../services/import/onenote/oauth.js";
import oauth from "../../services/oauth/oauth.js";

function getAuthUrl(req: Request) {
    const { verifier, challenge } = oauth.generatePkce();
    const state = oauth.generateState();
    const redirectUri = getRedirectUri(req);

    req.session.oneNoteImport = { verifier, state, redirectUri };

    return { authUrl: oauth.buildAuthorizationUrl(ONENOTE_OAUTH, { redirectUri, state, challenge }) };
}

async function callback(req: Request, res: Response) {
    res.triliumResponseHandled = true;

    try {
        const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
        const pending = req.session.oneNoteImport;

        if (error) {
            return sendHtml(res, `Sign-in failed: ${error}. You can close this window and try again.`);
        }
        if (!code || !pending?.verifier || !pending.state || !pending.redirectUri || pending.state !== state) {
            return sendHtml(res, "Sign-in could not be completed (invalid or expired state). Please close this window and try again.");
        }

        const tokens = await oauth.exchangeCodeForToken(ONENOTE_OAUTH, { code, verifier: pending.verifier, redirectUri: pending.redirectUri });
        const account = await graph.getAccount(tokens.access_token);

        req.session.oneNoteImport = {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt: Date.now() + tokens.expires_in * 1000,
            account
        };
        await saveSession(req);

        return sendHtml(res, `Connected as ${account.name}. You can close this window and return to Trilium.`);
    } catch (e) {
        return sendHtml(res, `Sign-in failed: ${e instanceof Error ? e.message : String(e)}`);
    }
}

function getStatus(req: Request) {
    const session = tokenStore(req).read();
    return { connected: !!session?.accessToken, account: session?.account ?? null };
}

async function disconnect(req: Request) {
    await tokenStore(req).clear();
    return {};
}

async function getNotebooks(req: Request) {
    const accessToken = await getValidAccessToken(req);
    if (!accessToken) {
        return [401, "Not connected to OneNote."];
    }
    return { notebooks: await graph.listNotebooks(accessToken) };
}

async function runImport(req: Request) {
    const accessToken = await getValidAccessToken(req);
    if (!accessToken) {
        return [401, "Not connected to OneNote."];
    }

    const { parentNoteId, sections, taskId, debug, shrinkImages } = req.body as { parentNoteId: string; sections: OneNoteSectionSelection[]; taskId: string; debug?: boolean; shrinkImages?: boolean };
    if (!parentNoteId || !taskId) {
        throw new ValidationError("parentNoteId and taskId are required.");
    }
    if (!Array.isArray(sections) || sections.length === 0) {
        return [400, "No sections were selected."];
    }
    becca.getNoteOrThrow(parentNoteId);

    // Fire-and-forget: a large notebook can take far longer than the client's HTTP request timeout, so
    // we return immediately and let the import report progress, completion and any error over the
    // WebSocket (taskType "importNotes"). importSelection catches and reports its own failures, so the
    // detached promise never rejects.
    void importer.importSelection({ accessToken, parentNoteId, sections, taskId, debug: !!debug, shrinkImages: !!shrinkImages });
    return {};
}

function getRedirectUri(req: Request): string {
    return `${req.protocol}://${req.get("host")}/api/onenote-import/callback`;
}

/** Returns a usable access token, transparently refreshing it when expired, or null if disconnected. */
async function getValidAccessToken(req: Request): Promise<string | null> {
    const store = tokenStore(req);
    const session = store.read();
    if (!session?.accessToken) {
        return null;
    }

    const stillValid = session.expiresAt && Date.now() < session.expiresAt - 60_000;
    if (stillValid) {
        return session.accessToken;
    }

    if (session.refreshToken) {
        const tokens = await oauth.refreshAccessToken(ONENOTE_OAUTH, { refreshToken: session.refreshToken });
        await store.write({
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token ?? session.refreshToken,
            expiresAt: Date.now() + tokens.expires_in * 1000
        });
        return tokens.access_token;
    }

    // Expired with no refresh token: force a clean reconnect rather than handing back a stale token
    // that would fail mid-import with a confusing Graph 401.
    return null;
}

interface TokenStore {
    read(): OneNoteTokenSession | undefined;
    /** Merges `data` into the stored token, preserving fields (e.g. the account) not being updated. */
    write(data: OneNoteTokenSession): Promise<void>;
    clear(): Promise<void>;
}

/**
 * Picks where the connected Graph token lives. Desktop renderer requests arrive over the
 * `trilium-app://` protocol dispatch (tagged as internal-electron) and use the process-wide
 * {@link getDesktopSession} singleton, because their OAuth callback was handled out-of-band by the
 * main process and never touched this session. Every other request keeps the token in its own
 * express-session, the same browser that completed the callback.
 */
function tokenStore(req: Request): TokenStore {
    if (isInternalElectronRequest(req)) {
        return {
            read: () => getDesktopSession() ?? undefined,
            write: async (data) => setDesktopSession({ ...getDesktopSession(), ...data }),
            clear: async () => setDesktopSession(null)
        };
    }
    return {
        read: () => req.session.oneNoteImport,
        write: async (data) => {
            req.session.oneNoteImport = { ...req.session.oneNoteImport, ...data };
            await saveSession(req);
        },
        clear: async () => {
            delete req.session.oneNoteImport;
            await saveSession(req);
        }
    };
}

function saveSession(req: Request): Promise<void> {
    return new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));
}

function sendHtml(res: Response, message: string) {
    res.status(200).setHeader("Content-Type", "text/html").send(
        `<!doctype html><html><head><meta charset="utf-8"><title>OneNote import</title></head>` +
        `<body style="font-family: sans-serif; padding: 2rem; text-align: center;">` +
        `<p>${escapeHtml(message)}</p><script>setTimeout(() => window.close(), 1500);</script></body></html>`
    );
}

function escapeHtml(text: string): string {
    return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

export default {
    getAuthUrl,
    callback,
    getStatus,
    disconnect,
    getNotebooks,
    runImport
};
