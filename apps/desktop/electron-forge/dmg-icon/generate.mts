/**
 * Regenerates the macOS DMG volume icon (volume.icns + volume-dev.icns) from volume-icon.html.
 *
 * Run with: pnpm --filter desktop generate-dmg-icon
 *
 * This is the icon of the MOUNTED disk image — Finder's sidebar under Locations, the desktop
 * mount, the DMG window's title bar, the eject menu. appdmg copies it in as `.VolumeIcon.icns`
 * (wired up as `icon` in forge.config.ts). It is NOT the .dmg file icon in Downloads: that one
 * comes from the disk-image UTI and can only be overridden by a resource-fork custom icon, which
 * HTTP downloads don't carry and which would dirty the file after CI's codesign/staple pass.
 *
 * It deliberately does NOT reuse the app icon. A drive body distinguishes "installer media" from
 * "the app", which is the whole point; Firefox's own volume icon is the reference, and it keeps
 * the drive body intact all the way down to the 16pt slot rather than swapping in a bare mark.
 *
 * The PNG slots render on any OS (headless Chromium via the repo's @playwright/test). Packing them
 * into an .icns uses `iconutil`, which is macOS-only — elsewhere the .iconset is left on disk and
 * the committed .icns is untouched. That's no worse than the status quo: the DMG itself can only
 * be BUILT on macOS anyway (appdmg is darwin-only).
 */
import { execFileSync } from "child_process";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

import { chromium } from "@playwright/test";

const DMG_ICON_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = pathToFileURL(path.join(DMG_ICON_DIR, "volume-icon.html"));
const CLIENT_ASSETS = path.join(DMG_ICON_DIR, "..", "..", "..", "client", "src", "assets");

/** The design is authored in a 1024 box; every slot is a vector render scaled from it. */
const DESIGN_SIZE = 1024;

/**
 * The ten slots an .iconset must provide, as {file name → pixel size}. Sizes repeat across slots
 * (a 256px render serves both `256x256` and `128x128@2x`) exactly as Finder expects, so only the
 * distinct pixel sizes are actually rendered.
 */
const SLOTS: Record<string, number> = {
    "icon_16x16.png": 16,
    "icon_16x16@2x.png": 32,
    "icon_32x32.png": 32,
    "icon_32x32@2x.png": 64,
    "icon_128x128.png": 128,
    "icon_128x128@2x.png": 256,
    "icon_256x256.png": 256,
    "icon_256x256@2x.png": 512,
    "icon_512x512.png": 512,
    "icon_512x512@2x.png": 1024
};

/**
 * One volume icon per channel. The mark is read from the client's own icon SVGs so the leaves stay
 * single-sourced — this folder never gets its own copy of the leaf paths.
 */
const VARIANTS = [
    { mark: "icon-color.svg", baseName: "volume" },
    { mark: "icon-nightly.svg", baseName: "volume-dev" }
];

const browser = await chromium.launch();
try {
    for (const { mark, baseName } of VARIANTS) {
        const iconsetDir = path.join(DMG_ICON_DIR, `${baseName}.iconset`);
        rmSync(iconsetDir, { recursive: true, force: true });
        mkdirSync(iconsetDir, { recursive: true });

        const markUrl = pathToFileURL(path.join(CLIENT_ASSETS, mark)).href;
        const renders = new Map<number, Buffer>();

        for (const size of new Set(Object.values(SLOTS))) {
            // Served from a file:// origin so the browser is allowed to load the file:// mark.
            const page = await browser.newPage({ viewport: { width: size, height: size } });
            const query = `scale=${size / DESIGN_SIZE}&mark=${encodeURIComponent(markUrl)}`;
            await page.goto(`${SOURCE.href}?${query}`);
            renders.set(size, await page.screenshot({ omitBackground: true }));
            await page.close();
        }

        for (const [fileName, size] of Object.entries(SLOTS)) {
            const render = renders.get(size);
            if (!render) {
                throw new Error(`No render for slot ${fileName} (${size}px)`);
            }
            writeFileSync(path.join(iconsetDir, fileName), render);
        }

        if (process.platform !== "darwin") {
            console.warn(`[${baseName}] iconset written to ${iconsetDir};`
                + " run iconutil on macOS to pack the .icns");
            continue;
        }

        const icnsPath = path.join(DMG_ICON_DIR, `${baseName}.icns`);
        execFileSync("iconutil", ["-c", "icns", iconsetDir, "-o", icnsPath]);
        rmSync(iconsetDir, { recursive: true, force: true });
        console.log(`[${baseName}] ${icnsPath}`);
    }
} finally {
    await browser.close();
}
