/**
 * Harvests a self-contained HTML snapshot of the running Trilium client for the website hero.
 *
 * Boots a disposable no-auth server on the e2e fixture database, renders it in headless
 * Chromium, then serializes the live DOM together with every stylesheet and asset (fonts,
 * images, canvases) inlined as data URIs. The result is a static page that looks exactly
 * like the app because it *is* the app's rendered output — no screenshots, no hand-built
 * replica.
 *
 * One artifact covers both color schemes: the `next` theme loads its light and dark
 * stylesheets behind `prefers-color-scheme` media queries, which survive serialization.
 * The script verifies this itself by screenshotting the artifact under both schemes and
 * pixel-diffing each against the live app.
 *
 * Usage: pnpm exec tsx scripts/harvest-hero.mts
 * Output: site/hero-snapshot/hero.html + index.html viewer
 *         site/hero-snapshot/check/{real,snap}-{light,dark}.png for fidelity comparison
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { chromium, type Page } from "playwright";
import { PNG } from "pngjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(REPO, "site", "hero-snapshot");
const CHECK_DIR = path.join(OUT_DIR, "check");
const PORT = 8083;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 1600, height: 1000 };
const CHROMIUM_BIN = process.env.CHROME_BIN ?? "/etc/profiles/per-user/elian/bin/chromium";

interface HarvestStats {
    htmlBytes: number;
    cssBytes: number;
    inlinedAssets: number;
    inlinedBytes: number;
    failedUrls: string[];
}

async function main() {
    fs.mkdirSync(CHECK_DIR, { recursive: true });

    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "trilium-hero-"));
    fs.copyFileSync(
        path.join(REPO, "packages/trilium-core/src/test/fixtures/document.db"),
        path.join(dataDir, "document.db")
    );
    prepareShowcaseOptions(path.join(dataDir, "document.db"));

    console.log(`[harvest] data dir: ${dataDir}`);
    const server = spawn("pnpm", ["exec", "tsx", "./src/main.ts"], {
        cwd: path.join(REPO, "apps/server"),
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
            ...process.env,
            TRILIUM_DATA_DIR: dataDir,
            TRILIUM_PORT: String(PORT),
            TRILIUM_ENV: "dev",
            TRILIUM_RESOURCE_DIR: "src",
            NODE_ENV: "development",
            TRILIUM_GENERAL_NOAUTHENTICATION: "true"
        }
    });
    let serverLog = "";
    server.stdout?.on("data", (chunk) => (serverLog += chunk));
    server.stderr?.on("data", (chunk) => (serverLog += chunk));

    try {
        await waitForServer();
        console.log("[harvest] server is up");

        const outFile = path.join(OUT_DIR, "hero.html");
        const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
        try {
            const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
            const page = await context.newPage();

            for (const scheme of ["light", "dark"] as const) {
                await page.emulateMedia({ colorScheme: scheme });
                await page.goto(BASE_URL, { waitUntil: "load" });
                await waitForAppReady(page);
                await page.screenshot({ path: path.join(CHECK_DIR, `real-${scheme}.png`) });

                if (scheme === "light") {
                    const { html, stats } = await harvest(page);
                    fs.writeFileSync(outFile, html);
                    report(outFile, stats);
                }
            }

            // Screenshots the artifact under both schemes so fidelity can be diffed below.
            for (const scheme of ["light", "dark"] as const) {
                await page.emulateMedia({ colorScheme: scheme });
                await page.goto(`file://${outFile}`, { waitUntil: "load" });
                await page.waitForTimeout(1500);
                await page.screenshot({ path: path.join(CHECK_DIR, `snap-${scheme}.png`) });
            }
        } finally {
            await browser.close();
        }

        verifyFidelity();
        fs.writeFileSync(path.join(OUT_DIR, "index.html"), buildViewer());
        console.log(`[harvest] viewer: ${path.join(OUT_DIR, "index.html")}`);
    } catch (err) {
        console.error("[harvest] failed; last server output:\n" + serverLog.slice(-4000));
        throw err;
    } finally {
        if (server.pid) {
            try {
                process.kill(-server.pid, "SIGTERM");
            } catch {
                // The process group is already gone.
            }
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
}

/** Points the fixture database at the `next` theme, whose light and dark stylesheets are both
 *  loaded behind `prefers-color-scheme` media queries, so the emulated color scheme picks one. */
function prepareShowcaseOptions(dbPath: string) {
    const db = new Database(dbPath);
    try {
        const set = db.prepare("UPDATE options SET value = ? WHERE name = ?");
        set.run("next", "theme");
        set.run("false", "checkForUpdates");
    } finally {
        db.close();
    }
}

async function waitForServer() {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(BASE_URL);
            if (res.status < 500) return;
        } catch {
            // The server is not listening yet.
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("server did not come up within 120s");
}

