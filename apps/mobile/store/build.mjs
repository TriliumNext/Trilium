#!/usr/bin/env node
/**
 * Builds the Google Play store listing assets: the 512 x 512 icon, the 1024 x 500 feature graphic,
 * phone and tablet screenshots of the demo document, and a preview page of the whole listing, then
 * checks them against the store's size and length limits and fails when one is not met. The
 * `flathub` target captures the desktop app's window for the Flathub listing instead, inside a
 * headless GNOME Shell, and `flathub-preview` mocks the Flathub app page from those screenshots
 * and the metainfo, with Flathub's quality checks. The `hero` target writes the website hero as
 * a self-contained HTML snapshot of the app, in `out/hero`.
 *
 * Usage:
 *   pnpm --filter @triliumnext/mobile store-assets [icon] [feature] [screenshots] [preview]
 *       [flathub] [flathub-preview] [hero]
 *       [--only tree,text] [--devices phone,tablet] [--url http://localhost:8080] [--port 37991]
 *
 * With no target it builds the Play Store assets only. Screenshots boot a dev server on a fresh
 * document with the demo content plus what `SEED` in `scenes.mjs` adds, unless --url points at a
 * running one that has both and needs no login; `flathub` always boots its own and then opens
 * the document in the desktop app, and needs `gnome-shell`, `dbus-run-session` and `gdbus` on
 * the PATH; `hero` also boots its own and needs `pyftsubset` from fontTools, with the Brotli
 * module. Output goes to `apps/mobile/store/out`; open `out/preview.html`,
 * `out/flathub-preview.html` and `out/hero/hero.html` to review it.
 *
 * Environment:
 *   CHROME_BIN  browser executable, for systems where Playwright's browsers cannot run (NixOS);
 *               a `chromium` on the PATH is found without it
 *   PYFTSUBSET  the fontTools subsetter, when `pyftsubset` on the PATH lacks Brotli
 */
import { execFileSync } from "child_process";
import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import zlib from "zlib";

import { findNoteId, seedDocument, startDemoServer } from "./demo_server.mjs";
import { startDesktopApp } from "./desktop_app.mjs";
import { checkFlathubListing, readMetainfo } from "./flathub_listing.mjs";
import { startGnomeSession } from "./gnome_session.mjs";
import { captureSnapshot } from "./hero_snapshot.mjs";
import { DEVICES, HERO, ITINERARY, SCENES, SEED, TRIP_COSTS } from "./scenes.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const templates = path.join(here, "templates");
const outDir = path.join(here, "out");
const listing = JSON.parse(fs.readFileSync(path.join(here, "listing.json"), "utf8"));

// Playwright, pngjs and pixelmatch are dependencies of the repository root, which pnpm does not
// expose to this package.
const rootRequire = createRequire(path.join(repoRoot, "package.json"));
const { chromium } = rootRequire("playwright");

const TARGETS = [
    "icon", "screenshots", "feature", "preview", "flathub", "flathub-preview", "hero"
];
const SEED_PARAMS = [ TRIP_COSTS, ITINERARY ];

/**
 * The targets built when none is named: the Play Store assets, which `checkStoreAssets()`
 * checks.
 */
const DEFAULT_TARGETS = [ "icon", "screenshots", "feature", "preview" ];

/**
 * Flathub asks for a window of at most 1000 x 700, or 2000 x 1400 on a HiDPI screen, so the
 * window is 1000 x 700 logical pixels on a monitor at 2x.
 */
const FLATHUB_WINDOW = { width: 1000, height: 700, scale: 2 };

const BUILDERS = {
    "icon": buildIcon,
    "screenshots": buildScreenshots,
    "feature": buildFeature,
    "preview": buildPreview,
    "flathub": buildFlathub,
    "flathub-preview": buildFlathubPreview,
    "hero": buildHero
};

/** The share of pixels the hero snapshot can differ from the app by, in either color scheme. */
const HERO_MAX_DIFF = 0.005;

const options = parseArgs(process.argv.slice(2));
fs.mkdirSync(outDir, { recursive: true });
const browser = await launchBrowser();
try {
    for (const target of TARGETS.filter((target) => options.targets.includes(target))) {
        console.log(`Building ${target}...`);
        await BUILDERS[target]();
    }
    if (options.targets.some((target) => DEFAULT_TARGETS.includes(target))) {
        checkStoreAssets();
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
            await seedDocument(browser, server.baseUrl, SEED, SEED_PARAMS);
        }
        for (const deviceName of options.devices) {
            await captureDevice(server.baseUrl, deviceName);
        }
    } finally {
        server.stop();
    }
}

