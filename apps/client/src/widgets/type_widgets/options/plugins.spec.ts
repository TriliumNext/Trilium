import { afterEach, describe, expect, it, vi } from "vitest";

import {
    compareVersions,
    compatibilityStatus,
    formatCompatibility,
    formatDependency,
    isCatalogPackageEntry,
    isNewerVersion,
    isPackageArtifact,
    isPackageArtifactSource,
    isPackageCompatibility,
    isPackageDependency,
    isPackageSettingDefinition,
    isSecurePackageUrl,
    loadCatalog,
    manifestStatus,
    normalizeSourceHosts,
    packageHealth,
    parseCachedPackageManifest,
    parseRegistryUrls,
    parseSettingValue,
    serializeSetting,
    settingLabelName,
    shouldScheduleUpdateChecks
} from "./plugins";

const integrity = `sha256-${"A".repeat(43)}=`;

const manifest = {
    id: "example/plugin",
    name: "Example plugin",
    description: "A plugin used by the validation tests.",
    version: "1.2.3",
    repository: "https://example.com/example/plugin",
    permissions: ["network"],
    settings: [{ key: "enabled", type: "boolean" as const, title: "Enabled", default: false }],
    artifacts: [{ id: "manifest", source: "https://example.com/plugin.json", integrity }],
    dependencies: [{ id: "example/dependency", version: ">=1.0.0" }],
    compatibility: { minTriliumVersion: "0.100.0", maxTriliumVersion: "0.110.0" }
};

describe("plugin manager validation helpers", () => {
    it("parses JSON and legacy newline-separated sources consistently", () => {
        expect(parseRegistryUrls('[" https://one.example/index.json ", "https://two.example/index.json"]')).toEqual([
            "https://one.example/index.json",
            "https://two.example/index.json"
        ]);
        expect(parseRegistryUrls("https://one.example/index.json\n\n https://two.example/index.json")).toEqual([
            "https://one.example/index.json",
            "https://two.example/index.json"
        ]);
        expect(parseRegistryUrls(null)).toEqual([]);
    });

    it("normalizes source hosts to one host per line", () => {
        expect(normalizeSourceHosts(" github.com, raw.githubusercontent.com\ngitlab.com ")).toBe(
            "github.com\nraw.githubusercontent.com\ngitlab.com"
        );
    });

    it("only accepts HTTPS sources, except for local development hosts", () => {
        expect(isSecurePackageUrl("https://example.com/plugin.json")).toBe(true);
        expect(isSecurePackageUrl("http://localhost:39125/plugin.json")).toBe(true);
        expect(isSecurePackageUrl("http://127.0.0.1:39125/plugin.json")).toBe(true);
        expect(isSecurePackageUrl("http://example.com/plugin.json")).toBe(false);
        expect(isSecurePackageUrl("javascript:alert(1)")).toBe(false);
    });

    it("validates package settings, dependencies, artifacts, and compatibility", () => {
        expect(isPackageSettingDefinition(manifest.settings[0])).toBe(true);
        expect(isPackageSettingDefinition({ key: "bad", type: "unknown", title: "Bad" })).toBe(false);
        expect(isPackageSettingDefinition({ key: "unsafe:key", type: "string", title: "Bad" })).toBe(false);
        expect(isPackageDependency(manifest.dependencies[0])).toBe(true);
        expect(isPackageDependency({ id: "example/dependency" })).toBe(false);
        expect(isPackageDependency({ id: "example/dependency", version: "not-semver" })).toBe(false);
        expect(isPackageArtifact(manifest.artifacts[0])).toBe(true);
        expect(isPackageArtifact({ ...manifest.artifacts[0], source: "src/plugin.js" })).toBe(true);
        expect(isPackageArtifact({ ...manifest.artifacts[0], id: "unsafe/id" })).toBe(false);
        expect(isPackageArtifact({ ...manifest.artifacts[0], source: "http://example.com/plugin.js" })).toBe(false);
        expect(isPackageArtifactSource("../plugin.js")).toBe(false);
        expect(isPackageArtifactSource("/absolute/plugin.js")).toBe(false);
        expect(isPackageArtifact({ ...manifest.artifacts[0], integrity: "sha256-invalid" })).toBe(false);
        expect(isPackageCompatibility(manifest.compatibility)).toBe(true);
        expect(isPackageCompatibility({ minTriliumVersion: 1 })).toBe(false);
        expect(isPackageCompatibility({ minTriliumVersion: "0.110.0", maxTriliumVersion: "0.100.0" })).toBe(false);
    });

    it("rejects incomplete or unsafe catalog entries", () => {
        expect(isCatalogPackageEntry(manifest)).toBe(true);
        expect(isCatalogPackageEntry({ ...manifest, id: "Example/Plugin" })).toBe(false);
        expect(isCatalogPackageEntry({ ...manifest, repository: "http://example.com/plugin" })).toBe(false);
        expect(isCatalogPackageEntry({ ...manifest, artifacts: [] })).toBe(false);
        expect(isCatalogPackageEntry({ ...manifest, compatibility: null })).toBe(false);
    });
});

