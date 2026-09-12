/**
 * Renders the volume-icon previews — so the icon can be judged without building a DMG (which needs
 * macOS + appdmg) or mounting one.
 *
 * Run with: pnpm --filter desktop generate-dmg-icon-preview
 *
 *   preview-large.png  the icon at Finder icon-view / desktop-mount size, both channels
 *   preview-small.png  the sizes Finder actually paints small — the DMG window's title bar and the
 *                      sidebar — at 1:1, with the 16 and 32 slots magnified so the pixels are
 *                      inspectable (a 16px image on its own tells you nothing)
 *
 * Documentation only: appdmg never sees these, it only reads the .icns.
 *
 * FIDELITY. The slots are extracted from the committed .icns rather than re-rendered from
 * volume-icon.html, so what you are looking at is what actually ships — this doubles as a check
 * that the packed file contains what we think it does. The window chrome is drawn by Finder, not
 * by us; it is reconstructed here only so the small sizes are shown in the context they appear in.
 *
 * Extraction uses `iconutil`, so this is macOS-only. Elsewhere the committed PNGs are left alone —
 * same stance as generate.mts, and no worse than the status quo, since the DMG can only be built
 * on macOS anyway.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

import { chromium } from "@playwright/test";

const DMG_ICON_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Keep in sync with the volume name appdmg gives the image (the app's product name). */
const VOLUME_NAME = "Trilium Notes";
const TITLEBAR_HEIGHT = 28;
const ZOOM = 6; // magnification for the small slots

const PAGE_CSS = `
    html, body { margin: 0; padding: 0; }
    body {
        background: #ffffff; color: #1d1d1f;
        font-family: -apple-system, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        /* min-height, not height: the shot is taken fullPage, so the viewport is a floor rather
           than a clip — content taller than it extends the image instead of being cut off. */
        min-height: 100vh; padding: 30px; box-sizing: border-box;
    }
    .caption { font-size: 12px; color: #6b6b70; }
    .channel-name { font-size: 13px; font-weight: 600; }
`;

const CHANNELS = [
    { label: "Stable", icns: "volume.icns" },
    { label: "Nightly", icns: "volume-dev.icns" }
];

if (process.platform !== "darwin") {
    console.warn("dmg-icon previews need `iconutil` (macOS-only);"
        + " leaving the committed PNGs alone");
    process.exit(0);
}

const work = mkdtempSync(path.join(tmpdir(), "dmg-icon-preview-"));
try {
    for (const channel of CHANNELS) {
        const iconsetDir = path.join(work, `${channel.label}.iconset`);
        const icns = path.join(DMG_ICON_DIR, channel.icns);
        execFileSync("iconutil", ["-c", "iconset", icns, "-o", iconsetDir]);
        channel.slot = (name) => pathToFileURL(path.join(iconsetDir, name)).href;
    }

    const browser = await chromium.launch();
    try {
        await shoot(browser, buildLarge(), "preview-large.png", 640, 400);
        await shoot(browser, buildSmall(), "preview-small.png", 760, 420);
    } finally {
        await browser.close();
    }
} finally {
    rmSync(work, { recursive: true, force: true });
}

async function shoot(browser, html, outName, width, height) {
    const htmlPath = path.join(work, `${outName}.html`);
    writeFileSync(htmlPath, html);
    // Served from a file:// origin so the browser is allowed to load the file:// slot images.
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
    await page.goto(pathToFileURL(htmlPath).href);
    const outputPath = path.join(DMG_ICON_DIR, outName);
    await page.screenshot({ path: outputPath, fullPage: true });
    await page.close();
    console.log(outputPath);
}

/** The icon at the size Finder shows it on the desktop / in icon view. */
function buildLarge() {
    // The 512 slot displayed at 256 CSS px on a 2x page is pixel-exact — no resampling.
    const columns = CHANNELS.map((c) => `
        <div class="col">
            <img class="icon" src="${c.slot("icon_512x512.png")}">
            <div class="channel-name">${c.label}</div>
            <div class="caption">256 pt</div>
        </div>`).join("");
    return `<!doctype html><meta charset="utf-8"><style>${PAGE_CSS}
        .row { display: flex; gap: 72px; }
        .col { display: flex; flex-direction: column; align-items: center; gap: 10px; }
        .icon { width: 256px; height: 256px; }
    </style><div class="row">${columns}</div>`;
}

/** The two places Finder paints the volume icon small, plus magnified slots. */
function buildSmall() {
    const rows = CHANNELS.map((c) => `
        <div class="block">
            <div class="channel-name">${c.label}</div>
            <div class="titlebar">
                <span class="lights"><i class="r"></i><i class="y"></i><i class="g"></i></span>
                <span class="title"><img src="${c.slot("icon_16x16.png")}"> ${VOLUME_NAME}</span>
            </div>
            <div class="caption">DMG window title bar, 1:1</div>
            <div class="zoom-row">
                <div class="zoom-col">
                    <img class="zoom" src="${c.slot("icon_16x16.png")}" width="${16 * ZOOM}">
                    <div class="caption">16 pt @${ZOOM}x</div>
                </div>
                <div class="zoom-col">
                    <img class="zoom" src="${c.slot("icon_32x32.png")}" width="${32 * ZOOM}">
                    <div class="caption">32 pt @${ZOOM}x</div>
                </div>
                <div class="zoom-col sidebar">
                    <span class="sidebar-row">
                        <img src="${c.slot("icon_16x16.png")}"> ${VOLUME_NAME}
                    </span>
                    <div class="caption">sidebar, 1:1</div>
                </div>
            </div>
        </div>`).join("");
    return `<!doctype html><meta charset="utf-8"><style>${PAGE_CSS}
        body { gap: 34px; }
        .block { display: flex; flex-direction: column; align-items: center; gap: 7px; }
        .titlebar {
            position: relative; width: 340px; height: ${TITLEBAR_HEIGHT}px; margin-top: 3px;
            background: linear-gradient(180deg, #f6f6f6 0%, #e7e7e7 100%);
            border: 1px solid #cdcdcd; border-radius: 8px 8px 0 0;
            display: flex; align-items: center; justify-content: center;
        }
        .lights {
            position: absolute; left: 11px; top: 50%; transform: translateY(-50%);
            display: flex; gap: 7px;
        }
        .lights i {
            width: 11px; height: 11px; border-radius: 50%;
            box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, 0.12);
        }
        .lights .r { background: #ff5f57; }
        .lights .y { background: #febc2e; }
        .lights .g { background: #28c840; }
        .title {
            display: flex; align-items: center; gap: 5px;
            font-size: 13px; font-weight: 600; color: #3a3a3a;
        }
        .title img { width: 16px; height: 16px; }
        .zoom-row { display: flex; align-items: flex-end; gap: 26px; margin-top: 9px; }
        .zoom-col { display: flex; flex-direction: column; align-items: center; gap: 7px; }
        /* Nearest-neighbour: the point is to see the actual pixels, not a smoothed idea of them. */
        .zoom { image-rendering: pixelated; }
        .sidebar-row {
            display: flex; align-items: center; gap: 6px; font-size: 13px;
            background: #f2f2f4; border-radius: 6px; padding: 7px 11px;
        }
        .sidebar-row img { width: 16px; height: 16px; }
    </style>${rows}`;
}
