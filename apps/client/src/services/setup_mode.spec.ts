import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    post: vi.fn(),
    remove: vi.fn(),
    restartDesktopApp: vi.fn(),
    isElectron: vi.fn(() => false),
    isStandalone: false
}));

vi.mock("./server", () => ({
    default: { get: mocks.get, post: mocks.post, remove: mocks.remove }
}));
vi.mock("./utils", () => ({
    restartDesktopApp: mocks.restartDesktopApp,
    isElectron: mocks.isElectron,
    get isStandalone() { return mocks.isStandalone; }
}));
// t() returns the key so assertions are deterministic and not tied to English text.
vi.mock("./i18n", () => ({ t: (key: string) => key }));

async function freshModule() {
    vi.resetModules();
    return import("./setup_mode.js");
}

/** happy-dom has no `confirm` of its own, so it is stubbed rather than spied on. */
const nativeConfirm = vi.fn(() => true);

beforeEach(() => {
    mocks.get.mockReset().mockResolvedValue({ requested: false });
    mocks.post.mockReset().mockResolvedValue(undefined);
    mocks.remove.mockReset().mockResolvedValue(undefined);
    mocks.restartDesktopApp.mockReset();
    mocks.isElectron.mockReset().mockReturnValue(false);
    mocks.isStandalone = false;
    nativeConfirm.mockReset().mockReturnValue(true);
    vi.stubGlobal("confirm", nativeConfirm);
    window.electronApi = undefined;
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

describe("starting over", () => {
    it("asks with the browser's own dialog, then goes back to setup from the top", async () => {
        mocks.isStandalone = true;
        const { startOver } = await freshModule();

        await expect(startOver()).resolves.toBe("restarting");

        // Nothing is asked for but the wizard's first screen: what follows is the offer of a backup
        // and then every way of starting a knowledge base.
        expect(nativeConfirm).toHaveBeenCalledWith("database.start_over_confirm");
        expect(mocks.post).toHaveBeenCalledWith("setup/boot");
        expect(mocks.restartDesktopApp).toHaveBeenCalled();
    });

    it("asks with the operating system's own where there is one to ask with", async () => {
        // A note script can reach every dialog Trilium draws for itself, so neither of these is one.
        mocks.isElectron.mockReturnValue(true);
        const confirmStartOver = vi.fn(async () => true);
        window.electronApi = { dialog: { confirmStartOver } } as never;
        const { startOver } = await freshModule();

        await expect(startOver()).resolves.toBe("restarting");

        expect(confirmStartOver).toHaveBeenCalled();
        expect(nativeConfirm).not.toHaveBeenCalled();
    });

    it("writes nothing down when the answer is no", async () => {
        mocks.isStandalone = true;
        nativeConfirm.mockReturnValue(false);
        const { startOver } = await freshModule();

        await expect(startOver()).resolves.toBe("cancelled");

        expect(mocks.post).not.toHaveBeenCalled();
        expect(mocks.restartDesktopApp).not.toHaveBeenCalled();
    });

    it("leaves the request standing on a server, which restarts itself for nobody", async () => {
        const { startOver } = await freshModule();

        await expect(startOver()).resolves.toBe("pending");

        expect(mocks.post).toHaveBeenCalledWith("setup/boot");
        // Reloading would restart the browser and leave the server holding the database open.
        expect(mocks.restartDesktopApp).not.toHaveBeenCalled();
    });

    it("says whether one is still waiting, and takes it back", async () => {
        const { cancelStartOver, isStartOverPending } = await freshModule();

        mocks.get.mockResolvedValue({ requested: true });
        await expect(isStartOverPending()).resolves.toBe(true);
        expect(mocks.get).toHaveBeenCalledWith("setup/boot");

        await cancelStartOver();
        expect(mocks.remove).toHaveBeenCalledWith("setup/boot");
    });
});
