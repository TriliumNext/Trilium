/** Helpers shared by the native and WASM shells. */

export function resolveDistDir(): string {
    const candidates = [
        Deno.env.get("TRILIUM_DIST_DIR"),
        // Running from the repo via `deno task start`.
        import.meta.dirname ? `${import.meta.dirname}/../standalone/dist` : undefined,
        // The bundled binary lives one level deeper (apps/desktop-deno/<bundle>/).
        import.meta.dirname ? `${import.meta.dirname}/../../standalone/dist` : undefined,
        // Fallbacks relative to the working directory.
        `${Deno.cwd()}/../standalone/dist`,
        `${Deno.cwd()}/../../standalone/dist`,
        `${Deno.cwd()}/apps/standalone/dist`
    ];

    for (const dir of candidates) {
        if (!dir) {
            continue;
        }
        try {
            Deno.statSync(`${dir}/index.html`);
            return dir;
        } catch {
            // Try the next candidate.
        }
    }

    console.error(
        "Could not find the standalone build. Run `pnpm --filter standalone build` first,\n" +
        "or point TRILIUM_DIST_DIR at a directory containing its dist output."
    );
    Deno.exit(1);
}

/** Where the user's database lives on the host filesystem. */
export function resolveDataDir(): string {
    const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".";
    const dir = Deno.env.get("TRILIUM_DATA_DIR") ??
        `${Deno.env.get("XDG_DATA_HOME") ?? `${home}/.local/share`}/trilium-deno-desktop`;
    Deno.mkdirSync(dir, { recursive: true });
    return dir;
}

export function wantsHtml(req: Request): boolean {
    const { pathname } = new URL(req.url);
    return !/\.[a-z0-9]+$/i.test(pathname) &&
        (req.headers.get("accept") ?? "").includes("text/html");
}

/** Same headers the standalone Vite server sends (COOP only, no COEP). */
export function withSecurityHeaders(res: Response): Response {
    res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    return res;
}

/**
 * Native capabilities exposed to the webview, callable as `bindings.<name>()`
 * from the page — an `electronApi`-style bridge without IPC or preload.
 */
export function registerBindings(win: Deno.BrowserWindow) {
    win.bind("desktopInfo", async () => ({
        runtime: `Deno ${Deno.version.deno}`,
        v8: Deno.version.v8,
        typescript: Deno.version.typescript,
        os: Deno.build.os,
        arch: Deno.build.arch,
        appVersion: Deno.desktopVersion
    }));

    win.bind("showNotification", async (title, body) => {
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
            new Notification(String(title), { body: String(body ?? "") });
        }
        return permission;
    });

    win.bind("setBadge", async (text) => {
        Deno.dock.setBadge(text == null ? null : String(text));
    });

    win.bind("openDevtools", async () => {
        win.openDevtools();
    });

    win.bind("openExternal", async (url) => {
        const parsed = new URL(String(url));
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            throw new Error(`Refusing to open non-web URL: ${parsed.protocol}`);
        }
        const opener = Deno.build.os === "darwin"
            ? "open"
            : Deno.build.os === "windows"
            ? "explorer"
            : "xdg-open";
        await new Deno.Command(opener, { args: [parsed.href] }).output();
    });
}

/** System tray icon with show/quit menu, mirroring the Electron tray. */
export function setupTray(win: Deno.BrowserWindow, distDir: string): Deno.Tray | null {
    let iconBytes: Uint8Array;
    try {
        iconBytes = Deno.readFileSync(`${distDir}/assets/icon.png`);
    } catch {
        return null;
    }

    const tray = new Deno.Tray();
    tray.setIcon(iconBytes);
    tray.setTooltip("Trilium Notes");
    tray.setMenu([
        { item: { label: "Show Trilium", id: "show", enabled: true } },
        "separator",
        { item: { label: "Quit", id: "quit", enabled: true } }
    ]);
    tray.addEventListener("menuclick", (e) => {
        if (e.detail.id === "show") {
            win.show();
            win.focus();
        } else if (e.detail.id === "quit") {
            tray.destroy();
            Deno.exit(0);
        }
    });
    return tray;
}

/** executeJs may wrap results as {ok, value} depending on the backend. */
export function unwrapExecuteJs(raw: unknown): unknown {
    if (raw && typeof raw === "object" && "value" in raw) {
        return (raw as { value: unknown }).value;
    }
    return raw;
}

/**
 * Completes the real setup flow (schema creation + demo document import)
 * from inside the page. Returns the HTTP status the setup call resolved to.
 */
export async function driveSetup(win: Deno.BrowserWindow): Promise<string> {
    await win.executeJs(
        `window.__smokeSetup = "pending";
        fetch("/api/setup/new-document", { method: "POST" }).then(
            (r) => { window.__smokeSetup = String(r.status); },
            (e) => { window.__smokeSetup = "error: " + e; }
        );
        "started"`
    );

    const deadlineAt = Date.now() + 120_000;
    while (Date.now() < deadlineAt) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        const status = unwrapExecuteJs(await win.executeJs("window.__smokeSetup"));
        if (status !== "pending" && status != null) {
            return String(status);
        }
    }
    return "timeout";
}
