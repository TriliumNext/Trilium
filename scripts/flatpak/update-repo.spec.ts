import { describe, expect, it } from "vitest";

import { checkPlaceholdersFilled, checkPnpmSupported, formatOutputs, parsePnpmVersion, selectStaleFiles, updateGitSource, updatePnpmPins } from "./update-repo.mjs";

const MANIFEST = `\
modules:
  - name: trilium
    sources:
      - type: git
        url: https://github.com/TriliumNext/Trilium.git
        tag: __TAG__
        commit: __COMMIT__
      - generated-sources.json
      - type: archive
        url: https://registry.npmjs.org/@pnpm/exe.linux-x64/-/exe.linux-x64-__PNPM_VERSION__.tgz
        sha256: __PNPM_SHA256_X64__
        dest: flatpak-node/pnpm
        only-arches: [x86_64]
      - type: archive
        url: https://registry.npmjs.org/@pnpm/exe.linux-arm64/-/exe.linux-arm64-__PNPM_VERSION__.tgz
        sha256: __PNPM_SHA256_ARM64__
        dest: flatpak-node/pnpm
        only-arches: [aarch64]
`;

const NEW_COMMIT = "1234567890abcdef1234567890abcdef12345678";
const HASHES = { x64: "a".repeat(64), arm64: "b".repeat(64) };

describe("updateGitSource", () => {
    it("pins a release: tag and commit both fill in", () => {
        const updated = updateGitSource(MANIFEST, NEW_COMMIT, "v0.106.0");
        expect(updated).toContain(`        tag: v0.106.0\n        commit: ${NEW_COMMIT}`);
    });

    it("pins a beta: the tag line goes, only the commit stays", () => {
        const updated = updateGitSource(MANIFEST, NEW_COMMIT);
        expect(updated).toContain(`Trilium.git\n        commit: ${NEW_COMMIT}`);
        expect(updated).not.toContain("tag:");
    });

    it("rejects a manifest without the placeholders, filled ones included", () => {
        expect(() => updateGitSource("modules: []", NEW_COMMIT)).toThrow(/git source/);
        const filled = updateGitSource(MANIFEST, NEW_COMMIT, "v0.106.0");
        expect(() => updateGitSource(filled, NEW_COMMIT, "v0.107.0")).toThrow(/git source/);
    });
});

describe("formatOutputs", () => {
    it("reports the tag for a release and an empty tag for a beta", () => {
        expect(formatOutputs(NEW_COMMIT, "v0.106.0", "12.4.2")).toBe(
            `commit=${NEW_COMMIT}\nshort=12345678\ntag=v0.106.0\npnpm=12.4.2\n`);
        // The workflow drafts the pull request when the tag is empty.
        expect(formatOutputs(NEW_COMMIT, undefined, "12.4.2")).toContain("tag=\n");
    });
});

describe("pnpm pins", () => {
    it("parses packageManager, with or without a corepack checksum", () => {
        expect(parsePnpmVersion(`{ "packageManager": "pnpm@12.5.0" }`)).toBe("12.5.0");
        expect(parsePnpmVersion(`{ "packageManager": "pnpm@12.5.0+sha512.abc" }`)).toBe("12.5.0");
        expect(() => parsePnpmVersion(`{ "packageManager": "yarn@4.9.1" }`)).toThrow(/yarn@4.9.1/);
        expect(() => parsePnpmVersion(`{}`)).toThrow(/undefined/);
    });

    it("fills the version into both per-arch sources, each with its own hash", () => {
        const updated = updatePnpmPins(MANIFEST, "12.5.0", HASHES);
        expect(updated).toContain(`exe.linux-x64-12.5.0.tgz\n        sha256: ${HASHES.x64}`);
        expect(updated).toContain(`exe.linux-arm64-12.5.0.tgz\n        sha256: ${HASHES.arm64}`);
    });

    it("rejects a ref older than the per-arch pnpm packages", () => {
        expect(() => checkPnpmSupported("12.4.2")).not.toThrow();
        // pnpm 11 shipped one wrapper tarball; @pnpm/exe.* starts at 12, so the
        // fetch would 404 with nothing explaining why.
        expect(() => checkPnpmSupported("11.22.0")).toThrow(/pnpm 12 or newer/);
    });

    it("rejects a manifest missing a per-arch source", () => {
        const withoutArm = MANIFEST.replace("__PNPM_SHA256_ARM64__", "deadbeef");
        expect(() => updatePnpmPins(withoutArm, "12.5.0", HASHES)).toThrow(/__PNPM_SHA256_ARM64__/);
    });
});

describe("checkPlaceholdersFilled", () => {
    it("passes a fully pinned manifest and names what a partial one left behind", () => {
        const pinned = updatePnpmPins(updateGitSource(MANIFEST, NEW_COMMIT, "v0.106.0"), "12.5.0", HASHES);
        expect(() => checkPlaceholdersFilled(pinned)).not.toThrow();
        expect(() => checkPlaceholdersFilled(`${pinned}  sha256: __ELECTRON_SHA256__\n`))
            .toThrow(/__ELECTRON_SHA256__/);
    });
});

describe("selectStaleFiles", () => {
    it("keeps what the recipe writes and the repo owns, removes the rest", () => {
        const tracked = [
            ".gitignore",
            "README.md",
            "flathub.json",
            "flip-fuses.mts",
            "generated-sources.json",
            "org.triliumnotes.Trilium.yml",
            "stamp-build-info.mts",
            "trilium.sh",
            "trim-locales.mts",
            ""
        ].join("\n");

        expect(selectStaleFiles(tracked))
            .toEqual([ "flip-fuses.mts", "stamp-build-info.mts", "trim-locales.mts" ]);
    });

    it("finds nothing to remove once a repo holds only the recipe", () => {
        expect(selectStaleFiles("org.triliumnotes.Trilium.yml\ntrilium.sh\n")).toEqual([]);
    });
});
