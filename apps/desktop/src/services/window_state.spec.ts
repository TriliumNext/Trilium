import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => unknown;

const state = vi.hoisted(() => ({
    userData: "",
    displays: [ { workArea: { x: 0, y: 0, width: 1920, height: 1080 } } ]
}));

vi.mock("electron", () => ({
    app: { getPath: () => state.userData },
    screen: { getAllDisplays: () => state.displays }
}));

vi.mock("@triliumnext/core", () => ({ getLog: () => ({ error: vi.fn() }) }));

const { createWindowStateKeeper } = await import("./window_state.js");

const DEFAULTS = { defaultWidth: 1200, defaultHeight: 800 };
let tempDir = "";

class FakeWindow {
    listeners = new Map<string, Handler[]>();
    normalBounds = { x: 100, y: 50, width: 1000, height: 700 };
    maximized = false;
    fullScreen = false;
    minimized = false;
    destroyed = false;
    maximize = vi.fn();
    setFullScreen = vi.fn();
    on(event: string, cb: Handler) {
        this.listeners.set(event, [ ...this.listeners.get(event) ?? [], cb ]);
        return this;
    }
    fire(event: string) {
        for (const cb of this.listeners.get(event) ?? []) cb();
    }
    getNormalBounds() { return this.normalBounds; }
    isMaximized() { return this.maximized; }
    isFullScreen() { return this.fullScreen; }
    isMinimized() { return this.minimized; }
    isDestroyed() { return this.destroyed; }
}

function stateFile() {
    return path.join(state.userData, "window-state.json");
}

function writeState(value: unknown) {
    fs.writeFileSync(stateFile(), JSON.stringify(value));
}

function readState() {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
}

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "window-state-"));
    state.userData = tempDir;
    state.displays = [ { workArea: { x: 0, y: 0, width: 1920, height: 1080 } } ];
});

afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("createWindowStateKeeper", () => {
    it("uses the defaults without a file, or with an unreadable or invalid one", () => {
        expect({ ...createWindowStateKeeper(DEFAULTS) }).toMatchObject({ x: undefined, y: undefined, width: 1200, height: 800 });

        fs.writeFileSync(stateFile(), "{ not json");
        expect(createWindowStateKeeper(DEFAULTS).width).toBe(1200);

        writeState({ x: 1.5, y: 0, width: -3, height: "tall" });
        expect({ ...createWindowStateKeeper(DEFAULTS) }).toMatchObject({ x: undefined, y: undefined, width: 1200, height: 800 });
    });

    it("restores the bounds a previous release wrote, displayBounds included", () => {
        writeState({ x: 10, y: 20, width: 900, height: 600, isMaximized: false, isFullScreen: false,
            displayBounds: { x: 0, y: 0, width: 1920, height: 1080 } });
        const keeper = createWindowStateKeeper(DEFAULTS);
        expect([ keeper.x, keeper.y, keeper.width, keeper.height ]).toEqual([ 10, 20, 900, 600 ]);
    });

    it("keeps a window that is partly off-screen but drops the position of one no display shows", () => {
        state.displays = [
            { workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
            { workArea: { x: 1920, y: 0, width: 1280, height: 1024 } }
        ];
        writeState({ x: 1700, y: -20, width: 1000, height: 700 });
        expect(createWindowStateKeeper(DEFAULTS).x).toBe(1700);

        writeState({ x: 5000, y: 100, width: 1000, height: 700 });
        const unplugged = createWindowStateKeeper(DEFAULTS);
        expect([ unplugged.x, unplugged.y, unplugged.width, unplugged.height ]).toEqual([ undefined, undefined, 1000, 700 ]);

        // A sliver along the edge is not enough to grab the window by.
        writeState({ x: 1880, y: 1060, width: 1000, height: 700 });
        state.displays = [ { workArea: { x: 0, y: 0, width: 1920, height: 1080 } } ];
        expect(createWindowStateKeeper(DEFAULTS).x).toBeUndefined();
    });

    it("maximizes and enters full screen as the saved state says", () => {
        writeState({ x: 10, y: 20, width: 900, height: 600, isMaximized: true, isFullScreen: true });
        const win = new FakeWindow();
        createWindowStateKeeper(DEFAULTS).manage(win as never);
        expect(win.maximize).toHaveBeenCalledOnce();
        expect(win.setFullScreen).toHaveBeenCalledWith(true);

        const plain = new FakeWindow();
        writeState({ x: 10, y: 20, width: 900, height: 600 });
        createWindowStateKeeper(DEFAULTS).manage(plain as never);
        expect(plain.maximize).not.toHaveBeenCalled();
        expect(plain.setFullScreen).not.toHaveBeenCalled();
    });

    it("saves the normal bounds shortly after a move or resize, and on close", () => {
        vi.useFakeTimers();
        const win = new FakeWindow();
        createWindowStateKeeper(DEFAULTS).manage(win as never);

        win.fire("move");
        win.fire("resize");
        expect(fs.existsSync(stateFile())).toBe(false);
        vi.runAllTimers();
        expect(readState()).toEqual({ x: 100, y: 50, width: 1000, height: 700, isMaximized: false, isFullScreen: false });

        // Maximized: the normal bounds are what a restore returns to, so they are kept.
        win.maximized = true;
        win.normalBounds = { x: 300, y: 200, width: 800, height: 500 };
        win.fire("maximize");
        vi.runAllTimers();
        expect(readState()).toEqual({ x: 300, y: 200, width: 800, height: 500, isMaximized: true, isFullScreen: false });

        // Minimizing reports the window as not maximized on some platforms; the flags stay as they were.
        win.minimized = true;
        win.maximized = false;
        win.fire("resize");
        vi.runAllTimers();
        expect(readState().isMaximized).toBe(true);

        win.minimized = false;
        win.fullScreen = true;
        win.fire("close");
        win.destroyed = true;
        win.fire("closed");
        expect(readState()).toMatchObject({ isMaximized: false, isFullScreen: true });

        // Nothing is left scheduled to read a destroyed window.
        win.fire("move");
        expect(() => vi.runAllTimers()).not.toThrow();
    });

    it("creates the user data directory when it is missing", () => {
        vi.useFakeTimers();
        state.userData = path.join(state.userData, "nested", "dir");
        const win = new FakeWindow();
        createWindowStateKeeper(DEFAULTS).manage(win as never);
        win.fire("close");
        win.fire("closed");
        expect(readState().width).toBe(1000);
    });
});
