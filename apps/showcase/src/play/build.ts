import fs from "fs";
import path from "path";
import type { Browser } from "playwright";
import { pathToFileURL } from "url";

import { openApp, openNote, renderTemplate, setOption, settle } from "../shared/browser.ts";
import {
    type BuildOptions, type Builder, checkList, outDir, reportChecks, sceneFileName, templatesDir
} from "../shared/build.ts";
import { findNoteId, openDemo } from "../shared/demo_server.ts";
import { describePng, readPng } from "../shared/png.ts";
import { DEVICES, type Scene, SCENES } from "../shared/scenes.ts";

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

interface StoreShot {
    device: string;
    file: string;
    alt: string;
}

/** The size of a phone screenshot with its caption, which the store needs for promotion. */
const CAPTIONED_SIZE = { width: 1080, height: 1920 };

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
    reportChecks(runChecks(listStoreShots(), await measureCaptions(browser)));
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
        for (const deviceName of options.devices) {
            await captureDevice(browser, options, server.baseUrl, deviceName);
        }
    } finally {
        server.stop();
    }
}

async function buildFeature(browser: Browser) {
    const shots = listing.featureGraphic.shots
        .map((id) => rawShotPath("phone", id))
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
    const data = { listing, screenshots: listStoreShots() };
    const script = `window.LISTING = ${JSON.stringify(data, null, 4)};\n`;
    fs.writeFileSync(path.join(outDir, "listing-data.js"), script);
    fs.copyFileSync(path.join(templatesDir, "preview.html"), path.join(outDir, "preview.html"));
    fs.copyFileSync(path.join(templatesDir, "common.css"), path.join(outDir, "common.css"));
    console.log(`  Open ${path.join(outDir, "preview.html")}`);
}

/** The store screenshots on disk, in listing order, with their alt text. */
function listStoreShots(): StoreShot[] {
    const screenshots: StoreShot[] = [];
    for (const deviceName of Object.keys(DEVICES)) {
        for (const [ index, scene ] of SCENES.entries()) {
            const file = storeShotPath(deviceName, index, scene.id);
            if (fs.existsSync(file)) {
                const relative = path.relative(outDir, file);
                const { alt } = sceneOn(scene, deviceName);
                screenshots.push({ device: deviceName, file: relative, alt });
            }
        }
    }
    return screenshots;
}

async function captureDevice(browser: Browser, options: BuildOptions, baseUrl: string,
    deviceName: string) {
    const device = DEVICES[deviceName];
    const scenes = SCENES.filter((scene) => options.only?.includes(scene.id) ?? true);
    for (const listed of scenes) {
        const index = SCENES.indexOf(listed);
        const scene = sceneOn(listed, deviceName);
        const colorScheme = scene.colorScheme ?? "light";
        const context = await browser.newContext({
            viewport: device.viewport,
            deviceScaleFactor: device.deviceScaleFactor,
            isMobile: true,
            hasTouch: true,
            userAgent: device.userAgent,
            colorScheme
        });
        await context.addCookies([ { name: "trilium-device", value: "mobile", url: baseUrl } ]);
        const page = await context.newPage();
        page.on("pageerror", (error) => {
            console.warn(`  [${deviceName}/${scene.id}] page error: ${error.message}`);
        });

        const noteId = await findNoteId(baseUrl, scene.query);
        await openApp(page, baseUrl);
        await openNote(page, noteId);
        await settle(page);
        await scene.prepare?.(page);
        await settle(page, { blur: !scene.keepFocus });

        const store = storeShotPath(deviceName, index, scene.id);
        const raw = device.captioned ? rawShotPath(deviceName, scene.id) : store;
        fs.mkdirSync(path.dirname(raw), { recursive: true });
        await page.screenshot({ path: raw });
        await context.close();

        if (device.captioned) {
            await renderTemplate(browser, "screenshot.html", CAPTIONED_SIZE, store, {
                caption: scene.caption,
                shot: pathToFileURL(raw).href,
                dark: colorScheme === "dark"
            });
        }
        console.log(`  ${path.relative(outDir, store)}`);
    }
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
            const png = readPng(path.join(outDir, shot.file));
            if (!png) continue;
            const long = Math.max(png.width, png.height);
            const short = Math.min(png.width, png.height);
            const rule = "16:9 or 9:16, at least 1080 px, no alpha, at most 8 MB";
            check(shot.file, rule, describePng(png),
                short >= 1080 && long <= 3840 && Math.abs(long / short - 16 / 9) < 0.01
                && !png.alpha && png.size <= 8 * 1024 * 1024);
            checkLength(`${shot.file} alt text`, shot.alt, 140);
        }
    }
    for (const [ id, lines ] of captionLines) {
        check(`${id} caption`, "two lines on the phone", `${lines} lines`, lines === 2);
    }
    return checks;
}

/** The scene as the device shows it: on the tablet, with `scene.tablet` in place. */
function sceneOn(scene: Scene, deviceName: string): Scene {
    return deviceName === "tablet" && scene.tablet ? { ...scene, ...scene.tablet } : scene;
}

/**
 * The number of lines each scene's caption takes above the phone screenshot, by scene ID. The
 * caption's text runs are counted by their distinct tops.
 */
async function measureCaptions(browser: Browser) {
    const page = await browser.newPage({ viewport: CAPTIONED_SIZE, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(path.join(templatesDir, "screenshot.html")).href);
    const lines = new Map<string, number>();
    for (const scene of SCENES) {
        lines.set(scene.id, await page.evaluate(async (caption) => {
            window.render?.({ caption, shot: "", dark: false });
            const heading = document.getElementById("caption");
            if (!heading) return 0;
            // Reading the layout starts the font loads that `document.fonts.ready` waits for.
            void heading.offsetHeight;
            await document.fonts.ready;
            const range = document.createRange();
            range.selectNodeContents(heading);
            return new Set([ ...range.getClientRects() ].map((rect) => Math.round(rect.top))).size;
        }, scene.caption));
    }
    await page.close();
    return lines;
}

function rawShotPath(deviceName: string, sceneId: string) {
    return path.join(outDir, "screenshots", deviceName, "raw", `${sceneId}.png`);
}

function storeShotPath(deviceName: string, index: number, sceneId: string) {
    return path.join(outDir, "screenshots", deviceName, sceneFileName(index, sceneId));
}
