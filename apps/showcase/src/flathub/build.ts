import fs from "fs";
import path from "path";
import type { Browser } from "playwright";

import { openNote, setOption, settle } from "../shared/browser.ts";
import {
    type BuildOptions, type Builder, outDir, reportChecks, repoRoot, sceneFileName, templatesDir
} from "../shared/build.ts";
import { startSeededServer } from "../shared/demo_server.ts";
import { readPng } from "../shared/png.ts";
import { SCENES } from "../shared/scenes.ts";
import { checkFlathubListing, type FlathubShot, readMetainfo } from "./checks.ts";
import { type DesktopApp, startDesktopApp } from "./desktop_app.ts";
import { type GnomeSession, startGnomeSession } from "./gnome_session.ts";

/**
 * Flathub asks for a window of at most 1000 x 700, or 2000 x 1400 on a HiDPI screen, so the
 * window is 1000 x 700 logical pixels on a monitor at 2x.
 */
const FLATHUB_WINDOW = { width: 1000, height: 700, scale: 2 };

/**
 * The Flathub targets: `flathub` captures the desktop app's window inside a headless GNOME
 * Shell, and `flathub-preview` mocks the Flathub app page from those screenshots and the
 * metainfo, with Flathub's quality checks.
 */
export const FLATHUB_TARGETS: Record<string, Builder> = {
    "flathub": buildFlathub,
    "flathub-preview": buildFlathubPreview
};

/**
 * Captures each scene in the desktop app with GNOME's window screenshot, which keeps the frame,
 * rounded corners and shadow that Flathub requires, into `out/flathub`.
 */
async function buildFlathub(browser: Browser, options: BuildOptions) {
    const server = await startSeededServer(browser, options.port);
    let session: GnomeSession | undefined;
    let app: DesktopApp | undefined;
    try {
        await setOption(browser, server.baseUrl, "rightPaneVisible", "false");
        await server.stopServer();

        const { width, height, scale } = FLATHUB_WINDOW;
        session = await startGnomeSession({
            width: width + 600,
            height: height + 400,
            scale,
            logPath: path.join(outDir, "gnome-shell.log")
        });
        app = await startDesktopApp({
            dataDir: server.dataDir,
            env: session.env,
            port: options.port,
            debugPort: options.port + 1,
            logPath: path.join(outDir, "desktop.log")
        });
        const { page } = app;
        page.on("pageerror", (error) => {
            console.warn(`  [flathub] page error: ${error.message}`);
        });
        await page.addStyleTag({ content: "* { caret-color: transparent !important; }" });
        const scenes = SCENES.filter((scene) => options.only?.includes(scene.id) ?? true);
        for (const scene of scenes) {
            const noteId = await page.evaluate(async (query) => {
                const params = new URLSearchParams({ searchString: query });
                const response = await fetch(`api/search?${params}`, {
                    headers: await window.glob.getHeaders()
                });
                return (await response.json())[0];
            }, scene.desktopQuery ?? scene.query);
            await page.emulateMedia({ colorScheme: scene.colorScheme ?? "light" });
            await openNote(page, noteId);
            await settle(page);
            await scene.desktopPrepare?.(page);
            await settle(page);

            const file = flathubShotPath(SCENES.indexOf(scene), scene.id);
            await session.screenshotWindow(file, { width, height });
            console.log(`  ${path.relative(outDir, file)}`);
        }
    } finally {
        await app?.stop();
        await session?.stop();
        server.stop();
    }
}

/**
 * Writes `out/flathub-preview.html`, a mock of the Flathub app page built from the desktop
 * app's metainfo and the screenshots in `out/flathub`, and checks both against Flathub's
 * quality guidelines, failing the build when one is not met.
 */
async function buildFlathubPreview(browser: Browser) {
    const flatpakDir = path.join(repoRoot, "apps", "desktop", "flatpak");
    const meta = await readMetainfo(browser,
        path.join(flatpakDir, "org.triliumnotes.Trilium.metainfo.xml"));
    const icon = fs.readFileSync(path.join(flatpakDir, "org.triliumnotes.Trilium.svg"), "utf8");
    fs.writeFileSync(path.join(outDir, "flathub-icon.svg"), icon);

    const screenshots: FlathubShot[] = [];
    for (const [ index, scene ] of SCENES.entries()) {
        const file = flathubShotPath(index, scene.id);
        if (fs.existsSync(file)) {
            screenshots.push({
                file: path.relative(outDir, file),
                caption: scene.flathubCaption ?? scene.caption,
                dark: scene.colorScheme === "dark",
                png: readPng(file)
            });
        }
    }
    const checks = checkFlathubListing(meta, screenshots, FLATHUB_WINDOW, icon);

    const data = { meta, screenshots, checks };
    const script = `window.FLATHUB = ${JSON.stringify(data, null, 4)};\n`;
    fs.writeFileSync(path.join(outDir, "flathub-data.js"), script);
    fs.copyFileSync(path.join(templatesDir, "flathub.html"),
        path.join(outDir, "flathub-preview.html"));
    fs.copyFileSync(path.join(templatesDir, "common.css"), path.join(outDir, "common.css"));

    reportChecks(checks);
    console.log(`  Open ${path.join(outDir, "flathub-preview.html")}`);
}

function flathubShotPath(index: number, sceneId: string) {
    return path.join(outDir, "flathub", sceneFileName(index, sceneId));
}
