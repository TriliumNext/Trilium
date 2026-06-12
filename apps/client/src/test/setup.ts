import { afterEach, beforeAll, beforeEach, vi } from "vitest";
import $ from "jquery";

injectGlobals();

// Restore spyOn() spies after every test so they never leak across tests (each spec used to do this itself).
afterEach(() => {
    vi.restoreAllMocks();
});

beforeAll(() => {
    vi.mock("../services/ws.js", mockWebsocket);
    vi.mock("../services/server.js", mockServer);
});

// Reset the shared server/ws mock call history between tests so per-test call assertions stay accurate.
beforeEach(() => {
    for (const fn of [ serverMock?.put, serverMock?.upload, serverMock?.patch, serverMock?.remove, wsMock?.logError, wsMock?.logInfo ]) {
        fn?.mockClear?.();
    }
});

function injectGlobals() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uncheckedWindow = window as any;
    uncheckedWindow.$ = $;
    uncheckedWindow.WebSocket = () => {};
    uncheckedWindow.glob = {
        isMainWindow: true
    };

    // happy-dom doesn't implement these APIs that various widgets touch — provide inert fallbacks.
    // (Specs that need to *drive* them still replace them locally and capture the callback.)
    if (!uncheckedWindow.matchMedia) {
        uncheckedWindow.matchMedia = () => ({
            matches: false, media: "", onchange: null,
            addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; }
        });
    }
    if (!uncheckedWindow.ResizeObserver) {
        uncheckedWindow.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    }
    if (!HTMLElement.prototype.animate) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        HTMLElement.prototype.animate = (() => ({ cancel() {}, finish() {}, finished: Promise.resolve(), onfinish: null })) as any;
    }
    if (!HTMLElement.prototype.scrollIntoView) {
        HTMLElement.prototype.scrollIntoView = () => {};
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let serverMock: Record<string, any> | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let wsMock: Record<string, any> | undefined;

function mockWebsocket() {
    wsMock = {
        subscribeToMessages(callback: (message: unknown) => void) {
            // Do nothing.
        },
        logError: vi.fn(),
        logInfo: vi.fn()
    };
    return { default: wsMock };
}

function mockServer() {
    serverMock = {
        async get(url: string) {
            if (url === "options") {
                return {};
            }

            if (url === "keyboard-actions") {
                return [];
            }

            if (url === "tree") {
                return {
                    branches: [],
                    notes: [],
                    attributes: []
                }
            }

            console.warn(`Unsupported GET to mocked server: ${url}`);
        },

        async post(url: string, data: object) {
            if (url === "tree/load") {
                throw new Error(`A module tried to load from the server the following notes: ${((data as { noteIds?: string[] }).noteIds || []).join(",")}\nThis is not supported, use Froca mocking instead and ensure the note exist in the mock.`)
            }
        },

        // Write verbs widgets call — inert spies so specs don't each re-augment the mock.
        put: vi.fn(async () => undefined),
        upload: vi.fn(async () => undefined),
        patch: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined)
    };
    return { default: serverMock };
}
