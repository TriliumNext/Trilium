import { afterEach, describe, expect, it, vi } from "vitest";

const showErrorBox = vi.fn();
const exit = vi.fn();
const requestSingleInstanceLock = vi.fn(() => true);

vi.mock("electron", () => ({
    default: {
        dialog: { showErrorBox: (...args: unknown[]) => showErrorBox(...args) },
        app: {
            exit: (...args: unknown[]) => exit(...args),
            requestSingleInstanceLock: () => requestSingleInstanceLock()
        }
    }
}));

// `t()` throws until translations are initialised; stub it so `crash` can build
// its dialog title without spinning up core.
vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return {
        ...actual,
        t: (key: string) => key
    };
});

const { default: DesktopPlatformProvider } = await import("./platform_provider.js");

function withPlatform(platform: NodeJS.Platform, fn: () => void) {
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
    try {
        fn();
    } finally {
        Object.defineProperty(process, "platform", { value: original, configurable: true });
    }
}

describe("DesktopPlatformProvider", () => {
    afterEach(() => {
        vi.clearAllMocks();
        requestSingleInstanceLock.mockReturnValue(true);
    });

    it("always reports as Electron and derives isMac / isWindows / isLinux from process.platform", () => {
        withPlatform("darwin", () => {
            const p = new DesktopPlatformProvider();
            expect(p.isElectron).toBe(true);
            expect(p.isMac).toBe(true);
            expect(p.isWindows).toBe(false);
            expect(p.isLinux).toBe(false);
        });
        withPlatform("win32", () => {
            const p = new DesktopPlatformProvider();
            expect(p.isMac).toBe(false);
            expect(p.isWindows).toBe(true);
            expect(p.isLinux).toBe(false);
        });
        withPlatform("linux", () => {
            const p = new DesktopPlatformProvider();
            expect(p.isMac).toBe(false);
            expect(p.isWindows).toBe(false);
            expect(p.isLinux).toBe(true);
        });
    });

    it("crash shows an error box and exits with code 1", () => {
        const p = new DesktopPlatformProvider();
        p.crash("boom");
        expect(showErrorBox).toHaveBeenCalledWith("modals.error_title", "boom");
        expect(exit).toHaveBeenCalledWith(1);
    });

    it("getEnv reads from process.env", () => {
        const p = new DesktopPlatformProvider();
        process.env.TRILIUM_PLATFORM_PROVIDER_TEST = "value";
        try {
            expect(p.getEnv("TRILIUM_PLATFORM_PROVIDER_TEST")).toBe("value");
            expect(p.getEnv("DOES_NOT_EXIST_TRILIUM")).toBeUndefined();
        } finally {
            delete process.env.TRILIUM_PLATFORM_PROVIDER_TEST;
        }
    });

    describe("shouldIgnoreStartupError", () => {
        const provider = new DesktopPlatformProvider();
        const eaddrinuse = { code: "EADDRINUSE" } as NodeJS.ErrnoException;

        it("ignores anything other than EADDRINUSE", () => {
            expect(provider.shouldIgnoreStartupError({ code: "EACCES" } as NodeJS.ErrnoException)).toBe(false);
        });

        it("tolerates EADDRINUSE when launched with --new-window", () => {
            const original = process.argv;
            process.argv = [...original, "--new-window"];
            try {
                expect(provider.shouldIgnoreStartupError(eaddrinuse)).toBe(true);
            } finally {
                process.argv = original;
            }
        });

        it("tolerates EADDRINUSE when the single-instance lock was lost", () => {
            requestSingleInstanceLock.mockReturnValue(false);
            expect(provider.shouldIgnoreStartupError(eaddrinuse)).toBe(true);
        });

        it("surfaces EADDRINUSE for the primary instance without --new-window", () => {
            requestSingleInstanceLock.mockReturnValue(true);
            expect(provider.shouldIgnoreStartupError(eaddrinuse)).toBe(false);
        });
    });
});
