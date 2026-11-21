import { execFileSync, spawn } from "child_process";
import fs from "fs";
import path from "path";

/**
 * Starts a headless GNOME Shell on its own D-Bus session and an empty home directory, so the
 * user's settings and extensions stay out of it, and resolves once the shell answers. The
 * virtual monitor is `width` x `height` logical pixels at `scale`. `--unsafe-mode` lets
 * `screenshotWindow()` and `evaluate()` call the shell's D-Bus API, which only allowlisted
 * callers can use otherwise.
 */
export async function startGnomeSession({ width, height, scale, logPath }: {
    width: number;
    height: number;
    scale: number;
    logPath: string;
}) {
    // The Wayland socket lives in the runtime directory, and its path must fit in 108 bytes.
    const runtimeDir = fs.mkdtempSync("/tmp/trilium-gnome-");
    const home = path.join(runtimeDir, "home");
    fs.mkdirSync(home);
    const busFile = path.join(runtimeDir, "bus");

    const env: NodeJS.ProcessEnv = {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: path.join(home, ".config"),
        XDG_DATA_HOME: path.join(home, ".local", "share"),
        XDG_CACHE_HOME: path.join(home, ".cache"),
        XDG_RUNTIME_DIR: runtimeDir,
        XDG_SESSION_TYPE: "wayland",
        WAYLAND_DISPLAY: "wayland-trilium"
    };
    delete env.DISPLAY;
    delete env.DBUS_SESSION_BUS_ADDRESS;

    const monitor = `${width * scale}x${height * scale}`;
    const log = fs.openSync(logPath, "w");
    const shell = spawn("dbus-run-session", [
        "--", "sh", "-c", `echo "$DBUS_SESSION_BUS_ADDRESS" > "${busFile}"; exec gnome-shell `
            + `--headless --wayland --no-x11 --wayland-display=${env.WAYLAND_DISPLAY} `
            + `--virtual-monitor ${monitor} --unsafe-mode`
    ], { env, detached: true, stdio: [ "ignore", log, log ] });
    let exited = false;
    shell.on("exit", () => { exited = true; });

    const kill = () => {
        try {
            if (shell.pid) process.kill(-shell.pid);
        } catch {
            // Already gone.
        }
    };
    process.on("exit", kill);
    const stop = async () => {
        const done = exited
            ? Promise.resolve()
            : new Promise<void>((resolve) => shell.once("exit", () => resolve()));
        kill();
        await done;
        removeRuntimeDir(runtimeDir);
    };

    const call: DbusCall = (destination, objectPath, method, ...args) => execFileSync("gdbus", [
        "call", "--session", "--dest", destination, "--object-path", objectPath,
        "--method", method, ...args
    ], { env, encoding: "utf8", stdio: [ "ignore", "pipe", "pipe" ] });
    const evaluate = (script: string): unknown => {
        const output = call("org.gnome.Shell", "/org/gnome/Shell", "org.gnome.Shell.Eval", script);
        const [ , success, result ] = output.match(/^\((true|false), '(.*)'\)\s*$/s) ?? [];
        if (success !== "true") throw new Error(`GNOME Shell could not run ${script}: ${output}`);
        return result ? JSON.parse(result) : undefined;
    };

    const deadline = Date.now() + 60_000;
    for (;;) {
        if (exited) throw new Error(`GNOME Shell exited; see ${logPath}.`);
        if (fs.existsSync(busFile) && fs.readFileSync(busFile, "utf8").trim()) {
            env.DBUS_SESSION_BUS_ADDRESS = fs.readFileSync(busFile, "utf8").trim();
            try {
                if (evaluate("1") === 1) break;
            } catch {
                // The shell has not claimed its bus name yet.
            }
        }
        if (Date.now() > deadline) {
            await stop();
            throw new Error(`GNOME Shell did not start; see ${logPath}.`);
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    setScale(call, monitor, scale);
    evaluate("Main.overview.hide()");

    return {
        env,
        evaluate,
        /**
         * Resizes the app's window to `width` x `height` logical pixels and saves it with its
         * frame and shadow, as GNOME's screenshot tool does.
         */
        async screenshotWindow(file: string, { width, height }: { width: number; height: number }) {
            // The overview opens once the shell has started, so it can open after `hide()` above.
            if (evaluate("Main.overview.visible")) {
                evaluate("Main.overview.hide()");
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
            // The screenshot is of the focused window, and a new window does not always get focus.
            // A window that nearly fills the monitor opens maximized, without frame or shadow.
            evaluate(`(() => {
                const appWindow = global.get_window_actors()[0].meta_window;
                if (appWindow.is_maximized?.() ?? appWindow.get_maximized()) {
                    appWindow.unmaximize(Meta.MaximizeFlags.BOTH);
                }
                appWindow.move_resize_frame(false, 50, 50, ${width}, ${height});
                appWindow.activate(global.get_current_time());
            })()`);
            await new Promise((resolve) => setTimeout(resolve, 1000));
            fs.mkdirSync(path.dirname(file), { recursive: true });
            const output = call("org.gnome.Shell.Screenshot", "/org/gnome/Shell/Screenshot",
                "org.gnome.Shell.Screenshot.ScreenshotWindow", "true", "false", "false", file);
            if (!output.startsWith("(true")) {
                throw new Error(`GNOME Shell did not take the screenshot: ${output}`);
            }
        },
        stop
    };
}

/**
 * Removes the runtime directory once the session is gone. The document portal and GVfs, which
 * the session starts on demand, mount FUSE file systems inside it, and those outlive the shell.
 */
function removeRuntimeDir(runtimeDir: string) {
    const mounts = fs.readFileSync("/proc/self/mountinfo", "utf8").split("\n")
        .map((line) => line.split(" ")[4])
        .filter((mountPoint) => mountPoint?.startsWith(`${runtimeDir}/`));
    for (const mountPoint of mounts) {
        for (const command of [ "fusermount3", "fusermount" ]) {
            try {
                execFileSync(command, [ "-u", "-z", mountPoint ], { stdio: "ignore" });
                break;
            } catch {
                // Try the other FUSE version.
            }
        }
    }
    try {
        fs.rmSync(runtimeDir, { recursive: true, force: true });
    } catch (error) {
        console.warn(`  Could not remove ${runtimeDir}: ${(error as Error).message}`);
    }
}

/** Applies `scale` to the virtual monitor through `org.gnome.Mutter.DisplayConfig`. */
function setScale(call: DbusCall, monitor: string, scale: number) {
    const destination = [
        "org.gnome.Mutter.DisplayConfig", "/org/gnome/Mutter/DisplayConfig"
    ] as const;
    const state = call(...destination, "org.gnome.Mutter.DisplayConfig.GetCurrentState");
    const serial = state.match(/^\(uint32 (\d+)/)?.[1];
    const mode = state.match(new RegExp(`'(${monitor}@[\\d.]+)'`))?.[1];
    const connector = state.match(/\(\('([^']+)'/)?.[1];
    if (!serial || !mode || !connector) {
        throw new Error(`Unexpected display configuration: ${state}`);
    }
    const temporary = "1";
    call(...destination, "org.gnome.Mutter.DisplayConfig.ApplyMonitorsConfig", serial, temporary,
        `[(0, 0, ${scale.toFixed(1)}, 0, true, [('${connector}', '${mode}', @a{sv} {})])]`,
        "@a{sv} {}");
}

type DbusCall = (destination: string, objectPath: string, method: string, ...args: string[])
    => string;

export type GnomeSession = Awaited<ReturnType<typeof startGnomeSession>>;
