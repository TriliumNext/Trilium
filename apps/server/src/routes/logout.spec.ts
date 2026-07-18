import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockIsOpenIDEnabled, mockIsSubjectIdentifierSaved } = vi.hoisted(() => ({
    mockIsOpenIDEnabled: vi.fn<() => boolean>(),
    mockIsSubjectIdentifierSaved: vi.fn<() => boolean>()
}));

vi.mock("../services/open_id.js", () => ({
    default: {
        isOpenIDEnabled: mockIsOpenIDEnabled,
        getSSOIssuerName: () => "",
        getSSOIssuerIcon: () => ""
    }
}));

vi.mock("../services/encryption/open_id_encryption.js", () => ({
    default: { isSubjectIdentifierSaved: mockIsSubjectIdentifierSaved }
}));

import login from "./login.js";

describe("logout", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("issues exactly one response via the OIDC provider when SSO is active", () => {
        mockIsOpenIDEnabled.mockReturnValue(true);
        mockIsSubjectIdentifierSaved.mockReturnValue(true);

        const { res, oidcLogout, redirect } = makeResponse();

        // oidc.logout() already sends the redirect; a trailing res.redirect() would throw
        // ERR_HTTP_HEADERS_SENT — the crash reported on POST /logout.
        expect(() => login.logout(makeRequest(), res)).not.toThrow();

        expect(oidcLogout).toHaveBeenCalledTimes(1);
        expect(oidcLogout).toHaveBeenCalledWith({ returnTo: "/" });
        expect(redirect).not.toHaveBeenCalled();
    });

    it("falls back to a local redirect when SSO is not configured", () => {
        mockIsOpenIDEnabled.mockReturnValue(false);
        mockIsSubjectIdentifierSaved.mockReturnValue(false);

        const { res, oidcLogout, redirect } = makeResponse();

        expect(() => login.logout(makeRequest(), res)).not.toThrow();

        expect(oidcLogout).not.toHaveBeenCalled();
        expect(redirect).toHaveBeenCalledTimes(1);
        expect(redirect).toHaveBeenCalledWith("login");
    });
});

/**
 * A response double that models the single invariant that matters here: Express throws
 * ERR_HTTP_HEADERS_SENT if a second response is written after the headers are sent.
 * Both `oidc.logout()` and `redirect()` "send" the response, so calling both on one
 * request reproduces the crash.
 */
function makeResponse() {
    let headersSent = false;
    const sendResponse = () => {
        if (headersSent) {
            throw new Error("Cannot set headers after they are sent to the client [ERR_HTTP_HEADERS_SENT]");
        }
        headersSent = true;
    };

    const oidcLogout = vi.fn(sendResponse);
    const redirect = vi.fn(sendResponse);

    return {
        res: { oidc: { logout: oidcLogout }, redirect } as unknown as Response,
        oidcLogout,
        redirect
    };
}

function makeRequest() {
    const session = {
        loggedIn: true,
        // session.regenerate swaps the session and runs its callback; invoke it synchronously.
        regenerate(cb: () => void) {
            cb();
        }
    };
    return { session } as unknown as Request;
}
