import { getLog, options as optionService, utils as coreUtils } from "@triliumnext/core";
import electron from "electron";
import fs from "fs";
import os from "os";
import path from "path";

// Electron's app.setLoginItemSettings() covers macOS and Windows but is a no-op on
// Linux, where autostart is instead a freedesktop ".desktop" file dropped into the
// per-user autostart directory. We therefore branch on the platform.

// We tag the autostart command so the app can tell, at launch, that it was started
// by the OS at login (and should hide to the tray) rather than launched manually
// (where it must show a window). macOS has no argv hook for login items, so it uses
// the native openAsHidden flag and reports it back via wasOpenedAsHidden instead.
export const START_HIDDEN_FLAG = "--start-hidden";

/**
 * Reconciles the OS autostart entry with the current `launchOnStartup` /
 * `hideOnAutoStart` options. Safe to call repeatedly (it's idempotent) and on every
 * startup, so the OS state is repaired if it drifts. Failures are logged rather than
 * thrown so a permission error (e.g. a read-only autostart dir on Linux) can't take
 * down app startup.
 */
export function applyLaunchOnStartup() {
    try {
        const enabled = optionService.getOptionBool("launchOnStartup");
        const hidden = enabled && optionService.getOptionBool("hideOnAutoStart");

        if (process.platform === "linux") {
            applyLinuxAutostart(enabled, hidden);
        } else {
            // macOS + Windows: handled natively by Electron. `openAsHidden` is the
            // macOS mechanism; `args` is the Windows one. Each platform ignores the
            // option that doesn't apply to it.
            electron.app.setLoginItemSettings({
                openAtLogin: enabled,
                openAsHidden: hidden,
                args: hidden ? [START_HIDDEN_FLAG] : []
            });
        }
    } catch (e) {
        getLog().error(`Failed to apply launch-on-startup setting: ${coreUtils.safeExtractMessageAndStackFromError(e)}`);
    }
}

/**
 * Whether this process was started hidden by the OS at login (vs. launched manually).
 * Used to decide whether the main window should open minimized to the tray.
 */
export function wasLaunchedHidden(): boolean {
    if (process.platform === "darwin") {
        return electron.app.getLoginItemSettings().wasOpenedAsHidden;
    }
    return process.argv.includes(START_HIDDEN_FLAG);
}

/**
 * Registers the IPC the renderer sends after the `launchOnStartup` option changes,
 * so the autostart entry updates immediately without an app restart.
 */
export function setupAutoLaunch() {
    electron.ipcMain.on("reapply-launch-on-startup", applyLaunchOnStartup);
}

function applyLinuxAutostart(enabled: boolean, hidden: boolean) {
    const autostartDir = getLinuxAutostartDir();
    const desktopFile = path.join(autostartDir, "trilium.desktop");
    if (enabled) {
        fs.mkdirSync(autostartDir, { recursive: true });
        fs.writeFileSync(desktopFile, buildLinuxDesktopEntry(hidden));
    } else {
        fs.rmSync(desktopFile, { force: true });
    }
}

function getLinuxAutostartDir() {
    // XDG Base Directory spec: use $XDG_CONFIG_HOME when set and non-empty,
    // otherwise fall back to ~/.config. Read lazily so the env is honoured at apply
    // time rather than module load.
    const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
    return path.join(configHome, "autostart");
}

function buildLinuxDesktopEntry(hidden: boolean) {
    const exec = resolveLinuxAutostartExec();
    const execLine = hidden ? `Exec=${exec} ${START_HIDDEN_FLAG}` : `Exec=${exec}`;
    return [
        "[Desktop Entry]",
        "Type=Application",
        `Name=${electron.app.getName()}`,
        execLine,
        "Terminal=false",
        "X-GNOME-Autostart-enabled=true",
        ""
    ].join("\n");
}

