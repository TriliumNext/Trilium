import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    startLocalServerWorker: vi.fn(),
    attachServiceWorkerBridge: vi.fn(),
    registerNativeHttpHandler: vi.fn(),
    capacitorHttpHandler: vi.fn()
}));

vi.mock("./local-bridge.js", () => ({
    startLocalServerWorker: mocks.startLocalServerWorker,
    attachServiceWorkerBridge: mocks.attachServiceWorkerBridge,
    registerNativeHttpHandler: mocks.registerNativeHttpHandler
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
