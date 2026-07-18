/**
 * Regenerates the macOS DMG background (background.png + background@2x.png) from
 * background.html.
 *
 * Run with: pnpm --filter desktop generate-dmg-background
 *
 * The DMG "picture" is the static Finder-window background of the mounted disk
 * image (the app-icon → drag → Applications layout). Unlike the Windows splash it
 * cannot animate, but Finder IS Retina-aware: appdmg auto-packages background.png
 * and its @2x sibling into a multi-resolution TIFF, so a HiDPI Mac renders it crisp.
 *
 * Both files are rendered here with headless Chromium (the repo's @playwright/test),
 * so it runs on any OS — even though the DMG itself can only be BUILT on macOS.
 */
import { chromium } from "@playwright/test";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const DMG_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = pathToFileURL(path.join(DMG_DIR, "background.html"));

// Window content size in points; must match the `window.size` in forge.config.ts.
const WIDTH = 640;
const HEIGHT = 400;

// One background per channel (stable green / nightly purple), each at 1x and 2x.
const VARIANTS = [
    { variant: "stable", baseName: "background" },
    { variant: "nightly", baseName: "background-dev" }
];
const RESOLUTIONS = [
    { suffix: "", scale: 1 },
    { suffix: "@2x", scale: 2 }
];

const browser = await chromium.launch();
try {
    for (const { variant, baseName } of VARIANTS) {
        for (const { suffix, scale } of RESOLUTIONS) {
            const page = await browser.newPage({
                viewport: { width: WIDTH, height: HEIGHT },
                deviceScaleFactor: scale
            });
            await page.goto(`${SOURCE.href}?variant=${variant}`);
            const outputPath = path.join(DMG_DIR, `${baseName}${suffix}.png`);
            await page.screenshot({ path: outputPath, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
            await page.close();
            console.log(`[${variant} ${scale}x] ${outputPath}`);
        }
    }
} finally {
    await browser.close();
}
