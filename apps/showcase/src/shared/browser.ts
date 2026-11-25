import { execFileSync, type StdioOptions } from "child_process";
import fs from "fs";
import path from "path";
import { type Browser, chromium, type LaunchOptions, type Page } from "playwright";
import { pathToFileURL } from "url";

import { templatesDir } from "./build.ts";

/** The part of the client's `window.glob` that the build calls inside the app's pages. */
declare global {
    interface Window {
        glob: {
            appContext: {
                tabManager: { getActiveContext(): NoteContext | null };
                triggerCommand(name: string, data: object): void;
            };
            getHeaders(): Promise<Record<string, string>>;
        };
        /** Fills a template from `templates/` with its data. */
        render?(data: object): void;
    }
}

interface NoteContext {
    noteId: string | null;
    setNote(noteId: string, options?: { viewScope?: { viewMode: string } }): Promise<void>;
    setHoistedNoteId(noteId: string): Promise<void>;
}

// Playwright's pinned browser build is usually not downloaded in dev setups, so system browsers
// come first.
export async function launchBrowser() {
    let lastError: unknown;
    const candidates: LaunchOptions[] = [
        ...[ process.env.CHROME_BIN, findOnPath("chromium") ]
            .filter((executablePath) => executablePath)
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

export function findOnPath(command: string) {
    try {
        const stdio: StdioOptions = [ "ignore", "pipe", "ignore" ];
        const output = execFileSync("which", [ command ], { stdio });
        return output.toString().trim() || undefined;
    } catch {
        return undefined;
    }
}

/** Waits for the note to render: its requests, then its animations and late layout. */
export async function settle(page: Page, { blur = true } = {}) {
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.evaluate((shouldBlur) => {
        if (shouldBlur && document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }
    }, blur);
    await page.waitForTimeout(2500);
}

/** Screenshots `template` from `templates/` at `size`, after `window.render(data)`. */
export async function renderTemplate(browser: Browser, template: string,
    size: { width: number; height: number }, output: string, data: object) {
    const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(path.join(templatesDir, template)).href);
    await page.evaluate((renderData) => window.render?.(renderData), data);
    await waitForAssets(page);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    await page.screenshot({ path: output });
    await page.close();
}

export async function waitForAssets(page: Page) {
    await page.evaluate(() => Promise.all([
        document.fonts.ready,
        ...[ ...document.images ].map((image) => image.decode().catch(() => {}))
    ]));
}

/** Opens the app at `baseUrl` in `page` and waits until a note context exists. */
export async function openApp(page: Page, baseUrl: string) {
    await page.goto(baseUrl);
    await page.waitForFunction(
        () => window.glob?.appContext?.tabManager?.getActiveContext(),
        null,
        { timeout: 120_000 }
    );
    await page.addStyleTag({ content: "* { caret-color: transparent !important; }" });
}

/** Opens the note in the active note context of the app in `page`. */
export async function openNote(page: Page, noteId: string, { hoist = false } = {}) {
    await page.evaluate(async ({ id, hoisted }) => {
        const noteContext = window.glob.appContext.tabManager.getActiveContext();
        if (hoisted) await noteContext?.setHoistedNoteId(id);
        await noteContext?.setNote(id);
    }, { id: noteId, hoisted: hoist });
}

/** Sets an option through the API, from a page of the app that supplies the CSRF headers. */
export async function setOption(browser: Browser, baseUrl: string, name: string, value: string) {
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
