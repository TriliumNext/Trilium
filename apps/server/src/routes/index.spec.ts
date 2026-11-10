import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import { markAsInternalElectronRequest } from "../services/electron_request.js";

const state = vi.hoisted(() => {
    const defaults = () => ({
        config: { General: {}, Network: {} } as { General?: Record<string, unknown>; Network: Record<string, unknown> },
        isMac: false,
        supportsBackgroundMaterial: false,
        isDbInitialized: true,
        isPasswordSet: true,
        sharedItems: {} as Record<string, unknown>,
        optionMap: {} as Record<string, string>,
        csrfToken: "csrf-test-token" as string | undefined,
        logInfo: [] as string[]
    });
    return { defaults, current: defaults() };
});

// Force the process-wide desktop-build flag ON so these tests reproduce the
// #10589 setup: a browser hitting the desktop app's HTTP listener. The gating
// must key off the per-request trusted-renderer marker, NOT this flag — that's
// exactly what the assertions below verify.
vi.mock("../services/utils.js", async (orig) => {
    const actual = await orig<typeof import("../services/utils.js")>();
    return {
        ...actual,
        isElectron: true,
        isDev: true,
        get isMac() { return state.current.isMac; },
        get supportsBackgroundMaterial() { return state.current.supportsBackgroundMaterial; }
    };
});

vi.mock("../services/config.js", () => ({
    default: {
        get General() { return state.current.config.General; },
        get Network() { return state.current.config.Network; }
    }
}));
vi.mock("../services/port.js", () => ({ default: 8080 }));
vi.mock("../services/app_path.js", () => ({ default: "app" }));
vi.mock("../services/asset_path.js", () => ({ default: "assets" }));
vi.mock("./csrf_protection.js", () => ({ generateCsrfToken: () => state.current.csrfToken }));
vi.mock("../services/open_id.js", () => ({
    default: { isOpenIDEnabled: () => false, getSSOIssuerName: () => "", getSSOIssuerIcon: () => "" }
}));
vi.mock("../services/totp.js", () => ({ default: { isTotpEnabled: () => false } }));

vi.mock("@triliumnext/core", () => ({
    attributes: {},
    BNote: class {},
    getSharedBootstrapItems: () => state.current.sharedItems,
    icon_packs: { getIconPacks: () => [], generateCss: () => "", MIME_TO_EXTENSION_MAPPINGS: {} },
    options: { getOptionMap: () => state.current.optionMap },
    password: { isPasswordSet: () => state.current.isPasswordSet },
    sql_init: { isDbInitialized: () => state.current.isDbInitialized },
    task_states: { generateTaskStateCss: () => "" },
    getLog: () => ({ info: (message: string) => state.current.logInfo.push(message), error: () => {} })
}));

const { bootstrap, getView } = await import("./index.js");

afterEach(() => {
    state.current = state.defaults();
});

function makeReq(overrides: {
    loggedIn?: boolean;
    internal?: boolean;
    query?: Record<string, unknown>;
    cookies?: Record<string, string>;
    userAgent?: string;
    session?: Record<string, unknown>;
} = {}): Request {
    const req = {
        session: Object.assign(overrides.session ?? {}, { loggedIn: overrides.loggedIn ?? false }),
        query: overrides.query ?? {},
        headers: overrides.userAgent ? { "user-agent": overrides.userAgent } : {},
        cookies: overrides.cookies ?? {}
    } as unknown as Request;
    if (overrides.internal) {
        markAsInternalElectronRequest(req);
    }
    return req;
}

function makeRes(): { res: Response; body: () => any } {
    let captured: any;
    const res = { send: (payload: any) => { captured = payload; } } as unknown as Response;
    return { res, body: () => captured };
}

