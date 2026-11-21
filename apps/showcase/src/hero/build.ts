import fs from "fs";
import path from "path";
import type { Browser } from "playwright";
import { pathToFileURL } from "url";
import zlib from "zlib";

import { findOnPath, openApp, openNote, settle, waitForAssets } from "../shared/browser.ts";
import { type BuildOptions, type Builder, outDir, repoRoot } from "../shared/build.ts";
import { findNoteId, openDemo } from "../shared/demo_server.ts";
import { diffPngs } from "../shared/png.ts";
import { HERO } from "../shared/scenes.ts";
import { captureSnapshot } from "./snapshot.ts";

/** The share of pixels the hero snapshot can differ from the app by, in either color scheme. */
const HERO_MAX_DIFF = 0.005;

export const HERO_TARGETS: Record<string, Builder> = {
    "hero": buildHero
};

/**
 * Writes the website hero to `out/hero/hero.html`: a snapshot of the desktop layout, light only,
 * whose CSS also carries the dark theme. The app is screenshotted in both color schemes and the
 * build fails when the snapshot differs from it by more than `HERO_MAX_DIFF` in either one;
 * otherwise the snapshot is copied to `apps/website/public/hero.html`.
 */
async function buildHero(browser: Browser, options: BuildOptions) {
    const fonttools = process.env.FONTTOOLS ?? findOnPath("fonttools");
    if (!fonttools) throw new Error("The hero needs the fonttools command; set FONTTOOLS.");
    const heroDir = path.join(outDir, "hero");
    fs.mkdirSync(heroDir, { recursive: true });
    const server = await openDemo(browser, options);
    const output = path.join(heroDir, "hero.html");
    try {
        const noteId = await findNoteId(server.baseUrl, HERO.query);
        for (const colorScheme of [ "light", "dark" ] as const) {
            const context = await browser.newContext({ viewport: HERO.viewport, colorScheme });
            const page = await context.newPage();
            await openApp(page, server.baseUrl);
            await openNote(page, noteId, { hoist: true });
            await settle(page);
            await page.mouse.move(HERO.viewport.width - 1, HERO.viewport.height - 1);
            await page.waitForTimeout(500);
            await page.screenshot({ path: path.join(heroDir, `app-${colorScheme}.png`) });
            if (colorScheme === "light") {
                const { html, stats } = await captureSnapshot(page, { fonttools });
                fs.writeFileSync(output, html);
                const fonts = stats.fonts
                    .map(({ family, bytes }) => `${family} ${(bytes / 1024).toFixed(1)} KB`);
                console.log(`  ${stats.rulesKept} of ${stats.rulesKept + stats.rulesDropped} CSS `
                    + `rules, ${stats.customProperties} custom properties, fonts: `
                    + `${fonts.join(", ")}; unused: ${stats.unusedFonts.join(", ")}`);
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
    for (const colorScheme of [ "light", "dark" ] as const) {
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
    if (!process.exitCode) {
        const published = path.join(repoRoot, "apps", "website", "public", "hero.html");
        fs.copyFileSync(output, published);
        console.log(`  ${path.relative(repoRoot, published)}`);
    }
}
