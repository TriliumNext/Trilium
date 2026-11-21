#!/usr/bin/env node
/**
 * Builds the Google Play store listing assets: the 512 x 512 icon, the 1024 x 500 feature graphic,
 * phone and tablet screenshots of the demo document, and a preview page of the whole listing with
 * the store's size and length checks.
 *
 * Usage:
 *   pnpm --filter @triliumnext/mobile store-assets [icon] [feature] [screenshots] [preview]
 *       [--only tree,text] [--devices phone,tablet] [--url http://localhost:8080] [--port 37991]
 *
 * With no target it builds everything. Screenshots boot a dev server on a fresh document with the
 * demo content plus what `SEED` in `scenes.mjs` adds, unless --url points at a running one that
 * has both and needs no login. Output goes
 * to `apps/mobile/store/out`; open `out/preview.html` to review it.
 *
 * Environment:
 *   CHROME_BIN  browser executable, for systems where Playwright's browsers cannot run (NixOS);
 *               a `chromium` on the PATH is found without it
 */
import { execFileSync } from "child_process";
import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

import { findNoteId, seedDocument, startDemoServer } from "./demo_server.mjs";
import { DEVICES, SCENES, SEED } from "./scenes.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const templates = path.join(here, "templates");
const outDir = path.join(here, "out");
const listing = JSON.parse(fs.readFileSync(path.join(here, "listing.json"), "utf8"));

// Playwright is a dependency of the repository root, which pnpm does not expose to this package.
const { chromium } = createRequire(path.join(repoRoot, "package.json"))("playwright");

const TARGETS = [ "icon", "screenshots", "feature", "preview" ];

const BUILDERS = {
    icon: buildIcon,
    screenshots: buildScreenshots,
    feature: buildFeature,
    preview: buildPreview
};

const options = parseArgs(process.argv.slice(2));
fs.mkdirSync(outDir, { recursive: true });
const browser = await launchBrowser();
try {
    for (const target of TARGETS.filter((target) => options.targets.includes(target))) {
        console.log(`Building ${target}...`);
        await BUILDERS[target]();
    }
} finally {
    await browser.close();
}

/**
 * The store asks for a 32-bit PNG, but Chromium writes an opaque screenshot as 24-bit, so the
 * screenshot is encoded again through a canvas, which keeps the alpha channel.
 */
async function buildIcon() {
    const output = path.join(outDir, "icon.png");
    await renderTemplate("icon.html", { width: 512, height: 512 }, output, {});
    const page = await browser.newPage();
    const dataUrl = await page.evaluate(async (source) => {
        const image = new Image();
        image.src = source;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        canvas.getContext("2d").drawImage(image, 0, 0);
        return canvas.toDataURL("image/png");
    }, `data:image/png;base64,${fs.readFileSync(output).toString("base64")}`);
    await page.close();
    fs.writeFileSync(output, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
}

async function buildScreenshots() {
    const server = options.url ? { baseUrl: options.url, stop() {} } : await startDemoServer({
        repoRoot,
        port: options.port,
        logPath: path.join(outDir, "server.log")
    });
    try {
        if (!options.url) {
            await seedDocument(browser, server.baseUrl, SEED);
        }
        for (const deviceName of options.devices) {
            await captureDevice(server.baseUrl, deviceName);
        }
    } finally {
        server.stop();
    }
}

async function buildFeature() {
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
    await renderTemplate("feature.html", { width: 1024, height: 500 }, output, {
        tagline: listing.featureGraphic.tagline,
        taglineSub: listing.featureGraphic.taglineSub,
        shots
    });
}

async function buildPreview() {
    const screenshots = [];
    for (const deviceName of Object.keys(DEVICES)) {
        for (const [ index, scene ] of SCENES.entries()) {
            const file = storeShotPath(deviceName, index, scene.id);
            if (fs.existsSync(file)) {
                const relative = path.relative(outDir, file);
                screenshots.push({ device: deviceName, file: relative, alt: scene.alt });
            }
        }
    }
    const data = { listing, screenshots, checks: runChecks(screenshots) };
    const script = `window.LISTING = ${JSON.stringify(data, null, 4)};\n`;
    fs.writeFileSync(path.join(outDir, "listing-data.js"), script);
    fs.copyFileSync(path.join(templates, "preview.html"), path.join(outDir, "preview.html"));
    fs.copyFileSync(path.join(templates, "common.css"), path.join(outDir, "common.css"));

    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.goto(pathToFileURL(path.join(outDir, "preview.html")).href);
    await waitForAssets(page);
    await page.screenshot({ path: path.join(outDir, "preview.png"), fullPage: true });
    await page.close();

    const failed = data.checks.filter((check) => !check.ok);
    for (const check of failed) {
        console.warn(`  Fails: ${check.asset}: ${check.rule} (${check.actual})`);
    }
    const passed = data.checks.length - failed.length;
    console.log(`  ${passed} of ${data.checks.length} checks pass.`);
    console.log(`  Open ${path.join(outDir, "preview.html")}`);
}

async function captureDevice(baseUrl, deviceName) {
    const device = DEVICES[deviceName];
    const scenes = SCENES.filter((scene) => options.only?.includes(scene.id) ?? true);
    for (const scene of scenes) {
        const index = SCENES.indexOf(scene);
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
        await page.goto(baseUrl);
        await page.waitForFunction(
            () => window.glob?.appContext?.tabManager?.getActiveContext(),
            null,
            { timeout: 120_000 }
        );
        await page.addStyleTag({ content: "* { caret-color: transparent !important; }" });
        await page.evaluate((id) => {
            return window.glob.appContext.tabManager.getActiveContext().setNote(id);
        }, noteId);
        await settle(page);
        await scene.prepare?.(page);
        await settle(page);

        const store = storeShotPath(deviceName, index, scene.id);
        const raw = device.captioned ? rawShotPath(deviceName, scene.id) : store;
        fs.mkdirSync(path.dirname(raw), { recursive: true });
        await page.screenshot({ path: raw });
        await context.close();

        if (device.captioned) {
            await renderTemplate("screenshot.html", { width: 1080, height: 1920 }, store, {
                caption: scene.caption,
                shot: pathToFileURL(raw).href,
                dark: colorScheme === "dark"
            });
        }
        console.log(`  ${path.relative(outDir, store)}`);
    }
}

/** Waits for the note to render: its requests, then its animations and late layout. */
async function settle(page) {
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await page.waitForTimeout(2500);
}

async function renderTemplate(template, size, output, data) {
    const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(path.join(templates, template)).href);
    await page.evaluate((renderData) => window.render?.(renderData), data);
    await waitForAssets(page);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    await page.screenshot({ path: output });
    await page.close();
}

