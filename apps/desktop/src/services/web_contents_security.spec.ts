import { beforeEach, describe, expect, it, vi } from "vitest";

// Captured app event handlers plus logged errors. `electron` is mocked because
// on CI its entry point throws ("Electron failed to install correctly") when
// the binary isn't materialized; `getLog` is stubbed because the log service
// requires `initializeCore`.
const state = vi.hoisted(() => {
    type PermissionRequestHandler = (
        webContents: unknown,
        permission: string,
        callback: (granted: boolean) => void,
        details: { requestingUrl: string }
    ) => void;
    type PermissionCheckHandler = (webContents: unknown, permission: string, requestingOrigin?: string) => boolean;
    type BeforeSendHeadersListener = (
        details: { requestHeaders: Record<string, string> },
        callback: (response: { requestHeaders: Record<string, string> }) => void
    ) => void;

    /** Fake Electron session capturing the handlers installed on it. */
    function makeFakeSession() {
        const session = {
            requestHandler: undefined as PermissionRequestHandler | undefined,
            checkHandler: undefined as PermissionCheckHandler | undefined,
            beforeSendHeaders: undefined as BeforeSendHeadersListener | undefined,
            setPermissionRequestHandler(fn: PermissionRequestHandler) {
                session.requestHandler = fn;
            },
            setPermissionCheckHandler(fn: PermissionCheckHandler) {
                session.checkHandler = fn;
            },
            webRequest: {
                onBeforeSendHeaders(_filter: { urls: string[] }, fn: BeforeSendHeadersListener) {
                    session.beforeSendHeaders = fn;
                }
            }
        };
        return session;
    }

    return {
        appHandlers: new Map<string, (...args: unknown[]) => unknown>(),
        errors: [] as string[],
        defaultSession: makeFakeSession(),
        partitionSessions: new Map<string, ReturnType<typeof makeFakeSession>>(),
        makeFakeSession,
        shellOpenExternal: [] as string[],
        shellOpenExternalThrow: false
    };
});

vi.mock("@triliumnext/core", () => ({
    getLog: () => ({ error: (msg: string) => state.errors.push(msg) })
}));

// shell.ts (imported for validateOpenExternalUrl) transitively pulls in the
// server's data_dir module, which resolves and creates directories at import
// time — stub it out to keep this spec free of filesystem side effects.
vi.mock("@triliumnext/server/src/services/data_dir.js", () => ({
    default: { TMP_DIR: "/tmp" }
}));

vi.mock("electron", () => ({
    default: {
        app: {
            on: (event: string, fn: (...args: unknown[]) => unknown) => state.appHandlers.set(event, fn),
            whenReady: () => Promise.resolve()
        },
        session: {
            get defaultSession() {
                return state.defaultSession;
            },
            fromPartition: (partition: string) => {
                let session = state.partitionSessions.get(partition);
                if (!session) {
                    session = state.makeFakeSession();
                    state.partitionSessions.set(partition, session);
                }
                return session;
            }
        },
        shell: {
            openExternal: (target: string) => {
                if (state.shellOpenExternalThrow) {
                    return Promise.reject(new Error("boom"));
                }
                state.shellOpenExternal.push(target);
                return Promise.resolve();
            }
        }
    }
}));

const { hardenWebviewPreferences, isNavigationAllowed, isPermissionAllowed, isPermissionAllowedForOrigin, setupWebContentsSecurity, withYouTubeEmbedReferer } = await import("./web_contents_security.js");

interface WindowOpenResult {
    action: "allow" | "deny";
}

/**
 * Simulates the main process creating a WebContents of the given type and
 * returns the security hooks the global handler installed on it.
 */
function createContents(type: "window" | "webview" = "window") {
    const created = state.appHandlers.get("web-contents-created");
    if (!created) throw new Error("web-contents-created not registered");

    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    let windowOpenHandler: ((details: { url: string }) => WindowOpenResult) | undefined;
    created({}, {
        getType: () => type,
        on: (event: string, fn: (...args: unknown[]) => unknown) => handlers.set(event, fn),
        setWindowOpenHandler: (fn: (details: { url: string }) => WindowOpenResult) => {
            windowOpenHandler = fn;
        }
    });

    return {
        handlers,
        openWindow(url: string): WindowOpenResult {
            if (!windowOpenHandler) throw new Error("window open handler not installed");
            return windowOpenHandler({ url });
        }
    };
}

function resetState() {
    state.appHandlers.clear();
    state.errors.length = 0;
    state.defaultSession = state.makeFakeSession();
    state.partitionSessions.clear();
    state.shellOpenExternal.length = 0;
    state.shellOpenExternalThrow = false;
}

