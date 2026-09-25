import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { trimElectronLocales } from "./trim-locales.js";

// The locale files Electron 44 ships on Linux and Windows.
const ELECTRON_PAKS = [
    "af", "am", "ar", "bg", "bn", "ca", "cs", "da", "de", "el", "en-GB", "en-US",
    "es", "es-419", "et", "fa", "fi", "fil", "fr", "gu", "he", "hi", "hr", "hu",
    "id", "it", "ja", "kn", "ko", "lt", "lv", "ml", "mr", "ms", "nb", "nl", "pl",
    "pt-BR", "pt-PT", "ro", "ru", "sk", "sl", "sr", "sv", "sw", "ta", "te", "th",
    "tr", "uk", "ur", "vi", "zh-CN", "zh-TW"
];

const tempDirs: string[] = [];

function makeLocaleDir(entries: string[], asDirectories = false): string {
    const dir = mkdtempSync(join(tmpdir(), "trim-locales-"));
    tempDirs.push(dir);
    for (const entry of entries) {
        if (asDirectories) {
            mkdirSync(join(dir, entry));
            writeFileSync(join(dir, entry, "locale.strings"), "");
        } else {
            writeFileSync(join(dir, entry), "");
        }
    }
    return dir;
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe("trimElectronLocales", () => {
    it("keeps exactly the exposed locales, resolving en-US.pak to the \"en\" entry", () => {
        const dir = makeLocaleDir(ELECTRON_PAKS.map((l) => `${l}.pak`));

        const { kept, removed } = trimElectronLocales([ dir ], false);

        expect(kept.size).toBe(21);
        expect(removed).toHaveLength(34);
        expect(existsSync(join(dir, "en-US.pak"))).toBe(true);
        expect(existsSync(join(dir, "zh-CN.pak"))).toBe(true);
        // Hebrew is content-only, so its Chromium locale goes.
        expect(existsSync(join(dir, "he.pak"))).toBe(false);
    });

    it("removes mac .lproj directories, keeping underscore names and ignoring other entries", () => {
        const resources = makeLocaleDir([ "zh_CN.lproj", "he.lproj" ], true);
        writeFileSync(join(resources, "icon.icns"), "");
        // Mac spreads locales over two directories; the keep check spans both.
        const frameworkResources = makeLocaleDir(
            [ "en.lproj", "de.lproj", "es.lproj", "fr.lproj", "zh_TW.lproj", "ro.lproj", "cs.lproj",
                "en_GB.lproj", "id.lproj", "it.lproj", "hi.lproj", "ja.lproj", "ko.lproj", "pt_BR.lproj",
                "pt_PT.lproj", "pl.lproj", "ru.lproj", "tr.lproj", "uk.lproj", "ar.lproj" ],
            true
        );

        const { kept, removed } = trimElectronLocales([ resources, frameworkResources ], true);

        expect(kept).toContain("zh_CN");
        expect(removed).toEqual([ "he.lproj" ]);
        expect(existsSync(join(resources, "he.lproj"))).toBe(false);
        expect(existsSync(join(resources, "icon.icns"))).toBe(true);
    });

    it("rejects a missing directory and a package missing a keep-list locale", () => {
        expect(() => trimElectronLocales([ "/nonexistent/locales" ], false))
            .toThrow(/No locales directory/);

        const incomplete = makeLocaleDir([ "en-US.pak", "de.pak" ]);
        expect(() => trimElectronLocales([ incomplete ], false)).toThrow(/was not found/);
    });
});
