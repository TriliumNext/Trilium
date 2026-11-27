import fs from "fs";
import path from "path";
import type { Browser } from "playwright";
import { pathToFileURL } from "url";

import { renderTemplate, setOption } from "../shared/browser.ts";
import {
    type BuildOptions, type Builder, checkList, outDir, reportChecks, templatesDir
} from "../shared/build.ts";
import { openDemo } from "../shared/demo_server.ts";
import { describePng, readPng } from "../shared/png.ts";
import { DEVICES } from "../shared/scenes.ts";
import {
    captureStoreShots, listStoreShots, measureCaptions, rawShotPath, type StoreShot
} from "../shared/store_shots.ts";

const shotsDir = path.join(outDir, "screenshots");

const listing: Listing = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, "listing.json"), "utf8"));

/** The texts of the store listing, which `listing.json` holds. */
interface Listing {
    name: string;
    developer: string;
    category: string;
    shortDescription: string;
    fullDescription: string;
    featureGraphic: { tagline: string; taglineSub: string; alt: string; shots: string[] };
}

/**
 * The Google Play targets, in build order: the 512 x 512 icon, phone and tablet screenshots of the
 * demo document, the 1024 x 500 feature graphic made from the phone ones, and `out/preview.html`,
 * a mock of the listing page.
 */
export const PLAY_TARGETS: Record<string, Builder> = {
    "icon": buildIcon,
    "screenshots": buildScreenshots,
    "feature": buildFeature,
    "preview": buildPreview
};

/**
 * Checks the store assets on disk against the Play Console's limits and fails the build when one
 * of them is not met.
 */
export async function checkPlayAssets(browser: Browser) {
    console.log("Checking the Play Store assets...");
    const shots = listStoreShots(shotsDir, DEVICES);
    reportChecks(runChecks(shots, await measureCaptions(browser, DEVICES)));
}

/**
 * The store asks for a 32-bit PNG, but Chromium writes an opaque screenshot as 24-bit, so the
 * screenshot is encoded again through a canvas, which keeps the alpha channel.
 */
async function buildIcon(browser: Browser) {
    const output = path.join(outDir, "icon.png");
    await renderTemplate(browser, "icon.html", { width: 512, height: 512 }, output, {});
    const page = await browser.newPage();
    const dataUrl = await page.evaluate(async (source) => {
        const image = new Image();
        image.src = source;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        canvas.getContext("2d")?.drawImage(image, 0, 0);
        return canvas.toDataURL("image/png");
    }, `data:image/png;base64,${fs.readFileSync(output).toString("base64")}`);
    await page.close();
    fs.writeFileSync(output, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
}

async function buildScreenshots(browser: Browser, options: BuildOptions) {
    const server = await openDemo(browser, options);
    try {
        await setOption(browser, server.baseUrl, "rightPaneVisible", "false");
        await captureStoreShots(browser, options, server.baseUrl, DEVICES, shotsDir);
    } finally {
        server.stop();
    }
}

async function buildFeature(browser: Browser) {
    const shots = listing.featureGraphic.shots
        .map((id) => rawShotPath(shotsDir, "phone", id))
        .filter((file) => {
            const exists = fs.existsSync(file);
            if (!exists) {
                const name = path.relative(outDir, file);
                console.warn(`  ${name} is missing; build the phone screenshots first.`);
            }
            return exists;
        })
        .map((file) => pathToFileURL(file).href);
    const output = path.join(outDir, "feature-graphic.png");
    await renderTemplate(browser, "feature.html", { width: 1024, height: 500 }, output, {
        tagline: listing.featureGraphic.tagline,
        taglineSub: listing.featureGraphic.taglineSub,
        shots
    });
}

function buildPreview() {
    const screenshots = listStoreShots(shotsDir, DEVICES).map(({ device, file, scene }) => ({
        device, file: path.join("screenshots", file), alt: scene.alt
    }));
    const data = { listing, screenshots };
    const script = `window.LISTING = ${JSON.stringify(data, null, 4)};\n`;
    fs.writeFileSync(path.join(outDir, "listing-data.js"), script);
    fs.copyFileSync(path.join(templatesDir, "preview.html"), path.join(outDir, "preview.html"));
    fs.copyFileSync(path.join(templatesDir, "common.css"), path.join(outDir, "common.css"));
    console.log(`  Open ${path.join(outDir, "preview.html")}`);
}

/** The store's limits, from the Play Console help on preview assets and on store listing text. */
function runChecks(screenshots: StoreShot[], captionLines: Map<string, number>) {
    const { checks, check } = checkList();
    const checkLength = (asset: string, text: string, max: number) => {
        const rule = `at most ${max.toLocaleString("en")} characters`;
        check(asset, rule, text.length, text.length <= max);
    };

    checkLength("App name", listing.name, 30);
    checkLength("Short description", listing.shortDescription, 80);
    checkLength("Full description", listing.fullDescription, 4000);
    checkLength("Feature graphic alt text", listing.featureGraphic.alt, 140);

    const icon = readPng(path.join(outDir, "icon.png"));
    check("Icon", "512 x 512 PNG with alpha, at most 1 MB", describePng(icon),
        icon?.width === 512 && icon.height === 512 && icon.alpha && icon.size <= 1024 * 1024);
    const feature = readPng(path.join(outDir, "feature-graphic.png"));
    check("Feature graphic", "1024 x 500 PNG without alpha", describePng(feature),
        feature?.width === 1024 && feature.height === 500 && !feature.alpha);

    for (const [ device, minCount ] of [ [ "phone", 4 ], [ "tablet", 4 ] ] as const) {
        const shots = screenshots.filter((shot) => shot.device === device);
        check(`${device} screenshots`, `${minCount} to 8 for promotion`, shots.length,
            shots.length >= minCount && shots.length <= 8);
        for (const shot of shots) {
            const png = readPng(path.join(shotsDir, shot.file));
            if (!png) continue;
            const long = Math.max(png.width, png.height);
            const short = Math.min(png.width, png.height);
            const rule = "16:9 or 9:16, at least 1080 px, no alpha, at most 8 MB";
            check(shot.file, rule, describePng(png),
                short >= 1080 && long <= 3840 && Math.abs(long / short - 16 / 9) < 0.01
                && !png.alpha && png.size <= 8 * 1024 * 1024);
            checkLength(`${shot.file} alt text`, shot.scene.alt, 140);
        }
    }
    for (const [ id, lines ] of captionLines) {
        check(`${id} caption`, "two lines", `${lines} lines`, lines === 2);
    }
    return checks;
}
