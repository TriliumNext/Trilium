import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    startLocalServerWorker: vi.fn(),
    attachServiceWorkerBridge: vi.fn(),
    registerNativeHttpHandler: vi.fn(),
    restoreBackup: vi.fn(),
    downloadDatabase: vi.fn(),
    announceLeadership: vi.fn(),
    localFetch: vi.fn(),
    capacitorHttpHandler: vi.fn(),
    saveUrlToDevice: vi.fn(),
    requestSecurityChange: vi.fn()
}));

// Whether this tab wins the database lock. Only the leader may start a worker;
// a second worker cannot open the OPFS database at all.
const leadership = vi.hoisted(() => ({ elected: true }));

vi.mock("./local-bridge.js", () => ({
    startLocalServerWorker: mocks.startLocalServerWorker,
    attachServiceWorkerBridge: mocks.attachServiceWorkerBridge,
    registerNativeHttpHandler: mocks.registerNativeHttpHandler,
    restoreBackup: mocks.restoreBackup,
    downloadDatabase: mocks.downloadDatabase,
    announceLeadership: mocks.announceLeadership,
    localFetch: mocks.localFetch,
    requestSecurityChange: mocks.requestSecurityChange
}));
vi.mock("./leader_election.js", () => ({
    claimLeadership: (onElected: () => void) => {
        if (leadership.elected) {
            onElected();
        }
    }
}));
vi.mock("./services/capacitor_http_handler.js", () => ({ capacitorHttpHandler: mocks.capacitorHttpHandler }));
vi.mock("./services/capacitor_download.js", () => ({ saveUrlToDevice: mocks.saveUrlToDevice }));
// Avoid pulling the entire client bundle when loadScripts() runs.
vi.mock("../../client/src/index.js", () => ({}));

interface ServiceWorkerLike {
    controller: unknown;
    register: ReturnType<typeof vi.fn>;
    ready: Promise<unknown>;
}

interface WindowWithCapacitor {
    Capacitor?: unknown;
    standaloneApi?: { save?: { saveUrl: unknown } };
}

function setServiceWorker(sw: ServiceWorkerLike | undefined) {
    Object.defineProperty(navigator, "serviceWorker", { value: sw, configurable: true });
}

function setStorageManager(storage: { persist?: unknown } | undefined) {
    Object.defineProperty(navigator, "storage", { value: storage, configurable: true });
}

let reloadSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    leadership.elected = true;
    document.body.innerHTML = "";
    delete (window as unknown as WindowWithCapacitor).Capacitor;
    reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
        value: { ...window.location, protocol: "https:", hostname: "localhost", reload: reloadSpy, search: "" },
        configurable: true
    });
    setStorageManager({ persist: vi.fn().mockResolvedValue(true) });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

async function runBootstrap() {
    vi.resetModules();
    await import("./main.js");
}

