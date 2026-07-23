/**
 * Generic OAuth 2.0 client for public (no-secret) clients: authorization code with PKCE, plus the
 * device authorization grant (RFC 8628) for deployments where no redirect URI can be registered.
 *
 * Provider-agnostic: every call is parameterised by an {@link OAuthProviderConfig} (endpoints, client
 * id, scopes), so the same machinery serves any provider. The first consumer is the OneNote importer's
 * delegated Microsoft Graph access (see services/import/onenote/oauth.ts for its config), driven on the
 * web by the API route (device flow — a self-hosted server's domain cannot be pre-registered as a
 * redirect URI) and on desktop by a loopback redirect (see apps/desktop/.../loopback_oauth.ts).
 *
 * PKCE is mandatory because there is no client secret to authenticate the token request — the flow is
 * protected by the verifier/challenge pair, not by a shared secret. A public-client id is therefore not
 * sensitive and may be shipped in the open.
 */

import { createHash, randomBytes } from "node:crypto";

export interface OAuthProviderConfig {
    /** The provider's authorization endpoint (where the user is sent to sign in). */
    authorizeEndpoint: string;
    /** The provider's token endpoint (where the code is exchanged and tokens are refreshed). */
    tokenEndpoint: string;
    /** The provider's device authorization endpoint (where device codes are requested). */
    deviceCodeEndpoint: string;
    /** The public client id of the registered application. */
    clientId: string;
    /** Space-separated scope list requested for the access token. */
    scopes: string;
}

export interface TokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
    scope?: string;
}

/** Response of the device authorization endpoint (RFC 8628 §3.2). */
export interface DeviceCodeResponse {
    /** The long secret the client polls the token endpoint with. Never shown to (or sent to) the user. */
    device_code: string;
    /** The short code the user types at the verification URI. */
    user_code: string;
    verification_uri: string;
    /** Seconds until the device/user code pair expires. */
    expires_in: number;
    /** Minimum seconds the client must wait between token polls. */
    interval: number;
    /** Human-readable sign-in instructions from the provider. */
    message?: string;
}

export type DevicePollResult =
    /** Not finished yet — poll again. `slowDown` asks the caller to widen its polling interval. */
    | { status: "pending"; slowDown?: boolean }
    | { status: "success"; tokens: TokenResponse };

export interface Pkce {
    verifier: string;
    challenge: string;
}

export function generatePkce(): Pkce {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    return { verifier, challenge };
}

export function generateState(): string {
    return randomBytes(16).toString("hex");
}

export function buildAuthorizationUrl(config: OAuthProviderConfig, { redirectUri, state, challenge }: { redirectUri: string; state: string; challenge: string }): string {
    const params = new URLSearchParams({
        client_id: config.clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        response_mode: "query",
        scope: config.scopes,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256"
    });
    return `${config.authorizeEndpoint}?${params.toString()}`;
}

export async function exchangeCodeForToken(config: OAuthProviderConfig, { code, verifier, redirectUri }: { code: string; verifier: string; redirectUri: string }): Promise<TokenResponse> {
    return postToken(config, {
        client_id: config.clientId,
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        scope: config.scopes
    });
}

export async function refreshAccessToken(config: OAuthProviderConfig, { refreshToken }: { refreshToken: string }): Promise<TokenResponse> {
    return postToken(config, {
        client_id: config.clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: config.scopes
    });
}

/**
 * Starts a device authorization grant (RFC 8628): asks the provider for a user code + device code
 * pair. The user then signs in at `verification_uri` in any browser while the application polls
 * {@link pollDeviceToken}. No redirect URI is involved, which is the whole point — it works no matter
 * what host the application is served from.
 */
export async function requestDeviceCode(config: OAuthProviderConfig): Promise<DeviceCodeResponse> {
    const { response, json } = await postForm<DeviceCodeResponse>(config.deviceCodeEndpoint, {
        client_id: config.clientId,
        scope: config.scopes
    });
    if (!response.ok || !json.device_code || !json.user_code) {
        throw new Error(`OAuth device code request failed: ${errorDetail(response, json)}`);
    }
    return json as DeviceCodeResponse;
}

/**
 * One poll of the token endpoint for a pending device authorization. Returns `pending` while the user
 * has not finished signing in (the caller schedules the next poll) and the tokens once they have.
 *
 * Only a *known terminal* OAuth outcome throws (the user declined, or the code expired) — these mean
 * the device code is dead and the sign-in must restart. Everything else the caller can't recover from
 * a single failed poll — a network blip, a 5xx from the token endpoint, an unrecognised error — is
 * reported as `pending` so a transient hiccup does not abandon an otherwise valid sign-in; the device
 * code's own expiry bounds how long polling can continue.
 */
export async function pollDeviceToken(config: OAuthProviderConfig, deviceCode: string): Promise<DevicePollResult> {
    let response: Response;
    let json: Partial<TokenResponse> & OAuthErrorFields;
    try {
        ({ response, json } = await postForm<TokenResponse>(config.tokenEndpoint, {
            client_id: config.clientId,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code: deviceCode
        }));
    } catch {
        // Couldn't reach the token endpoint at all: transient, keep polling.
        return { status: "pending" };
    }

    if (response.ok && json.access_token) {
        return { status: "success", tokens: json as TokenResponse };
    }
    // `slow_down` means "keep polling, but less often" — ask the caller to widen its interval (RFC 8628).
    if (json.error === "slow_down") {
        return { status: "pending", slowDown: true };
    }
    if (json.error === "authorization_pending") {
        return { status: "pending" };
    }
    if (json.error === "authorization_declined" || json.error === "access_denied") {
        throw new Error("The sign-in was declined.");
    }
    if (json.error === "expired_token") {
        throw new Error("The sign-in code expired before the sign-in was completed. Please try again.");
    }
    // Anything else (5xx, a transient proxy error, an unrecognised code) is not a proven terminal
    // outcome, so keep polling rather than discarding the sign-in on one bad response.
    return { status: "pending" };
}

async function postToken(config: OAuthProviderConfig, body: Record<string, string>): Promise<TokenResponse> {
    const { response, json } = await postForm<TokenResponse>(config.tokenEndpoint, body);
    if (!response.ok || !json.access_token) {
        throw new Error(`OAuth token request failed: ${errorDetail(response, json)}`);
    }
    return json as TokenResponse;
}

interface OAuthErrorFields {
    error?: string;
    error_description?: string;
}

/**
 * POSTs a urlencoded form and parses the JSON response without throwing on HTTP errors, so callers can
 * inspect the OAuth `error` code (the device flow signals "keep polling" via an error response). The
 * endpoint may also return non-JSON (e.g. a reverse proxy's HTML 502 page); that surfaces as the HTTP
 * status rather than an opaque JSON SyntaxError.
 */
async function postForm<T>(url: string, body: Record<string, string>): Promise<{ response: Response; json: Partial<T> & OAuthErrorFields }> {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body).toString()
    });

    const text = await response.text();
    try {
        return { response, json: JSON.parse(text) };
    } catch {
        return { response, json: {} };
    }
}

function errorDetail(response: Response, json: OAuthErrorFields): string {
    return json.error_description || json.error || `HTTP ${response.status}`;
}

export default {
    generatePkce,
    generateState,
    buildAuthorizationUrl,
    exchangeCodeForToken,
    refreshAccessToken,
    requestDeviceCode,
    pollDeviceToken
};