describe("hardenWebviewPreferences", () => {
    it("reports no violations for a benign attach and forces isolation on", () => {
        // A legitimate attach (WebView.tsx) always declares the guest partition.
        const prefs: Electron.WebPreferences = { partition: "persist:webview" };

        const violations = hardenWebviewPreferences(prefs);

        expect(violations).toEqual([]);
        expect(prefs).toMatchObject({
            nodeIntegration: false,
            nodeIntegrationInSubFrames: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
            contextIsolation: true,
            sandbox: true,
            partition: "persist:webview"
        });
    });

    it("requires exactly the guest partition and rejects any other, unset, or empty value", () => {
        const legit: Electron.WebPreferences = { partition: "persist:webview" };
        expect(hardenWebviewPreferences(legit)).toEqual([]);

        // Wrong partition in the web preferences (e.g. trying to share the
        // default session's persistent storage under another name).
        const hostile: Electron.WebPreferences = { partition: "persist:evil" };
        expect(hardenWebviewPreferences(hostile)).toEqual(["partition 'persist:evil'"]);
        expect(hostile.partition).toBe("persist:webview");

        // Wrong partition surfaced only via the attach params (attribute
        // plumbing differs between Electron versions).
        const viaParams: Electron.WebPreferences = {};
        expect(hardenWebviewPreferences(viaParams, "persist:evil")).toEqual(["partition 'persist:evil'"]);
        expect(viaParams.partition).toBe("persist:webview");

        // Unset partition (no attribute) — must not slip through to the default
        // session, so it is a violation and the attach is denied.
        const unset: Electron.WebPreferences = {};
        expect(hardenWebviewPreferences(unset)).toEqual(["partition '<unset>'"]);
        expect(unset.partition).toBe("persist:webview");

        // Empty partition — Electron surfaces an omitted <webview partition> as
        // "", which must be rejected just the same.
        const empty: Electron.WebPreferences = {};
        expect(hardenWebviewPreferences(empty, "")).toEqual(["partition ''"]);
    });

    it("normalizes explicitly-disabled isolation silently (Electron default plumbing, not hostile markup)", () => {
        const prefs: Electron.WebPreferences = { contextIsolation: false, sandbox: false, partition: "persist:webview" };

        const violations = hardenWebviewPreferences(prefs);

        expect(violations).toEqual([]);
        expect(prefs.contextIsolation).toBe(true);
        expect(prefs.sandbox).toBe(true);
    });

    it("strips preload scripts and reports them, including the legacy preloadURL alias", () => {
        const prefs = { preload: "/evil.js", partition: "persist:webview" } as Electron.WebPreferences;
        const legacyPrefs = { preloadURL: "file:///evil.js", partition: "persist:webview" } as Electron.WebPreferences & { preloadURL?: string };

        expect(hardenWebviewPreferences(prefs)).toEqual(["preload script"]);
        expect(hardenWebviewPreferences(legacyPrefs)).toEqual(["preload script"]);
        expect("preload" in prefs).toBe(false);
        expect("preloadURL" in legacyPrefs).toBe(false);
    });

    it("reports and disables every dangerous capability requested at once", () => {
        const prefs: Electron.WebPreferences = {
            nodeIntegration: true,
            nodeIntegrationInSubFrames: true,
            webSecurity: false,
            allowRunningInsecureContent: true,
            partition: "persist:webview"
        };

        const violations = hardenWebviewPreferences(prefs);

        expect(violations).toEqual([
            "nodeIntegration",
            "nodeIntegrationInSubFrames",
            "webSecurity disabled",
            "allowRunningInsecureContent"
        ]);
        expect(prefs).toMatchObject({
            nodeIntegration: false,
            nodeIntegrationInSubFrames: false,
            webSecurity: true,
            allowRunningInsecureContent: false
        });
    });
});

