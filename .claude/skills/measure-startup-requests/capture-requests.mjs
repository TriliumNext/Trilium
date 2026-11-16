#!/usr/bin/env node
/**
 * Captures every network request made by the Trilium client during a full startup
 * (login → app fully loaded) against a running dev server, and writes them to a
 * JSON file for analysis with analyze-requests.mjs.
 *
 * Usage:
 *   node .claude/skills/measure-startup-requests/capture-requests.mjs [--mobile] [output.json] [baseUrl]
 *   node .claude/skills/measure-startup-requests/capture-requests.mjs --cdp <endpoint> [output.json]
 *
 * --mobile loads the mobile layout, in a phone's viewport with touch, as a phone's browser would.
 * --cdp attaches to a running Electron app started with `--remote-debugging-port`, for example
 * `http://127.0.0.1:9222`, and reloads its main window instead of launching a browser.
 *
 * Environment:
 *   TRILIUM_PASSWORD  password of the dev instance (required if a login page appears)
 *   TRILIUM_URL       base URL (default http://localhost:8080), overridden by the second argument
 *   CHROME_BIN        browser executable to launch, for systems where Playwright's channels
 *                     cannot run (NixOS); a `chromium` on the PATH is found without it
 */
import { execFileSync } from "child_process";
import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

// Playwright is not installed at the repo root; resolve it from the e2e package.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const e2eRequire = createRequire(path.join(repoRoot, "packages", "trilium-e2e", "package.json"));
const { chromium } = e2eRequire("playwright");

const cliArgs = process.argv.slice(2);
const mobile = cliArgs.includes("--mobile");
const cdpIndex = cliArgs.indexOf("--cdp");
const cdpEndpoint = cdpIndex >= 0 ? cliArgs[cdpIndex + 1] : undefined;
const [ outputPath = "requests.json", baseUrl = process.env.TRILIUM_URL ?? "http://localhost:8080" ] =
    cliArgs.filter((arg, index) => arg !== "--mobile" && (cdpIndex < 0 || (index !== cdpIndex && index !== cdpIndex + 1)));

/**
 * A phone's browser: the server picks the mobile layout off the `trilium-device` cookie, and the
 * client tells a phone from a tablet by the viewport's width.
 */
const MOBILE_CONTEXT = {
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
};

// The pinned Playwright browser build is usually not downloaded in dev setups,
// so prefer system browsers before falling back to the bundled one.
async function launchBrowser() {
    let lastError;
    const candidates = [
        ...[process.env.CHROME_BIN, findOnPath("chromium")].filter(Boolean).map((executablePath) => ({ executablePath })),
        { channel: "msedge" },
        { channel: "chrome" },
        {}
    ];
    for (const options of candidates) {
        try {
            return await chromium.launch(options);
        } catch (e) {
            lastError = e;
        }
    }
    throw lastError;
}

