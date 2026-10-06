import { describe, expect, it } from "vitest";

import {
    parseShasums,
    readPinnedElectronVersion,
    readWantedElectronVersion,
    rewriteFlake
} from "./update-flake-electron";

/** Trimmed to the shape the script anchors on, indentation included. */
const FLAKE = `{
  outputs =
    { self }:
    let
      pinnedElectronVersion = "43.2.0";
      pinnedElectronHashes = {
        x86_64-linux = "old-x64";
        aarch64-linux = "old-arm64";
        aarch64-darwin = "old-darwin-arm64";
        headers = "old-headers";
      };
      nodejs = pkgs.nodejs_24;
    in
    { };
}
`;

const HASHES = {
    "x86_64-linux": "x64",
    "aarch64-linux": "arm64",
    "aarch64-darwin": "darwin-arm64",
    "headers": "headers"
};

const desktopPackageJson = (electron: string) => JSON.stringify({ devDependencies: { electron } });

describe("readWantedElectronVersion", () => {
    it("reads an exact pin", () => {
        expect(readWantedElectronVersion(desktopPackageJson("43.3.0"))).toBe("43.3.0");
    });

    it("rejects ranges and missing entries, which cannot be pinned to one build", () => {
        expect(() => readWantedElectronVersion(desktopPackageJson("^43.3.0"))).toThrow(/exact/);
        expect(() => readWantedElectronVersion(desktopPackageJson("latest"))).toThrow(/exact/);
        expect(() => readWantedElectronVersion("{}")).toThrow(/devDependencies/);
    });
});

describe("readPinnedElectronVersion", () => {
    it("reads the flake's pin, and fails loudly when the binding is gone", () => {
        expect(readPinnedElectronVersion(FLAKE)).toBe("43.2.0");
        expect(() => readPinnedElectronVersion("{ }")).toThrow(/pinnedElectronVersion/);
    });
});

describe("parseShasums", () => {
    const shasums = [
        `${"a".repeat(64)} *chromedriver-v43.3.0-linux-x64.zip`,
        `${"1".repeat(64)} *electron-v43.3.0-linux-x64.zip`,
        `${"2".repeat(64)} *electron-v43.3.0-linux-armv7l.zip`,
        `${"3".repeat(64)} *electron-v43.3.0-linux-arm64.zip`,
        `${"4".repeat(64)} *electron-v43.3.0-darwin-x64.zip`,
        `${"5".repeat(64)} *electron-v43.3.0-darwin-arm64.zip`,
        `${"b".repeat(64)} *electron-v43.3.0-linux-x64-symbols.zip`,
        `${"c".repeat(64)} *electron-v43.3.0-mas-x64.zip`,
        ""
    ].join("\n");

    it("picks the platform zips it pins and ignores the rest of the release", () => {
        expect(parseShasums(shasums, "43.3.0")).toEqual({
            "x86_64-linux": "1".repeat(64),
            "aarch64-linux": "3".repeat(64),
            "aarch64-darwin": "5".repeat(64)
        });
    });

    it("names the assets it could not find rather than emitting a partial set", () => {
        expect(() => parseShasums(shasums, "43.4.0")).toThrow(/electron-v43\.4\.0-linux-x64\.zip/);

        // Only the one that is genuinely absent — the two it did resolve stay unmentioned.
        const withoutArm = shasums.replace(/^.*darwin-arm64\.zip$/m, "");
        const onlyDarwinArm = /^(?!.*linux-x64).*darwin-arm64\.zip/s;
        expect(() => parseShasums(withoutArm, "43.3.0")).toThrow(onlyDarwinArm);
    });
});

describe("rewriteFlake", () => {
    const rewritten = rewriteFlake(FLAKE, "43.3.0", HASHES);

    it("replaces both bindings, keeping indentation and the surrounding expression", () => {
        expect(rewritten).toBe(`{
  outputs =
    { self }:
    let
      pinnedElectronVersion = "43.3.0";
      pinnedElectronHashes = {
        x86_64-linux = "x64";
        aarch64-linux = "arm64";
        aarch64-darwin = "darwin-arm64";
        headers = "headers";
      };
      nodejs = pkgs.nodejs_24;
    in
    { };
}
`);
    });

    it("is stable when re-run against its own output", () => {
        expect(rewriteFlake(rewritten, "43.3.0", HASHES)).toBe(rewritten);
    });

    it("refuses to touch a flake it no longer recognises", () => {
        const versionOnly = `pinnedElectronVersion = "43.2.0";`;
        expect(() => rewriteFlake(versionOnly, "43.3.0", HASHES)).toThrow(/pinnedElectronHashes/);
        expect(() => rewriteFlake("{ }", "43.3.0", HASHES)).toThrow(/pinnedElectronVersion/);
    });
});
