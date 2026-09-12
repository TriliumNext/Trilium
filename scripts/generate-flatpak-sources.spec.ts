import { describe, expect, it } from "vitest";

import { checkPnpm, filterSources } from "./generate-flatpak-sources.mjs";

describe("checkPnpm", () => {
    it("accepts the pinned pnpm major, with or without a corepack checksum", () => {
        expect(() => checkPnpm(`{ "packageManager": "pnpm@11.24.0" }`)).not.toThrow();
        expect(() => checkPnpm(`{ "packageManager": "pnpm@11.24.0+sha512.abc" }`)).not.toThrow();
    });

    it("rejects another pnpm major, another package manager, and a missing pin", () => {
        expect(() => checkPnpm(`{ "packageManager": "pnpm@12.0.0" }`)).toThrow(/pnpm 11/);
        expect(() => checkPnpm(`{ "packageManager": "yarn@4.9.1" }`)).toThrow(/yarn@4.9.1/);
        expect(() => checkPnpm(`{}`)).toThrow(/undefined/);
    });
});

describe("filterSources", () => {
    const tarballs = Array.from({ length: 2500 }, (_, i) => ({
        type: "file",
        url: `https://registry.npmjs.org/pkg/-/pkg-${i}.tgz`,
        dest: "flatpak-node/pnpm-tarballs"
    }));
    const electron = {
        type: "file",
        url: "https://github.com/electron/electron/releases/download/v44.0.0/electron-v44.0.0-linux-x64.zip",
        dest: "flatpak-node/cache/electron"
    };
    const playwright = [
        {
            type: "archive",
            url: "https://cdn.playwright.dev/builds/cft/151.0/linux64/chrome-linux64.zip",
            dest: "flatpak-node/cache/ms-playwright/chromium-1234"
        },
        {
            type: "inline",
            contents: "flatpak-node-cache",
            dest: "flatpak-node/cache/ms-playwright/chromium-1234"
        }
    ];

    it("drops exactly the Playwright cache entries", () => {
        const kept = filterSources([ ...tarballs, electron, ...playwright ]);
        expect(kept).toHaveLength(tarballs.length + 1);
        expect(kept.some((s) => s.dest?.includes("ms-playwright"))).toBe(false);
        expect(kept).toContain(electron);
    });

    it("rejects generator output that lost its expected shape", () => {
        // Nothing matching the filter means the generator moved its cache paths.
        expect(() => filterSources([ ...tarballs, electron ])).toThrow(/no Playwright/);
        // A collapsed count means packages went missing wholesale.
        expect(() => filterSources([ electron, ...playwright ])).toThrow(/expected around 2500/);
        // The manifest unpacks the Electron zip, so its absence must fail here.
        expect(() => filterSources([ ...tarballs, ...playwright ])).toThrow(/Electron zip/);
    });
});
