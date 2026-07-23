import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TokenResponse } from "../../oauth/oauth.js";
import { createGraphTokenProvider, type GraphTokenProviderDeps, type TokenSnapshot } from "./token_provider.js";

function tokenResponse(overrides: Partial<TokenResponse> = {}): TokenResponse {
    return { token_type: "Bearer", access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, ...overrides };
}

/** A provider wired to a mutable in-memory snapshot, mirroring how the route's token store behaves. */
function setup(initial: TokenSnapshot | undefined) {
    let snapshot = initial;
    const refresh = vi.fn<GraphTokenProviderDeps["refresh"]>();
    const write = vi.fn<GraphTokenProviderDeps["write"]>(async (tokens) => {
        snapshot = { ...snapshot, ...tokens };
    });
    const getAccessToken = createGraphTokenProvider({
        read: () => snapshot,
        write,
        refresh
    });
    return { getAccessToken, refresh, write, current: () => snapshot };
}

const FIVE_MINUTES = 5 * 60_000;

describe("createGraphTokenProvider", () => {
    let refreshResult: TokenResponse;

    beforeEach(() => {
        refreshResult = tokenResponse();
    });

    it("returns the current token without refreshing while it is comfortably valid", async () => {
        const { getAccessToken, refresh } = setup({ accessToken: "live", refreshToken: "r", expiresAt: Date.now() + FIVE_MINUTES });

        await expect(getAccessToken()).resolves.toBe("live");
        expect(refresh).not.toHaveBeenCalled();
    });

    it("refreshes and persists when the token is within the expiry skew, returning the new token", async () => {
        const { getAccessToken, refresh, current } = setup({ accessToken: "stale", refreshToken: "old-refresh", expiresAt: Date.now() + 30_000 });
        refresh.mockResolvedValue(refreshResult);

        await expect(getAccessToken()).resolves.toBe("new-access");
        expect(refresh).toHaveBeenCalledWith("old-refresh");
        // The rotated refresh token and the new expiry are persisted so the next operation sees them.
        expect(current()).toMatchObject({ accessToken: "new-access", refreshToken: "new-refresh" });
        expect(current()?.expiresAt).toBeGreaterThan(Date.now());
    });

    it("keeps the existing refresh token when the provider does not rotate it", async () => {
        const { getAccessToken, refresh, current } = setup({ accessToken: "stale", refreshToken: "keep-me", expiresAt: Date.now() - 1000 });
        refresh.mockResolvedValue(tokenResponse({ refresh_token: undefined }));

        await getAccessToken();
        expect(current()?.refreshToken).toBe("keep-me");
    });

    it("collapses concurrent refreshes into a single call (rotated refresh tokens would otherwise clash)", async () => {
        const { getAccessToken, refresh } = setup({ accessToken: "stale", refreshToken: "r", expiresAt: Date.now() - 1000 });
        let resolveRefresh!: (value: TokenResponse) => void;
        refresh.mockReturnValue(new Promise<TokenResponse>((resolve) => { resolveRefresh = resolve; }));

        const first = getAccessToken();
        const second = getAccessToken();
        resolveRefresh(refreshResult);

        await expect(Promise.all([first, second])).resolves.toEqual(["new-access", "new-access"]);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("refreshes again on a later call once the in-flight refresh has settled", async () => {
        const { getAccessToken, refresh, current } = setup({ accessToken: "stale", refreshToken: "r1", expiresAt: Date.now() - 1000 });
        // First refresh yields a token that is itself already near expiry, forcing a second refresh.
        refresh.mockResolvedValueOnce(tokenResponse({ access_token: "first", refresh_token: "r2", expires_in: 0 }));
        refresh.mockResolvedValueOnce(tokenResponse({ access_token: "second", expires_in: 3600 }));

        await expect(getAccessToken()).resolves.toBe("first");
        await expect(getAccessToken()).resolves.toBe("second");
        expect(refresh).toHaveBeenCalledTimes(2);
        expect(refresh).toHaveBeenNthCalledWith(2, "r2");
        expect(current()?.accessToken).toBe("second");
    });

    it("throws a sign-in-again error when there is no connection at all", async () => {
        const { getAccessToken, refresh } = setup(undefined);

        await expect(getAccessToken()).rejects.toThrow(/sign in/i);
        expect(refresh).not.toHaveBeenCalled();
    });

    it("throws when the token is expired and there is no refresh token to use", async () => {
        const { getAccessToken, refresh } = setup({ accessToken: "stale", expiresAt: Date.now() - 1000 });

        await expect(getAccessToken()).rejects.toThrow(/sign in/i);
        expect(refresh).not.toHaveBeenCalled();
    });

    it("surfaces a refresh failure and lets a later call retry", async () => {
        const { getAccessToken, refresh } = setup({ accessToken: "stale", refreshToken: "r", expiresAt: Date.now() - 1000 });
        refresh.mockRejectedValueOnce(new Error("invalid_grant"));
        refresh.mockResolvedValueOnce(refreshResult);

        await expect(getAccessToken()).rejects.toThrow("invalid_grant");
        // The failed refresh must not wedge the single-flight latch shut.
        await expect(getAccessToken()).resolves.toBe("new-access");
        expect(refresh).toHaveBeenCalledTimes(2);
    });
});
