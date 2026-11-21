#!/usr/bin/env node
/**
 * Builds the pictures of Trilium shown outside the app, from a demo document:
 *
 * - Google Play (`play/`): the icon, the feature graphic, phone and tablet screenshots and
 *   `out/preview.html`, a mock of the listing, checked against the store's size and length
 *   limits.
 * - Flathub (`flathub/`): screenshots of the desktop app's window, captured inside a headless
 *   GNOME Shell, and `out/flathub-preview.html`, a mock of the app page from those screenshots
 *   and the metainfo, with Flathub's quality checks.
 * - The website hero (`hero/`): a self-contained HTML snapshot of the app in `out/hero`,
 *   published to `apps/website/public/hero.html` once it matches the app.
 *
 * Usage:
 *   pnpm --filter showcase play | flathub | hero
 *   pnpm --filter showcase start [icon] [screenshots] [feature] [preview] [flathub]
 *       [flathub-preview] [hero]
 *       [--only tree,text] [--devices phone,tablet] [--url http://localhost:8080] [--port 37991]
 *
 * With no target it builds the Play Store assets only. The demo document is a fresh one with the
 * demo content plus what `SEED` in `shared/scenes.mjs` adds, on a dev server the build boots,
 * unless --url points at a running one that has both and needs no login; `flathub` always boots
 * its own and then opens the document in the desktop app, and needs `gnome-shell`,
 * `dbus-run-session` and `gdbus` on the PATH; `hero` needs the `fonttools` command, with the
 * Brotli module. Output goes to `apps/showcase/out`.
 *
 * Environment:
 *   CHROME_BIN  browser executable, for systems where Playwright's browsers cannot run (NixOS);
 *               a `chromium` on the PATH is found without it
 *   FONTTOOLS   the `fonttools` command, when the one on the PATH lacks Brotli
 */
import fs from "fs";

import { FLATHUB_TARGETS } from "./flathub/build.mjs";
import { HERO_TARGETS } from "./hero/build.mjs";
import { checkPlayAssets, PLAY_TARGETS } from "./play/build.mjs";
import { launchBrowser } from "./shared/browser.mjs";
import { outDir } from "./shared/paths.mjs";
import { DEVICES } from "./shared/scenes.mjs";

const BUILDERS = { ...PLAY_TARGETS, ...FLATHUB_TARGETS, ...HERO_TARGETS };

/** Names that stand for several targets; `play` is built when none is named. */
const GROUPS = {
    "play": Object.keys(PLAY_TARGETS)
};

const options = parseArgs(process.argv.slice(2));
fs.mkdirSync(outDir, { recursive: true });
const browser = await launchBrowser();
try {
    for (const [ target, build ] of Object.entries(BUILDERS)) {
        if (options.targets.includes(target)) {
            console.log(`Building ${target}...`);
            await build(browser, options);
        }
    }
    if (options.targets.some((target) => target in PLAY_TARGETS)) {
        checkPlayAssets();
    }
} finally {
    await browser.close();
}

function parseArgs(args) {
    const result = {
        targets: [],
        devices: Object.keys(DEVICES),
        only: undefined,
        url: undefined,
        port: 37991
    };
    const names = [ ...Object.keys(GROUPS), ...Object.keys(BUILDERS) ];
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === "--only") result.only = args[++index].split(",");
        else if (arg === "--devices") result.devices = args[++index].split(",");
        else if (arg === "--url") result.url = args[++index].replace(/\/$/, "");
        else if (arg === "--port") result.port = Number(args[++index]);
        else if (arg in GROUPS) result.targets.push(...GROUPS[arg]);
        else if (arg in BUILDERS) result.targets.push(arg);
        else throw new Error(`Unknown argument ${arg}; targets are ${names.join(", ")}.`);
    }
    if (!result.targets.length) result.targets = GROUPS.play;
    return result;
}
