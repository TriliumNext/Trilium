import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    post: vi.fn(),
    restartDesktopApp: vi.fn(),
    isElectron: vi.fn(() => false),
    isStandalone: false
}));

vi.mock("./server", () => ({ default: { post: mocks.post } }));
vi.mock("./utils", () => ({
    restartDesktopApp: mocks.restartDesktopApp,
    isElectron: mocks.isElectron,
    get isStandalone() { return mocks.isStandalone; }
}));

async function freshModule() {
    vi.resetModules();
    return import("./setup_mode.js");
}

beforeEach(() => {
    mocks.post.mockReset().mockResolvedValue(undefined);
    mocks.restartDesktopApp.mockReset();
    mocks.isElectron.mockReset().mockReturnValue(false);
    mocks.isStandalone = false;
});

describe("asking the next start to be the setup wizard", () => {
    it("writes down what was asked for, then starts the app again", async () => {
        mocks.isElectron.mockReturnValue(true);
        const { bootToSetup } = await freshModule();

        await bootToSetup({ targetScreen: "restore-backup" });

        expect(mocks.post).toHaveBeenCalledWith("setup/boot", { targetScreen: "restore-backup" });
        // In that order: a restart before the marker is written comes back to the app.
        expect(mocks.restartDesktopApp).toHaveBeenCalled();
        expect(mocks.post.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.restartDesktopApp.mock.invocationCallOrder[0]);
    });

    it("may be asked for without a screen, which is where a first run starts", async () => {
        mocks.isStandalone = true;
        const { bootToSetup } = await freshModule();

        await bootToSetup();

        expect(mocks.post).toHaveBeenCalledWith("setup/boot", { targetScreen: undefined });
    });

    it("refuses where the app cannot start itself again, rather than leaving a marker behind", async () => {
        // A browser talking to a server reloads only itself: the server keeps the database open and
        // would find the marker at some unrelated restart, days later.
        const { bootToSetup, canBootToSetup } = await freshModule();

        expect(canBootToSetup()).toBe(false);
        await expect(bootToSetup({ targetScreen: "restore-backup" })).rejects.toThrow(/cannot restart/);
        expect(mocks.post).not.toHaveBeenCalled();
        expect(mocks.restartDesktopApp).not.toHaveBeenCalled();
    });

    it("is offered on the two builds that come back to a real start", async () => {
        mocks.isElectron.mockReturnValue(true);
        expect((await freshModule()).canBootToSetup()).toBe(true);

        mocks.isElectron.mockReturnValue(false);
        mocks.isStandalone = true;
        expect((await freshModule()).canBootToSetup()).toBe(true);
    });
});
