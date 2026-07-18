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

// Leaf `d` paths for the title-bar volume-icon mark (order: g1 g2 g3 o1 o2 o3 r1 r2 r3), plus the
// stable and nightly fills — reused from background.html's mark.
const LEAF_PATHS = [
    "m202.9 112.7c-22.5 16.1-54.5 12.8-74.9 6.3l14.8-11.8 14.1-11.3 49.1-39.3-51.2 35.9-14.3 10-14.9 10.5c0.7-21.2 7-49.9 28.6-65.4 1.8-1.3 3.9-2.6 6.1-3.8 2.7-1.5 5.7-2.9 8.8-4.1 27.1-11.1 68.5-15.3 85.2-9.5 0.1 16.2-15.9 45.4-33.9 65.9-2.4 2.8-4.9 5.4-7.4 7.8-3.4 3.5-6.8 6.4-10.1 8.8z",
    "m213.1 104c-22.2 12.6-51.4 9.3-70.3 3.2l14.1-11.3 49.1-39.3-51.2 35.9-14.3 10c0.5-18.1 4.9-42.1 19.7-58.6 2.7-1.5 5.7-2.9 8.8-4.1 27.1-11.1 68.5-15.3 85.2-9.5 0.1 16.2-15.9 45.4-33.9 65.9-2.3 2.8-4.8 5.4-7.2 7.8z",
    "m220.5 96.2c-21.1 8.6-46.6 5.3-63.7-0.2l49.2-39.4-51.2 35.9c0.3-15.8 3.5-36.6 14.3-52.8 27.1-11.1 68.5-15.3 85.2-9.5 0.1 16.2-15.9 45.4-33.8 66z",
    "m86.3 59.1c21.7 10.9 32.4 36.6 35.8 54.9l-15.2-6.6-14.5-6.3-50.6-22 48.8 24.9 13.6 6.9 14.3 7.3c-16.6 7.9-41.3 14.5-62.1 4.1-1.8-0.9-3.6-1.9-5.4-3.2-2.3-1.5-4.5-3.2-6.8-5.1-19.9-16.4-40.3-46.4-42.7-61.5 12.4-6.5 41.5-5.8 64.8-0.3 3.2 0.8 6.2 1.6 9.1 2.5 4 1.3 7.6 2.8 10.9 4.4z",
    "m75.4 54.8c18.9 12 28.4 35.6 31.6 52.6l-14.5-6.3-50.6-22 48.7 24.9 13.6 6.9c-14.1 6.8-34.5 13-53.3 8.2-2.3-1.5-4.5-3.2-6.8-5.1-19.8-16.4-40.2-46.4-42.6-61.5 12.4-6.5 41.5-5.8 64.8-0.3 3.1 0.8 6.2 1.6 9.1 2.6z",
    "m66.3 52.2c15.3 12.8 23.3 33.6 26.1 48.9l-50.6-22 48.8 24.9c-12.2 6-29.6 11.8-46.5 10-19.8-16.4-40.2-46.4-42.6-61.5 12.4-6.5 41.5-5.8 64.8-0.3z",
    "m106.7 179c-5.8-21 5.2-43.8 15.5-57.2l4.8 14.2 4.5 13.4 15.9 47-12.8-47.6-3.6-13.2-3.7-13.9c15.5 6.2 35.1 18.6 40.7 38.8 0.5 1.7 0.9 3.6 1.2 5.5 0.4 2.4 0.6 5 0.7 7.7 0.9 23.1-7.1 54.9-15.9 65.7-12-4.3-29.3-24-39.7-42.8-1.4-2.6-2.7-5.1-3.8-7.6-1.6-3.5-2.9-6.8-3.8-10z",
    "m110.4 188.9c-3.4-19.8 6.9-40.5 16.6-52.9l4.5 13.4 15.9 47-12.8-47.6-3.6-13.2c13.3 5.2 29.9 15 38.1 30.4 0.4 2.4 0.6 5 0.7 7.7 0.9 23.1-7.1 54.9-15.9 65.7-12-4.3-29.3-24-39.7-42.8-1.4-2.6-2.7-5.2-3.8-7.7z",
    "m114.2 196.5c-0.7-18 8.6-35.9 17.3-47.1l15.9 47-12.8-47.6c11.6 4.4 26.1 12.4 35.2 24.8 0.9 23.1-7.1 54.9-15.9 65.7-12-4.3-29.3-24-39.7-42.8z"
];
const STABLE_LEAVES = ["#95c980", "#72b755", "#4fa52b", "#efb075", "#e99547", "#e47b19", "#ee8c89", "#e96562", "#e33f3b"];
const NIGHTLY_LEAVES = ["#b18ad6", "#9159c4", "#6e2ea8", "#c09fe0", "#a276cf", "#8146b8", "#cdb2e4", "#b08fd6", "#9668c2"];

const VARIANTS = [
    { bg: "background.png", icns: "icon.icns", pngFallback: "128x128.png", leaves: STABLE_LEAVES, out: "preview.png" },
    { bg: "background-dev.png", icns: "icon-dev.icns", pngFallback: "128x128-dev.png", leaves: NIGHTLY_LEAVES, out: "preview-dev.png" }
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

/** The trillium leaf mark for the title bar, coloured for the given channel. */
function trilliumMark(leaves) {
    const paths = LEAF_PATHS.map((d, i) => `<path fill="${leaves[i]}" d="${d}"/>`).join("");
    return `<svg viewBox="0 0 256 256" aria-hidden="true">${paths}</svg>`;
}

function buildHtml(variant) {
    const bgHref = pathToFileURL(path.join(DMG_DIR, variant.bg)).href;
    const appIconHref =
        extractIcns(path.join(APP_ICON_DIR, variant.icns), work, `app-${variant.out}.png`) ??
        pathToFileURL(path.join(APP_ICON_DIR, "png", variant.pngFallback)).href;
    const appsGlyph = appsIconHref ? `<img class="icon" src="${appsIconHref}">` : FOLDER_FALLBACK;
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
    .title svg { width: 16px; height: 16px; display: block; }
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
        <span class="title">${trilliumMark(variant.leaves)} Trilium Notes</span>
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
