#!/usr/bin/env node
/**
 * Captures every network request made by the Trilium client during a full startup
 * (login → app fully loaded) against a running dev server, and writes them to a
 * JSON file for analysis with analyze-requests.mjs.
 *
 * Usage:
 *   node .claude/skills/measure-startup-requests/capture-requests.mjs [output.json] [baseUrl]
 *
 * Environment:
 *   TRILIUM_PASSWORD  password of the dev instance (required if a login page appears)
 *   TRILIUM_URL       base URL (default http://localhost:8080), overridden by the second argument
 */
import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

// Playwright is not installed at the repo root; resolve it from the e2e package.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const e2eRequire = createRequire(path.join(repoRoot, "packages", "trilium-e2e", "package.json"));
const { chromium } = e2eRequire("playwright");

const outputPath = process.argv[2] ?? "requests.json";
const baseUrl = process.argv[3] ?? process.env.TRILIUM_URL ?? "http://localhost:8080";

// The pinned Playwright browser build is usually not downloaded in dev setups,
// so prefer system browsers before falling back to the bundled one.
async function launchBrowser() {
    let lastError;
    for (const channel of ["msedge", "chrome", undefined]) {
        try {
            return await chromium.launch(channel ? { channel } : {});
        } catch (e) {
            lastError = e;
        }
    }
    throw lastError;
}

const requests = [];
let seq = 0;

const browser = await launchBrowser();
const context = await browser.newContext();
const page = await context.newPage();

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
        bodySize
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

console.log(`Navigating to ${baseUrl}...`);
await page.goto(baseUrl, { waitUntil: "networkidle" });

// The login screen is rendered by the client at "/" (or "/?login") once /bootstrap reports no
// session, so detect it by its password field rather than by the URL.
const passwordField = page.locator('form input[name="password"]');
if (await passwordField.count()) {
    const password = process.env.TRILIUM_PASSWORD;
    if (!password) {
        console.error("The instance requires a login; set the TRILIUM_PASSWORD environment variable.");
        await browser.close();
        process.exit(1);
    }
    console.log("Logging in...");
    await passwordField.fill(password);
    await page.click("form button.btn-primary");
    // A successful login calls window.location.assign("."), which replaces the login form.
    await passwordField.waitFor({ state: "detached", timeout: 30000 });
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
await browser.close();
