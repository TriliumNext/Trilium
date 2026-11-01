import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

// Hoisted alongside the mock factories, which can run before this file's top-level constants exist.
const mocks = vi.hoisted(() => ({
    serverGet: undefined as unknown as (url: string) => Promise<unknown>,
    entitiesReloadedHandler: undefined as ((data: { loadResults: unknown }) => void) | undefined
}));
const serverGet = vi.fn<(url: string) => Promise<unknown>>();
mocks.serverGet = serverGet;

vi.mock("../../services/server", () => ({
    default: { get: (url: string) => mocks.serverGet(url) }
}));

// A full mock, not a partial one: the real hooks module transitively imports half the app at module
// scope (app_context, keyboard actions). Any subscription the hook made would land here, which is
// how the "measures only when asked" test can prove it makes none.
vi.mock("./hooks", () => ({
    useTriliumEvent: (_name: string, handler: (data: { loadResults: unknown }) => void) => {
        mocks.entitiesReloadedHandler = handler;
    }
}));

// Import AFTER the mocks (vi.mock is hoisted, but the hook import must resolve the mocked deps).
import { useFetch } from "./use_fetch";

function Probe({ url }: { url: string }) {
    const { data, failed } = useFetch<{ label: string }>(url);
    return <div>{data ? data.label : (failed ? "failed" : "loading")}</div>;
}

let container: HTMLDivElement | undefined;

function renderProbe(url: string) {
    container = container ?? document.body.appendChild(document.createElement("div"));
    render(<Probe url={url} />, container);
    return container;
}

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    mocks.entitiesReloadedHandler = undefined;
    serverGet.mockReset();
    vi.useRealTimers();
});

describe("useFetch", () => {
    it("fetches the url and renders the payload once it arrives", async () => {
        serverGet.mockResolvedValueOnce({ label: "first" });
        const probe = renderProbe("space-usage/overview");

        expect(probe.textContent).toBe("loading");
        await vi.waitFor(() => expect(probe.textContent).toBe("first"));
        expect(serverGet).toHaveBeenCalledWith("space-usage/overview");
    });

    it("keeps the previous payload while navigating, and through a failed fetch", async () => {
        serverGet.mockResolvedValueOnce({ label: "first" });
        const probe = renderProbe("space-usage/note/a");
        await vi.waitFor(() => expect(probe.textContent).toBe("first"));

        // The rejection must neither blank the chart nor escape as an unhandled rejection.
        serverGet.mockRejectedValueOnce(new Error("network down"));
        renderProbe("space-usage/note/b");
        await vi.waitFor(() => expect(serverGet).toHaveBeenCalledTimes(2));
        expect(probe.textContent).toBe("first");
    });

    it("reports a first fetch that fails, instead of measuring forever", async () => {
        // Nothing to fall back on yet, and a browser-rejected request is not even toasted, so a
        // silent catch would leave the view claiming to measure for as long as it stayed open.
        serverGet.mockRejectedValueOnce(new Error("rejected by browser"));
        const probe = renderProbe("space-usage/overview");
        await vi.waitFor(() => expect(probe.textContent).toBe("failed"));

        // ...and it clears itself the moment an attempt succeeds.
        serverGet.mockResolvedValueOnce({ label: "recovered" });
        renderProbe("space-usage/note/a");
        await vi.waitFor(() => expect(probe.textContent).toBe("recovered"));
    });

    it("drops a stale response that resolves after a newer request", async () => {
        let resolveSlow: ((value: unknown) => void) | undefined;
        serverGet.mockReturnValueOnce(new Promise((resolve) => { resolveSlow = resolve; }));
        const probe = renderProbe("space-usage/note/slow");

        serverGet.mockResolvedValueOnce({ label: "fast" });
        renderProbe("space-usage/note/fast");
        await vi.waitFor(() => expect(probe.textContent).toBe("fast"));

        resolveSlow?.({ label: "slow" });
        await Promise.resolve();
        expect(probe.textContent).toBe("fast");
    });

    it("drops a stale failure too, so an abandoned request cannot report over a newer reading", async () => {
        let rejectSlow: ((reason?: unknown) => void) | undefined;
        serverGet.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectSlow = reject; }));
        const probe = renderProbe("space-usage/note/slow");

        serverGet.mockResolvedValueOnce({ label: "fast" });
        renderProbe("space-usage/note/fast");
        await vi.waitFor(() => expect(probe.textContent).toBe("fast"));

        rejectSlow?.(new Error("network down"));
        await Promise.resolve();
        expect(probe.textContent).toBe("fast");
    });

    it("never re-measures on its own when notes change", async () => {
        serverGet.mockResolvedValue({ label: "data" });
        const probe = renderProbe("space-usage/overview");
        await vi.waitFor(() => expect(probe.textContent).toBe("data"));
        expect(serverGet).toHaveBeenCalledTimes(1);

        // Measuring the database is far too expensive to repeat after every edit; the user asks for
        // a fresh reading instead. A subscription that merely fires later would be just as bad, so
        // assert the hook subscribes to nothing at all.
        expect(mocks.entitiesReloadedHandler).toBeUndefined();

        vi.useFakeTimers();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(serverGet).toHaveBeenCalledTimes(1);
    });
});
