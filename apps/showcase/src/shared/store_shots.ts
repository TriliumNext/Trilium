import fs from "fs";
import path from "path";
import type { Browser } from "playwright";
import { pathToFileURL } from "url";

import { fetchBezel } from "./bezels.ts";
import { openApp, openNote, renderTemplate, settle } from "./browser.ts";
import { type BuildOptions, sceneFileName, templatesDir } from "./build.ts";
import { findNoteId } from "./demo_server.ts";
import type { Device, Scene } from "./scenes.ts";
import { SCENES } from "./scenes.ts";

/** A store screenshot on disk, with the scene it shows. */
export interface StoreShot {
    device: string;
    /** The path of the file, relative to the store's directory. */
    file: string;
    scene: Scene;
}

/**
 * Captures the scenes of the demo document at `baseUrl` on each of `devices` that the options
 * name, into `dir/<device>`. A device with a `frame` keeps the app's screenshot in
 * `dir/<device>/raw` and sets it under the scene's caption.
 */
export async function captureStoreShots(browser: Browser, options: BuildOptions, baseUrl: string,
    devices: Record<string, Device>, dir: string) {
    for (const [ deviceName, device ] of Object.entries(devices)) {
        if (options.devices && !options.devices.includes(deviceName)) continue;
        const scenes = SCENES.filter((scene) => options.only?.includes(scene.id) ?? true);
        for (const listed of scenes) {
            await captureScene(browser, baseUrl, dir, deviceName, device, listed);
        }
    }
}

/** The store screenshots of `devices` in `dir`, in listing order. */
export function listStoreShots(dir: string, devices: Record<string, Device>): StoreShot[] {
    const screenshots: StoreShot[] = [];
    for (const [ deviceName, device ] of Object.entries(devices)) {
        for (const [ index, scene ] of SCENES.entries()) {
            const file = storeShotPath(dir, deviceName, index, scene.id);
            if (fs.existsSync(file)) {
                screenshots.push({
                    device: deviceName,
                    file: path.relative(dir, file),
                    scene: sceneOn(scene, device)
                });
            }
        }
    }
    return screenshots;
}

/**
 * The number of lines each scene's caption takes in the frame of each device in `devices`, by
 * `<device>/<scene ID>`. The caption's text runs are counted by their distinct tops.
 */
export async function measureCaptions(browser: Browser, devices: Record<string, Device>) {
    const lines = new Map<string, number>();
    for (const [ deviceName, { frame } ] of Object.entries(devices)) {
        if (!frame) continue;
        const page = await browser.newPage({ viewport: frame.size, deviceScaleFactor: 1 });
        await page.goto(pathToFileURL(path.join(templatesDir, frame.template)).href);
        for (const scene of SCENES) {
            lines.set(`${deviceName}/${scene.id}`, await page.evaluate(async (data) => {
                window.render?.(data);
                const heading = document.getElementById("caption");
                if (!heading) return 0;
                // Reading the layout starts the font loads that `document.fonts.ready` waits for.
                void heading.offsetHeight;
                await document.fonts.ready;
                const range = document.createRange();
                range.selectNodeContents(heading);
                const tops = [ ...range.getClientRects() ].map((rect) => Math.round(rect.top));
                return new Set(tops).size;
            }, { caption: scene.caption, shot: "", dark: false, device: deviceName }));
        }
        await page.close();
    }
    return lines;
}

/** The screenshot of the app alone, before a device's `frame` sets it under its caption. */
export function rawShotPath(dir: string, deviceName: string, sceneId: string) {
    return path.join(dir, deviceName, "raw", `${sceneId}.png`);
}

async function captureScene(browser: Browser, baseUrl: string, dir: string, deviceName: string,
    device: Device, listed: Scene) {
    const index = SCENES.indexOf(listed);
    const scene = sceneOn(listed, device);
    const colorScheme = scene.colorScheme ?? "light";
    const context = await browser.newContext({
        viewport: device.viewport,
        screen: device.viewport,
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
    if (device.safeArea) {
        await page.evaluate(({ top, bottom }) => {
            const { style } = document.documentElement;
            style.setProperty("--safe-area-inset-top", `${top}px`);
            style.setProperty("--safe-area-inset-bottom", `${bottom}px`);
        }, device.safeArea);
    }
    await openNote(page, noteId);
    await settle(page);
    await scene.prepare?.(page);
    await settle(page, { blur: !scene.keepFocus });

    const store = storeShotPath(dir, deviceName, index, scene.id);
    const raw = device.frame ? rawShotPath(dir, deviceName, scene.id) : store;
    fs.mkdirSync(path.dirname(raw), { recursive: true });
    await page.screenshot({ path: raw });
    await context.close();

    if (device.frame) {
        const { bezel } = device.frame;
        await renderTemplate(browser, device.frame.template, device.frame.size, store, {
            caption: scene.caption,
            shot: pathToFileURL(raw).href,
            dark: colorScheme === "dark",
            device: deviceName,
            points: device.viewport.width,
            bezel: bezel && {
                ...bezel,
                src: pathToFileURL(await fetchBezel(bezel)).href,
                screenSize: {
                    width: device.viewport.width * device.deviceScaleFactor,
                    height: device.viewport.height * device.deviceScaleFactor
                }
            }
        });
    }
    console.log(`  ${path.relative(path.dirname(dir), store)}`);
}

/** The scene as the device shows it: on a tablet, with `scene.tablet` in place. */
function sceneOn(scene: Scene, device: Device): Scene {
    return device.tablet && scene.tablet ? { ...scene, ...scene.tablet } : scene;
}

function storeShotPath(dir: string, deviceName: string, index: number, sceneId: string) {
    return path.join(dir, deviceName, sceneFileName(index, sceneId));
}