describe("setupWebContentsSecurity", () => {
    interface MockAttach {
        preventDefault: ReturnType<typeof vi.fn>;
        prefs: Electron.WebPreferences;
    }

    beforeEach(() => {
        resetState();
        setupWebContentsSecurity();
    });

    /** Simulates a window being created and then a <webview> attaching inside it. */
    function attachWebview(prefs: Electron.WebPreferences, src = "https://example.com", partition?: string): MockAttach {
        const { handlers } = createContents();

        const willAttach = handlers.get("will-attach-webview");
        if (!willAttach) throw new Error("will-attach-webview not registered");

        const preventDefault = vi.fn();
        willAttach({ preventDefault }, prefs, { src, partition });
        return { preventDefault, prefs };
    }

    it("lets a benign webview attach with hardened preferences", () => {
        const { preventDefault, prefs } = attachWebview({}, "https://example.com", "persist:webview");

        expect(preventDefault).not.toHaveBeenCalled();
        expect(state.errors).toEqual([]);
        expect(prefs.nodeIntegration).toBe(false);
        expect(prefs.contextIsolation).toBe(true);
        expect(prefs.partition).toBe("persist:webview");
    });

    it("denies an attach requesting a foreign partition passed via attach params", () => {
        const { preventDefault } = attachWebview({}, "https://evil.example", "persist:other");

        expect(preventDefault).toHaveBeenCalledOnce();
        expect(state.errors[0]).toContain("partition 'persist:other'");
    });

    it("denies an attach requesting nodeIntegration and logs the src", () => {
        const { preventDefault } = attachWebview({ nodeIntegration: true }, "https://evil.example", "persist:webview");

        expect(preventDefault).toHaveBeenCalledOnce();
        expect(state.errors).toHaveLength(1);
        expect(state.errors[0]).toContain("nodeIntegration");
        expect(state.errors[0]).toContain("https://evil.example");
    });

    it("denies an attach requesting a preload script", () => {
        const { preventDefault } = attachWebview({ preload: "/evil.js" } as Electron.WebPreferences, "https://example.com", "persist:webview");

        expect(preventDefault).toHaveBeenCalledOnce();
        expect(state.errors[0]).toContain("preload script");
    });
});

describe("isPermissionAllowed", () => {
    it("implements the per-session allowlist matrix", () => {
        // App session: the renderer copies note content, toggles fullscreen
        // and shows notifications (user scripts rely on `new Notification()`).
        expect(isPermissionAllowed("app", "clipboard-sanitized-write")).toBe(true);
        expect(isPermissionAllowed("app", "fullscreen")).toBe(true);
        expect(isPermissionAllowed("app", "notifications")).toBe(true);

        // Guest session: only fullscreen (embedded video players). Remote
        // pages must not show OS notifications appearing to come from Trilium.
        expect(isPermissionAllowed("guest", "fullscreen")).toBe(true);
        expect(isPermissionAllowed("guest", "clipboard-sanitized-write")).toBe(false);
        expect(isPermissionAllowed("guest", "notifications")).toBe(false);

        // Everything else is denied everywhere.
        for (const permission of ["media", "geolocation", "midi", "hid", "serial", "usb", "pointerLock", "clipboard-read", "openExternal"]) {
            expect(isPermissionAllowed("app", permission)).toBe(false);
            expect(isPermissionAllowed("guest", permission)).toBe(false);
        }
    });
});

describe("isPermissionAllowedForOrigin", () => {
    it("gates non-fullscreen app permissions on the trilium-app://app origin", () => {
        // The app shell itself keeps its grants.
        expect(isPermissionAllowedForOrigin("app", "notifications", "trilium-app://app")).toBe(true);
        expect(isPermissionAllowedForOrigin("app", "clipboard-sanitized-write", "trilium-app://app/some/path")).toBe(true);

        // A remote <iframe> sharing the default session does not.
        expect(isPermissionAllowedForOrigin("app", "notifications", "https://www.youtube-nocookie.com/embed/x")).toBe(false);
        expect(isPermissionAllowedForOrigin("app", "clipboard-sanitized-write", "https://evil.example")).toBe(false);
        // Another host under our own scheme is not the app shell.
        expect(isPermissionAllowedForOrigin("app", "notifications", "trilium-app://evil")).toBe(false);
        // A missing / unparseable origin is treated as untrusted.
        expect(isPermissionAllowedForOrigin("app", "notifications", null)).toBe(false);
        expect(isPermissionAllowedForOrigin("app", "notifications", "not a url")).toBe(false);
    });

    it("allows fullscreen for any origin, in both sessions", () => {
        expect(isPermissionAllowedForOrigin("app", "fullscreen", "https://www.youtube-nocookie.com/embed/x")).toBe(true);
        expect(isPermissionAllowedForOrigin("guest", "fullscreen", "https://example.com")).toBe(true);
        expect(isPermissionAllowedForOrigin("app", "fullscreen", null)).toBe(true);
    });

    it("never grants a permission outside the session allowlist, even from the app shell", () => {
        expect(isPermissionAllowedForOrigin("app", "geolocation", "trilium-app://app")).toBe(false);
        expect(isPermissionAllowedForOrigin("app", "clipboard-read", "trilium-app://app")).toBe(false);
        expect(isPermissionAllowedForOrigin("guest", "notifications", "trilium-app://app")).toBe(false);
    });
});

