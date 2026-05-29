import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

import openID, { _resetInFlightRefreshesForTesting } from "./open_id";

interface MockOidc {
    isAuthenticated: ReturnType<typeof vi.fn>;
    accessToken?: { isExpired: ReturnType<typeof vi.fn> };
    refreshToken?: string;
    refresh?: ReturnType<typeof vi.fn>;
}

interface MockSession {
    loggedIn?: boolean;
}

let sessionCounter = 0;

function makeReq(oidc: MockOidc | undefined, session: MockSession | undefined): { req: Request; session: MockSession | undefined } {
    sessionCounter += 1;
    const req = {
        oidc,
        session,
        sessionID: `sid-${sessionCounter}`,
    } as unknown as Request;
    return { req, session };
}

function flushMicrotasks() {
    return new Promise((resolve) => setImmediate(resolve));
}

describe("refreshOidcTokenIfNeeded", () => {
    let next: ReturnType<typeof vi.fn>;
    const res = {} as Response;

    beforeEach(() => {
        next = vi.fn();
        _resetInFlightRefreshesForTesting();
    });

    it("calls next without refreshing when the user is not OIDC-authenticated", () => {
        const refresh = vi.fn();
        const { req } = makeReq(
            { isAuthenticated: vi.fn(() => false), refresh },
            { loggedIn: true }
        );

        openID.refreshOidcTokenIfNeeded(req, res, next as NextFunction);

        expect(next).toHaveBeenCalledOnce();
        expect(refresh).not.toHaveBeenCalled();
    });

    it("calls next without refreshing when the local session is not logged in", () => {
        const refresh = vi.fn();
        const { req } = makeReq(
            { isAuthenticated: vi.fn(() => true), refresh },
            { loggedIn: false }
        );

        openID.refreshOidcTokenIfNeeded(req, res, next as NextFunction);

        expect(next).toHaveBeenCalledOnce();
        expect(refresh).not.toHaveBeenCalled();
    });

    it("calls next without refreshing when the access token is still valid", () => {
        const refresh = vi.fn();
        const { req } = makeReq(
            {
                isAuthenticated: vi.fn(() => true),
                accessToken: { isExpired: vi.fn(() => false) },
                refreshToken: "rt",
                refresh,
            },
            { loggedIn: true }
        );

        openID.refreshOidcTokenIfNeeded(req, res, next as NextFunction);

        expect(next).toHaveBeenCalledOnce();
        expect(refresh).not.toHaveBeenCalled();
    });

    it("calls next without refreshing when no refresh token is present", () => {
        const refresh = vi.fn();
        const { req } = makeReq(
            {
                isAuthenticated: vi.fn(() => true),
                accessToken: { isExpired: vi.fn(() => true) },
                refreshToken: undefined,
                refresh,
            },
            { loggedIn: true }
        );

        openID.refreshOidcTokenIfNeeded(req, res, next as NextFunction);

        expect(next).toHaveBeenCalledOnce();
        expect(refresh).not.toHaveBeenCalled();
    });

    it("refreshes the token and calls next on success", async () => {
        const refresh = vi.fn().mockResolvedValue(undefined);
        const { req } = makeReq(
            {
                isAuthenticated: vi.fn(() => true),
                accessToken: { isExpired: vi.fn(() => true) },
                refreshToken: "rt",
                refresh,
            },
            { loggedIn: true }
        );

        openID.refreshOidcTokenIfNeeded(req, res, next as NextFunction);
        await flushMicrotasks();

        expect(refresh).toHaveBeenCalledOnce();
        expect(next).toHaveBeenCalledOnce();
    });

    it("soft-fails on transient refresh errors so the local session survives an IdP outage", async () => {
        const refresh = vi.fn().mockRejectedValue(new Error("network down"));
        const { req, session } = makeReq(
            {
                isAuthenticated: vi.fn(() => true),
                accessToken: { isExpired: vi.fn(() => true) },
                refreshToken: "rt",
                refresh,
            },
            { loggedIn: true }
        );

        openID.refreshOidcTokenIfNeeded(req, res, next as NextFunction);
        await flushMicrotasks();

        expect(refresh).toHaveBeenCalledOnce();
        expect(next).toHaveBeenCalledOnce();
        // Session must remain authenticated — transient errors are not terminal.
        expect(session?.loggedIn).toBe(true);
    });

    it("forces re-authentication on invalid_grant by marking the session not-logged-in", async () => {
        const invalidGrant = Object.assign(new Error("Token revoked"), {
            error: "invalid_grant",
        });
        const refresh = vi.fn().mockRejectedValue(invalidGrant);
        const { req, session } = makeReq(
            {
                isAuthenticated: vi.fn(() => true),
                accessToken: { isExpired: vi.fn(() => true) },
                refreshToken: "rt",
                refresh,
            },
            { loggedIn: true }
        );

        openID.refreshOidcTokenIfNeeded(req, res, next as NextFunction);
        await flushMicrotasks();

        expect(refresh).toHaveBeenCalledOnce();
        expect(next).toHaveBeenCalledOnce();
        // checkAuth (downstream) will see !loggedIn and redirect to login.
        expect(session?.loggedIn).toBe(false);
    });

    it("coalesces concurrent refresh requests for the same session", async () => {
        let resolveRefresh: () => void = () => undefined;
        const refresh1 = vi.fn(() => new Promise<void>((resolve) => { resolveRefresh = resolve; }));
        const refresh2 = vi.fn();

        // Both requests have the same sessionID — simulating two concurrent tabs / requests
        // for the same logged-in user hitting the server while the access token is expired.
        const sharedSessionId = "shared-sid";
        const baseOidc = {
            isAuthenticated: vi.fn(() => true),
            accessToken: { isExpired: vi.fn(() => true) },
            refreshToken: "rt",
        };
        const req1 = { oidc: { ...baseOidc, refresh: refresh1 }, session: { loggedIn: true }, sessionID: sharedSessionId } as unknown as Request;
        const req2 = { oidc: { ...baseOidc, refresh: refresh2 }, session: { loggedIn: true }, sessionID: sharedSessionId } as unknown as Request;
        const next1 = vi.fn();
        const next2 = vi.fn();

        openID.refreshOidcTokenIfNeeded(req1, res, next1 as NextFunction);
        openID.refreshOidcTokenIfNeeded(req2, res, next2 as NextFunction);

        // Only the first request actually hits the IdP — the second piggy-backs.
        expect(refresh1).toHaveBeenCalledOnce();
        expect(refresh2).not.toHaveBeenCalled();

        resolveRefresh();
        await flushMicrotasks();

        expect(next1).toHaveBeenCalledOnce();
        expect(next2).toHaveBeenCalledOnce();
    });
});
