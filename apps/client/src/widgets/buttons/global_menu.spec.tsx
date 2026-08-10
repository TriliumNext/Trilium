import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Shared, mutable control state for the mocks below. `vi.hoisted` runs before the hoisted `vi.mock`
// factories, so they can safely reference it.
const ctrl = vi.hoisted(() => ({ standalone: false, checkForUpdates: true }));

// `isStandalone` is a const in the target, read here as a live getter so each scenario can flip the
// kind of client we are pretending to be. Partial-mock so the rest of utils stays real — in
// particular `isUpdateAvailable`, which is the version comparison under test.
vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    get isStandalone() {
        return ctrl.standalone;
    }
}));

// The hook reads the user's preference through `useTriliumOptionBool`; stub just that one, so the
// other hooks the menu pulls in keep their real implementation.
vi.mock("../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../react/hooks")>()),
    useTriliumOptionBool: () => [ ctrl.checkForUpdates, vi.fn() ]
}));

// Import AFTER the mocks (vi.mock is hoisted, but the import must resolve the mocked deps).
import { parseLatestVersion, RELEASES_API_URL, UPDATE_CHECK_INTERVAL, useTriliumUpdateStatus } from "./global_menu";

let status: ReturnType<typeof useTriliumUpdateStatus> | undefined;
let container: HTMLDivElement | undefined;
let fetchMock: ReturnType<typeof vi.fn>;

function Probe() {
    status = useTriliumUpdateStatus();
    return null;
}

async function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
        if (container) {
            render(<Probe />, container);
        }
    });
    await advance(1);
}

function unmount() {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
}

/** Runs the fake clock forward, flushing the promise chain of any fetch it kicks off along the way. */
async function advance(ms: number) {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    ctrl.standalone = false;
    ctrl.checkForUpdates = true;
    status = undefined;

    window.glob = { ...window.glob, triliumVersion: "0.104.0" };
    fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ tag_name: "v0.104.1" }) });
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    unmount();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("useTriliumUpdateStatus", () => {
    it("polls GitHub and flags the update on clients the user updates by hand", async () => {
        await mount();

        expect(fetchMock).toHaveBeenCalledWith(RELEASES_API_URL);
        expect(status?.latestVersion).toBe("0.104.1");
        expect(status?.isUpdateAvailable).toBe(true);
    });

    it("stays quiet in standalone, which picks up new versions on reload", async () => {
        ctrl.standalone = true;

        await mount();

        expect(fetchMock).not.toHaveBeenCalled();
        expect(status?.latestVersion).toBeUndefined();
        expect(status?.isUpdateAvailable).toBe(false);
    });

    it("stays quiet when the user switched the check off", async () => {
        ctrl.checkForUpdates = false;

        await mount();

        expect(fetchMock).not.toHaveBeenCalled();
        expect(status?.isUpdateAvailable).toBe(false);
    });

    it("reports no update once the running version has caught up", async () => {
        window.glob = { ...window.glob, triliumVersion: "0.104.1" };

        await mount();

        expect(status?.latestVersion).toBe("0.104.1");
        expect(status?.isUpdateAvailable).toBe(false);
    });

    it("re-checks on the interval, and stops once unmounted", async () => {
        await mount();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await advance(UPDATE_CHECK_INTERVAL);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        unmount();
        await advance(UPDATE_CHECK_INTERVAL * 2);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("keeps the badge hidden when GitHub cannot be reached", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        fetchMock.mockRejectedValue(new Error("offline"));

        await mount();

        expect(status?.latestVersion).toBeUndefined();
        expect(status?.isUpdateAvailable).toBe(false);
        expect(warn).toHaveBeenCalled();
    });
});

describe("parseLatestVersion", () => {
    it("strips the tag prefix, and ignores payloads without a usable tag", () => {
        expect(parseLatestVersion({ tag_name: "v0.104.1" })).toBe("0.104.1");
        expect(parseLatestVersion({ tag_name: "0.104.1" })).toBe("0.104.1");
        expect(parseLatestVersion({})).toBeUndefined();
        expect(parseLatestVersion(undefined)).toBeUndefined();
        expect(parseLatestVersion({ tag_name: 104 })).toBeUndefined();
    });
});
