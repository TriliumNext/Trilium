import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    startLocalServerWorker: vi.fn(),
    attachServiceWorkerBridge: vi.fn(),
    registerNativeHttpHandler: vi.fn(),
    restoreBackup: vi.fn(),
    downloadDatabase: vi.fn(),
    announceLeadership: vi.fn(),
    capacitorHttpHandler: vi.fn()
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
    announceLeadership: mocks.announceLeadership
}));
vi.mock("./leader_election.js", () => ({
    claimLeadership: (onElected: () => void) => {
        if (leadership.elected) {
            onElected();
        }
    }
}));
vi.mock("./services/capacitor_http_handler.js", () => ({ capacitorHttpHandler: mocks.capacitorHttpHandler }));
// Avoid pulling the entire client bundle when loadScripts() runs.
vi.mock("../../client/src/index.js", () => ({}));

interface ServiceWorkerLike {
    controller: unknown;
    register: ReturnType<typeof vi.fn>;
    ready: Promise<unknown>;
}

interface WindowWithCapacitor { Capacitor?: unknown }

function setServiceWorker(sw: ServiceWorkerLike | undefined) {
    Object.defineProperty(navigator, "serviceWorker", { value: sw, configurable: true });
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
    vi.spyOn(console, "log").mockImplementation(() => {});
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
    });

    it("registers the native HTTP handler under Capacitor", async () => {
        (window as unknown as WindowWithCapacitor).Capacitor = {};
        setServiceWorker({ controller: {}, register: vi.fn(), ready: Promise.resolve() });
        await runBootstrap();
        await vi.waitFor(() => expect(mocks.registerNativeHttpHandler).toHaveBeenCalledWith(mocks.capacitorHttpHandler));
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