/**
 * Captures each scene in the desktop app with GNOME's window screenshot, which keeps the frame,
 * rounded corners and shadow that Flathub requires, into `out/flathub`.
 */
async function buildFlathub() {
    const server = await startDemoServer({
        repoRoot,
        port: options.port,
        logPath: path.join(outDir, "server.log")
    });
    let session;
    let app;
    try {
        await seedDocument(browser, server.baseUrl, SEED, SEED_PARAMS);
        await setOption(server.baseUrl, "rightPaneVisible", "false");
        await server.stopServer();

        const { width, height, scale } = FLATHUB_WINDOW;
        session = await startGnomeSession({
            width: width + 600,
            height: height + 400,
            scale,
            logPath: path.join(outDir, "gnome-shell.log")
        });
        app = await startDesktopApp({
            chromium,
            repoRoot,
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
            await page.evaluate(async (id) => {
                await window.glob.appContext.tabManager.getActiveContext().setNote(id);
            }, noteId);
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
async function buildFlathubPreview() {
    const flatpakDir = path.join(repoRoot, "apps", "desktop", "flatpak");
    const meta = await readMetainfo(browser,
        path.join(flatpakDir, "org.triliumnotes.Trilium.metainfo.xml"));
    const iconSource = path.join(repoRoot, "apps", "desktop", "electron-forge", "app-icon",
        "png", "512x512.png");
    fs.copyFileSync(iconSource, path.join(outDir, "flathub-icon.png"));

    const screenshots = [];
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
    const checks = checkFlathubListing(meta, screenshots, FLATHUB_WINDOW,
        readPng(path.join(outDir, "flathub-icon.png")));

    const data = { meta, screenshots, checks };
    const script = `window.FLATHUB = ${JSON.stringify(data, null, 4)};\n`;
    fs.writeFileSync(path.join(outDir, "flathub-data.js"), script);
    fs.copyFileSync(path.join(templates, "flathub.html"),
        path.join(outDir, "flathub-preview.html"));
    fs.copyFileSync(path.join(templates, "common.css"), path.join(outDir, "common.css"));

    const failed = checks.filter((check) => !check.ok);
    for (const check of failed) {
        console.error(`  Fails: ${check.asset}: ${check.rule} (${check.actual})`);
    }
    console.log(`  ${checks.length - failed.length} of ${checks.length} checks pass.`);
    console.log(`  Open ${path.join(outDir, "flathub-preview.html")}`);
    if (failed.length) {
        process.exitCode = 1;
    }
}

/**
 * Writes the website hero to `out/hero/hero.html`: a snapshot of the desktop layout, light only,
 * whose CSS also carries the dark theme. The app is screenshotted in both color schemes and the
 * build fails when the snapshot differs from it by more than `HERO_MAX_DIFF` in either one.
 */
async function buildHero() {
    const pyftsubset = process.env.PYFTSUBSET ?? findOnPath("pyftsubset");
    if (!pyftsubset) throw new Error("The hero needs pyftsubset from fontTools; set PYFTSUBSET.");
    const heroDir = path.join(outDir, "hero");
    fs.mkdirSync(heroDir, { recursive: true });
    const server = options.url ? { baseUrl: options.url, stop() {} } : await startDemoServer({
        repoRoot,
        port: options.port,
        logPath: path.join(outDir, "server.log")
    });
    const output = path.join(heroDir, "hero.html");
    try {
        if (!options.url) {
            await seedDocument(browser, server.baseUrl, SEED, SEED_PARAMS);
        }
        const noteId = await findNoteId(server.baseUrl, HERO.query);
        for (const colorScheme of [ "light", "dark" ]) {
            const context = await browser.newContext({ viewport: HERO.viewport, colorScheme });
            const page = await context.newPage();
            await page.goto(server.baseUrl);
            await page.waitForFunction(
                () => window.glob?.appContext?.tabManager?.getActiveContext(),
                null,
                { timeout: 120_000 }
            );
            await page.addStyleTag({ content: "* { caret-color: transparent !important; }" });
            await page.evaluate(async (id) => {
                const noteContext = window.glob.appContext.tabManager.getActiveContext();
                await noteContext.setHoistedNoteId(id);
                await noteContext.setNote(id);
            }, noteId);
            await settle(page);
            await page.mouse.move(HERO.viewport.width - 1, HERO.viewport.height - 1);
            await page.waitForTimeout(500);
            await page.screenshot({ path: path.join(heroDir, `app-${colorScheme}.png`) });
            if (colorScheme === "light") {
                const { html, stats } = await captureSnapshot(page, { pyftsubset });
                fs.writeFileSync(output, html);
                const fonts = stats.fonts
                    .map(({ family, bytes }) => `${family} ${Math.round(bytes / 1024)} KB`);
                console.log(`  ${stats.rulesKept} of ${stats.rulesKept + stats.rulesDropped} CSS `
                    + `rules, ${stats.customProperties} custom properties, fonts: `
                    + `${fonts.join(", ")}`);
            }
            await context.close();
        }
    } finally {
        server.stop();
    }

    const html = fs.readFileSync(output);
    const brotli = zlib.brotliCompressSync(html).length;
    console.log(`  ${path.relative(outDir, output)}: ${Math.round(html.length / 1024)} KB, `
        + `${Math.round(brotli / 1024)} KB with Brotli`);
    for (const colorScheme of [ "light", "dark" ]) {
        const shot = path.join(heroDir, `snapshot-${colorScheme}.png`);
        const context = await browser.newContext({ viewport: HERO.viewport, colorScheme });
        const page = await context.newPage();
        await page.goto(pathToFileURL(output).href);
        await waitForAssets(page);
        await page.screenshot({ path: shot });
        await context.close();
        const share = diffPngs(path.join(heroDir, `app-${colorScheme}.png`), shot,
            path.join(heroDir, `diff-${colorScheme}.png`));
        const percent = `${(share * 100).toFixed(2)}%`;
        if (share > HERO_MAX_DIFF) {
            console.error(`  Fails: ${colorScheme} snapshot differs from the app by ${percent}`);
            process.exitCode = 1;
        } else {
            console.log(`  ${colorScheme}: differs from the app by ${percent}`);
        }
    }
}

/** The share of pixels that differ between two screenshots of the same size. */
function diffPngs(expectedFile, actualFile, diffFile) {
    const { PNG } = rootRequire("pngjs");
    const pixelmatch = rootRequire("pixelmatch").default ?? rootRequire("pixelmatch");
    const expected = PNG.sync.read(fs.readFileSync(expectedFile));
    const actual = PNG.sync.read(fs.readFileSync(actualFile));
    const { width, height } = expected;
    const diff = new PNG({ width, height });
    const count = pixelmatch(expected.data, actual.data, diff.data, width, height,
        { threshold: 0.1 });
    fs.writeFileSync(diffFile, PNG.sync.write(diff));
    return count / (width * height);
}

/** Sets an option through the API, from a page of the app that supplies the CSRF headers. */
async function setOption(baseUrl, name, value) {
    const page = await browser.newPage();
    try {
        await page.goto(baseUrl);
        await page.waitForFunction(() => window.glob?.getHeaders, null, { timeout: 120_000 });
        const status = await page.evaluate(async ([ optionName, optionValue ]) => {
            const response = await fetch(`api/options/${optionName}/${optionValue}`, {
                method: "PUT",
                headers: await window.glob.getHeaders()
            });
            return response.status;
        }, [ name, value ]);
        if (status >= 400) throw new Error(`Setting ${name} failed (${status}).`);
    } finally {
        await page.close();
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

function buildPreview() {
    const data = { listing, screenshots: listStoreShots() };
    const script = `window.LISTING = ${JSON.stringify(data, null, 4)};\n`;
    fs.writeFileSync(path.join(outDir, "listing-data.js"), script);
    fs.copyFileSync(path.join(templates, "preview.html"), path.join(outDir, "preview.html"));
    fs.copyFileSync(path.join(templates, "common.css"), path.join(outDir, "common.css"));
    console.log(`  Open ${path.join(outDir, "preview.html")}`);
}

/**
 * Checks the store assets on disk against the Play Console's limits and fails the build when one
 * of them is not met.
 */
function checkStoreAssets() {
    console.log("Checking the store assets...");
    const checks = runChecks(listStoreShots());
    const failed = checks.filter((check) => !check.ok);
    for (const check of failed) {
        console.error(`  Fails: ${check.asset}: ${check.rule} (${check.actual})`);
    }
    console.log(`  ${checks.length - failed.length} of ${checks.length} checks pass.`);
    if (failed.length) {
        process.exitCode = 1;
    }
}

/** The store screenshots on disk, in listing order, with their alt text. */
function listStoreShots() {
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
    return screenshots;
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
        await settle(page, { blur: !scene.keepFocus });

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
async function settle(page, { blur = true } = {}) {
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.evaluate((shouldBlur) => {
        if (shouldBlur && document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }
    }, blur);
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

function flathubShotPath(index, sceneId) {
    const name = `${String(index + 1).padStart(2, "0")}-${sceneId}.png`;
    return path.join(outDir, "flathub", name);
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
    if (!result.targets.length) result.targets = DEFAULT_TARGETS;
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