function findOnPath(command) {
    try {
        return execFileSync("which", [command], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || undefined;
    } catch {
        return undefined;
    }
}

const requests = [];
let seq = 0;

const { browser, context, page, startUrl } = cdpEndpoint ? await attachToElectron(cdpEndpoint) : await openBrowser();

/**
 * A browser context that has loaded the app once, and a new page to capture the second load in.
 * The first load logs in, and Vite can optimize the dependencies of a cold cache during it. That
 * load can still be importing modules after its network went quiet, so it gets a page of its own,
 * closed before the capture starts.
 */
async function openBrowser() {
    const browser = await launchBrowser();
    const context = await browser.newContext(mobile ? MOBILE_CONTEXT : {});
    if (mobile) {
        await context.addCookies([ { name: "trilium-device", value: "mobile", url: baseUrl } ]);
    }
    const firstLoad = await context.newPage();
    console.log(`Navigating to ${baseUrl}...`);
    await firstLoad.goto(baseUrl, { waitUntil: "networkidle" });
    await logIn(browser, firstLoad);
    const startUrl = firstLoad.url();
    await firstLoad.close();
    return { browser, context, page: await context.newPage(), startUrl };
}

/** Logs in when the page is the login page, which the client renders at the same URL as the app. */
async function logIn(browser, page) {
    // The app has password fields of its own, as the protected session's.
    const passwordField = page.locator(".page.login input[type=password]");
    if (!await passwordField.count()) return;
    const password = process.env.TRILIUM_PASSWORD;
    if (!password) {
        console.error("The instance requires a login; set the TRILIUM_PASSWORD environment variable.");
        await browser.close();
        process.exit(1);
    }
    console.log("Logging in...");
    await passwordField.first().fill(password);
    await passwordField.first().press("Enter");
    await passwordField.first().waitFor({ state: "detached", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 30000 });
}

/** The main window of the Electron app listening on `endpoint`, the one that is not an extra window. */
async function attachToElectron(endpoint) {
    const browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    const page = context?.pages().find((p) => p.url().startsWith("trilium-app:") && !p.url().includes("extraWindow"));
    if (!page) {
        console.error(`No Trilium main window at ${endpoint}.`);
        process.exit(1);
    }
    return { browser, context, page };
}

// What asked for each URL, which Playwright does not expose. A static import names the importing
// module; a dynamic import, a fetch or an injected element carries the stack that made the call.
const initiators = new Map();
const cdp = await context.newCDPSession(page);
await cdp.send("Network.enable");
// Without the debugger, a stack ends at the first `await`, so a fetch shows only `server.ts`.
await cdp.send("Debugger.enable");
await cdp.send("Debugger.setAsyncCallStackDepth", { maxDepth: 32 });
// A module answered from the cache reports no body size, and the reload after a login would
// otherwise be answered from it.
await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
cdp.on("Network.requestWillBeSent", ({ request, initiator }) => {
    if (initiators.has(request.url)) return;
    const frames = [];
    for (let stack = initiator.stack; stack; stack = stack.parent) {
        frames.push(...stack.callFrames);
    }
    const frame = frames.find((f) => f.url);
    initiators.set(request.url, {
        type: initiator.type,
        url: initiator.url ?? frame?.url ?? null,
        // A static import has no stack: the module loader made the request, not running script.
        dynamic: !!frame,
        // Every script on the stack, async parents included, so a fetch can be traced to the
        // module whose code made it and not only to the library that sent it.
        stack: [ ...new Set(frames.map((f) => f.url).filter(Boolean)) ]
    });
});

page.on("response", async (response) => {
    const req = response.request();
    let bodySize = 0;
    try {
        const sizes = await req.sizes();
        bodySize = sizes.responseBodySize;
    } catch {
        // request may be from a worker or already closed
    }
    requests.push({
        seq: seq++,
        method: req.method(),
        url: req.url(),
        resourceType: req.resourceType(),
        status: response.status(),
        fromServiceWorker: response.fromServiceWorker(),
        bodySize,
        initiator: initiators.get(req.url()) ?? null
    });
});

page.on("websocket", (ws) => {
    requests.push({
        seq: seq++,
        method: "WS",
        url: ws.url(),
        resourceType: "websocket",
        status: null,
        bodySize: 0
    });
});

// A startup that throws loads less than it should, so say so rather than leave a short capture
// looking like a win.
page.on("pageerror", (error) => console.error(`Page error: ${error.stack ?? error.message}`));
page.on("console", (message) => {
    if (message.type() === "error") console.error(`Console error: ${message.text()}`);
});

console.log("Loading the app again to capture the startup on its own...");
if (cdpEndpoint) {
    await page.reload({ waitUntil: "networkidle" });
} else {
    await page.goto(startUrl, { waitUntil: "networkidle" });
}

console.log("Waiting for the app to fully load...");
try {
    await page.waitForLoadState("networkidle", { timeout: 30000 });
} catch {}
// Extra settle time for deferred/idle loading, then require a quiet network again.
await page.waitForTimeout(8000);
try {
    await page.waitForLoadState("networkidle", { timeout: 10000 });
} catch {}

fs.writeFileSync(outputPath, JSON.stringify(requests, null, 2));
console.log(`Captured ${requests.length} requests -> ${outputPath}`);
// Closing a browser attached over CDP would quit the Electron app.
if (cdpEndpoint) {
    process.exit(0);
}
await browser.close();
