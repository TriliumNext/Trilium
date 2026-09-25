import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { checkPnpm, filterSources, resolveOutputPath } from "./generate-sources.mjs";

describe("checkPnpm", () => {
    it("accepts the pinned pnpm major, with or without a corepack checksum", () => {
        expect(() => checkPnpm(`{ "packageManager": "pnpm@12.4.2" }`)).not.toThrow();
        expect(() => checkPnpm(`{ "packageManager": "pnpm@12.4.2+sha512.abc" }`)).not.toThrow();
    });

    it("rejects another pnpm major, another package manager, and a missing pin", () => {
        expect(() => checkPnpm(`{ "packageManager": "pnpm@11.22.0" }`)).toThrow(/pnpm 12/);
        expect(() => checkPnpm(`{ "packageManager": "yarn@4.9.1" }`)).toThrow(/yarn@4.9.1/);
        expect(() => checkPnpm(`{}`)).toThrow(/undefined/);
    });
});

describe("resolveOutputPath", () => {
    it("defaults to upload/, appends the filename to a directory, and takes a file path as-is", () => {
        expect(resolveOutputPath(undefined).endsWith(join("upload", "generated-sources.json"))).toBe(true);

        const dir = mkdtempSync(join(tmpdir(), "flatpak-sources-"));
        try {
            expect(resolveOutputPath(dir)).toBe(join(dir, "generated-sources.json"));
            expect(resolveOutputPath(join(dir, "custom.json"))).toBe(join(dir, "custom.json"));
        } finally {
            rmSync(dir, { recursive: true });
        }
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
