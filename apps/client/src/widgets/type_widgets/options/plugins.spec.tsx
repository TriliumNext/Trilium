import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    searchForNotes: vi.fn(),
    getNote: vi.fn(),
    reloadNotes: vi.fn(async (..._args: unknown[]) => {}),
    setLabel: vi.fn(async (..._args: unknown[]) => {}),
    openContextWithNote: vi.fn(async (..._args: unknown[]) => {}),
    closeActiveDialog: vi.fn(),
    showMessage: vi.fn(),
    showError: vi.fn(),
    fetch: vi.fn()
}));

let triliumEventListeners: Record<string, ((...args: unknown[]) => void)[]> = {};

vi.mock("../../../services/search", () => ({
    default: { searchForNotes: (...args: unknown[]) => mocks.searchForNotes(...args) }
}));

vi.mock("../../../services/froca", () => ({
    default: {
        getNote: (...args: unknown[]) => mocks.getNote(...args),
        reloadNotes: (...args: unknown[]) => mocks.reloadNotes(...args)
    }
}));

vi.mock("../../../services/attributes", () => ({
    setLabel: (...args: unknown[]) => mocks.setLabel(...args)
}));

vi.mock("../../../components/app_context", () => ({
    default: {
        tabManager: {
            openContextWithNote: (...args: unknown[]) => mocks.openContextWithNote(...args)
        }
    }
}));

vi.mock("../../../services/dialog", () => ({
    closeActiveDialog: () => mocks.closeActiveDialog()
}));

vi.mock("../../../services/toast", () => ({
    default: {
        showMessage: (...args: unknown[]) => mocks.showMessage(...args),
        showError: (...args: unknown[]) => mocks.showError(...args)
    }
}));

vi.mock("../../../services/i18n", () => ({
    t: (key: string, params?: Record<string, unknown>) => {
        if (!params) return key;
        return `${key}:${JSON.stringify(params)}`;
    }
}));

vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useTriliumEvent: (event: string, handler: (...args: unknown[]) => void) => {
        triliumEventListeners[event] = triliumEventListeners[event] || [];
        triliumEventListeners[event].push(handler);
    }
}));

vi.mock("./components/OptionsPageHeader", () => ({
    default: () => <div className="options-page-header-stub" />
}));

vi.stubGlobal("fetch", mocks.fetch);

