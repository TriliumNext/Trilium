/**
 * Renders the DMG preview(s) — faithful mocks of the assembled Finder window, one per channel
 * (preview.png for stable, preview-dev.png for nightly), so the "what the DMG looks like"
 * reference is reproducible from source. Regenerate with: pnpm --filter desktop generate-dmg-preview
 *
 * Documentation only: appdmg never sees these (it uses background.png/@2x).
 *
 * PIXEL FIDELITY. The icon positions mirror the REAL DMG, read back from a built disk image's
 * `.DS_Store`: Finder `Iloc` records use a TOP-LEFT origin, y down, and (x, y) is the icon CENTER
 * (confirmed by appdmg's own example: y=344 sits near the *bottom*). So the `contents` coordinates
 * in forge.config.ts are top-left, not bottom-left. The window chrome (title bar, traffic lights,
 * title, volume-icon mark) is drawn by Finder/macOS, not appdmg — reconstructed here only so the
 * reference reads as a real window.
 */
import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

import { chromium } from "@playwright/test";

const DMG_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ICON_DIR = path.join(DMG_DIR, "..", "app-icon");
const DMG_ICON_DIR = path.join(DMG_DIR, "..", "dmg-icon");

// --- Layout: mirrors the real DMG (keep in sync with forge.config.ts) ---
const WIDTH = 640; // content = the background image
const HEIGHT = 400;
const ICON = 128; // forge.config `iconSize`
const TITLEBAR = 28; // Finder-drawn chrome (illustrative)
const MARGIN = 44; // transparent padding around the window for its drop shadow
const ICON_Y = 182; // icon centers; keep in sync with `contents` in forge.config.ts

const APP = { x: 180, label: "Trilium Notes" };
const APPS = { x: 460, label: "Applications" };
const APPLICATIONS_ICNS = "/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/ApplicationsFolderIcon.icns";

const VARIANTS = [
    { bg: "background.png", icns: "icon.icns", pngFallback: "128x128.png", volumeIcns: "volume.icns", out: "preview.png" },
    { bg: "background-dev.png", icns: "icon-dev.icns", pngFallback: "128x128-dev.png", volumeIcns: "volume-dev.icns", out: "preview-dev.png" }
];

// Drawn stand-in used only when the real macOS Applications icon isn't available.
const FOLDER_FALLBACK = `<svg class="icon" viewBox="0 0 128 128" aria-hidden="true">
  <defs>
    <linearGradient id="fb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#57a7e8"/><stop offset="1" stop-color="#3f8ed6"/></linearGradient>
    <linearGradient id="ff" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fcbf5"/><stop offset="1" stop-color="#63b0ee"/></linearGradient>
  </defs>
  <path fill="url(#fb)" d="M14 20 h34 l9 9 h57 a13 13 0 0 1 13 13 v46 a13 13 0 0 1 -13 13 H14 a13 13 0 0 1 -13 -13 V33 a13 13 0 0 1 13 -13 z"/>
  <path fill="url(#ff)" d="M1 50 h126 v51 a13 13 0 0 1 -13 13 H14 a13 13 0 0 1 -13 -13 z"/>
</svg>`;

const work = mkdtempSync(path.join(tmpdir(), "dmg-preview-"));
const appsIconHref = extractIcns(APPLICATIONS_ICNS, work, "applications.png");

const browser = await chromium.launch();
try {
    const page = await browser.newPage({
        viewport: { width: WIDTH + 2 * MARGIN, height: HEIGHT + TITLEBAR + 2 * MARGIN },
        deviceScaleFactor: 2
    });
    for (const variant of VARIANTS) {
        // Serve the HTML from a file:// origin so the browser allows the file:// image resources.
        const htmlPath = path.join(work, `${variant.out}.html`);
        writeFileSync(htmlPath, buildHtml(variant));
        await page.goto(pathToFileURL(htmlPath).href);
        await page.waitForLoadState("networkidle");
        const outputPath = path.join(DMG_DIR, variant.out);
        await page.screenshot({ path: outputPath, omitBackground: true });
        console.log(outputPath);
    }
} finally {
    await browser.close();
    rmSync(work, { recursive: true, force: true });
}

