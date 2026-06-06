import { describe, expect, it } from "vitest";

import appInfo from "./app_info.js";
import build from "./build.js";
import packageJson from "../../package.json" with { type: "json" };
import { getMaxMigrationVersion } from "../migrations/migrations.js";

describe("app_info", () => {
    it("derives version metadata from package.json, build info and migrations", () => {
        // The version-bearing fields are wired straight from their sources, so
        // assert against those sources rather than hardcoding values that would
        // break on every release / migration bump.
        expect(appInfo.appVersion).toBe(packageJson.version);
        expect(appInfo.dbVersion).toBe(getMaxMigrationVersion());
        expect(appInfo.buildDate).toBe(build.buildDate);
        expect(appInfo.buildRevision).toBe(build.buildRevision);
    });

    it("exposes the fixed sync and clipper protocol versions", () => {
        // These are protocol constants; bumping them is a deliberate,
        // breaking change, so they are locked here as a regression guard.
        expect(appInfo.syncVersion).toBe(39);
        expect(appInfo.clipperProtocolVersion).toBe("1.0");
    });

    it("reports a valid current UTC timestamp", () => {
        // utcDateTime is generated at module load via new Date().toISOString().
        expect(appInfo.utcDateTime).toBe(new Date(appInfo.utcDateTime).toISOString());
        expect(appInfo.utcDateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

        const generatedAt = new Date(appInfo.utcDateTime).getTime();
        expect(Number.isNaN(generatedAt)).toBe(false);
        // The timestamp is captured when the module is first imported, so it
        // must be in the past relative to the running test.
        expect(generatedAt).toBeLessThanOrEqual(Date.now());
    });

    it("populates every required AppInfo field with the expected primitive type", () => {
        expect(typeof appInfo.appVersion).toBe("string");
        expect(appInfo.appVersion.length).toBeGreaterThan(0);
        expect(typeof appInfo.dbVersion).toBe("number");
        expect(appInfo.dbVersion).toBeGreaterThan(0);
        expect(typeof appInfo.syncVersion).toBe("number");
        expect(typeof appInfo.buildDate).toBe("string");
        expect(typeof appInfo.buildRevision).toBe("string");
        expect(typeof appInfo.clipperProtocolVersion).toBe("string");
        expect(typeof appInfo.utcDateTime).toBe("string");
    });
});