describe("permission handlers", () => {
    beforeEach(async () => {
        resetState();
        setupWebContentsSecurity();
        // Installation is gated on app.whenReady(); flush the microtask queue.
        await Promise.resolve();
    });

    it("installs request and check handlers on both the default and the webview partition session", () => {
        expect(state.defaultSession.requestHandler).toBeDefined();
        expect(state.defaultSession.checkHandler).toBeDefined();

        const guestSession = state.partitionSessions.get("persist:webview");
        expect(guestSession?.requestHandler).toBeDefined();
        expect(guestSession?.checkHandler).toBeDefined();
        expect(state.partitionSessions.size).toBe(1);
    });

    it("grants allowlisted permission requests from the app shell without logging", () => {
        const handler = state.defaultSession.requestHandler;
        if (!handler) throw new Error("request handler not installed");

        const callback = vi.fn();
        handler({}, "notifications", callback, { requestingUrl: "trilium-app://app/" });

        expect(callback).toHaveBeenCalledWith(true);
        expect(state.errors).toEqual([]);
    });

    it("denies an allowlisted permission requested by a foreign embedded iframe", () => {
        const handler = state.defaultSession.requestHandler;
        if (!handler) throw new Error("request handler not installed");

        // A YouTube embed (link_embed.tsx) runs in the default session but must
        // not inherit the app shell's notification / clipboard grants.
        const callback = vi.fn();
        handler({}, "notifications", callback, { requestingUrl: "https://www.youtube-nocookie.com/embed/x" });

        expect(callback).toHaveBeenCalledWith(false);
        expect(state.errors[0]).toContain("notifications");
        expect(state.errors[0]).toContain("youtube-nocookie.com");
    });

    it("grants fullscreen to any origin in the app session (embedded video players)", () => {
        const handler = state.defaultSession.requestHandler;
        if (!handler) throw new Error("request handler not installed");

        const callback = vi.fn();
        handler({}, "fullscreen", callback, { requestingUrl: "https://www.youtube-nocookie.com/embed/x" });

        expect(callback).toHaveBeenCalledWith(true);
        expect(state.errors).toEqual([]);
    });

    it("denies non-allowlisted permission requests and logs the requesting URL", () => {
        const guestSession = state.partitionSessions.get("persist:webview");
        const handler = guestSession?.requestHandler;
        if (!handler) throw new Error("request handler not installed");

        const callback = vi.fn();
        handler({}, "media", callback, { requestingUrl: "https://evil.example/" });

        expect(callback).toHaveBeenCalledWith(false);
        expect(state.errors).toHaveLength(1);
        expect(state.errors[0]).toContain("media");
        expect(state.errors[0]).toContain("https://evil.example/");
        expect(state.errors[0]).toContain("guest");
    });

    it("mirrors the policy in the synchronous check handler", () => {
        const appCheck = state.defaultSession.checkHandler;
        const guestCheck = state.partitionSessions.get("persist:webview")?.checkHandler;
        if (!appCheck || !guestCheck) throw new Error("check handlers not installed");

        expect(appCheck({}, "clipboard-sanitized-write", "trilium-app://app")).toBe(true);
        expect(appCheck({}, "clipboard-sanitized-write", "https://www.youtube-nocookie.com")).toBe(false);
        expect(appCheck({}, "geolocation", "trilium-app://app")).toBe(false);
        // Fullscreen is origin-independent.
        expect(guestCheck({}, "fullscreen", "https://www.youtube-nocookie.com")).toBe(true);
        expect(guestCheck({}, "clipboard-sanitized-write", "https://www.youtube-nocookie.com")).toBe(false);
    });
});

describe("withYouTubeEmbedReferer", () => {
    it("adds a Referer when the request has none (the desktop embed case)", () => {
        // trilium-app:// renderer => Electron sends no Referer; YouTube's player
        // then errors out. We supply a valid web referrer.
        expect(withYouTubeEmbedReferer({ Accept: "*/*" })).toEqual({
            Accept: "*/*",
            Referer: "https://triliumnotes.org/"
        });
    });

    it("never overwrites an existing Referer (case-insensitive)", () => {
        const withCanonical = { Referer: "https://example.com/" };
        expect(withYouTubeEmbedReferer(withCanonical)).toBe(withCanonical);

        const withLowercase = { referer: "https://example.com/" };
        expect(withYouTubeEmbedReferer(withLowercase)).toBe(withLowercase);
    });
});

