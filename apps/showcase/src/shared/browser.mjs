import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { chromium } from "playwright";
import { pathToFileURL } from "url";

import { templatesDir } from "./paths.mjs";

// Playwright's pinned browser build is usually not downloaded in dev setups, so system browsers
// come first.
export async function launchBrowser() {
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

export function findOnPath(command) {
    try {
        const stdio = [ "ignore", "pipe", "ignore" ];
        return execFileSync("which", [ command ], { stdio }).toString().trim() || undefined;
    } catch {
        return undefined;
    }
}

/** Waits for the note to render: its requests, then its animations and late layout. */
export async function settle(page, { blur = true } = {}) {
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.evaluate((shouldBlur) => {
        if (shouldBlur && document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }
    }, blur);
    await page.waitForTimeout(2500);
}

/** Screenshots `template` from `templates/` at `size`, after `window.render(data)`. */
export async function renderTemplate(browser, template, size, output, data) {
    const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(path.join(templatesDir, template)).href);
    await page.evaluate((renderData) => window.render?.(renderData), data);
    await waitForAssets(page);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    await page.screenshot({ path: output });
    await page.close();
}

export async function waitForAssets(page) {
    await page.evaluate(() => Promise.all([
        document.fonts.ready,
        ...[ ...document.images ].map((image) => image.decode().catch(() => {}))
    ]));
}

/** Opens the app at `baseUrl` in `page` and waits until a note context exists. */
export async function openApp(page, baseUrl) {
    await page.goto(baseUrl);
    await page.waitForFunction(
        () => window.glob?.appContext?.tabManager?.getActiveContext(),
        null,
        { timeout: 120_000 }
    );
    await page.addStyleTag({ content: "* { caret-color: transparent !important; }" });
}
