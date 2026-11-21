import fs from "fs";
import path from "path";
import type { Browser, BrowserContextOptions } from "playwright";
import zlib from "zlib";

import { findOnPath, openApp, openNote, settle, waitForAssets } from "../shared/browser.ts";
import { type BuildOptions, type Builder, outDir, repoRoot } from "../shared/build.ts";
import { findNoteId, openDemo } from "../shared/demo_server.ts";
import { diffPngs } from "../shared/png.ts";
import { DEVICES, HERO, type HeroVariant } from "../shared/scenes.ts";
import { captureSnapshot } from "./snapshot.ts";

/** The share of pixels the hero snapshot can differ from the app by, in either color scheme. */
const HERO_MAX_DIFF = 0.005;

/** The website's own copy of Inter, which the snapshots load instead of embedding the font. */
const SHARED_FONTS = { Inter: "/fonts/Inter/Inter-VariableFont_opsz,wght.woff2" };

/** The origin the fidelity check serves a snapshot from, with `apps/website/public` behind it. */
const CHECK_ORIGIN = "http://hero.invalid";

const COLOR_SCHEMES = [ "light", "dark" ] as const;

export const HERO_TARGETS: Record<string, Builder> = {
    "hero": buildHero
};

/**
 * Writes each variant of the website hero in `HERO.variants` to `out/hero/<file>`: a snapshot of
 * the app, light only, whose CSS also carries the dark theme. The app is screenshotted in both
 * color schemes and the build fails when a snapshot differs from it by more than
 * `HERO_MAX_DIFF` in either one; otherwise the snapshots are copied to `apps/website/public/`.
 */
async function buildHero(browser: Browser, options: BuildOptions) {
    const fonttools = process.env.FONTTOOLS ?? findOnPath("fonttools");
    if (!fonttools) throw new Error("The hero needs the fonttools command; set FONTTOOLS.");
    const heroDir = path.join(outDir, "hero");
    fs.mkdirSync(heroDir, { recursive: true });
    const server = await openDemo(browser, options);
    try {
        for (const variant of HERO.variants) {
            console.log(`  ${variant.file}`);
            await captureVariant(browser, server.baseUrl, variant, heroDir, fonttools);
        }
    } finally {
        server.stop();
    }

    for (const variant of HERO.variants) {
        await compareVariant(browser, variant, heroDir);
    }
    if (!process.exitCode) {
        for (const variant of HERO.variants) {
            const published = path.join(repoRoot, "apps", "website", "public", variant.file);
            fs.copyFileSync(path.join(heroDir, variant.file), published);
            console.log(`  ${path.relative(repoRoot, published)}`);
        }
    }
}

/** Screenshots the app in both color schemes and writes the snapshot of the light one. */
async function captureVariant(browser: Browser, baseUrl: string, variant: HeroVariant,
    heroDir: string, fonttools: string) {
    const name = path.basename(variant.file, ".html");
    const noteId = await findNoteId(baseUrl, variant.query);
    for (const colorScheme of COLOR_SCHEMES) {
        const context = await browser.newContext(contextOptions(variant, colorScheme));
        if (variant.mobile) {
            await context.addCookies([ { name: "trilium-device", value: "mobile", url: baseUrl } ]);
        }
        const page = await context.newPage();
        await openApp(page, baseUrl);
        if (variant.mobile) {
            const { top, bottom } = variant.mobile.safeArea;
            await page.evaluate(({ insetTop, insetBottom }) => {
                const { style } = document.documentElement;
                style.setProperty("--safe-area-inset-top", `${insetTop}px`);
                style.setProperty("--safe-area-inset-bottom", `${insetBottom}px`);
            }, { insetTop: top, insetBottom: bottom });
        }
        await openNote(page, noteId, { hoist: variant.hoist });
        await settle(page);
        await page.mouse.move(variant.viewport.width - 1, variant.viewport.height - 1);
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(heroDir, `app-${name}-${colorScheme}.png`) });
        if (colorScheme === "light") {
            const { html, stats } = await captureSnapshot(page,
                { fonttools, sharedFonts: SHARED_FONTS });
            fs.writeFileSync(path.join(heroDir, variant.file), html);
            const fonts = stats.fonts
                .map(({ family, bytes, shared }) => shared ? `${family} (shared)`
                    : `${family} ${(bytes / 1024).toFixed(1)} KB`);
            console.log(`    ${stats.rulesKept} of ${stats.rulesKept + stats.rulesDropped} CSS `
                + `rules, ${stats.customProperties} custom properties, fonts: `
                + `${fonts.join(", ")}; unused: ${stats.unusedFonts.join(", ")}`);
        }
        await context.close();
    }
}

/** Screenshots the snapshot in both color schemes; fails the build when it strays from the app. */
async function compareVariant(browser: Browser, variant: HeroVariant, heroDir: string) {
    const name = path.basename(variant.file, ".html");
    const output = path.join(heroDir, variant.file);
    const html = fs.readFileSync(output);
    const brotli = zlib.brotliCompressSync(html).length;
    console.log(`  ${path.relative(outDir, output)}: ${Math.round(html.length / 1024)} KB, `
        + `${Math.round(brotli / 1024)} KB with Brotli`);
    for (const colorScheme of COLOR_SCHEMES) {
        const shot = path.join(heroDir, `snapshot-${name}-${colorScheme}.png`);
        const context = await browser.newContext(contextOptions(variant, colorScheme));
        // The snapshot is served as the website serves it, so that a shared font resolves.
        const publicDir = path.join(repoRoot, "apps", "website", "public");
        await context.route(`${CHECK_ORIGIN}/**`, (route) => {
            const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
            const file = pathname === `/${variant.file}` ? output : path.join(publicDir, pathname);
            if (fs.existsSync(file)) route.fulfill({ path: file });
            else route.fulfill({ status: 404 });
        });
        const page = await context.newPage();
        await page.goto(`${CHECK_ORIGIN}/${variant.file}`);
        await waitForAssets(page);
        await page.screenshot({ path: shot });
        await context.close();
        const share = diffPngs(path.join(heroDir, `app-${name}-${colorScheme}.png`), shot,
            path.join(heroDir, `diff-${name}-${colorScheme}.png`));
        const percent = `${(share * 100).toFixed(2)}%`;
        if (share > HERO_MAX_DIFF) {
            console.error(`    Fails: ${colorScheme} snapshot differs from the app by ${percent}`);
            process.exitCode = 1;
        } else {
            console.log(`    ${colorScheme}: differs from the app by ${percent}`);
        }
    }
}

function contextOptions(variant: HeroVariant,
    colorScheme: "light" | "dark"): BrowserContextOptions {
    if (!variant.mobile) return { viewport: variant.viewport, colorScheme };
    return {
        viewport: variant.viewport,
        isMobile: true,
        hasTouch: true,
        userAgent: DEVICES.phone.userAgent,
        colorScheme
    };
}
