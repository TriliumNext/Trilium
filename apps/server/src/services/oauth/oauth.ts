/**
 * Generic OAuth 2.0 authorization-code-with-PKCE client for public (no-secret) clients.
 *
 * Provider-agnostic: every call is parameterised by an {@link OAuthProviderConfig} (endpoints, client
 * id, scopes), so the same machinery serves any provider. The first consumer is the OneNote importer's
 * delegated Microsoft Graph access (see services/import/onenote/oauth.ts for its config), driven on the
 * web by the API route and on desktop by a loopback redirect (see apps/desktop/.../loopback_oauth.ts).
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

async function postToken(config: OAuthProviderConfig, body: Record<string, string>): Promise<TokenResponse> {
    const response = await fetch(config.tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body).toString()
    });

    // The token endpoint may return a non-JSON error (e.g. a reverse proxy's HTML 502/500 page); parse
    // the text ourselves so that surfaces as the HTTP status rather than an opaque JSON SyntaxError.
    const text = await response.text();
    let json: Partial<TokenResponse> & { error?: string; error_description?: string };
    try {
        json = JSON.parse(text);
    } catch {
        throw new Error(`OAuth token request failed: HTTP ${response.status}`);
    }
    if (!response.ok || !json.access_token) {
        const detail = json.error_description || json.error || `HTTP ${response.status}`;
        throw new Error(`OAuth token request failed: ${detail}`);
    }
    return json as TokenResponse;
}

export default {
    generatePkce,
    generateState,
    buildAuthorizationUrl,
    exchangeCodeForToken,
    refreshAccessToken
};