/**
 * The command the OS should run to relaunch this app on Linux.
 *
 * `process.execPath` is only the right answer when the running process *is* the
 * whole app — an AppImage bundle or a bundled-Electron build. On a "system
 * Electron + wrapper script" install (e.g. the Arch `triliumnext-bin` package)
 * it is the bare `electron` binary with no app attached, so autostart launches
 * generic Electron, which prints its usage and exits (#10918).
 *
 * Resolution order:
 *  1. `$APPIMAGE` — AppImage builds relaunch the bundle itself.
 *  2. `$TRILIUM_LAUNCH_EXEC` — explicit contract for unbundled-Electron
 *     packagers whose wrapper (env setup, `app.asar` path) must not be bypassed.
 *  3. The app's installed `.desktop` launcher — distro packages already ship a
 *     correct `Exec=` (the wrapper); reusing it repairs existing installs with
 *     no packager changes.
 *  4. `process.execPath` — bundled builds where the executable is the app.
 */
function resolveLinuxAutostartExec(): string {
    if (process.env.APPIMAGE) {
        return quoteDesktopExecValue(process.env.APPIMAGE);
    }
    if (process.env.TRILIUM_LAUNCH_EXEC?.trim()) {
        return quoteDesktopExecValue(process.env.TRILIUM_LAUNCH_EXEC.trim());
    }
    const installed = findInstalledLinuxDesktopExec();
    if (installed) {
        return installed;
    }
    return quoteDesktopExecValue(process.execPath);
}

function quoteDesktopExecValue(value: string): string {
    return `"${value}"`;
}

/**
 * Locate a trilium application launcher among the installed `.desktop` files
 * and return its `Exec=` line, stripped of freedesktop field codes (`%f`, `%U`,
 * …), which the autostart entry has no use for. Scans user-local applications
 * first so a user override beats the system package's entry. Best-effort: any
 * error or missing directory just yields null and the caller falls back.
 */
function findInstalledLinuxDesktopExec(): string | null {
    try {
        for (const dir of linuxApplicationsDirs()) {
            let listed: unknown;
            try {
                listed = fs.readdirSync(dir);
            } catch {
                continue;
            }
            if (!Array.isArray(listed)) {
                continue;
            }
            const candidates = (listed as string[])
                .filter((name) => name.toLowerCase().includes("trilium") && name.endsWith(".desktop"))
                .sort();
            for (const name of candidates) {
                const exec = readDesktopExec(path.join(dir, name));
                if (exec) {
                    return exec;
                }
            }
        }
    } catch {
        // Detection is a convenience layer; never block autostart on it.
    }
    return null;
}

function linuxApplicationsDirs(): string[] {
    const dirs: string[] = [];
    const dataHome = process.env.XDG_DATA_HOME?.trim() || path.join(os.homedir(), ".local", "share");
    dirs.push(path.join(dataHome, "applications"));
    const dataDirs = process.env.XDG_DATA_DIRS?.trim() || "/usr/local/share:/usr/share";
    for (const entry of dataDirs.split(":")) {
        if (entry.trim()) {
            dirs.push(path.join(entry.trim(), "applications"));
        }
    }
    return dirs;
}

function readDesktopExec(file: string): string | null {
    let contents: string;
    try {
        contents = fs.readFileSync(file, "utf8");
    } catch {
        return null;
    }
    let inDesktopEntry = false;
    for (const line of contents.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
            inDesktopEntry = trimmed === "[Desktop Entry]";
            continue;
        }
        if (!inDesktopEntry || !trimmed.startsWith("Exec=")) {
            continue;
        }
        // Field codes (%f, %F, %u, %U, …) are launch-context placeholders the
        // spec defines for file-manager launches; autostart has none to offer.
        const exec = trimmed
            .slice("Exec=".length)
            .split(/\s+/)
            .filter((token) => !token.startsWith("%"))
            .join(" ")
            .trim();
        return exec || null;
    }
    return null;
}
