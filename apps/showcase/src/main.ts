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
 * - The website's screenshots (`website/`): note types, collections and the note tree in the
 *   desktop layout, light and dark, as WebP in `out/website` and `apps/website/public`.
 * - The User Guide (`docs/`, target `user-guide`): heroes of note types, collections and the tree, light, at 1x, over
 *   their attachments in `docs/User Guide`.
 *
 * Usage:
 *   pnpm --filter showcase play | flathub | hero | website | user-guide
 *   pnpm --filter showcase start [icon] [screenshots] [feature] [preview] [flathub]
 *       [flathub-preview] [hero] [website] [user-guide]
 *       [--only tree,text] [--devices phone,tablet] [--url http://localhost:8080] [--port 37991]
 *
 * With no target it builds the Play Store assets only. The demo document is a fresh one with the
 * demo content plus what `SEED` in `shared/scenes.ts` adds, on a dev server the build boots,
 * unless --url points at a running one that has both and needs no login; `flathub` always boots
 * its own and then opens the document in the desktop app, and needs `gnome-shell`,
 * `dbus-run-session` and `gdbus` on the PATH; `hero` needs the `fonttools` command, with the
 * Brotli module. Output goes to `apps/showcase/out`.
 *
 * Environment:
 *   CHROME_BIN  browser executable, for systems where Playwright's browsers cannot run (NixOS);
 *               a `chromium` on the PATH is found without it
 *   FONTTOOLS   the `fonttools` command, when the one on the PATH lacks Brotli
 *
 * The sources run on Node's own type stripping, not tsx: tsx wraps functions in `__name()`
 * calls, which do not exist where the functions passed to `page.evaluate()` and `SEED` run.
 */
import fs from "fs";
import { parseArgs } from "util";

import { DOCS_TARGETS } from "./docs/build.ts";
import { FLATHUB_TARGETS } from "./flathub/build.ts";
import { HERO_TARGETS } from "./hero/build.ts";
import { checkPlayAssets, PLAY_TARGETS } from "./play/build.ts";
import { launchBrowser } from "./shared/browser.ts";
import { type BuildOptions, type Builder, outDir } from "./shared/build.ts";
import { DEVICES } from "./shared/scenes.ts";
import { WEBSITE_TARGETS } from "./website/build.ts";

const BUILDERS: Record<string, Builder> = {
    ...PLAY_TARGETS, ...FLATHUB_TARGETS, ...HERO_TARGETS, ...WEBSITE_TARGETS, ...DOCS_TARGETS
};

/** Names that stand for several targets; `play` is built when none is named. */
const GROUPS: Record<string, string[]> = {
    "play": Object.keys(PLAY_TARGETS)
};

const options = readOptions(process.argv.slice(2));
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
        await checkPlayAssets(browser);
    }
} finally {
    await browser.close();
}

function readOptions(args: string[]): BuildOptions {
    const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: {
            only: { type: "string" },
            devices: { type: "string" },
            url: { type: "string" },
            port: { type: "string", default: "37991" }
        }
    });
    const targets = positionals.flatMap((name) => {
        if (name in GROUPS) return GROUPS[name];
        if (name in BUILDERS) return [ name ];
        const names = [ ...Object.keys(GROUPS), ...Object.keys(BUILDERS) ];
        throw new Error(`Unknown target ${name}; targets are ${names.join(", ")}.`);
    });
    return {
        targets: targets.length ? targets : GROUPS.play,
        devices: values.devices?.split(",") ?? Object.keys(DEVICES),
        only: values.only?.split(","),
        url: values.url?.replace(/\/$/, ""),
        port: Number(values.port)
    };
}