describe("bootstrap", () => {
    it("starts the worker, bridges the SW, and loads scripts when already controlling", async () => {
        setServiceWorker({ controller: {}, register: vi.fn(), ready: Promise.resolve() });
        await runBootstrap();
        await vi.waitFor(() => expect(mocks.startLocalServerWorker).toHaveBeenCalled());
        expect(mocks.attachServiceWorkerBridge).toHaveBeenCalled();
        expect(document.body.innerHTML).toBe("");
    });

    it("announces leadership once elected", async () => {
        setServiceWorker({ controller: {}, register: vi.fn(), ready: Promise.resolve() });
        await runBootstrap();
        // The service worker has to know which tab owns the worker so it can
        // route every tab's API traffic there.
        await vi.waitFor(() => expect(mocks.announceLeadership).toHaveBeenCalled());
        // The leader also answers the client's API calls directly, skipping that route.
        expect(window.standaloneApi?.localFetch).toBe(mocks.localFetch);
        // And its worker is the one holding the settings file, so it is the tab that can change
        // what this instance is allowed to run.
        expect(window.standaloneApi?.security).toBeDefined();
    });

    it("a follower tab starts no worker but still bridges the SW", async () => {
        leadership.elected = false;
        setServiceWorker({ controller: {}, register: vi.fn(), ready: Promise.resolve() });
        await runBootstrap();
        await vi.waitFor(() => expect(mocks.attachServiceWorkerBridge).toHaveBeenCalled());

        // Starting a worker here would open a second database against the same
        // exclusive OPFS handles and silently fall back to an empty in-memory one.
        expect(mocks.startLocalServerWorker).not.toHaveBeenCalled();
        expect(mocks.announceLeadership).not.toHaveBeenCalled();

        // A follower must keep calling through the service worker: with no worker of its own,
        // a localFetch here would answer from nothing.
        expect(window.standaloneApi?.localFetch).toBeUndefined();

        // Nor can it change a security setting: the file that holds them is locked by the
        // leader's worker, which this tab has no way to reach.
        expect(window.standaloneApi?.security).toBeUndefined();
    });

    it("asks the browser to keep the storage the database lives in", async () => {
        const persist = vi.fn().mockResolvedValue(true);
        setStorageManager({ persist });
        setServiceWorker({ controller: {}, register: vi.fn(), ready: Promise.resolve() });
        await runBootstrap();

        await vi.waitFor(() => expect(persist).toHaveBeenCalled());
        expect(console.log).toHaveBeenCalledWith("[Bootstrap] Storage is persistent");
    });

    it("reports a refusal and starts up regardless", async () => {
        const persist = vi.fn().mockResolvedValue(false);
        setStorageManager({ persist });
        setServiceWorker({ controller: {}, register: vi.fn(), ready: Promise.resolve() });
        await runBootstrap();

        // A browser that declines gives no reason and takes no argument, so the only thing left
        // to do about it is say so; the database still opens either way.
        await vi.waitFor(() => expect(console.log)
            .toHaveBeenCalledWith(expect.stringContaining("best-effort")));
        expect(mocks.startLocalServerWorker).toHaveBeenCalled();
        expect(document.body.innerHTML).toBe("");
    });

    it("survives a browser that rejects or lacks the request", async () => {
        setStorageManager({ persist: vi.fn().mockRejectedValue(new Error("no quota manager")) });
        setServiceWorker({ controller: {}, register: vi.fn(), ready: Promise.resolve() });
        await runBootstrap();
        await vi.waitFor(() => expect(console.warn).toHaveBeenCalledWith(
            "[Bootstrap] Could not ask for persistent storage:", expect.any(Error)));
        expect(document.body.innerHTML).toBe("");

        // `navigator.storage` is missing outside a secure context; asking there would throw
        // before the service worker's own error screen could explain why nothing works.
        vi.mocked(console.warn).mockClear();
        setStorageManager(undefined);
        await runBootstrap();
        await vi.waitFor(() => expect(mocks.startLocalServerWorker).toHaveBeenCalledTimes(2));
        expect(console.warn).not.toHaveBeenCalled();
    });

    it("registers the native HTTP handler and the share-sheet save under Capacitor only", async () => {
        setServiceWorker({ controller: {}, register: vi.fn(), ready: Promise.resolve() });
        await runBootstrap();
        await vi.waitFor(() => expect(mocks.startLocalServerWorker).toHaveBeenCalled());
        // A browser saves its own downloads, so the client keeps navigating to them there.
        const win = window as unknown as WindowWithCapacitor;
        expect(win.standaloneApi?.save).toBeUndefined();

        win.Capacitor = {};
        await runBootstrap();
        await vi.waitFor(() => expect(mocks.registerNativeHttpHandler).toHaveBeenCalledWith(mocks.capacitorHttpHandler));
        await vi.waitFor(() => expect(win.standaloneApi?.save?.saveUrl).toBe(mocks.saveUrlToDevice));
    });

    it("registers and waits for the SW, then loads scripts once it controls", async () => {
        const sw: ServiceWorkerLike = { controller: null, register: vi.fn(), ready: Promise.resolve() };
        // The SW takes control once registration completes (after the first check).
        sw.register.mockImplementation(async () => { sw.controller = {}; });
        setServiceWorker(sw);
        await runBootstrap();
        await vi.waitFor(() => expect(sw.register).toHaveBeenCalledWith("./sw.js", { scope: "/" }));
        expect(reloadSpy).not.toHaveBeenCalled();
        expect(document.body.innerHTML).toBe("");
    });

    it("reports progress on the splash while the SW installs", async () => {
        document.body.innerHTML = `
            <div id="splash">
                <div class="splash-bar"><div class="splash-bar-fill"></div></div>
                <div id="splash-status"></div>
            </div>`;
        const sw: ServiceWorkerLike = {
            controller: null, register: vi.fn(), ready: Promise.resolve()
        };
        sw.register.mockImplementation(async () => { sw.controller = {}; });
        setServiceWorker(sw);
        await runBootstrap();
        await vi.waitFor(() => expect(sw.register).toHaveBeenCalled());
        expect(document.getElementById("splash-status")?.textContent)
            .toBe("Setting up offline support…");
        // Nine weighted phases, the first of which covers 1/20 of the bar.
        const fill = document.querySelector<HTMLElement>(".splash-bar-fill");
        expect(fill?.style.width).toBe("5%");
    });

    it("lets the worker's phases through after the client reports its own", async () => {
        document.body.innerHTML = `
            <div id="splash">
                <div class="splash-bar"><div class="splash-bar-fill"></div></div>
                <div id="splash-status"></div>
            </div>`;
        setServiceWorker({ controller: {}, register: vi.fn(), ready: Promise.resolve() });
        await runBootstrap();
        const { reportSplashPhase } = await import("../../client/src/services/splash.js");

        // On a warm start the client reaches its own "bootstrap" phase while the worker is still
        // opening the database. That phase is not in the standalone sequence, so the worker's
        // later steps are still shown rather than being swallowed by the monotonic guard.
        reportSplashPhase("bootstrap");
        reportSplashPhase("core");
        expect(document.getElementById("splash-status")?.textContent).toBe("Loading Trilium…");
    });

    it("reloads the page when the SW installs but does not take control", async () => {
        setServiceWorker({ controller: null, register: vi.fn().mockResolvedValue(undefined), ready: Promise.resolve() });
        await runBootstrap();
        await vi.waitFor(() => expect(reloadSpy).toHaveBeenCalled());
        // The reload path throws "Reloading..." which bootstrap swallows (no error UI).
        expect(document.body.innerHTML).toBe("");
    });

    it("shows an error screen when service workers are unavailable (insecure context)", async () => {
        setServiceWorker(undefined);
        Object.defineProperty(window, "location", {
            value: { protocol: "http:", hostname: "example.com", reload: reloadSpy, search: "" },
            configurable: true
        });
        Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
        await runBootstrap();
        await vi.waitFor(() => expect(document.body.innerHTML).toContain("Failed to Initialize"));
        expect(document.body.innerHTML).toContain("not a secure context");
    });

    it("omits the secure-context hints when the context is already secure", async () => {
        setServiceWorker(undefined);
        Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
        await runBootstrap();
        await vi.waitFor(() => expect(document.body.innerHTML).toContain("Failed to Initialize"));
        expect(document.body.innerHTML).not.toContain("Possible cause");
    });

    it("shows an error screen for a generic failure with the error message", async () => {
        setServiceWorker({ controller: {}, register: vi.fn(), ready: Promise.resolve() });
        mocks.attachServiceWorkerBridge.mockImplementation(() => { throw new Error("bridge exploded"); });
        await runBootstrap();
        await vi.waitFor(() => expect(document.body.innerHTML).toContain("bridge exploded"));
    });

    it("stringifies a non-Error failure in the error screen", async () => {
        setServiceWorker({ controller: {}, register: vi.fn(), ready: Promise.resolve() });
        mocks.attachServiceWorkerBridge.mockImplementation(() => { throw "plain failure"; });
        await runBootstrap();
        await vi.waitFor(() => expect(document.body.innerHTML).toContain("plain failure"));
    });
});
