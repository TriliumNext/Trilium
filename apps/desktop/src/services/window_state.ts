import { getLog } from "@triliumnext/core";
import { app, type BrowserWindow, type Rectangle, screen } from "electron";
import fs from "fs";
import path from "path";

/** The contents of `window-state.json`, in the shape `electron-window-state` wrote it. */
interface WindowState {
    x?: number;
    y?: number;
    width: number;
    height: number;
    isMaximized?: boolean;
    isFullScreen?: boolean;
}

const STATE_FILE_NAME = "window-state.json";
const SAVE_DELAY_MS = 500;
/** How much of a saved window, in pixels along each axis, a display must show for the position to be kept. */
const MIN_VISIBLE_PX = 100;

/**
 * Remembers the bounds, maximized and full-screen state of the main window across restarts, in
 * `window-state.json` under the user data directory. `x`, `y`, `width` and `height` are the
 * bounds to create the window with; `x` and `y` are `undefined` when there is no saved position
 * or no display shows enough of it, so Electron centers the window. `manage()` applies the
 * maximized and full-screen state and saves every change to the file.
 */
export function createWindowStateKeeper(defaults: { defaultWidth: number; defaultHeight: number }) {
    const stateFile = path.join(app.getPath("userData"), STATE_FILE_NAME);
    const state = readState(stateFile) ?? { width: defaults.defaultWidth, height: defaults.defaultHeight };
    if (!isPositionVisible(state)) {
        state.x = undefined;
        state.y = undefined;
    }

    function manage(win: BrowserWindow) {
        if (state.isMaximized) {
            win.maximize();
        }
        if (state.isFullScreen) {
            win.setFullScreen(true);
        }

        let saveTimer: ReturnType<typeof setTimeout> | undefined;
        const scheduleSave = () => {
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
                if (!win.isDestroyed()) {
                    updateState(state, win);
                    writeState(stateFile, state);
                }
            }, SAVE_DELAY_MS);
        };

        win.on("move", scheduleSave);
        win.on("resize", scheduleSave);
        win.on("maximize", scheduleSave);
        win.on("unmaximize", scheduleSave);
        win.on("enter-full-screen", scheduleSave);
        win.on("leave-full-screen", scheduleSave);
        // The window can no longer be read once it is closed, so its state is taken on `close`.
        win.on("close", () => updateState(state, win));
        win.on("closed", () => {
            clearTimeout(saveTimer);
            writeState(stateFile, state);
        });
    }

    return { x: state.x, y: state.y, width: state.width, height: state.height, manage };
}

function readState(stateFile: string): WindowState | null {
    let parsed: Partial<Record<keyof WindowState, unknown>>;
    try {
        parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    } catch {
        return null;
    }

    const { x, y, width, height, isMaximized, isFullScreen } = parsed ?? {};
    if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
        return null;
    }
    const hasPosition = Number.isInteger(x) && Number.isInteger(y);
    return {
        x: hasPosition ? x as number : undefined,
        y: hasPosition ? y as number : undefined,
        width,
        height,
        isMaximized: isMaximized === true,
        isFullScreen: isFullScreen === true
    };
}

function isPositiveInteger(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) > 0;
}

function isPositionVisible({ x, y, width, height }: WindowState) {
    if (x === undefined || y === undefined) {
        return false;
    }
    return screen.getAllDisplays().some(({ workArea }) =>
        overlap(x, width, workArea.x, workArea.width) >= MIN_VISIBLE_PX
        && overlap(y, height, workArea.y, workArea.height) >= MIN_VISIBLE_PX);
}

function overlap(start: number, length: number, areaStart: number, areaLength: number) {
    return Math.min(start + length, areaStart + areaLength) - Math.max(start, areaStart);
}

function updateState(state: WindowState, win: BrowserWindow) {
    const bounds: Rectangle = win.getNormalBounds();
    state.x = bounds.x;
    state.y = bounds.y;
    state.width = bounds.width;
    state.height = bounds.height;
    // Some platforms report a minimized window as neither maximized nor full screen.
    if (!win.isMinimized()) {
        state.isMaximized = win.isMaximized();
        state.isFullScreen = win.isFullScreen();
    }
}

function writeState(stateFile: string, state: WindowState) {
    try {
        fs.mkdirSync(path.dirname(stateFile), { recursive: true });
        fs.writeFileSync(stateFile, JSON.stringify(state));
    } catch (e) {
        getLog().error(`Could not save the window state to ${stateFile}: ${e}`);
    }
}
