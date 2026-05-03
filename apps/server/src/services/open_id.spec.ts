import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

import openID from "./open_id";

interface MockOidc {
    isAuthenticated: ReturnType<typeof vi.fn>;
    accessToken?: { isExpired: ReturnType<typeof vi.fn> };
    refreshToken?: string;
    refresh?: ReturnType<typeof vi.fn>;
}

function makeReq(oidc: MockOidc | undefined, loggedIn: boolean): Request {
    return {
        oidc,
        session: loggedIn ? { loggedIn: true } : undefined,
    } as unknown as Request;
}

describe("refreshOidcTokenIfNeeded", () => {
    let next: ReturnType<typeof vi.fn>;
    const res = {} as Response;

    beforeEach(() => {
        next = vi.fn();
    });

    it("calls next without refreshing when the user is not OIDC-authenticated", () => {
        const refresh = vi.fn();
        const req = makeReq(
            { isAuthenticated: vi.fn(() => false), refresh },
            true
        );

        openID.refreshOidcTokenIfNeeded(req, res, next as NextFunction);

        expect(next).toHaveBeenCalledOnce();
        expect(refresh).not.toHaveBeenCalled();
    });

    it("calls next without refreshing when the local session is not logged in", () => {
        const refresh = vi.fn();
        const req = makeReq(
            { isAuthenticated: vi.fn(() => true), refresh },
            false
        );

        openID.refreshOidcTokenIfNeeded(req, res, next as NextFunction);

        expect(next).toHaveBeenCalledOnce();
        expect(refresh).not.toHaveBeenCalled();
    });

    it("calls next without refreshing when the access token is still valid", () => {
        const refresh = vi.fn();
        const req = makeReq(
            {
                isAuthenticated: vi.fn(() => true),
                accessToken: { isExpired: vi.fn(() => false) },
                refreshToken: "rt",
                refresh,
            },
            true
        );

        openID.refreshOidcTokenIfNeeded(req, res, next as NextFunction);

        expect(next).toHaveBeenCalledOnce();
        expect(refresh).not.toHaveBeenCalled();
    });

    it("calls next without refreshing when no refresh token is present", () => {
        const refresh = vi.fn();
        const req = makeReq(
            {
                isAuthenticated: vi.fn(() => true),
                accessToken: { isExpired: vi.fn(() => true) },
                refreshToken: undefined,
                refresh,
            },
            true
        );

        openID.refreshOidcTokenIfNeeded(req, res, next as NextFunction);

        expect(next).toHaveBeenCalledOnce();
        expect(refresh).not.toHaveBeenCalled();
    });

    it("refreshes the token and calls next on success", async () => {
        const refresh = vi.fn().mockResolvedValue(undefined);
        const req = makeReq(
            {
                isAuthenticated: vi.fn(() => true),
                accessToken: { isExpired: vi.fn(() => true) },
                refreshToken: "rt",
                refresh,
            },
            true
        );

        openID.refreshOidcTokenIfNeeded(req, res, next as NextFunction);
        // The middleware calls next() inside an async .then(); flush the microtask queue.
        await new Promise((resolve) => setImmediate(resolve));

        expect(refresh).toHaveBeenCalledOnce();
        expect(next).toHaveBeenCalledOnce();
    });

    it("calls next (without erroring) when refresh fails generically", async () => {
        const refresh = vi.fn().mockRejectedValue(new Error("network down"));
        const req = makeReq(
            {
                isAuthenticated: vi.fn(() => true),
                accessToken: { isExpired: vi.fn(() => true) },
                refreshToken: "rt",
                refresh,
            },
            true
        );

        openID.refreshOidcTokenIfNeeded(req, res, next as NextFunction);
        await new Promise((resolve) => setImmediate(resolve));

        expect(refresh).toHaveBeenCalledOnce();
        expect(next).toHaveBeenCalledOnce();
        // next() must be called with no arguments — the middleware does not surface
        // refresh errors to the express error handler since the local session is still valid.
        expect(next).toHaveBeenCalledWith();
    });

    it("calls next (without erroring) when the refresh token is rejected (invalid_grant)", async () => {
        const invalidGrant = Object.assign(new Error("invalid_grant"), {
            error: "invalid_grant",
        });
        const refresh = vi.fn().mockRejectedValue(invalidGrant);
        const req = makeReq(
            {
                isAuthenticated: vi.fn(() => true),
                accessToken: { isExpired: vi.fn(() => true) },
                refreshToken: "rt",
                refresh,
            },
            true
        );

        openID.refreshOidcTokenIfNeeded(req, res, next as NextFunction);
        await new Promise((resolve) => setImmediate(resolve));

        expect(refresh).toHaveBeenCalledOnce();
        expect(next).toHaveBeenCalledOnce();
        expect(next).toHaveBeenCalledWith();
    });
});
