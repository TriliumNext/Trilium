import { describe, expect, it } from "vitest";

import {
    compareVersions, latestRelease, parseVersion, registerReleaseNote, setPackageVersion,
    suggestVersion, type Version
} from "./release.mjs";

function version(text: string): Version {
    const parsed = parseVersion(text);
    if (!parsed) {
        throw new Error(`Not a version: ${text}`);
    }
    return parsed;
}

describe("parseVersion", () => {
    it("reads releases and pre-releases with or without the v", () => {
        expect(parseVersion("v0.107.0")).toEqual({ major: 0, minor: 107, patch: 0 });
        expect(parseVersion("0.107.0-rc.1")).toEqual(
            { major: 0, minor: 107, patch: 0, preRelease: "rc.1" });
        expect(parseVersion("v0.107")).toBeUndefined();
        expect(parseVersion("nightly")).toBeUndefined();
    });
});

describe("latestRelease", () => {
    it("orders by version, with a pre-release before its release", () => {
        expect(compareVersions(version("0.107.0-rc.2"), version("0.107.0-rc.10"))).toBeLessThan(0);
        expect(compareVersions(version("0.107.0-rc.1"), version("0.107.0"))).toBeLessThan(0);
        expect(latestRelease([ "v0.99.5", "v0.106.1", "v0.106.0", "nightly", "v0.48" ]))
            .toEqual(version("0.106.1"));
        expect(latestRelease([ "v0.106.1", "v0.107.0-rc.1" ])).toEqual(version("0.107.0-rc.1"));
    });
});

describe("suggestVersion", () => {
    const previous = version("0.106.1");

    it("proposes a minor release for a few fixes", () => {
        expect(suggestVersion(previous, {
            sections: [ "Bugfixes", "Bugfixes", "Internationalization" ], protocolChanged: false
        })).toEqual({
            version: "0.106.2",
            kind: "minor",
            reasons: [ "only 3 entries, with no feature, breaking or compatibility change" ]
        });
    });

    it("proposes a major release for features, breaking changes, protocol bumps or volume", () => {
        expect(suggestVersion(previous, {
            sections: [ "Breaking changes", "Improvements", "Improvements", "Bugfixes" ],
            protocolChanged: true
        })).toEqual({
            version: "0.107.0",
            kind: "major",
            reasons: [ "Breaking changes (1)", "Improvements (2)",
                "the sync or database version changed" ]
        });
        expect(suggestVersion(previous, {
            sections: Array(15).fill("Bugfixes"), protocolChanged: false
        })).toMatchObject({ version: "0.107.0", reasons: [ "15 changelog entries" ] });
    });

    it("follows a pre-release with its release", () => {
        expect(suggestVersion(version("0.107.0-rc.1"), { sections: [], protocolChanged: false }))
            .toMatchObject({ version: "0.107.0", kind: "major" });
    });
});

describe("setPackageVersion", () => {
    it("replaces the top-level version only", () => {
        const source = `{\n  "name": "x",\n  "version": "0.106.1",\n  "dependencies": {}\n}`;
        expect(setPackageVersion(source, "0.107.0"))
            .toBe(`{\n  "name": "x",\n  "version": "0.107.0",\n  "dependencies": {}\n}`);
        expect(() => setPackageVersion("{}", "0.107.0")).toThrow();
    });
});

describe("registerReleaseNote", () => {
    const meta = JSON.stringify({
        formatVersion: 2,
        files: [ {
            noteId: "folder",
            children: [
                { noteId: "a", title: "v0.106.1", notePosition: 10, dataFileName: "v0.106.1.md" },
                { noteId: "t", title: "Release Template", notePosition: 20,
                    dataFileName: "Release Template.md" }
            ]
        } ]
    }, null, 4);

    it("adds the note on top from the template and moves the others down", () => {
        const children = JSON.parse(registerReleaseNote(meta, "v0.107.0", "newNote")).files[0]
            .children;
        expect(children.map((child: { title: string; notePosition: number }) =>
            [ child.title, child.notePosition ])).toEqual(
            [ [ "v0.107.0", 10 ], [ "v0.106.1", 20 ], [ "Release Template", 30 ] ]);
        expect(children[0]).toMatchObject({
            noteId: "newNote",
            notePath: [ "folder", "newNote" ],
            dataFileName: "v0.107.0.md",
            attributes: [ { type: "relation", name: "template", value: "wyurrlcDl416" } ]
        });
    });

    it("leaves a registered note alone", () => {
        expect(registerReleaseNote(meta, "v0.106.1", "newNote")).toBe(meta);
    });
});