import PluginsSettings, {
    compareVersions,
    compatibilityStatus,
    formatCompatibility,
    formatDependency,
    isCatalogPackageEntry,
    isNewerVersion,
    isPackageArtifact,
    isPackageCompatibility,
    isPackageDependency,
    isPackageSettingDefinition,
    isSecurePackageUrl,
    manifestStatus,
    normalizeSourceHosts,
    packageHealth,
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
        expect(isPackageArtifact({ ...manifest.artifacts[0], id: "unsafe/id" })).toBe(false);
        expect(isPackageArtifact({ ...manifest.artifacts[0], source: "http://example.com/plugin.js" })).toBe(false);
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
            expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBe(-1);
            expect(compareVersions("1.0.0-alpha", "1.0.0-1")).toBe(1);
            expect(compareVersions("1.0.0-2", "1.0.0-10")).toBe(-1);
            expect(compareVersions("1.0.0-10", "1.0.0-2")).toBe(1);
            expect(compareVersions("1.0.0-1", "1.0.0-2")).toBe(-1);
            expect(compareVersions("1.0.0-alpha", "1.0.0-alpha")).toBe(0);
            expect(compareVersions("1.0.0-alpha.1", "1.0.0-alpha")).toBe(1);
            expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
            expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
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
        expect(manifestStatus({ ...manifest, securityStatus: "unreviewed", lastValidatedAt: "2026-09-01T00:00:00.000Z" })).toContain("Security: unreviewed · Validated 2026-09-01");
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

describe("PluginsSettings component", () => {
    let host: HTMLElement;

    function createMockNote(overrides: {
        noteId: string;
        title: string;
        type?: string;
        isArchived?: boolean;
        labels?: Record<string, string>;
    }) {
        const { noteId, title, type = "render", isArchived = false, labels = {} } = overrides;
        return {
            noteId,
            title,
            type,
            isArchived,
            getOwnedLabelValue: (name: string) => labels[name] ?? null
        };
    }

    const managerNote = createMockNote({
        noteId: "_sd_community-packages-manager_render",
        title: "Community Packages",
        type: "render"
    });

    const settingsNote = createMockNote({
        noteId: "settings-note",
        title: "Plugin Settings",
        type: "code",
        labels: {
            packageRegistryUrls: JSON.stringify(["https://example.com/registry.json"]),
            packageDirectManifestUrls: JSON.stringify(["https://example.com/direct.json"]),
            packageAllowNetwork: "true",
            packageAllowedSourceHosts: "example.com\ngithub.com",
            packageCheckForUpdates: "true",
            packageUpdateIntervalHours: "12",
            packageIncludeDeprecated: "true"
        }
    });

    const installedManifestNote = createMockNote({
        noteId: "pkg-installed-manifest",
        title: "Installed Plugin",
        type: "code",
        labels: {
            packageOwner: "example/installed",
            packageArtifact: "manifest",
            packageVersion: "1.0.0",
            packageEnabled: "true",
            packagePinned: "false",
            "packageSetting:enabled": "true",
            "packageSetting:count": "10",
            "packageSetting:token": '"secret-token"',
            "packageSetting:mode": '"dark"',
            "packageSetting:nickname": '"Testy"'
        }
    });

    const installedArtifactNote = createMockNote({
        noteId: "pkg-installed-main",
        title: "main.js",
        type: "code",
        labels: {
            packageOwner: "example/installed",
            packageArtifact: "main"
        }
    });

    const brokenManifestNote = createMockNote({
        noteId: "pkg-broken-manifest",
        title: "Broken Plugin",
        type: "code",
        labels: {
            packageOwner: "example/broken",
            packageArtifact: "manifest",
            packageVersion: "0.5.0",
            packageEnabled: "false",
            packagePinned: "true"
        }
    });

    const transactionNote = createMockNote({
        noteId: "tx-note-1",
        title: "Transaction",
        type: "code",
        labels: {
            packageTransaction: "tx-123"
        }
    });

    const catalogResponse = {
        packages: [
            {
                id: "example/installed",
                name: "Installed Plugin",
                version: "1.1.0", // newer version available
                description: "Installed plugin description",
                repository: "https://example.com/installed",
                permissions: ["network"],
                dependencies: [{ id: "example/dep", version: ">=1.0.0" }],
                compatibility: { minTriliumVersion: "0.100.0", maxTriliumVersion: "0.110.0" },
                author: "Test Author",
                maintainer: "Test Maintainer",
                license: "MIT",
                artifacts: [
                    { id: "manifest", source: "https://example.com/manifest.json", integrity },
                    { id: "main", source: "https://example.com/main.js", integrity }
                ],
                settings: [
                    { key: "enabled", type: "boolean" as const, title: "Enable Feature" },
                    { key: "count", type: "number" as const, title: "Item Count" },
                    { key: "token", type: "secret" as const, title: "Secret Token" },
                    { key: "mode", type: "select" as const, title: "Mode", options: ["light", "dark"] },
                    { key: "nickname", type: "string" as const, title: "Nickname" }
                ]
            },
            {
                id: "example/available",
                name: "Available Plugin",
                version: "2.0.0",
                description: "Available plugin not installed",
                repository: "https://example.com/available",
                artifacts: [{ id: "manifest", source: "https://example.com/avail-manifest.json", integrity }],
                compatibility: { minTriliumVersion: "0.100.0", maxTriliumVersion: "0.110.0" }
            }
        ]
    };

    const directManifestResponse = {
        id: "example/broken",
        name: "Broken Plugin",
        version: "0.5.0",
        description: "Broken plugin with missing artifacts",
        repository: "https://example.com/broken",
        deprecated: true,
        deprecationMessage: "This plugin is deprecated.",
        artifacts: [
            { id: "manifest", source: "https://example.com/manifest.json", integrity },
            { id: "missing-artifact", source: "https://example.com/missing.js", integrity }
        ],
        compatibility: { minTriliumVersion: "0.100.0", maxTriliumVersion: "0.110.0" }
    };

    beforeEach(() => {
        window.glob.triliumVersion = "0.104.1";
        triliumEventListeners = {};
        host = document.body.appendChild(document.createElement("div"));

        mocks.getNote.mockImplementation(async (noteId: string) => {
            if (noteId === "_sd_community-packages-manager_render") return managerNote;
            return null;
        });

        mocks.searchForNotes.mockImplementation(async (query: string) => {
            if (query === "#packageManaged") {
                return [installedManifestNote, installedArtifactNote, brokenManifestNote];
            }
            if (query.includes("packageTransaction")) {
                return [transactionNote];
            }
            if (query === "#packageManagerSettings") {
                return [settingsNote];
            }
            if (query === "Community Packages") {
                return [managerNote];
            }
            return [];
        });

        mocks.fetch.mockImplementation(async (url: string) => {
            if (url === "https://example.com/registry.json") {
                return {
                    ok: true,
                    status: 200,
                    json: async () => catalogResponse
                };
            }
            if (url === "https://example.com/direct.json") {
                return {
                    ok: true,
                    status: 200,
                    json: async () => directManifestResponse
                };
            }
            return {
                ok: false,
                status: 404,
                json: async () => ({})
            };
        });
    });

    afterEach(() => {
        render(null, host);
        document.body.innerHTML = "";
        vi.clearAllMocks();
    });

    async function mountComponent() {
        await act(async () => {
            render(<PluginsSettings />, host);
        });
        // Allow async refresh() to resolve state updates
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
        });
    }

    it("renders loading state then loads installed, available, updates, and advanced sections", async () => {
        await mountComponent();

        expect(host.querySelector(".plugins-settings")).not.toBeNull();
        expect(host.querySelector(".options-page-header-stub")).not.toBeNull();

        // Installed packages
        expect(host.textContent).toContain("Installed Plugin");
        expect(host.textContent).toContain("Broken Plugin");

        // Available packages notification
        expect(host.textContent).toContain("plugins.available_count");

        // Transaction recovery notification
        expect(host.textContent).toContain("plugins.incomplete_operation_label");

        // Updates notification
        expect(host.textContent).toContain("plugins.updates_available");
    });

    it("opens catalog when clicking Browse Available, Open Recovery, or Review Updates", async () => {
        await mountComponent();

        // Find buttons that call openCatalog()
        const buttons = Array.from(host.querySelectorAll("button"));
        const openRecoveryBtn = buttons.find((btn) => btn.textContent?.includes("plugins.open_recovery"));
        expect(openRecoveryBtn).toBeDefined();

        await act(async () => {
            openRecoveryBtn!.click();
        });

        expect(mocks.openContextWithNote).toHaveBeenCalledWith("_sd_community-packages-manager_render", {
            activate: true,
            hoistedNoteId: "root"
        });
        expect(mocks.closeActiveDialog).toHaveBeenCalled();
    });

    it("enables and disables an installed package", async () => {
        await mountComponent();

        const buttons = Array.from(host.querySelectorAll("button"));
        const disableBtn = buttons.find((btn) => btn.textContent?.includes("plugins.disable"));
        expect(disableBtn).toBeDefined();

        await act(async () => {
            disableBtn!.click();
        });

        expect(mocks.setLabel).toHaveBeenCalledWith("pkg-installed-manifest", "packageEnabled", "false");
        expect(mocks.reloadNotes).toHaveBeenCalledWith(["pkg-installed-manifest"]);
        expect(mocks.showMessage).toHaveBeenCalledWith(expect.stringContaining("plugins.plugin_disabled"));
    });

    it("toggles package details, edits settings, saves package settings, and pins package", async () => {
        await mountComponent();

        // Click Details on Installed Plugin (index 1 because "Broken Plugin" sorts first alphabetically)
        const detailButtons = Array.from(host.querySelectorAll("button")).filter(
            (btn) => btn.textContent?.includes("plugins.details")
        );
        expect(detailButtons.length).toBeGreaterThanOrEqual(2);

        await act(async () => {
            detailButtons[1].click();
            await new Promise((resolve) => setTimeout(resolve, 20));
        });

        expect(host.querySelector(".community-package-details")).not.toBeNull();
        expect(host.textContent).toContain("Test Maintainer");
        expect(host.textContent).toContain("MIT");

        // Test editing inputs: number, secret, string, select
        const textInputs = Array.from(host.querySelectorAll<HTMLInputElement>(".community-package-details input[type='text'], .community-package-details input[type='number'], .community-package-details input[type='password']"));
        expect(textInputs.length).toBeGreaterThanOrEqual(3);

        await act(async () => {
            const countInput = textInputs.find((input) => input.type === "number");
            if (countInput) {
                countInput.value = "42";
                countInput.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });

        const select = host.querySelector<HTMLSelectElement>(".community-package-details select");
        if (select) {
            await act(async () => {
                select.value = "light";
                select.dispatchEvent(new Event("change", { bubbles: true }));
            });
        }

        // Click Save package settings
        const savePackageBtn = Array.from(host.querySelectorAll("button")).find(
            (btn) => btn.textContent?.includes("plugins.save_package_settings")
        );
        expect(savePackageBtn).toBeDefined();

        await act(async () => {
            savePackageBtn!.click();
            await new Promise((resolve) => setTimeout(resolve, 50));
        });

        expect(mocks.setLabel).toHaveBeenCalledWith("pkg-installed-manifest", "packageSetting:enabled", "true");
        expect(mocks.showMessage).toHaveBeenCalledWith(expect.stringContaining("plugins.plugin_settings_saved"));

        // Toggle pin (at the bottom of package details)
        const toggles = Array.from(host.querySelectorAll<HTMLInputElement>(".community-package-details input.switch-toggle"));
        const pinToggle = toggles[toggles.length - 1];
        expect(pinToggle).toBeDefined();
        if (pinToggle) {
            await act(async () => {
                pinToggle.dispatchEvent(new Event("input", { bubbles: true }));
                await new Promise((resolve) => setTimeout(resolve, 50));
            });
            expect(mocks.setLabel).toHaveBeenCalledWith("pkg-installed-manifest", "packagePinned", expect.any(String));
        }
    });

    it("displays repair action for broken packages", async () => {
        await mountComponent();

        // Open details for broken plugin (index 0)
        const detailButtons = Array.from(host.querySelectorAll("button")).filter(
            (btn) => btn.textContent?.includes("plugins.details")
        );
        expect(detailButtons.length).toBeGreaterThanOrEqual(1);

        await act(async () => {
            detailButtons[0].click();
            await new Promise((resolve) => setTimeout(resolve, 20));
        });

        const repairBtn = Array.from(host.querySelectorAll("button")).find(
            (btn) => btn.textContent?.includes("plugins.open_repair")
        );
        expect(repairBtn).toBeDefined();

        await act(async () => {
            repairBtn!.click();
        });

        expect(mocks.openContextWithNote).toHaveBeenCalled();
    });

    it("edits advanced source configuration and saves settings", async () => {
        await mountComponent();

        const textareas = Array.from(host.querySelectorAll<HTMLTextAreaElement>("textarea.plugin-source-textarea"));
        expect(textareas.length).toBe(3);

        await act(async () => {
            textareas[0].value = "https://new-registry.example.com/packages.json";
            textareas[0].dispatchEvent(new Event("input", { bubbles: true }));

            textareas[1].value = "https://new-direct.example.com/plugin.json";
            textareas[1].dispatchEvent(new Event("input", { bubbles: true }));

            textareas[2].value = "custom.example.com";
            textareas[2].dispatchEvent(new Event("input", { bubbles: true }));
        });

        // Click Save Settings button in advanced section
        const saveSettingsBtn = Array.from(host.querySelectorAll("button")).find(
            (btn) => btn.textContent?.includes("plugins.save_settings")
        );
        expect(saveSettingsBtn).toBeDefined();

        await act(async () => {
            saveSettingsBtn!.click();
            await new Promise((resolve) => setTimeout(resolve, 50));
        });

        expect(mocks.setLabel).toHaveBeenCalledWith(
            "settings-note",
            "packageRegistryUrls",
            JSON.stringify(["https://new-registry.example.com/packages.json"])
        );
        expect(mocks.setLabel).toHaveBeenCalledWith("settings-note", "packageAllowNetwork", "true");
        expect(mocks.reloadNotes).toHaveBeenCalledWith(["settings-note"]);
        expect(mocks.showMessage).toHaveBeenCalledWith("plugins.package_settings_saved");
    });

    it("displays initialize prompt when settings note is missing", async () => {
        mocks.searchForNotes.mockImplementation(async (query: string) => {
            if (query === "#packageManagerSettings") return [];
            if (query === "Community Packages") return [managerNote];
            return [];
        });

        await mountComponent();

        expect(host.textContent).toContain("plugins.initialize_advanced");
    });

    it("falls back to searchForNotes('Community Packages') when manager ID not found", async () => {
        mocks.getNote.mockResolvedValue(null);
        await mountComponent();

        expect(mocks.searchForNotes).toHaveBeenCalledWith("Community Packages");
    });

    it("handles search failure gracefully by displaying error alert", async () => {
        mocks.searchForNotes.mockRejectedValue(new Error("Search database error"));
        await mountComponent();

        expect(host.querySelector("[role='alert']")).not.toBeNull();
        expect(host.textContent).toContain("Search database error");
    });

    it("refreshes when entitiesReloaded event fires", async () => {
        await mountComponent();

        expect(triliumEventListeners["entitiesReloaded"]).toBeDefined();
        expect(triliumEventListeners["entitiesReloaded"].length).toBeGreaterThan(0);

        mocks.searchForNotes.mockClear();

        await act(async () => {
            for (const listener of triliumEventListeners["entitiesReloaded"]) {
                listener();
            }
        });

        expect(mocks.searchForNotes).toHaveBeenCalled();
    });

    it("handles loadCatalog error conditions and partial failures", async () => {
        // Direct manifest returning 404
        mocks.fetch.mockImplementation(async () => ({
            ok: false,
            status: 404,
            json: async () => ({})
        }));

        await mountComponent();

        expect(host.textContent).toContain("plugins.update_error");
    });
});