async function waitForAssets(page) {
    await page.evaluate(() => Promise.all([
        document.fonts.ready,
        ...[ ...document.images ].map((image) => image.decode().catch(() => {}))
    ]));
}

/** The store's limits, from the Play Console help on preview assets and on store listing text. */
function runChecks(screenshots) {
    const checks = [];
    const check = (asset, rule, actual, ok) => {
        checks.push({ asset, rule, actual: String(actual), ok });
    };
    const checkLength = (asset, text, max) => {
        const rule = `at most ${max.toLocaleString("en")} characters`;
        check(asset, rule, text.length, text.length <= max);
    };

    checkLength("App name", listing.name, 30);
    checkLength("Short description", listing.shortDescription, 80);
    checkLength("Full description", listing.fullDescription, 4000);
    checkLength("Feature graphic alt text", listing.featureGraphic.alt, 140);

    const icon = readPng(path.join(outDir, "icon.png"));
    check("Icon", "512 x 512 PNG with alpha, at most 1 MB", describe(icon),
        icon?.width === 512 && icon.height === 512 && icon.alpha && icon.size <= 1024 * 1024);
    const feature = readPng(path.join(outDir, "feature-graphic.png"));
    check("Feature graphic", "1024 x 500 PNG without alpha", describe(feature),
        feature?.width === 1024 && feature.height === 500 && !feature.alpha);

    for (const [ device, minCount ] of [ [ "phone", 4 ], [ "tablet", 4 ] ]) {
        const shots = screenshots.filter((shot) => shot.device === device);
        check(`${device} screenshots`, `${minCount} to 8 for promotion`, shots.length,
            shots.length >= minCount && shots.length <= 8);
        for (const shot of shots) {
            const png = readPng(path.join(outDir, shot.file));
            const long = Math.max(png.width, png.height);
            const short = Math.min(png.width, png.height);
            const rule = "16:9 or 9:16, at least 1080 px, no alpha, at most 8 MB";
            check(shot.file, rule, describe(png),
                short >= 1080 && long <= 3840 && Math.abs(long / short - 16 / 9) < 0.01
                && !png.alpha && png.size <= 8 * 1024 * 1024);
            checkLength(`${shot.file} alt text`, shot.alt, 140);
        }
    }
    return checks;
}

function readPng(file) {
    if (!fs.existsSync(file)) return undefined;
    const buffer = fs.readFileSync(file);
    const colorType = buffer[25];
    return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
        alpha: colorType === 4 || colorType === 6,
        size: buffer.length
    };
}

function describe(png) {
    if (!png) return "missing";
    const alpha = png.alpha ? "alpha" : "no alpha";
    return `${png.width} x ${png.height}, ${alpha}, ${Math.round(png.size / 1024)} KB`;
}

function rawShotPath(deviceName, sceneId) {
    return path.join(outDir, "screenshots", deviceName, "raw", `${sceneId}.png`);
}

function storeShotPath(deviceName, index, sceneId) {
    const name = `${String(index + 1).padStart(2, "0")}-${sceneId}.png`;
    return path.join(outDir, "screenshots", deviceName, name);
}

function parseArgs(args) {
    const result = {
        targets: [],
        devices: Object.keys(DEVICES),
        only: undefined,
        url: undefined,
        port: 37991
    };
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === "--only") result.only = args[++index].split(",");
        else if (arg === "--devices") result.devices = args[++index].split(",");
        else if (arg === "--url") result.url = args[++index].replace(/\/$/, "");
        else if (arg === "--port") result.port = Number(args[++index]);
        else if (TARGETS.includes(arg)) result.targets.push(arg);
        else throw new Error(`Unknown argument ${arg}; targets are ${TARGETS.join(", ")}.`);
    }
    if (!result.targets.length) result.targets = TARGETS;
    return result;
}

// Playwright's pinned browser build is usually not downloaded in dev setups, so system browsers
// come first.
async function launchBrowser() {
    let lastError;
    const candidates = [
        ...[ process.env.CHROME_BIN, findOnPath("chromium") ]
            .filter(Boolean)
            .map((executablePath) => ({ executablePath })),
        { channel: "chrome" },
        {}
    ];
    for (const launchOptions of candidates) {
        try {
            return await chromium.launch(launchOptions);
        } catch (e) {
            lastError = e;
        }
    }
    throw lastError;
}

function findOnPath(command) {
    try {
        const stdio = [ "ignore", "pipe", "ignore" ];
        return execFileSync("which", [ command ], { stdio }).toString().trim() || undefined;
    } catch {
        return undefined;
    }
}
