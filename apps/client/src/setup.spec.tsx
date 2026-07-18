import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// t() returns the key so assertions are deterministic and not tied to English text.
vi.mock("./services/i18n", () => ({
    t: (key: string) => key,
    initLocale: vi.fn(),
    getCurrentLanguage: () => "en"
}));

const serverMock = vi.hoisted(() => ({
    // Default implementation serves the module-load-time requests transitively imported
    // modules fire (e.g. keyboard_actions fetches its shortcut list on import) — the
    // per-test routing installed in beforeEach overrides it.
    get: vi.fn(async (url: string): Promise<unknown> => {
        if (url === "keyboard-actions") {
            return [];
        }
        return {};
    }),
    post: vi.fn(async (): Promise<unknown> => ({}))
}));
vi.mock("./services/server", () => ({ default: serverMock }));

import { renderState, SyncFailed, SyncFromServer, SyncInProgress } from "./setup";

type Stats = { outstandingPullCount: number; totalPullCount: number | null; initialized: boolean; lastSyncError?: string | null };

let container: HTMLDivElement;
function renderInto(vnode: preact.ComponentChild) {
    container = document.createElement("div");
    document.body.appendChild(container);
    render(vnode, container);
    return container;
}

// Preact flushes effects via requestAnimationFrame (~16ms under fake timers), so
// "flushing" means advancing past that; a poll tick is the hook's 1s interval on top.
const flushEffects = () => vi.advanceTimersByTimeAsync(50);
const nextPoll = () => vi.advanceTimersByTimeAsync(1000);

/** Routes the mocked server.get; `stats` can be swapped between polls. */
let stats: Stats;
function mockRoutes(extra: Record<string, unknown> = {}) {
    serverMock.get.mockImplementation(async (url: string) => {
        if (url === "sync/stats") {
            return stats;
        }
        return extra[url];
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    stats = { outstandingPullCount: 0, totalPullCount: null, initialized: false, lastSyncError: null };
    mockRoutes();
    serverMock.post.mockResolvedValue({});
});

afterEach(() => {
    render(null, container);
    container.remove();
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe("SyncInProgress", () => {
    it("switches to the failure screen when the server reports a failed sync", async () => {
        const setState = vi.fn();
        stats = { ...stats, lastSyncError: "401 Logged in session not found" };
        renderInto(<SyncInProgress device="server" setState={setState} />);
        await flushEffects();
        expect(setState).toHaveBeenCalledWith("syncFailed");
    });

    it("ignores sync errors in the sync-from-desktop flow (the other device syncs, not us)", async () => {
        const setState = vi.fn();
        stats = { ...stats, lastSyncError: "boom" };
        renderInto(<SyncInProgress device="desktop" setState={setState} />);
        await flushEffects();
        expect(setState).not.toHaveBeenCalled();
    });

    it("stays on the progress screen while the sync is healthy", async () => {
        const setState = vi.fn();
        renderInto(<SyncInProgress device="server" setState={setState} />);
        await flushEffects();
        expect(setState).not.toHaveBeenCalled();
    });

    it("is wired for both flows in renderState", async () => {
        for (const state of ["syncFromServerInProgress", "syncFromDesktopInProgress"] as const) {
            const c = renderInto(renderState(state, vi.fn()));
            await flushEffects();
            expect(c.querySelector(".page.sync-in-progress")).not.toBeNull();
            render(null, c);
            c.remove();
        }
    });
});

describe("SyncFailed", () => {
    it("shows the recorded error and a hint, and renderState wires the syncFailed case", async () => {
        stats = { ...stats, lastSyncError: "Request to PUT https://[redacted]/api/sync/update failed" };
        const c = renderInto(renderState("syncFailed", vi.fn()));
        await flushEffects();

        const pre = c.querySelector(".admonition-body pre");
        expect(pre?.textContent).toBe("Request to PUT https://[redacted]/api/sync/update failed");
        expect(c.querySelector(".admonition-body p")?.textContent).toBe("setup.sync-failed-hint");
    });

    it("retries via sync/now and hands back to the progress screen once the attempt starts", async () => {
        const setState = vi.fn();
        stats = { ...stats, lastSyncError: "boom" };
        const c = renderInto(<SyncFailed setState={setState} />);
        await flushEffects();

        const retry = [...c.querySelectorAll("button")].find((b) => b.textContent?.includes("setup.button-retry"));
        expect(retry).toBeDefined();
        retry?.click();
        expect(serverMock.post).toHaveBeenCalledWith("sync/now");

        // The server clears the error as the new attempt starts; the next poll notices.
        stats = { ...stats, lastSyncError: null };
        await nextPoll();
        expect(setState).toHaveBeenCalledWith("syncFromServerInProgress");
    });

    it("finishes setup directly when the retry converges before the next transition", async () => {
        const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
        const setState = vi.fn();
        stats = { ...stats, lastSyncError: "boom" };
        renderInto(<SyncFailed setState={setState} />);
        await flushEffects();

        stats = { ...stats, lastSyncError: null, initialized: true };
        await nextPoll();
        expect(reload).toHaveBeenCalled();
        expect(setState).not.toHaveBeenCalledWith("syncFromServerInProgress");
    });

    it("goes back to the server form", async () => {
        const setState = vi.fn();
        stats = { ...stats, lastSyncError: "boom" };
        const c = renderInto(<SyncFailed setState={setState} />);
        await flushEffects();

        const back = [...c.querySelectorAll("button")].find((b) => b.textContent?.includes("setup.button-back"));
        back?.click();
        expect(setState).toHaveBeenCalledWith("syncFromServer");
    });
});

describe("SyncFromServer", () => {
    it("prefills the stored server address and proxy after a failed attempt", async () => {
        mockRoutes({ "setup/status": { syncServerHost: "https://old.example.com", syncProxy: "http://proxy:3128" } });
        const c = renderInto(<SyncFromServer setState={vi.fn()} />);
        await flushEffects();

        const inputs = [...c.querySelectorAll("input")];
        expect(inputs.some((i) => i.value === "https://old.example.com")).toBe(true);
        expect(inputs.some((i) => i.value === "http://proxy:3128")).toBe(true);
    });

    it("does not clobber a value the user already typed before the prefill resolves", async () => {
        let resolveStatus: (v: unknown) => void = () => {};
        serverMock.get.mockImplementation((url: string) => {
            if (url === "setup/status") {
                return new Promise((resolve) => {
                    resolveStatus = resolve;
                });
            }
            return Promise.resolve(stats);
        });
        const c = renderInto(<SyncFromServer setState={vi.fn()} />);

        const host = c.querySelector<HTMLInputElement>("input");
        expect(host).not.toBeNull();
        if (!host) return;
        host.value = "https://typed.example.com";
        host.dispatchEvent(new Event("input", { bubbles: true }));

        resolveStatus({ syncServerHost: "https://stored.example.com", syncProxy: "" });
        await flushEffects();

        expect(host.value).toBe("https://typed.example.com");
    });

    it("leaves the form empty on a fresh setup (no stored sync options)", async () => {
        mockRoutes({ "setup/status": { isInitialized: false, schemaExists: false } });
        const c = renderInto(<SyncFromServer setState={vi.fn()} />);
        await flushEffects();

        const host = c.querySelector<HTMLInputElement>("input");
        expect(host?.value).toBe("");
    });
});
