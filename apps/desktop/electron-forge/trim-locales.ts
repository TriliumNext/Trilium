/**
 * Trims the Chromium locale files a packaged Electron build carries (~38 MB)
 * down to the locales Trilium exposes. The electron-forge postPackage hook
 * calls it per package output; the Flathub build runs it as a script, with
 * tsx, on the locales directory of its unpacked Electron.
 */

import { existsSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";

import { LOCALES } from "@triliumnext/commons";

export function trimElectronLocales(localeDirs: string[], isMac: boolean) {
    const localesToKeep = getLocalesToKeep(isMac);
    // Mac locales are .lproj directories; the other platforms ship .pak files.
    const extension = isMac ? ".lproj" : ".pak";
    const kept = new Set<string>();
    const removed: string[] = [];

    for (const localeDir of localeDirs) {
        if (!existsSync(localeDir)) {
            throw new Error(`No locales directory found in '${localeDir}'.`);
        }

        for (const file of readdirSync(localeDir)) {
            if (!file.endsWith(extension)) {
                continue;
            }

            const localeName = normalizeLocaleName(basename(file, extension), isMac);
            if (localesToKeep.has(localeName)) {
                kept.add(localeName);
            } else {
                rmSync(join(localeDir, file), { recursive: true });
                removed.push(file);
            }
        }
    }

    // A keep-list locale absent from the package would ship a build silently
    // missing a UI language; fail the packaging instead.
    for (const locale of localesToKeep) {
        if (!kept.has(locale)) {
            throw new Error(`Locale ${locale} was not found in the packaged app.`);
        }
    }

    return { kept, removed };
}

/**
 * The locales to keep, as locale file base names — hyphenated (`zh-CN.pak`),
 * except on mac, which names its `.lproj` directories with underscores.
 */
function getLocalesToKeep(isMac: boolean): Set<string> {
    const names: string[] = [];
    for (const locale of LOCALES) {
        if (locale.contentOnly || !locale.electronLocale) {
            continue;
        }
        names.push(isMac ? locale.electronLocale : locale.electronLocale.replace("_", "-"));
    }
    return new Set(names);
}

/** Electron names the English locale file `en-US.pak` where {@link LOCALES} has "en"; mac names it `en.lproj` already. */
function normalizeLocaleName(name: string, isMac: boolean): string {
    return !isMac && name === "en-US" ? "en" : name;
}

// Only when run as a script — the Flathub build passes the locales directory
// of its unpacked, always-Linux Electron.
if (process.argv[1] === import.meta.filename) {
    const localesDir = process.argv[2];
    if (!localesDir) {
        throw new Error("Pass the locales directory to trim.");
    }
    const { kept, removed } = trimElectronLocales([ localesDir ], false);
    console.log(`Removed ${removed.length} locales, kept ${kept.size}.`);
}