describe("plugin manager state helpers", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("schedules update checks for registry or direct-manifest sources only when enabled", () => {
        expect(shouldScheduleUpdateChecks(true, true, ["https://example.com/registry.json"], [])).toBe(false);
        expect(shouldScheduleUpdateChecks(false, false, ["https://example.com/registry.json"], [])).toBe(false);
        expect(shouldScheduleUpdateChecks(false, true, [], [])).toBe(false);
        expect(shouldScheduleUpdateChecks(false, true, ["https://example.com/registry.json"], [])).toBe(true);
        expect(shouldScheduleUpdateChecks(false, true, [], ["https://example.com/plugin.json"])).toBe(true);
    });

    it("reports healthy, broken, and unknown package states", () => {
        expect(packageHealth(["manifest"], manifest)).toEqual({ health: "healthy", healthMessage: "all artifacts present" });
        expect(packageHealth([], manifest)).toEqual({ health: "broken", healthMessage: "missing manifest" });
        expect(packageHealth(["manifest"], undefined)).toEqual({ health: "unknown", healthMessage: "not in registry" });
    });

    it("accepts a valid cached manifest for offline package details", () => {
        const cached = parseCachedPackageManifest(JSON.stringify(manifest));
        expect(cached?.id).toBe("example/plugin");
        expect(parseCachedPackageManifest("not json")).toBeUndefined();
    });

    it("accepts cached manifests written before repository metadata was retained", () => {
        const { repository: _repository, ...legacyCachedManifest } = manifest;
        const cached = parseCachedPackageManifest(JSON.stringify(legacyCachedManifest));
        expect(cached?.id).toBe("example/plugin");
        expect(cached?.repository).toBeUndefined();
    });

    it("uses saved package metadata when every configured source is unavailable", async () => {
        const cachedManifest = parseCachedPackageManifest(JSON.stringify(manifest));
        vi.stubGlobal("fetch", vi.fn(async () => {
            throw new Error("network unavailable");
        }));

        const result = await loadCatalog(["https://example.com/registry.json"], [], [{
            id: manifest.id,
            title: manifest.name,
            version: manifest.version,
            enabled: false,
            pinned: false,
            noteId: "package-note",
            artifactIds: ["manifest"],
            health: "unknown",
            healthMessage: "not checked",
            settings: {},
            cachedManifest
        }], false);

        expect(result.catalog).toEqual([cachedManifest]);
        expect(result.usingSavedData).toBe(true);
        expect(result.updateCount).toBeNull();
        expect(result.registryError).toContain("network unavailable");
    });

    it("compares compatible versions and detects updates", () => {
        const originalVersion = window.glob.triliumVersion;
        window.glob.triliumVersion = "0.104.1";
        try {
            expect(compareVersions("0.104.1", "0.104.1")).toBe(0);
            expect(compareVersions("0.105.0", "0.104.9")).toBe(1);
            expect(compareVersions("0.103.9", "0.104.0")).toBe(-1);
            expect(compareVersions("1.0.0-beta", "1.0.0")).toBe(-1);
            expect(compareVersions("1.0.0", "1.0.0-beta")).toBe(1);
            expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBe(-1);
            expect(compareVersions("not-a-version", "0.104.0")).toBeNull();
            expect(isNewerVersion("1.1.0", "1.0.9")).toBe(true);
            expect(isNewerVersion("1.0.9", "1.1.0")).toBe(false);
            expect(isNewerVersion("1.0.0-beta.2", "1.0.0-beta.1")).toBe(true);
            expect(compatibilityStatus(manifest.compatibility)).toBe("compatible");
            expect(compatibilityStatus({ minTriliumVersion: "0.105.0" })).toContain("incompatible");
        } finally {
            window.glob.triliumVersion = originalVersion;
        }
    });

    it("formats manifest metadata for the details view", () => {
        expect(formatDependency(manifest.dependencies[0])).toBe("example/dependency >=1.0.0");
        expect(formatCompatibility(manifest.compatibility)).toBe("0.100.0 – 0.110.0");
        expect(manifestStatus({ ...manifest, securityStatus: "warning", maintenance: "slow", deprecated: true, deprecationMessage: "Use the replacement." })).toContain("Deprecated: Use the replacement.");
        expect(manifestStatus({ ...manifest, securityStatus: "warning", maintenance: "slow" })).toContain("Security review warning");
    });

    it("round-trips package settings using stable labels", () => {
        const booleanSetting = manifest.settings[0];
        const numberSetting = { key: "limit", type: "number" as const, title: "Limit" };
        expect(parseSettingValue("true", booleanSetting)).toBe(true);
        expect(parseSettingValue("42", numberSetting)).toBe(42);
        expect(parseSettingValue('"secret"', { key: "token", type: "secret", title: "Token" })).toBe("secret");
        expect(serializeSetting({ value: 42 })).toBe('{"value":42}');
        expect(settingLabelName("token")).toBe("packageSetting:token");
    });
});