describe("YouTube embed referer header", () => {
    beforeEach(async () => {
        resetState();
        setupWebContentsSecurity();
        await Promise.resolve(); // installation is gated on app.whenReady()
    });

    it("installs the onBeforeSendHeaders hook on the default session only", () => {
        expect(state.defaultSession.beforeSendHeaders).toBeDefined();
        expect(state.partitionSessions.get("persist:webview")?.beforeSendHeaders).toBeUndefined();
    });

    it("injects the Referer through the installed listener", () => {
        const listener = state.defaultSession.beforeSendHeaders;
        if (!listener) throw new Error("onBeforeSendHeaders not installed");

        let result: Record<string, string> | undefined;
        listener({ requestHeaders: {} }, ({ requestHeaders }) => { result = requestHeaders; });
        expect(result).toEqual({ Referer: "https://triliumnotes.org/" });
    });
});

describe("window-open policy", () => {
    beforeEach(() => {
        resetState();
        setupWebContentsSecurity();
    });

    it("denies the popup and opens allowlisted URLs in the OS browser", async () => {
        const contents = createContents();

        expect(contents.openWindow("https://example.com")).toEqual({ action: "deny" });
        await new Promise((r) => setTimeout(r, 0));

        // URL round-trips through the validator, which normalizes it.
        expect(state.shellOpenExternal).toEqual(["https://example.com/"]);
        expect(state.errors).toEqual([]);
    });

    it("refuses to open URLs with blocked schemes externally", async () => {
        const contents = createContents();

        // Follina-class and credential-leak schemes must not reach the OS
        // handler via window.open / target=_blank either — same allowlist
        // as the open-external IPC channel.
        for (const hostileUrl of ["ms-msdt:/id PCWDiagnostic", "smb://attacker.example/share", "not a url"]) {
            expect(contents.openWindow(hostileUrl)).toEqual({ action: "deny" });
        }
        await new Promise((r) => setTimeout(r, 0));

        expect(state.shellOpenExternal).toEqual([]);
        expect(state.errors).toHaveLength(3);
    });

    it("logs when the external open fails", async () => {
        state.shellOpenExternalThrow = true;
        const contents = createContents();

        expect(contents.openWindow("https://bad.example")).toEqual({ action: "deny" });
        await new Promise((r) => setTimeout(r, 0));

        expect(state.errors).toHaveLength(1);
        expect(state.errors[0]).toContain("https://bad.example");
    });

    it("denies window.open from webview guests without dispatching to the OS", async () => {
        const contents = createContents("webview");

        expect(contents.openWindow("https://example.com")).toEqual({ action: "deny" });
        await new Promise((r) => setTimeout(r, 0));

        expect(state.shellOpenExternal).toEqual([]);
        expect(state.errors).toHaveLength(1);
        expect(state.errors[0]).toContain("https://example.com");
    });
});

describe("navigation guard", () => {
    beforeEach(() => {
        resetState();
        setupWebContentsSecurity();
    });

    it("only allows the app shell at its root path", () => {
        expect(isNavigationAllowed("trilium-app://app/")).toBe(true);
        // Root "/?" path is allowed.
        expect(isNavigationAllowed("trilium-app://app/?")).toBe(true);

        // App shell but non-root path is blocked (in-page SPA routing / hostile).
        expect(isNavigationAllowed("trilium-app://app/somewhere")).toBe(false);
        // Our scheme but not the app host — only `trilium-app://app` is ever served.
        expect(isNavigationAllowed("trilium-app://evil/")).toBe(false);
        expect(isNavigationAllowed("https://evil.example/page")).toBe(false);
        // localhost is no longer a trusted host: the renderer is served only
        // from trilium-app://app, so a link to a local listener must not
        // navigate the privileged window.
        expect(isNavigationAllowed("http://localhost/")).toBe(false);
        expect(isNavigationAllowed("http://127.0.0.1/")).toBe(false);
        expect(isNavigationAllowed("http://127.0.0.1:9090/")).toBe(false);
        // URL with no hostname falls back to "" and is blocked.
        expect(isNavigationAllowed("javascript:void(0)")).toBe(false);
    });

    it("prevents disallowed navigations on app windows", () => {
        const { handlers } = createContents();
        const willNavigate = handlers.get("will-navigate");
        if (!willNavigate) throw new Error("will-navigate not registered");

        const external = { preventDefault: vi.fn() };
        willNavigate(external, "https://evil.example/page");
        expect(external.preventDefault).toHaveBeenCalled();

        const internal = { preventDefault: vi.fn() };
        willNavigate(internal, "trilium-app://app/");
        expect(internal.preventDefault).not.toHaveBeenCalled();
    });

    it("does not install a navigation guard on webview guests", () => {
        const { handlers } = createContents("webview");
        expect(handlers.has("will-navigate")).toBe(false);
    });
});