async function waitForAppReady(page: Page) {
    await page.waitForFunction(
        () => {
            const glob = (window as any).glob;
            return glob?.appContext && document.querySelector(".fancytree-node");
        },
        undefined,
        { timeout: 60_000 }
    );
    await page.waitForLoadState("networkidle");
    // Lets lazy widgets (ribbon, editor) finish their first paint.
    await page.waitForTimeout(3000);
}

function report(outFile: string, stats: HarvestStats) {
    console.log(
        `[harvest] ${(stats.htmlBytes / 1024).toFixed(0)} KB html, ` +
            `${(stats.cssBytes / 1024).toFixed(0)} KB css, ` +
            `${stats.inlinedAssets} assets inlined (${(stats.inlinedBytes / 1024).toFixed(0)} KB) -> ${outFile}`
    );
    if (stats.failedUrls.length) {
        console.log(`[harvest] could not inline: ${stats.failedUrls.join(", ")}`);
    }
}

/** Pixel-diffs the artifact's rendering against the live app for both color schemes. */
function verifyFidelity() {
    for (const scheme of ["light", "dark"] as const) {
        const real = PNG.sync.read(fs.readFileSync(path.join(CHECK_DIR, `real-${scheme}.png`)));
        const snap = PNG.sync.read(fs.readFileSync(path.join(CHECK_DIR, `snap-${scheme}.png`)));
        if (real.width !== snap.width || real.height !== snap.height) {
            throw new Error(`${scheme}: screenshot sizes differ`);
        }
        let differing = 0;
        for (let i = 0; i < real.data.length; i += 4) {
            if (
                Math.abs(real.data[i] - snap.data[i]) > 8 ||
                Math.abs(real.data[i + 1] - snap.data[i + 1]) > 8 ||
                Math.abs(real.data[i + 2] - snap.data[i + 2]) > 8
            ) {
                differing++;
            }
        }
        const percent = (100 * differing) / (real.width * real.height);
        console.log(`[verify] ${scheme}: ${percent.toFixed(3)}% pixels differ from the live app`);
        if (percent > 0.5) {
            throw new Error(`${scheme}: snapshot deviates from the live app by ${percent.toFixed(3)}%`);
        }
    }
}