describe("bootstrap auth gating (desktop build, #10589)", () => {
    it("serves the login screen to an untrusted (browser) request even on a desktop build", () => {
        const { res, body } = makeRes();
        bootstrap(makeReq({ loggedIn: false, internal: false }), res);

        // A browser hitting the desktop's HTTP listener must get the login screen,
        // not a spurious loggedIn:true (which stranded it with 401s on every API call).
        expect(body().loggedIn).toBe(false);
        expect(body().login).toBeTruthy();
        expect(body().csrfToken).toBeUndefined();
        // ...and it must NOT be told it's the Electron renderer (no `electron` body
        // class, no renderer-only trilium-app:// URLs).
        expect(body().isElectron).toBe(false);
        expect(body().wsBaseUrl).toBeUndefined();
    });

    it("treats a browser as logged in once it has a real session", () => {
        const { res, body } = makeRes();
        bootstrap(makeReq({ loggedIn: true, internal: false }), res);

        expect(body().loggedIn).toBe(true);
        expect(body().csrfToken).toBe("csrf-test-token");
    });

    it("bypasses the login screen for the trusted desktop renderer with no web session", () => {
        const { res, body } = makeRes();
        bootstrap(makeReq({ loggedIn: false, internal: true }), res);

        // The trilium-app:// renderer is trusted and never gates on a web session.
        expect(body().loggedIn).toBe(true);
        expect(body().csrfToken).toBe("csrf-test-token");
        // It IS the Electron renderer, so it keeps the electron flag and the
        // absolute renderer-only URLs it can't derive from trilium-app://.
        expect(body().isElectron).toBe(true);
        expect(body().wsBaseUrl).toBeTruthy();
    });
});

describe("bootstrap payloads", () => {
    it("serves the setup payload before the database exists, with background effects only for the renderer", () => {
        state.current.isDbInitialized = false;
        state.current.isMac = true;

        const browser = makeRes();
        bootstrap(makeReq(), browser.res);
        expect(browser.body()).toMatchObject({ hasBackgroundEffects: false, isMainWindow: true, appCssNoteIds: [] });
        expect(browser.body().loggedIn).toBeUndefined();

        const renderer = makeRes();
        bootstrap(makeReq({ internal: true }), renderer.res);
        expect(renderer.body().hasBackgroundEffects).toBe(true);

        state.current.isMac = false;
        state.current.supportsBackgroundMaterial = true;
        const windows = makeRes();
        bootstrap(makeReq({ internal: true }), windows.res);
        expect(windows.body().hasBackgroundEffects).toBe(true);
    });

    it("asks a browser to set a password while none is set, unless authentication is off", () => {
        state.current.isPasswordSet = false;

        const browser = makeRes();
        bootstrap(makeReq(), browser.res);
        expect(browser.body()).toMatchObject({ passwordSet: false, hasNativeTitleBar: false });

        state.current.config.General = { noAuthentication: true };
        const open = makeRes();
        bootstrap(makeReq(), open.res);
        expect(open.body()).toMatchObject({ loggedIn: true, passwordSet: true });
    });

    it("exempts the renderer and an unauthenticated instance from the setup password gate", () => {
        state.current.sharedItems = { setupAuthRequired: true, setupSecondFactorRequired: true };
        const gates = (req: Request) => {
            const { res, body } = makeRes();
            bootstrap(req, res);
            return [ body().setupAuthRequired, body().setupSecondFactorRequired ];
        };

        expect(gates(makeReq())).toEqual([ true, true ]);
        expect(gates(makeReq({ internal: true }))).toEqual([ false, false ]);
        state.current.config.General = { noAuthentication: true };
        expect(gates(makeReq())).toEqual([ false, false ]);
    });

    it("hands the login screen a pending SSO error once, and reduces a connection failure to a flag", () => {
        const session: Record<string, unknown> = { ssoError: "access_denied", ssoConnectionFailed: "ECONNREFUSED" };
        const first = makeRes();
        bootstrap(makeReq({ session }), first.res);
        expect(first.body().login).toMatchObject({ ssoError: "access_denied", ssoConnectionFailed: true });
        expect(session).not.toHaveProperty("ssoError");
        expect(session).not.toHaveProperty("ssoConnectionFailed");

        const second = makeRes();
        bootstrap(makeReq({ session }), second.res);
        expect(second.body().login).toMatchObject({ ssoError: undefined, ssoConnectionFailed: false });
    });

    it("hands a logged-in client its one-shot OAuth notices and keeps an initialized CSRF session", () => {
        const session: Record<string, unknown> = {
            csrfInitialized: true, ssoJustEnrolled: true, ssoConnectionFailed: "TLS rejected"
        };
        const first = makeRes();
        bootstrap(makeReq({ loggedIn: true, session }), first.res);
        expect(first.body()).toMatchObject({ oauthJustEnrolled: true, oauthConnectionFailed: "TLS rejected" });
        expect(session).toEqual({ loggedIn: true, csrfInitialized: true });

        const second = makeRes();
        bootstrap(makeReq({ loggedIn: true, session }), second.res);
        expect(second.body()).toMatchObject({ oauthJustEnrolled: false, oauthConnectionFailed: undefined });
    });

    it("logs a failed CSRF token generation", () => {
        state.current.csrfToken = undefined;
        bootstrap(makeReq({ loggedIn: true }), makeRes().res);
        state.current.csrfToken = "t";
        bootstrap(makeReq({ loggedIn: true }), makeRes().res);

        expect(state.current.logInfo).toEqual([ "CSRF token generation: Failed", "CSRF token generation: Successful" ]);
    });

    it("gives the renderer loopback URLs with the configured protocol and the window chrome options", () => {
        state.current.config = { General: { instanceName: "work" }, Network: { https: true } };
        state.current.optionMap = { nativeTitleBarVisible: "false", backgroundEffects: "true" };
        state.current.isMac = true;

        const renderer = makeRes();
        bootstrap(makeReq({ internal: true }), renderer.res);
        expect(renderer.body()).toMatchObject({
            instanceName: "work",
            wsBaseUrl: "ws://127.0.0.1:8080/",
            httpBaseUrl: "https://127.0.0.1:8080",
            hasNativeTitleBar: false,
            hasBackgroundEffects: true
        });

        state.current.config = { General: undefined, Network: { https: false } };
        state.current.optionMap = { nativeTitleBarVisible: "true", backgroundEffects: "true" };
        const titled = makeRes();
        bootstrap(makeReq({ internal: true }), titled.res);
        expect(titled.body()).toMatchObject({
            instanceName: null,
            httpBaseUrl: "http://127.0.0.1:8080",
            hasNativeTitleBar: true,
            hasBackgroundEffects: false
        });

        state.current.isMac = false;
        state.current.optionMap = { backgroundEffects: "true" };
        const plain = makeRes();
        bootstrap(makeReq({ internal: true }), plain.res);
        expect(plain.body().hasBackgroundEffects).toBe(false);
    });

    it("marks only an extra desktop window as secondary", () => {
        const isMainWindow = (req: Request) => {
            const { res, body } = makeRes();
            bootstrap(req, res);
            return body().isMainWindow;
        };

        expect(isMainWindow(makeReq({ loggedIn: true }))).toBe(true);
        expect(isMainWindow(makeReq({ loggedIn: true, query: { extraWindow: "1" } }))).toBe(false);
        expect(isMainWindow(makeReq({ loggedIn: true, query: { extraWindow: "1", mobile: "" } }))).toBe(true);
    });
});

