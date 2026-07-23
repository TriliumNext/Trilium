/**
 * REST endpoints for the OneNote importer. Implements the OAuth device authorization grant (delegated
 * Microsoft Graph access) and the actual import. Tokens live in the user's session only — they are
 * never written to the synced options store.
 *
 * The device flow (RFC 8628) is used because a self-hosted server's domain cannot be pre-registered as
 * a redirect URI on the shared app registration, so an authorization-code callback can never come back
 * to it. With the device flow there is no redirect at all: the user enters a short code at Microsoft's
 * sign-in page in any browser while the client polls until the tokens arrive. (The desktop build does
 * not use these sign-in endpoints — it runs an authorization-code flow over a loopback redirect in the
 * Electron main process, which Microsoft matches host-only, and only stores the result here.)
 *
 * Flow:
 *   1. POST /api/onenote-import/device-login -> { userCode, verificationUri, ... }   (shown to the user)
 *   2. POST /api/onenote-import/device-poll  -> { status: pending | connected | failed }   (client polls)
 *   3. GET  /api/onenote-import/status       -> { connected, account }
 *   4. GET  /api/onenote-import/notebooks    -> { notebooks }
 *   5. POST /api/onenote-import/import       -> { noteId }
 */

import type { OneNoteDeviceLogin, OneNoteDevicePollResult, OneNoteSectionSelection } from "@triliumnext/commons";
import { becca, getLog, ValidationError } from "@triliumnext/core";
import type { Request } from "express";

import { isInternalElectronRequest } from "../../services/electron_request.js";
import { getDesktopSession, type OneNoteTokenSession, setDesktopSession } from "../../services/import/onenote/desktop_session.js";
import graph, { type AccessTokenProvider } from "../../services/import/onenote/graph.js";
import importer from "../../services/import/onenote/importer.js";
import { ONENOTE_OAUTH } from "../../services/import/onenote/oauth.js";
import { createGraphTokenProvider } from "../../services/import/onenote/token_provider.js";
import oauth, { type DevicePollResult } from "../../services/oauth/oauth.js";

async function deviceLogin(req: Request): Promise<OneNoteDeviceLogin> {
    const device = await oauth.requestDeviceCode(ONENOTE_OAUTH);

    // Starting a new sign-in discards any previous connection or half-finished attempt. Only the
    // device code (the credential the tokens are polled out with) stays server-side; the browser gets
    // exclusively the user-facing pieces.
    req.session.oneNoteImport = {
        deviceCode: device.device_code,
        deviceCodeExpiresAt: Date.now() + device.expires_in * 1000
    };
    await saveSession(req);

    return {
        userCode: device.user_code,
        verificationUri: device.verification_uri,
        expiresInSeconds: device.expires_in,
        intervalSeconds: device.interval
    };
}

async function devicePoll(req: Request): Promise<OneNoteDevicePollResult | [number, string]> {
    const pending = req.session.oneNoteImport;

    // A concurrent/earlier poll may have already completed the sign-in. Report that instead of polling
    // the now-consumed device code again (which would fail and could wipe the good tokens).
    if (pending?.accessToken) {
        return { status: "connected", account: pending.account ?? EMPTY_ACCOUNT };
    }
    if (!pending?.deviceCode) {
        return [400, "No sign-in is in progress."];
    }

    const clearPending = async () => {
        delete req.session.oneNoteImport;
        await saveSession(req);
    };

    if (pending.deviceCodeExpiresAt && Date.now() > pending.deviceCodeExpiresAt) {
        await clearPending();
        return { status: "failed", error: "The sign-in code expired before the sign-in was completed. Please try again." };
    }

    let result: DevicePollResult;
    try {
        result = await oauth.pollDeviceToken(ONENOTE_OAUTH, pending.deviceCode);
    } catch (e) {
        // pollDeviceToken throws only on a known terminal outcome (declined, code expired): the device
        // code is dead, so the pending state is too and the client offers a fresh sign-in. Transient
        // failures come back as `pending`, never here, so a network blip won't cancel a valid sign-in.
        await clearPending();
        return { status: "failed", error: e instanceof Error ? e.message : String(e) };
    }

    if (result.status === "pending") {
        return { status: "pending", slowDown: result.slowDown };
    }

    // Success consumes the device code, so the tokens can't be re-fetched by polling again — persist
    // them immediately, before the (fallible, non-essential) profile lookup, so a transient failure
    // there can't discard a completed sign-in.
    req.session.oneNoteImport = {
        accessToken: result.tokens.access_token,
        refreshToken: result.tokens.refresh_token,
        expiresAt: Date.now() + result.tokens.expires_in * 1000
    };
    await saveSession(req);

    let account = EMPTY_ACCOUNT;
    try {
        account = await graph.getAccount(() => Promise.resolve(result.tokens.access_token));
        req.session.oneNoteImport = { ...req.session.oneNoteImport, account };
        await saveSession(req);
    } catch (e) {
        // The connection stands (tokens are stored); only the display name is missing. Leave it blank
        // rather than failing the whole sign-in over a cosmetic profile fetch.
        getLog().info(`OneNote sign-in connected but the profile lookup failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    return { status: "connected", account };
}

const EMPTY_ACCOUNT = { name: "", email: "" };

function getStatus(req: Request) {
    const session = tokenStore(req).read();
    return { connected: !!session?.accessToken, account: session?.account ?? null };
}

async function disconnect(req: Request) {
    await tokenStore(req).clear();
    return {};
}

async function getNotebooks(req: Request) {
    const getAccessToken = buildTokenProvider(req);
    if (!(await isConnected(getAccessToken))) {
        return [401, "Not connected to OneNote."];
    }
    return { notebooks: await graph.listNotebooks(getAccessToken) };
}

async function runImport(req: Request) {
    const getAccessToken = buildTokenProvider(req);
    if (!(await isConnected(getAccessToken))) {
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
    // detached promise never rejects. The token provider (not a fixed token) is handed off so the
    // import keeps refreshing across its whole run, which can outlast a single Graph token.
    void importer.importSelection({ getAccessToken, parentNoteId, sections, taskId, debug: !!debug, shrinkImages: !!shrinkImages });
    return {};
}

/**
 * Builds the token provider bound to this request's token store (session on web, the process-wide
 * singleton on desktop). Returns a valid access token per call, refreshing and persisting as expiry
 * nears; the importer re-reads it before every Graph request so a long import never runs on an expired
 * token. See {@link createGraphTokenProvider}.
 */
function buildTokenProvider(req: Request): AccessTokenProvider {
    const store = tokenStore(req);
    return createGraphTokenProvider({
        read: () => store.read(),
        write: (tokens) => store.write(tokens),
        refresh: (refreshToken) => oauth.refreshAccessToken(ONENOTE_OAUTH, { refreshToken })
    });
}

/** True when the connection can currently produce an access token; false when disconnected/unrefreshable. */
async function isConnected(getAccessToken: AccessTokenProvider): Promise<boolean> {
    try {
        await getAccessToken();
        return true;
    } catch {
        return false;
    }
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

export default {
    deviceLogin,
    devicePoll,
    getStatus,
    disconnect,
    getNotebooks,
    runImport
};
