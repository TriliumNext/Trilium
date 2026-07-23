/**
 * Builds the access-token provider the importer calls before every Graph request.
 *
 * A large or heavily-throttled import runs far longer than a Microsoft Graph access token lives
 * (~60–90 min), and a single throttled request can wait out most of that on its own. Passing one token
 * captured at the start would leave every request past the expiry boundary failing with 401 — which,
 * with the per-page hardening, degrades the import into a tree of placeholder notes and then trips the
 * circuit breaker. So instead of a fixed string the importer holds this provider and re-reads a token
 * from it on each attempt: it hands back the current token while it is valid and transparently refreshes
 * (persisting the rotated token) as expiry approaches.
 */

import type { TokenResponse } from "../../oauth/oauth.js";

/** How long before actual expiry a token is treated as stale, to refresh before a request can 401. */
const REFRESH_SKEW_MS = 60_000;

/** The stored token state the provider reads; a subset of the session's OneNote token fields. */
export interface TokenSnapshot {
    accessToken?: string;
    refreshToken?: string;
    /** Epoch millis at which the access token expires. */
    expiresAt?: number;
}

export interface GraphTokenProviderDeps {
    /** Reads the current token snapshot, or undefined when the connection is gone. */
    read: () => TokenSnapshot | undefined;
    /** Persists a refreshed token so later requests (and operations) reuse it. */
    write: (tokens: { accessToken: string; refreshToken?: string; expiresAt: number }) => Promise<void>;
    /** Exchanges a refresh token for a fresh access (and possibly rotated refresh) token. */
    refresh: (refreshToken: string) => Promise<TokenResponse>;
}

export function createGraphTokenProvider(deps: GraphTokenProviderDeps): () => Promise<string> {
    // Single-flight latch: concurrent resource downloads all near the expiry boundary must share one
    // refresh. Microsoft rotates the refresh token on each use, so parallel refreshes would race and
    // invalidate each other's tokens.
    let inFlightRefresh: Promise<string> | null = null;

    async function refreshNow(refreshToken: string): Promise<string> {
        const tokens = await deps.refresh(refreshToken);
        await deps.write({
            accessToken: tokens.access_token,
            // Reuse the current refresh token when the provider chose not to rotate it.
            refreshToken: tokens.refresh_token ?? refreshToken,
            expiresAt: Date.now() + tokens.expires_in * 1000
        });
        return tokens.access_token;
    }

    return async function getAccessToken(): Promise<string> {
        const session = deps.read();
        if (!session?.accessToken) {
            throw new Error("The OneNote connection was lost. Please sign in again and restart the import.");
        }

        if (session.expiresAt && Date.now() < session.expiresAt - REFRESH_SKEW_MS) {
            return session.accessToken;
        }

        if (!session.refreshToken) {
            throw new Error("The OneNote access token expired and could not be refreshed. Please sign in again and restart the import.");
        }

        if (!inFlightRefresh) {
            inFlightRefresh = refreshNow(session.refreshToken).finally(() => {
                inFlightRefresh = null;
            });
        }
        return inFlightRefresh;
    };
}