/** Renders an .icns to a 256px PNG via macOS `sips`; returns null when unavailable. */
function extractIcns(icns, workDir, outName) {
    if (process.platform !== "darwin" || !existsSync(icns)) {
        return null;
    }
    try {
        const out = path.join(workDir, outName);
        execFileSync("sips", ["-s", "format", "png", icns, "--resampleWidth", "256", "--out", out], { stdio: "ignore" });
        return pathToFileURL(out).href;
    } catch {
        return null;
    }
}

function buildHtml(variant) {
    const bgHref = pathToFileURL(path.join(DMG_DIR, variant.bg)).href;
    const appIconHref =
        extractIcns(path.join(APP_ICON_DIR, variant.icns), work, `app-${variant.out}.png`) ??
        pathToFileURL(path.join(APP_ICON_DIR, "png", variant.pngFallback)).href;
    const appsGlyph = appsIconHref ? `<img class="icon" src="${appsIconHref}">` : FOLDER_FALLBACK;
    // Finder titles the window with the VOLUME icon — the drive, not the app icon.
    const volumeHref = extractIcns(path.join(DMG_ICON_DIR, variant.volumeIcns), work, `vol-${variant.out}.png`);
    const volumeGlyph = volumeHref ? `<img class="volume" src="${volumeHref}">` : "";
    return `<!doctype html><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; background: transparent; }
    .stage { padding: ${MARGIN}px; width: ${WIDTH}px; }
    .win {
        border-radius: 10px; overflow: hidden;
        box-shadow: 0 22px 60px rgba(0, 0, 0, 0.5), 0 0 0 0.5px rgba(0, 0, 0, 0.35);
        font-family: -apple-system, "SF Pro Text", system-ui, sans-serif;
    }
    .titlebar {
        position: relative; height: ${TITLEBAR}px;
        background: linear-gradient(180deg, #f6f6f6 0%, #e7e7e7 100%);
        border-bottom: 1px solid #cdcdcd;
        display: flex; align-items: center; justify-content: center;
    }
    .lights { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); display: flex; gap: 8px; }
    .lights i { width: 12px; height: 12px; border-radius: 50%; box-shadow: inset 0 0 0 0.5px rgba(0,0,0,0.12); }
    .lights .r { background: #ff5f57; } .lights .y { background: #febc2e; } .lights .g { background: #28c840; }
    .title { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: #3a3a3a; }
    .title .volume { width: 16px; height: 16px; display: block; }
    .content { position: relative; width: ${WIDTH}px; height: ${HEIGHT}px; }
    .content .bg { position: absolute; inset: 0; width: ${WIDTH}px; height: ${HEIGHT}px; }
    .item { position: absolute; width: ${ICON}px; height: ${ICON}px; transform: translate(-50%, -50%); }
    .item .icon { width: ${ICON}px; height: ${ICON}px; display: block; }
    /* A background picture forces Finder to draw icon captions in black (in both light and dark
       system themes), which is why this preview renders them black. The light background keeps
       both captions legible on their own — no per-label plate needed. */
    .item .label {
        position: absolute; left: 50%; top: ${ICON + 6}px; transform: translateX(-50%);
        white-space: nowrap; font-size: 13px; font-weight: 500; color: #1d1d1f;
    }
</style>
<div class="stage"><div class="win">
    <div class="titlebar">
        <span class="lights"><i class="r"></i><i class="y"></i><i class="g"></i></span>
        <span class="title">${volumeGlyph} Trilium Notes</span>
    </div>
    <div class="content">
        <img class="bg" src="${bgHref}">
        <div class="item" style="left:${APP.x}px;top:${ICON_Y}px">
            <img class="icon" src="${appIconHref}"><div class="label">${APP.label}</div>
        </div>
        <div class="item" style="left:${APPS.x}px;top:${ICON_Y}px">
            ${appsGlyph}<div class="label">${APPS.label}</div>
        </div>
    </div>
</div></div>`;
}
