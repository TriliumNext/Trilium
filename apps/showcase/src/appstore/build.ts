import fs from "fs";
import path from "path";
import type { Browser } from "playwright";

import { setOption } from "../shared/browser.ts";
import {
    type BuildOptions, type Builder, checkList, outDir, repoRoot, reportChecks, templatesDir
} from "../shared/build.ts";
import { openDemo } from "../shared/demo_server.ts";
import { describePng, readPng } from "../shared/png.ts";
import { APP_STORE_DEVICES } from "../shared/scenes.ts";
import {
    captureStoreShots, listStoreShots, measureCaptions, type StoreShot
} from "../shared/store_shots.ts";

const shotsDir = path.join(outDir, "appstore");

const listing: Listing = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, "listing.json"), "utf8"));

/** The texts of the App Store product page, which `listing.json` holds. */
interface Listing {
    name: string;
    subtitle: string;
    /** The seller shown on the product page, which the developer account sets. */
    developer: string;
    category: string;
    promotionalText: string;
    description: string;
    /** Comma-separated, without the words of the name, which the store already searches. */
    keywords: string;
}

/**
 * The App Store Connect upload takes the icon from the app's asset catalog, not from the listing,
 * so the build checks that one.
 */
const appIcon = path.join(repoRoot,
    "apps/mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png");

/**
 * The accepted screenshot sizes of each display, portrait, from the App Store Connect help on
 * screenshot specifications. Landscape is the same sizes turned.
 */
const ACCEPTED_SIZES: Record<string, [ number, number ][]> = {
    iphone: [ [ 1260, 2736 ], [ 1290, 2796 ], [ 1320, 2868 ] ],
    ipad: [ [ 2064, 2752 ], [ 2048, 2732 ] ]
};

/**
 * The App Store targets: iPhone and iPad screenshots of the demo document under their captions in
 * `out/appstore`, and `out/appstore-preview.html`, a mock of the product page.
 */
export const APP_STORE_TARGETS: Record<string, Builder> = {
    "appstore-screenshots": buildScreenshots,
    "appstore-preview": buildPreview
};

/**
 * Checks the App Store assets on disk and the listing texts against App Store Connect's limits
 * and fails the build when one of them is not met.
 */
export async function checkAppStoreAssets(browser: Browser) {
    console.log("Checking the App Store assets...");
    const shots = listStoreShots(shotsDir, APP_STORE_DEVICES);
    reportChecks(runChecks(shots, await measureCaptions(browser, APP_STORE_DEVICES)));
}

async function buildScreenshots(browser: Browser, options: BuildOptions) {
    const server = await openDemo(browser, options);
    try {
        await setOption(browser, server.baseUrl, "rightPaneVisible", "false");
        await captureStoreShots(browser, options, server.baseUrl, APP_STORE_DEVICES, shotsDir);
    } finally {
        server.stop();
    }
}

function buildPreview() {
    const screenshots = listStoreShots(shotsDir, APP_STORE_DEVICES).map(({ device, file }) => ({
        device, file: path.join("appstore", file)
    }));
    const script = `window.LISTING = ${JSON.stringify({ listing, screenshots }, null, 4)};\n`;
    fs.writeFileSync(path.join(outDir, "appstore-data.js"), script);
    fs.mkdirSync(shotsDir, { recursive: true });
    fs.copyFileSync(appIcon, path.join(shotsDir, "icon.png"));
    for (const file of [ "appstore-preview.html", "common.css" ]) {
        fs.copyFileSync(path.join(templatesDir, file), path.join(outDir, file));
    }
    console.log(`  Open ${path.join(outDir, "appstore-preview.html")}`);
}

/** The store's limits, from the App Store Connect help on platform version information. */
function runChecks(screenshots: StoreShot[], captionLines: Map<string, number>) {
    const { checks, check } = checkList();
    const checkLength = (asset: string, text: string, max: number) => {
        const rule = `at most ${max.toLocaleString("en")} characters`;
        check(asset, rule, text.length, text.length <= max);
    };

    checkLength("Name", listing.name, 30);
    checkLength("Subtitle", listing.subtitle, 30);
    checkLength("Promotional text", listing.promotionalText, 170);
    checkLength("Description", listing.description, 4000);
    const keywordBytes = Buffer.byteLength(listing.keywords);
    check("Keywords", "at most 100 bytes", `${keywordBytes} bytes`, keywordBytes <= 100);
    const nameWords = listing.name.toLowerCase().split(" ");
    const repeated = listing.keywords.split(",").filter((word) => nameWords.includes(word));
    check("Keywords", "no word of the name", repeated.join(", ") || "none", !repeated.length);

    const icon = readPng(appIcon);
    check("App icon", "1024 x 1024 PNG without alpha", describePng(icon),
        icon?.width === 1024 && icon.height === 1024 && !icon.alpha);

    for (const [ device, sizes ] of Object.entries(ACCEPTED_SIZES)) {
        const shots = screenshots.filter((shot) => shot.device === device);
        check(`${device} screenshots`, "1 to 10", shots.length,
            shots.length >= 1 && shots.length <= 10);
        const rule = `${sizes.map(([ width, height ]) => `${width} x ${height}`).join(", ")}`
            + " in either orientation, no alpha";
        for (const shot of shots) {
            const png = readPng(path.join(shotsDir, shot.file));
            if (!png) continue;
            const accepted = sizes.some(([ width, height ]) =>
                (png.width === width && png.height === height)
                || (png.width === height && png.height === width));
            check(shot.file, rule, describePng(png), accepted && !png.alpha);
        }
    }
    for (const [ id, lines ] of captionLines) {
        check(`${id} caption`, "two lines", `${lines} lines`, lines === 2);
    }
    return checks;
}
