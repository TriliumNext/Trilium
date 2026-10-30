import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import packageJson from "../package.json" with { type: "json" };
import electronLocales from "./electron-locales.json" with { type: "json" };
import { trimElectronLocales } from "./trim-locales.js";

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
    it("runs against the locale files of the pinned Electron version", () => {
        expect(
            electronLocales.electronVersion,
            "electron-locales.json is out of date; run `pnpm chore:update-electron-locales`"
        ).toBe(packageJson.devDependencies.electron);
    });

    it.each([
        [ "Linux", electronLocales.linux ],
        [ "Windows", electronLocales.win32 ]
    ])("keeps the exposed locales of the %s package, resolving en-US.pak to \"en\"", (_, paks) => {
        const dir = makeLocaleDir(paks);

        const { kept, removed } = trimElectronLocales([ dir ], false);

        expect(kept.size + removed.length).toBe(paks.length);
        expect(existsSync(join(dir, "en-US.pak"))).toBe(true);
        expect(existsSync(join(dir, "zh-CN.pak"))).toBe(true);
        // Hebrew is content-only, so its Chromium locale goes.
        expect(existsSync(join(dir, "he.pak"))).toBe(false);
    });

    it("removes mac .lproj directories, keeping underscore names and ignoring other entries", () => {
        const resources = makeLocaleDir(electronLocales.darwin.resources, true);
        writeFileSync(join(resources, "icon.icns"), "");
        // Mac spreads locales over two directories; the keep check spans both.
        const frameworkResources = makeLocaleDir(
            electronLocales.darwin.frameworkResources, true
        );

        const { kept } = trimElectronLocales([ resources, frameworkResources ], true);

        expect(kept).toContain("zh_CN");
        expect(existsSync(join(resources, "zh_CN.lproj"))).toBe(true);
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