describe("getView view resolution (desktop build, #10720)", () => {
    it("resolves the mobile view when a browser hits a desktop build with the trilium-device=mobile cookie", () => {
        // "Switch to Mobile Version" sets this cookie and reloads. On a desktop
        // build the process-wide isElectron flag is true, but this browser request
        // is NOT the trusted renderer, so the cookie must still be honoured.
        // Previously getView short-circuited on the global flag and always returned
        // "desktop", so the mobile layout never activated.
        const req = makeReq({ internal: false, cookies: { "trilium-device": "mobile" } });

        expect(getView(req)).toBe("mobile");
    });

    it("keeps the desktop view for the trusted Electron renderer even with a mobile cookie", () => {
        const req = makeReq({ internal: true, cookies: { "trilium-device": "mobile" } });

        expect(getView(req)).toBe("desktop");
    });

    it("honours the print override above everything else", () => {
        const req = makeReq({ query: { print: "" }, cookies: { "trilium-device": "mobile" } });

        expect(getView(req)).toBe("print");
    });

    it("respects the ?mobile and ?desktop query overrides on a browser request", () => {
        expect(getView(makeReq({ query: { mobile: "" } }))).toBe("mobile");
        expect(getView(makeReq({ query: { desktop: "" } }))).toBe("desktop");
    });

    it("respects an explicit trilium-device=desktop cookie", () => {
        expect(getView(makeReq({ cookies: { "trilium-device": "desktop" } }))).toBe("desktop");
    });

    it("falls back to user-agent detection when no override is present", () => {
        const mobileUa = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
        expect(getView(makeReq({ userAgent: mobileUa }))).toBe("mobile");

        const desktopUa = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome";
        expect(getView(makeReq({ userAgent: desktopUa }))).toBe("desktop");
    });
});