async function harvest(page: Page): Promise<{ html: string; stats: HarvestStats }> {
    // tsx (esbuild) compiles the evaluate callback with `__name(...)` helper calls, which do not
    // exist inside the page; a stub keeps the serialized function runnable.
    await page.evaluate("window.__name = (fn) => fn");
    return await page.evaluate(async () => {
        const failedUrls: string[] = [];
        let inlinedAssets = 0;
        let inlinedBytes = 0;
        const dataUriCache = new Map<string, string>();

        async function toDataUri(rawUrl: string, base: string): Promise<string | null> {
            let absolute: string;
            try {
                absolute = new URL(rawUrl, base).href;
            } catch {
                return null;
            }
            if (absolute.startsWith("data:") || absolute.startsWith("about:")) return null;
            const cached = dataUriCache.get(absolute);
            if (cached) return cached;
            try {
                const res = await fetch(absolute);
                if (!res.ok) throw new Error(String(res.status));
                const blob = await res.blob();
                const uri = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result as string);
                    reader.onerror = () => reject(reader.error);
                    reader.readAsDataURL(blob);
                });
                dataUriCache.set(absolute, uri);
                inlinedAssets++;
                inlinedBytes += blob.size;
                return uri;
            } catch {
                failedUrls.push(absolute);
                return null;
            }
        }

        async function inlineCssUrls(cssText: string, base: string): Promise<string> {
            const urlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
            const replacements = new Map<string, string>();
            for (const match of cssText.matchAll(urlPattern)) {
                const target = match[2];
                if (replacements.has(match[0])) continue;
                const uri = await toDataUri(target, base);
                if (uri) replacements.set(match[0], `url("${uri}")`);
            }
            let result = cssText;
            for (const [from, to] of replacements) {
                result = result.split(from).join(to);
            }
            return result;
        }

        async function collectSheet(sheet: CSSStyleSheet): Promise<string> {
            let rules: CSSRuleList;
            try {
                rules = sheet.cssRules;
            } catch {
                return ""; // Cross-origin sheet; the app does not use any.
            }
            const base = sheet.href ?? document.baseURI;
            const parts: string[] = [];
            for (const rule of Array.from(rules)) {
                if (rule instanceof CSSImportRule && rule.styleSheet) {
                    const imported = await collectSheet(rule.styleSheet);
                    parts.push(
                        rule.media.mediaText && rule.media.mediaText !== "all"
                            ? `@media ${rule.media.mediaText} {\n${imported}\n}`
                            : imported
                    );
                } else {
                    parts.push(await inlineCssUrls(rule.cssText, base));
                }
            }
            let text = parts.join("\n");
            // A media attribute on the owning <link> gates the whole sheet (the `next` theme
            // splits light/dark this way), so the wrapper must survive into the snapshot.
            const ownerMedia = sheet.ownerNode instanceof Element ? sheet.ownerNode.getAttribute("media") : null;
            if (ownerMedia && ownerMedia !== "all") {
                text = `@media ${ownerMedia} {\n${text}\n}`;
            }
            return text;
        }

        const cssParts: string[] = [];
        for (const sheet of Array.from(document.styleSheets)) {
            cssParts.push(await collectSheet(sheet));
        }
        const css = cssParts.join("\n");

        const clone = document.documentElement.cloneNode(true) as HTMLElement;

        for (const el of Array.from(clone.querySelectorAll("script, link, style, noscript, template, iframe"))) {
            el.remove();
        }

        // Freezes live form state into attributes so the snapshot renders it.
        const liveFields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
        const cloneFields = clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
        for (const [index, live] of Array.from(liveFields).entries()) {
            const target = cloneFields[index];
            if (!target) continue;
            if (live instanceof HTMLTextAreaElement) {
                target.textContent = live.value;
            } else {
                target.setAttribute("value", live.value);
                if ((live as HTMLInputElement).checked) target.setAttribute("checked", "");
            }
        }

        // Replaces canvases with their current bitmap.
        const liveCanvases = document.querySelectorAll("canvas");
        const cloneCanvases = clone.querySelectorAll("canvas");
        for (const [index, live] of Array.from(liveCanvases).entries()) {
            const target = cloneCanvases[index];
            if (!target) continue;
            try {
                const img = document.createElement("img");
                img.src = live.toDataURL();
                img.setAttribute("class", target.getAttribute("class") ?? "");
                img.setAttribute("style", target.getAttribute("style") ?? "");
                img.width = live.width;
                img.height = live.height;
                target.replaceWith(img);
            } catch {
                target.remove();
            }
        }

        for (const img of Array.from(clone.querySelectorAll("img"))) {
            const src = img.getAttribute("src");
            if (!src) continue;
            const uri = await toDataUri(src, document.baseURI);
            if (uri) {
                img.setAttribute("src", uri);
            }
            img.removeAttribute("srcset");
        }

        for (const el of Array.from(clone.querySelectorAll<HTMLElement>("*"))) {
            for (const attr of Array.from(el.attributes)) {
                if (attr.name.startsWith("on")) el.removeAttribute(attr.name);
            }
            el.removeAttribute("contenteditable");
        }

        const head = clone.querySelector("head");
        if (head) {
            head.innerHTML = '<meta charset="utf-8">';
            const style = document.createElement("style");
            style.textContent = css;
            head.appendChild(style);
            const freeze = document.createElement("style");
            freeze.textContent = "html { pointer-events: none; user-select: none; overflow: hidden; }";
            head.appendChild(freeze);
        }

        const html = "<!doctype html>\n" + clone.outerHTML;
        return {
            html,
            stats: {
                htmlBytes: html.length - css.length,
                cssBytes: css.length,
                inlinedAssets,
                inlinedBytes,
                failedUrls
            }
        };
    });
}

function buildViewer(): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Trilium hero snapshot</title>
<style>
    body { margin: 0; font-family: sans-serif; background: #202124; color: #e8eaed; }
    header { padding: 12px 20px; display: flex; gap: 16px; align-items: baseline; }
    header a { color: #8ab4f8; }
    .frame-wrapper { width: 100%; max-width: 1280px; aspect-ratio: ${VIEWPORT.width} / ${VIEWPORT.height}; margin: 0 auto 32px; position: relative; }
    .frame-wrapper iframe {
        width: ${VIEWPORT.width}px; height: ${VIEWPORT.height}px; border: 0;
        transform-origin: top left; position: absolute; top: 0; left: 0;
        border-radius: 8px; box-shadow: 0 8px 40px rgb(0 0 0 / 50%);
    }
</style>
</head>
<body>
<header>
    <strong>Harvested hero snapshot</strong>
    <a href="hero.html" target="_blank">open 1:1</a>
    <span>(one artifact — follows your OS light/dark preference)</span>
</header>
<div class="frame-wrapper"><iframe src="hero.html"></iframe></div>
<script>
    function rescale() {
        for (const wrapper of document.querySelectorAll(".frame-wrapper")) {
            const iframe = wrapper.querySelector("iframe");
            iframe.style.transform = "scale(" + (wrapper.clientWidth / ${VIEWPORT.width}) + ")";
        }
    }
    addEventListener("resize", rescale);
    rescale();
</script>
</body>
</html>
`;
}

await main();
