import { describe, expect, it } from "vitest";

import { pickReleaseVersion } from "./release_version";

describe("pickReleaseVersion", () => {
    it("keeps a stable version from package.json", () => {
        expect(pickReleaseVersion("0.107.0", [ "v0.106.1", "v0.107.0" ])).toBe("0.107.0");
    });

    it("links to the newest stable tag while main carries a prerelease", () => {
        const tags = [
            "v0.99.5", "v0.107.0", "v0.108.0-rc.1", "v0.106.1", "web-clipper-v1.2.0", "v0.48"
        ];

        expect(pickReleaseVersion("0.108.0-rc.1", tags)).toBe("0.107.0");
    });

    it("fails the build rather than link to a release that has no files", () => {
        expect(() => pickReleaseVersion("0.108.0-rc.1", [ "v0.108.0-rc.1" ]))
            .toThrow(/stable release tag/);
    });
});
