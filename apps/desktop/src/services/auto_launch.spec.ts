import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => unknown;

const state = vi.hoisted(() => ({
    launchOnStartup: false,
    hideOnAutoStart: false,
    appName: "Trilium Notes",
    setLoginItemSettings: vi.fn(),
    setLoginItemThrows: false,
    wasOpenedAsHidden: false,
    ipcOn: new Map<string, Handler>(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
    log: { info: vi.fn(), error: vi.fn() }
}));

vi.mock("electron", () => ({
    default: {
        app: {
            setLoginItemSettings: (...a: unknown[]) => {
                if (state.setLoginItemThrows) throw new Error("boom");
                return state.setLoginItemSettings(...a);
            },
            getLoginItemSettings: () => ({ wasOpenedAsHidden: state.wasOpenedAsHidden }),
            getName: () => state.appName
        },
        ipcMain: {
            on: (channel: string, fn: Handler) => state.ipcOn.set(channel, fn)
        }
    }
}));

vi.mock("fs", () => ({
    default: {
        mkdirSync: (...a: unknown[]) => state.mkdirSync(...a),
        writeFileSync: (...a: unknown[]) => state.writeFileSync(...a),
        rmSync: (...a: unknown[]) => state.rmSync(...a)
    }
}));

vi.mock("os", () => ({ default: { homedir: () => "/home/user" } }));

vi.mock("@triliumnext/core", () => ({
    getLog: () => state.log,
    options: {
        getOptionBool: (name: string) => {
            if (name === "launchOnStartup") return state.launchOnStartup;
            if (name === "hideOnAutoStart") return state.hideOnAutoStart;
            return false;
        }
    },
    utils: { safeExtractMessageAndStackFromError: (e: unknown) => String(e) }
}));

const { applyLaunchOnStartup, setupAutoLaunch, wasLaunchedHidden, START_HIDDEN_FLAG } = await import("./auto_launch.js");

// Built with the same path.join as the module so the assertions hold on every OS.
const AUTOSTART_DIR = path.join("/home/user", ".config", "autostart");
const DESKTOP_FILE = path.join(AUTOSTART_DIR, "trilium.desktop");

const ORIGINAL_PLATFORM = process.platform;
const ORIGINAL_EXECPATH = process.execPath;

function setPlatform(p: NodeJS.Platform) {
    Object.defineProperty(process, "platform", { value: p, configurable: true });
}

function setExecPath(p: string) {
    Object.defineProperty(process, "execPath", { value: p, configurable: true });
}

beforeEach(() => {
    vi.clearAllMocks();
    state.launchOnStartup = false;
    state.hideOnAutoStart = false;
    state.setLoginItemThrows = false;
    state.wasOpenedAsHidden = false;
    state.ipcOn.clear();
    delete process.env.APPIMAGE;
    delete process.env.XDG_CONFIG_HOME;
});

afterEach(() => {
    setPlatform(ORIGINAL_PLATFORM);
    setExecPath(ORIGINAL_EXECPATH);
    delete process.env.APPIMAGE;
    delete process.env.XDG_CONFIG_HOME;
});

describe("auto_launch", () => {
    it("enables the OS login item on Windows/macOS when the option is on", () => {
        setPlatform("win32");
        state.launchOnStartup = true;
        applyLaunchOnStartup();
        expect(state.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, openAsHidden: false, args: [] });
    });

    it("disables the OS login item when the option is off", () => {
        setPlatform("darwin");
        state.launchOnStartup = false;
        applyLaunchOnStartup();
        expect(state.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false, openAsHidden: false, args: [] });
    });

    it("tags the login item to start hidden when hide-on-auto-start is on", () => {
        setPlatform("win32");
        state.launchOnStartup = true;
        state.hideOnAutoStart = true;
        applyLaunchOnStartup();
        expect(state.setLoginItemSettings).toHaveBeenCalledWith({
            openAtLogin: true,
            openAsHidden: true,
            args: [START_HIDDEN_FLAG]
        });
    });

    it("does not start hidden when autostart is off, even if hide-on-auto-start is on", () => {
        setPlatform("darwin");
        state.launchOnStartup = false;
        state.hideOnAutoStart = true;
        applyLaunchOnStartup();
        expect(state.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false, openAsHidden: false, args: [] });
    });

    it("writes a .desktop autostart file on Linux when enabled", () => {
        setPlatform("linux");
        setExecPath("/opt/trilium/trilium");
        state.launchOnStartup = true;

        applyLaunchOnStartup();

        expect(state.mkdirSync).toHaveBeenCalledWith(AUTOSTART_DIR, { recursive: true });
        const [file, content] = state.writeFileSync.mock.calls[0] as [string, string];
        expect(file).toBe(DESKTOP_FILE);
        expect(content).toContain("[Desktop Entry]");
        expect(content).toContain('Exec="/opt/trilium/trilium"');
        expect(content).toContain("Name=Trilium Notes");
        // Linux must not touch the (no-op) Electron login-item API.
        expect(state.setLoginItemSettings).not.toHaveBeenCalled();
    });

    it("appends the start-hidden flag to the Linux Exec line when enabled", () => {
        setPlatform("linux");
        setExecPath("/opt/trilium/trilium");
        state.launchOnStartup = true;
        state.hideOnAutoStart = true;

        applyLaunchOnStartup();

        const [, content] = state.writeFileSync.mock.calls[0] as [string, string];
        expect(content).toContain(`Exec="/opt/trilium/trilium" ${START_HIDDEN_FLAG}`);
    });

    it("prefers APPIMAGE over execPath for the Linux Exec line", () => {
        setPlatform("linux");
        setExecPath("/tmp/electron");
        process.env.APPIMAGE = "/home/user/Apps/Trilium.AppImage";
        state.launchOnStartup = true;

        applyLaunchOnStartup();

        const [, content] = state.writeFileSync.mock.calls[0] as [string, string];
        expect(content).toContain('Exec="/home/user/Apps/Trilium.AppImage"');
    });

    it("honours $XDG_CONFIG_HOME for the Linux autostart directory", () => {
        setPlatform("linux");
        state.launchOnStartup = true;
        process.env.XDG_CONFIG_HOME = "/home/user/.xdgconfig";

        applyLaunchOnStartup();

        const [file] = state.writeFileSync.mock.calls[0] as [string, string];
        expect(file).toBe(path.join("/home/user/.xdgconfig", "autostart", "trilium.desktop"));
    });

    it("removes the .desktop file on Linux when disabled", () => {
        setPlatform("linux");
        state.launchOnStartup = false;

        applyLaunchOnStartup();

        expect(state.rmSync).toHaveBeenCalledWith(DESKTOP_FILE, { force: true });
        expect(state.writeFileSync).not.toHaveBeenCalled();
    });

    it("logs and does not throw when applying fails", () => {
        setPlatform("win32");
        state.setLoginItemThrows = true;

        expect(() => applyLaunchOnStartup()).not.toThrow();
        expect(state.log.error).toHaveBeenCalledWith(expect.stringContaining("Failed to apply launch-on-startup"));
    });

    it("wasLaunchedHidden reflects the --start-hidden argv flag on Windows/Linux", () => {
        setPlatform("win32");
        const original = process.argv;
        try {
            process.argv = ["node", "main.js", START_HIDDEN_FLAG];
            expect(wasLaunchedHidden()).toBe(true);
            process.argv = ["node", "main.js"];
            expect(wasLaunchedHidden()).toBe(false);
        } finally {
            process.argv = original;
        }
    });

    it("wasLaunchedHidden reflects wasOpenedAsHidden on macOS", () => {
        setPlatform("darwin");
        state.wasOpenedAsHidden = true;
        expect(wasLaunchedHidden()).toBe(true);
        state.wasOpenedAsHidden = false;
        expect(wasLaunchedHidden()).toBe(false);
    });

    it("setupAutoLaunch registers the reapply IPC, which applies the current setting", () => {
        setPlatform("win32");
        setupAutoLaunch();

        const handler = state.ipcOn.get("reapply-launch-on-startup");
        expect(handler).toBeDefined();

        state.launchOnStartup = true;
        handler?.();
        expect(state.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, openAsHidden: false, args: [] });
    });
});
