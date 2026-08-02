import { useCallback, useEffect, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import type FNote from "../../../entities/fnote";
import { setLabel } from "../../../services/attributes";
import { closeActiveDialog } from "../../../services/dialog";
import froca from "../../../services/froca";
import search from "../../../services/search";
import toast from "../../../services/toast";
import Button from "../../react/Button";
import FormTextBox from "../../react/FormTextBox";
import { useTriliumEvent } from "../../react/hooks";
import NoItems from "../../react/NoItems";
import OptionsPageHeader from "./components/OptionsPageHeader";
import OptionsRow, { OptionsRowWithButton, OptionsRowWithToggle } from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";

const COMMUNITY_PACKAGES_MANAGER_NOTE_ID = "_sd_community-packages-manager_render";
const PACKAGE_PINNED_LABEL = "packagePinned";
const PACKAGE_ENABLED_LABEL = "packageEnabled";
const PACKAGE_TRANSACTION_LABEL = "packageTransaction";
const PACKAGE_REGISTRY_URL_LABEL = "packageRegistryUrl";
const PACKAGE_REGISTRY_URLS_LABEL = "packageRegistryUrls";
const PACKAGE_DIRECT_MANIFEST_URLS_LABEL = "packageDirectManifestUrls";
const PACKAGE_CHECK_UPDATES_LABEL = "packageCheckForUpdates";
const PACKAGE_UPDATE_INTERVAL_LABEL = "packageUpdateIntervalHours";
const PACKAGE_ALLOWED_SOURCE_HOSTS_LABEL = "packageAllowedSourceHosts";
const PACKAGE_INCLUDE_DEPRECATED_LABEL = "packageIncludeDeprecated";
const PACKAGE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const PACKAGE_ARTIFACT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const PACKAGE_SETTING_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/;
const PACKAGE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const PACKAGE_VERSION_RANGE_PATTERN = /^(?:[<>=~^]*\s*)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export interface PackageSummary {
    id: string;
    title: string;
    version: string;
    enabled: boolean;
    pinned: boolean;
    noteId: string;
    artifactIds: string[];
    health: "healthy" | "broken" | "unknown";
    healthMessage: string;
    settings: Record<string, unknown>;
}

type PackageSettingType = "boolean" | "number" | "string" | "secret" | "select";

export interface PackageSettingDefinition {
    key: string;
    type: PackageSettingType;
    title: string;
    description?: string;
    default?: unknown;
    options?: string[];
}

export interface PackageDependency {
    id: string;
    version: string;
    optional?: boolean;
}

export interface PackageCompatibility {
    minTriliumVersion: string;
    maxTriliumVersion?: string;
}

export interface PackageArtifact {
    id: string;
    source: string;
    integrity: string;
}

export interface CatalogPackage {
    id: string;
    name: string;
    description: string;
    version: string;
    permissions: string[];
    settings: PackageSettingDefinition[];
    artifacts: PackageArtifact[];
    dependencies: PackageDependency[];
    compatibility: PackageCompatibility | null;
    author?: string;
    maintainer?: string;
    homepage?: string;
    license?: string;
    deprecated?: boolean;
    deprecationMessage?: string;
    maintenance?: "active" | "slow" | "unmaintained";
    securityStatus?: "unreviewed" | "reviewed" | "warning";
    lastValidatedAt?: string;
}

export interface RawCatalogPackage {
    id?: string;
    name?: string;
    description?: string;
    version?: string;
    repository?: string;
    permissions?: unknown;
    settings?: unknown;
    artifacts?: unknown;
    dependencies?: unknown;
    compatibility?: unknown;
    author?: string;
    maintainer?: string;
    homepage?: string;
    license?: string;
    deprecated?: boolean;
    deprecationMessage?: string;
    maintenance?: CatalogPackage["maintenance"];
    securityStatus?: CatalogPackage["securityStatus"];
    lastValidatedAt?: string;
}

interface PluginsState {
    manager: FNote | null;
    settings: FNote | null;
    packages: PackageSummary[];
    catalog: CatalogPackage[];
    registryUrls: string[];
    directManifestUrls: string[];
    allowNetworkPackages: boolean;
    allowedSourceHosts: string;
    checkForUpdates: boolean;
    updateCheckIntervalHours: number;
    includeDeprecatedPackages: boolean;
    interruptedTransactionCount: number;
    updateCount: number | null;
    registryError: string | null;
    loading: boolean;
    error: string | null;
}

const EMPTY_STATE: PluginsState = {
    manager: null,
    settings: null,
    packages: [],
    catalog: [],
    registryUrls: [],
    directManifestUrls: [],
    allowNetworkPackages: false,
    allowedSourceHosts: "",
    checkForUpdates: false,
    updateCheckIntervalHours: 24,
    includeDeprecatedPackages: false,
    interruptedTransactionCount: 0,
    updateCount: null,
    registryError: null,
    loading: true,
    error: null
};

export default function PluginsSettings() {
    const [state, setState] = useState<PluginsState>(EMPTY_STATE);
    const [savingSettings, setSavingSettings] = useState(false);
    const [savingPackage, setSavingPackage] = useState("");
    const [configuredPackage, setConfiguredPackage] = useState("");

    const refresh = useCallback(async () => {
        try {
            const [manager, packageNotes, transactionNotes] = await Promise.all([
                findPackageManager(),
                search.searchForNotes("#packageManaged"),
                search.searchForNotes(`#${PACKAGE_TRANSACTION_LABEL}`)
            ]);
            const settings = (await search.searchForNotes("#packageManagerSettings"))[0] || null;
            const legacyRegistryUrl = settings?.getOwnedLabelValue(PACKAGE_REGISTRY_URL_LABEL) || "";
            const registryUrls = parseRegistryUrls(settings?.getOwnedLabelValue(PACKAGE_REGISTRY_URLS_LABEL) || legacyRegistryUrl);
            const directManifestUrls = parseRegistryUrls(settings?.getOwnedLabelValue(PACKAGE_DIRECT_MANIFEST_URLS_LABEL) || "");
            const allowNetworkPackages = settings?.getOwnedLabelValue("packageAllowNetwork") === "true";
            const allowedSourceHosts = normalizeSourceHosts(settings?.getOwnedLabelValue(PACKAGE_ALLOWED_SOURCE_HOSTS_LABEL) || "");
            const checkForUpdates = settings?.getOwnedLabelValue(PACKAGE_CHECK_UPDATES_LABEL) === "true";
            const updateCheckIntervalHours = Math.max(1, Number(settings?.getOwnedLabelValue(PACKAGE_UPDATE_INTERVAL_LABEL)) || 24);
            const includeDeprecatedPackages = settings?.getOwnedLabelValue(PACKAGE_INCLUDE_DEPRECATED_LABEL) === "true";
            const artifactIdsByPackage = new Map<string, string[]>();
            packageNotes
                .filter((note) => !note.isArchived && !note.getOwnedLabelValue(PACKAGE_TRANSACTION_LABEL))
                .forEach((note) => {
                    const packageId = note.getOwnedLabelValue("packageOwner");
                    const artifactId = note.getOwnedLabelValue("packageArtifact");
                    if (!packageId || !artifactId) return;
                    const artifactIds = artifactIdsByPackage.get(packageId) || [];
                    if (!artifactIds.includes(artifactId)) artifactIds.push(artifactId);
                    artifactIdsByPackage.set(packageId, artifactIds);
                });

            const packages = packageNotes
                .filter((note) => note.getOwnedLabelValue("packageArtifact") === "manifest" && !note.isArchived && !note.getOwnedLabelValue(PACKAGE_TRANSACTION_LABEL))
                .map((note) => ({
                    id: note.getOwnedLabelValue("packageOwner") || note.noteId,
                    title: note.title,
                    version: note.getOwnedLabelValue("packageVersion") || "unknown",
                    enabled: note.getOwnedLabelValue("packageEnabled") === "true",
                    pinned: note.getOwnedLabelValue(PACKAGE_PINNED_LABEL) === "true",
                    noteId: note.noteId,
                    artifactIds: artifactIdsByPackage.get(note.getOwnedLabelValue("packageOwner") || note.noteId) || [],
                    health: "unknown" as const,
                    healthMessage: "not checked",
                    settings: {}
                }))
                .sort((left, right) => left.title.localeCompare(right.title));

            const { catalog, updateCount, registryError } = await loadCatalog(registryUrls, directManifestUrls, packages, includeDeprecatedPackages);
            const packagesWithSettings = packages.map((pkg) => {
                const note = packageNotes.find((candidate) => candidate.noteId === pkg.noteId);
                const manifest = catalog.find((candidate) => candidate.id === pkg.id);
                return { ...pkg, ...packageHealth(pkg.artifactIds, manifest), settings: note && manifest ? readPackageSettings(note, manifest) : {} };
            });
            const interruptedTransactionCount = new Set(transactionNotes
                .filter((note) => !note.isArchived)
                .map((note) => note.getOwnedLabelValue(PACKAGE_TRANSACTION_LABEL))
                .filter(Boolean)).size;
            setState({ manager, settings, packages: packagesWithSettings, catalog, registryUrls, directManifestUrls, allowNetworkPackages, allowedSourceHosts, checkForUpdates, updateCheckIntervalHours, includeDeprecatedPackages, interruptedTransactionCount, updateCount, registryError, loading: false, error: null });
        } catch (error) {
            setState({ ...EMPTY_STATE, loading: false, error: error instanceof Error ? error.message : String(error) });
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    useTriliumEvent("entitiesReloaded", useCallback(() => {
        void refresh();
    }, [refresh]));

    useEffect(() => {
        if (state.loading || !state.checkForUpdates || !state.registryUrls.length) return;
        const intervalHours = Math.max(1, state.updateCheckIntervalHours || 24);
        const timer = window.setInterval(() => void refresh(), intervalHours * 60 * 60 * 1000);
        return () => window.clearInterval(timer);
    }, [refresh, state.checkForUpdates, state.loading, state.registryUrls, state.updateCheckIntervalHours]);

    async function openCatalog() {
        if (state.manager) {
            await appContext.tabManager.openContextWithNote(state.manager.noteId, { activate: true, hoistedNoteId: "root" });
            closeActiveDialog();
        }
    }

    async function saveSettings() {
        if (!state.settings) {
            await openCatalog();
            return;
        }

        setSavingSettings(true);
        try {
            await setLabel(state.settings.noteId, PACKAGE_REGISTRY_URLS_LABEL, JSON.stringify(state.registryUrls));
            await setLabel(state.settings.noteId, PACKAGE_REGISTRY_URL_LABEL, state.registryUrls[0] || "");
            await setLabel(state.settings.noteId, PACKAGE_DIRECT_MANIFEST_URLS_LABEL, JSON.stringify(state.directManifestUrls));
            await setLabel(state.settings.noteId, "packageAllowNetwork", state.allowNetworkPackages ? "true" : "false");
            await setLabel(state.settings.noteId, PACKAGE_ALLOWED_SOURCE_HOSTS_LABEL, normalizeSourceHosts(state.allowedSourceHosts));
            await setLabel(state.settings.noteId, PACKAGE_CHECK_UPDATES_LABEL, state.checkForUpdates ? "true" : "false");
            await setLabel(state.settings.noteId, PACKAGE_UPDATE_INTERVAL_LABEL, String(Math.max(1, state.updateCheckIntervalHours || 24)));
            await setLabel(state.settings.noteId, PACKAGE_INCLUDE_DEPRECATED_LABEL, state.includeDeprecatedPackages ? "true" : "false");
            await froca.reloadNotes([state.settings.noteId]);
            toast.showMessage("Package settings saved.");
            await refresh();
        } catch (error) {
            toast.showError(error instanceof Error ? error.message : String(error));
        } finally {
            setSavingSettings(false);
        }
    }

    async function savePackageSettings(pkg: PackageSummary) {
        const manifest = state.catalog.find((candidate) => candidate.id === pkg.id);
        if (!manifest || !manifest.settings.length) return;

        setSavingPackage(pkg.id);
        try {
            for (const setting of manifest.settings) {
                await setLabel(pkg.noteId, settingLabelName(setting.key), serializeSetting(pkg.settings[setting.key]));
            }
            await froca.reloadNotes([pkg.noteId]);
            toast.showMessage(`${pkg.title} settings saved.`);
            await refresh();
        } catch (error) {
            toast.showError(error instanceof Error ? error.message : String(error));
        } finally {
            setSavingPackage("");
        }
    }

    async function savePackagePin(pkg: PackageSummary, pinned: boolean) {
        setSavingPackage(pkg.id);
        try {
            await setLabel(pkg.noteId, PACKAGE_PINNED_LABEL, pinned ? "true" : "false");
            await froca.reloadNotes([pkg.noteId]);
            toast.showMessage(`${pkg.title} updates ${pinned ? "pinned" : "unpinned"}.`);
            await refresh();
        } catch (error) {
            toast.showError(error instanceof Error ? error.message : String(error));
        } finally {
            setSavingPackage("");
        }
    }

    async function setPackageEnabled(pkg: PackageSummary, enabled: boolean) {
        setSavingPackage(pkg.id);
        try {
            await setLabel(pkg.noteId, PACKAGE_ENABLED_LABEL, enabled ? "true" : "false");
            await froca.reloadNotes([pkg.noteId]);
            toast.showMessage(`${pkg.title} ${enabled ? "enabled" : "disabled"}.`);
            await refresh();
        } catch (error) {
            toast.showError(error instanceof Error ? error.message : String(error));
        } finally {
            setSavingPackage("");
        }
    }

    function updatePackageSetting(packageId: string, key: string, value: unknown) {
        setState((current) => ({
            ...current,
            packages: current.packages.map((pkg) => pkg.id === packageId
                ? { ...pkg, settings: { ...pkg.settings, [key]: value } }
                : pkg)
        }));
    }

    const installedPackageIds = new Set(state.packages.map((pkg) => pkg.id));
    const availablePackages = state.catalog.filter((pkg) => !installedPackageIds.has(pkg.id) && (!pkg.deprecated || state.includeDeprecatedPackages));

    return (
        <>
            <OptionsPageHeader />

            <OptionsSection
                title="Available plugins"
                description="Find and install extensions from your configured plugin sources."
            >
                {!state.loading && state.interruptedTransactionCount > 0 && (
                    <OptionsRowWithButton
                        label="Incomplete package operation"
                        description={`${state.interruptedTransactionCount} interrupted install or update operation${state.interruptedTransactionCount === 1 ? " remains" : "s remain"}. Open the catalog to recover staged packages safely.`}
                        icon="bx-error"
                        buttonText="Open recovery"
                        buttonClassName="btn-warning"
                        onClick={() => void openCatalog()}
                    />
                )}
                {!state.loading && state.manager && availablePackages.length > 0 && (
                    <OptionsRowWithButton
                        label={`${availablePackages.length} plugin${availablePackages.length === 1 ? "" : "s"} available`}
                        description={availablePackages.map((pkg) => pkg.name).join(", ")}
                        icon="bx-package"
                        buttonText="Browse available plugins"
                        buttonClassName="btn-primary"
                        onClick={() => void openCatalog()}
                    />
                )}
                {!state.loading && state.manager && availablePackages.length === 0 && (
                    <OptionsRowWithButton
                        label="Plugin catalog"
                        description="Browse, install, update, and archive plugins."
                        icon="bx-package"
                        buttonText="Browse plugin catalog"
                        onClick={() => void openCatalog()}
                    />
                )}
                {!state.loading && !state.manager && !state.error && (
                    <p>The plugin catalog is not available yet.</p>
                )}
            </OptionsSection>

            <OptionsSection
                title="Installed plugins"
                description="Turn plugins on or off, and open Details to configure one."
            >
                {state.error && <p role="alert">Could not load plugins: {state.error}</p>}
                {state.loading && <p>Loading installed plugins…</p>}
                {!state.loading && !state.packages.length && <NoItems icon="bx bx-package" text="No plugins installed." />}
                {state.packages.map((pkg) => (
                    <div key={pkg.noteId}>
                        <OptionsRow name={`community-package-${pkg.noteId}`} label={pkg.title} description={`${pkg.id} · v${pkg.version} · ${pkg.enabled ? "enabled" : "disabled"}${pkg.pinned ? " · pinned" : ""} · ${pkg.health}${pkg.healthMessage ? ` (${pkg.healthMessage})` : ""}`}>
                            <span style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "0.4em" }}>
                                <Button
                                    text={pkg.enabled ? "Disable" : "Enable"}
                                    kind={pkg.enabled ? undefined : "primary"}
                                    size="micro"
                                    disabled={savingPackage === pkg.id}
                                    onClick={() => void setPackageEnabled(pkg, !pkg.enabled)}
                                />
                                <Button
                                    text={configuredPackage === pkg.id ? "Hide details" : "Details"}
                                    icon="bx-cog"
                                    size="micro"
                                    disabled={savingPackage === pkg.id}
                                    onClick={() => setConfiguredPackage((current) => current === pkg.id ? "" : pkg.id)}
                                    title="Show plugin settings and permissions"
                                />
                            </span>
                        </OptionsRow>
                        {configuredPackage === pkg.id && <InstalledPackageDetails
                            pkg={pkg}
                            manifest={state.catalog.find((candidate) => candidate.id === pkg.id)}
                            onChange={(key, value) => updatePackageSetting(pkg.id, key, value)}
                            onSave={() => void savePackageSettings(pkg)}
                            onPinChange={(pinned) => void savePackagePin(pkg, pinned)}
                            onRepair={() => void openCatalog()}
                            disabled={savingPackage === pkg.id}
                        />}
                    </div>
                ))}
            </OptionsSection>

            <OptionsSection
                title="Updates"
                description="Updates will appear here when they are available."
            >
                {state.registryError && <p role="alert">Could not check for updates: {state.registryError}</p>}
                {!state.loading && state.updateCount === null && !state.registryError && <p>Configure a plugin source in Advanced settings to check for updates.</p>}
                {!state.loading && state.updateCount === 0 && !state.registryError && <NoItems icon="bx bx-check" text="All installed plugins are up to date." />}
                {!state.loading && state.updateCount !== null && state.updateCount > 0 && (
                    <OptionsRowWithButton
                        label={`${state.updateCount} update${state.updateCount === 1 ? "" : "s"} available`}
                        description="Review versions and update safely in the plugin catalog."
                        buttonText="Review updates"
                        onClick={() => void openCatalog()}
                    />
                )}
            </OptionsSection>

            <OptionsSection
                title="Advanced"
                description="Trusted plugin sources, permissions, and update behavior. Most people can leave these unchanged."
            >
                {!state.loading && state.settings ? <>
                    <OptionsRow name="community-package-registries" label="Plugin sources" description="One registry URL per line. Leave this unchanged unless you want to add another trusted source." stacked>
                        <textarea
                            rows={3}
                            value={state.registryUrls.join("\n")}
                            placeholder="One registry URL per line"
                            style={{ width: "100%", boxSizing: "border-box" }}
                            onInput={(event) => setState((current) => ({ ...current, registryUrls: parseRegistryUrls(event.currentTarget.value) }))}
                        />
                    </OptionsRow>
                    <OptionsRow name="community-package-direct-manifests" label="Direct plugin manifests (optional)" description="One manifest URL per line for a trusted plugin that is not listed in a registry catalog. The manifest and its artifacts still go through compatibility, permission, source-host, and integrity checks." stacked>
                        <textarea
                            rows={3}
                            value={state.directManifestUrls.join("\n")}
                            placeholder="https://example.com/my-plugin/trilium-package.json"
                            style={{ width: "100%", boxSizing: "border-box" }}
                            onInput={(event) => setState((current) => ({ ...current, directManifestUrls: parseRegistryUrls(event.currentTarget.value) }))}
                        />
                    </OptionsRow>
                    <OptionsRow name="community-package-source-hosts" label="Plugin download hosts (optional)" description="Restricts where plugin files may be downloaded from during install or update. This is separate from runtime network access." stacked>
                        <textarea
                            rows={3}
                            value={state.allowedSourceHosts}
                            placeholder="One host per line, for example:\ngithub.com\nraw.githubusercontent.com"
                            style={{ width: "100%", boxSizing: "border-box" }}
                            onInput={(event) => setState((current) => ({ ...current, allowedSourceHosts: event.currentTarget.value }))}
                        />
                    </OptionsRow>
                    <OptionsRowWithToggle
                        name="community-package-network"
                        label="Allow plugin network requests"
                        description="Controls whether installed plugins may make network requests while running. This does not control plugin downloads."
                        currentValue={state.allowNetworkPackages}
                        onChange={(value) => setState((current) => ({ ...current, allowNetworkPackages: value }))}
                    />
                    <OptionsRowWithToggle
                        name="community-package-check-updates"
                        label="Check for plugin updates automatically"
                        description="Performs a low-frequency registry check while this page is open."
                        currentValue={state.checkForUpdates}
                        onChange={(value) => setState((current) => ({ ...current, checkForUpdates: value }))}
                    />
                    <OptionsRowWithToggle
                        name="community-package-include-deprecated"
                        label="Show deprecated plugins"
                        description="Deprecated plugins stay hidden unless you explicitly choose to show them."
                        currentValue={state.includeDeprecatedPackages}
                        onChange={(value) => setState((current) => ({ ...current, includeDeprecatedPackages: value }))}
                    />
                    <OptionsRow name="community-package-update-interval" label="Update check interval (hours)" description="The minimum interval between automatic registry checks.">
                        <FormTextBox
                            type="number"
                            currentValue={String(state.updateCheckIntervalHours)}
                            onChange={(value) => setState((current) => ({ ...current, updateCheckIntervalHours: Math.max(1, Number(value) || 24) }))}
                        />
                    </OptionsRow>
                    <OptionsRowWithButton
                        label="Save advanced settings"
                        description="Apply source, permission, and update changes."
                        buttonText="Save settings"
                        disabled={savingSettings}
                        onClick={() => void saveSettings()}
                    />
                </> : !state.loading && <p>Open the plugin catalog once to initialize advanced settings.</p>}
            </OptionsSection>
        </>
    );
}

async function findPackageManager() {
    const deployedManager = await froca.getNote(COMMUNITY_PACKAGES_MANAGER_NOTE_ID, true);
    if (deployedManager?.type === "render") {
        return deployedManager;
    }

    const candidates = await search.searchForNotes("Community Packages");
    return candidates.find((note) => note.type === "render" && note.title === "Community Packages") || null;
}

export function packageHealth(artifactIds: string[], manifest?: CatalogPackage) {
    if (!manifest) return { health: "unknown" as const, healthMessage: "not in registry" };
    const expected = [...new Set(["manifest", ...manifest.artifacts.map((artifact) => artifact.id)])];
    const missing = expected.filter((artifactId) => !artifactIds.includes(artifactId));
    return missing.length
        ? { health: "broken" as const, healthMessage: `missing ${missing.join(", ")}` }
        : { health: "healthy" as const, healthMessage: "all artifacts present" };
}

async function loadCatalog(registryUrls: string[], directManifestUrls: string[], packages: PackageSummary[], includeDeprecatedPackages: boolean) {
    const registrySources = registryUrls.filter(Boolean);
    const directSources = directManifestUrls.filter(Boolean);
    if (!registrySources.length && !directSources.length) {
        return { catalog: [], updateCount: null, registryError: null };
    }

    const registryResults = registrySources.map(async (source): Promise<RawCatalogPackage[]> => {
        if (!isSecurePackageUrl(source)) throw new Error(`${source} is not a permitted plugin source URL`);
        const response = await fetch(source);
        if (!response.ok) throw new Error(`${source} returned HTTP ${response.status}`);
        const index = await response.json() as { packages?: RawCatalogPackage[] };
        if (!Array.isArray(index.packages)) throw new Error(`${source} does not contain a packages array`);
        return index.packages;
    });
    const directResults = directSources.map(async (source): Promise<RawCatalogPackage[]> => {
        if (!isSecurePackageUrl(source)) throw new Error(`${source} is not a permitted plugin source URL`);
        const response = await fetch(source);
        if (!response.ok) throw new Error(`${source} returned HTTP ${response.status}`);
        const manifest = await response.json() as RawCatalogPackage;
        if (!isCatalogPackageEntry(manifest)) {
            throw new Error(`${source} is not a valid plugin manifest`);
        }
        return [manifest];
    });
    const results = await Promise.allSettled([...registryResults, ...directResults]);
    const indexes = results
        .filter((result): result is PromiseFulfilledResult<RawCatalogPackage[]> => result.status === "fulfilled")
        .map((result) => result.value);
    const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
    if (!indexes.length) {
        return { catalog: [], updateCount: null, registryError: failures.join("; ") || "No plugin sources could be loaded." };
    }

    const seen = new Set<string>();
    const catalog = indexes.flat()
        .filter(isCatalogPackageEntry)
        .filter((entry) => {
            if (seen.has(entry.id!)) return false;
            seen.add(entry.id!);
            return true;
        })
        .map((entry) => ({
            id: entry.id!,
            name: entry.name!,
            description: entry.description || "",
            version: entry.version!,
            permissions: Array.isArray(entry.permissions) ? entry.permissions.filter((permission): permission is string => typeof permission === "string") : [],
            settings: Array.isArray(entry.settings) ? entry.settings.filter(isPackageSettingDefinition) : [],
            artifacts: Array.isArray(entry.artifacts) ? entry.artifacts.filter(isPackageArtifact) : [],
            dependencies: Array.isArray(entry.dependencies) ? entry.dependencies.filter(isPackageDependency) : [],
            compatibility: isPackageCompatibility(entry.compatibility) ? entry.compatibility : null,
            author: entry.author,
            maintainer: entry.maintainer,
            homepage: entry.homepage,
            license: entry.license,
            deprecated: entry.deprecated,
            deprecationMessage: entry.deprecationMessage,
            maintenance: entry.maintenance,
            securityStatus: entry.securityStatus,
            lastValidatedAt: entry.lastValidatedAt
        }));
    const versions = new Map(catalog.map((entry) => [entry.id, entry.version]));
    const updateCount = packages.filter((pkg) => {
        if (pkg.pinned) return false;
        const candidate = versions.get(pkg.id);
        const manifest = catalog.find((entry) => entry.id === pkg.id);
        if (manifest?.deprecated && !includeDeprecatedPackages) return false;
        return candidate && manifest?.compatibility && compatibilityStatus(manifest.compatibility) === "compatible"
            ? isNewerVersion(candidate, pkg.version)
            : false;
    }).length;
    return { catalog, updateCount, registryError: failures.length ? `Some plugin sources could not be loaded: ${failures.join("; ")}` : null };
}

export function parseRegistryUrls(value: string | null | undefined) {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.filter((url): url is string => typeof url === "string" && Boolean(url.trim())).map((url) => url.trim());
    } catch {
        // Legacy and hand-edited values are accepted as newline-separated URLs.
    }
    return value.split(/[\r\n]+/).map((url) => url.trim()).filter(Boolean);
}

export function normalizeSourceHosts(value: string) {
    return value.split(/[\s,]+/).map((host) => host.trim()).filter(Boolean).join("\n");
}

function InstalledPackageDetails({ pkg, manifest, onChange, onSave, onPinChange, onRepair, disabled }: { pkg: PackageSummary; manifest?: CatalogPackage; onChange: (key: string, value: unknown) => void; onSave: () => void; onPinChange: (pinned: boolean) => void; onRepair: () => void; disabled: boolean }) {
    return (
        <div className="community-package-details">
            <OptionsRow name={`community-package-health-${pkg.noteId}`} label="Health" description="Checks that the installed package still contains its declared artifacts.">
                <span>{pkg.health}{pkg.healthMessage ? ` (${pkg.healthMessage})` : ""}</span>
            </OptionsRow>
            {pkg.health === "broken" && <OptionsRowWithButton
                label="Repair package"
                description="Downloads the declared artifacts again and replaces the broken installation. The repaired package stays disabled until you enable it."
                buttonText="Open repair"
                buttonClassName="btn-primary"
                disabled={disabled}
                onClick={onRepair}
            />}
            {manifest ? <>
                <OptionsRow name={`community-package-maintenance-${pkg.noteId}`} label="Registry status" description="Maintenance and security metadata published by the registry.">
                    <span>{[manifestStatus(manifest), manifest.maintainer && `Maintainer: ${manifest.maintainer}`, manifest.license && `License: ${manifest.license}`].filter(Boolean).join(" · ") || "No additional registry metadata"}</span>
                </OptionsRow>
                <OptionsRow name={`community-package-permissions-${pkg.noteId}`} label="Permissions" description="Permissions declared by the package manifest.">
                    <span>{manifest.permissions.length ? manifest.permissions.join(", ") : "None declared"}</span>
                </OptionsRow>
                <OptionsRow name={`community-package-dependencies-${pkg.noteId}`} label="Dependencies" description="Required packages must be installed first.">
                    <span>{manifest.dependencies.length ? manifest.dependencies.map(formatDependency).join(", ") : "None declared"}</span>
                </OptionsRow>
                {manifest.compatibility && <OptionsRow name={`community-package-compatibility-${pkg.noteId}`} label="Compatibility" description="Trilium versions declared by the package manifest.">
                    <span>{formatCompatibility(manifest.compatibility)} · {compatibilityStatus(manifest.compatibility)}</span>
                </OptionsRow>}
                {manifest.settings.map((setting) => <PackageSettingEditor
                    key={setting.key}
                    packageId={pkg.id}
                    setting={setting}
                    value={pkg.settings[setting.key]}
                    onChange={(value) => onChange(setting.key, value)}
                    disabled={disabled}
                />)}
                {manifest.settings.length > 0 && <OptionsRowWithButton
                    label="Package settings"
                    description="Settings remain stored while the package is disabled."
                    buttonText="Save package settings"
                    disabled={disabled}
                    onClick={onSave}
                />}
            </> : <p className="text-muted">This package is not present in the configured registry, so its manifest details are unavailable.</p>}
            <OptionsRowWithToggle
                name={`community-package-pinned-${pkg.noteId}`}
                label="Pin updates"
                description="Pinned packages stay at this version until you unpin them."
                currentValue={pkg.pinned}
                onChange={onPinChange}
                disabled={disabled}
            />
        </div>
    );
}

function PackageSettingEditor({ packageId, setting, value, onChange, disabled }: { packageId: string; setting: PackageSettingDefinition; value: unknown; onChange: (value: unknown) => void; disabled: boolean }) {
    const name = `community-package-${packageId}-${setting.key}`;
    if (setting.type === "boolean") {
        return <OptionsRowWithToggle name={name} label={setting.title} description={setting.description} currentValue={Boolean(value)} onChange={onChange} disabled={disabled} />;
    }
    if (setting.type === "select") {
        return (
            <OptionsRow name={name} label={setting.title} description={setting.description}>
                <select value={String(value ?? "")} onChange={(event) => onChange(event.currentTarget.value)} disabled={disabled}>
                    {(setting.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
            </OptionsRow>
        );
    }
    return (
        <OptionsRow name={name} label={setting.title} description={setting.description}>
            <FormTextBox
                type={setting.type === "secret" ? "password" : setting.type === "number" ? "number" : "text"}
                currentValue={value === undefined || value === null ? "" : String(value)}
                onChange={(newValue) => onChange(setting.type === "number" ? Number(newValue) : newValue)}
                disabled={disabled}
            />
        </OptionsRow>
    );
}

export function isPackageSettingDefinition(value: unknown): value is PackageSettingDefinition {
    if (!value || typeof value !== "object") return false;
    const setting = value as Partial<PackageSettingDefinition>;
    return typeof setting.key === "string"
        && PACKAGE_SETTING_KEY_PATTERN.test(setting.key)
        && typeof setting.title === "string"
        && ["boolean", "number", "string", "secret", "select"].includes(setting.type || "")
        && (setting.options === undefined || (Array.isArray(setting.options) && setting.options.every((option) => typeof option === "string")));
}

export function isPackageDependency(value: unknown): value is PackageDependency {
    if (!value || typeof value !== "object") return false;
    const dependency = value as Partial<PackageDependency>;
    return typeof dependency.id === "string"
        && PACKAGE_ID_PATTERN.test(dependency.id)
        && typeof dependency.version === "string"
        && PACKAGE_VERSION_RANGE_PATTERN.test(dependency.version);
}

export function isPackageArtifact(value: unknown): value is PackageArtifact {
    if (!value || typeof value !== "object") return false;
    const artifact = value as Partial<PackageArtifact>;
    return typeof artifact.id === "string"
        && PACKAGE_ARTIFACT_ID_PATTERN.test(artifact.id)
        && typeof artifact.source === "string"
        && isSecurePackageUrl(artifact.source)
        && typeof artifact.integrity === "string"
        && /^sha256-[A-Za-z0-9+/]{43}=$/.test(artifact.integrity);
}

export function isCatalogPackageEntry(value: RawCatalogPackage): value is RawCatalogPackage & Required<Pick<RawCatalogPackage, "id" | "name" | "version" | "description" | "repository" | "artifacts">> {
    return Boolean(
        value
        && typeof value.id === "string"
        && PACKAGE_ID_PATTERN.test(value.id)
        && typeof value.name === "string"
        && typeof value.version === "string"
        && PACKAGE_VERSION_PATTERN.test(value.version)
        && typeof value.description === "string"
        && typeof value.repository === "string"
        && isSecurePackageUrl(value.repository)
        && isPackageCompatibility(value.compatibility)
        && Array.isArray(value.artifacts)
        && value.artifacts.length > 0
        && value.artifacts.every(isPackageArtifact)
    );
}

export function isSecurePackageUrl(value: string) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname));
    } catch {
        return false;
    }
}

export function isPackageCompatibility(value: unknown): value is PackageCompatibility {
    if (!value || typeof value !== "object") return false;
    const compatibility = value as Partial<PackageCompatibility>;
    return typeof compatibility.minTriliumVersion === "string"
        && PACKAGE_VERSION_PATTERN.test(compatibility.minTriliumVersion)
        && (compatibility.maxTriliumVersion === undefined || PACKAGE_VERSION_PATTERN.test(compatibility.maxTriliumVersion))
        && (!compatibility.maxTriliumVersion
            || (compareVersions(compatibility.minTriliumVersion, compatibility.maxTriliumVersion) ?? -1) <= 0);
}

export function formatDependency(dependency: PackageDependency) {
    return `${dependency.id} ${dependency.version}${dependency.optional ? " (optional)" : ""}`;
}

export function formatCompatibility(compatibility: PackageCompatibility) {
    return compatibility.maxTriliumVersion
        ? `${compatibility.minTriliumVersion} – ${compatibility.maxTriliumVersion}`
        : `${compatibility.minTriliumVersion}+`;
}

export function compatibilityStatus(compatibility: PackageCompatibility) {
    const currentVersion = window.glob.triliumVersion;
    const minimumComparison = compareVersions(currentVersion, compatibility.minTriliumVersion);
    if (minimumComparison === null || !currentVersion) return "compatibility unknown";
    if (minimumComparison < 0) return `incompatible with ${currentVersion}`;
    if (compatibility.maxTriliumVersion) {
        const maximumComparison = compareVersions(currentVersion, compatibility.maxTriliumVersion);
        if (maximumComparison === null) return "compatibility unknown";
        if (maximumComparison > 0) return `incompatible with ${currentVersion}`;
    }
    return "compatible";
}

export function manifestStatus(manifest: CatalogPackage) {
    const status: string[] = [];
    if (manifest.deprecated) status.push(`Deprecated${manifest.deprecationMessage ? `: ${manifest.deprecationMessage}` : ""}`);
    if (manifest.maintenance && manifest.maintenance !== "active") status.push(`Maintenance: ${manifest.maintenance}`);
    if (manifest.securityStatus === "warning") status.push("Security review warning");
    else if (manifest.securityStatus === "unreviewed") status.push("Security: unreviewed");
    if (manifest.lastValidatedAt) status.push(`Validated ${manifest.lastValidatedAt.slice(0, 10)}`);
    return status.join(" · ");
}

function readPackageSettings(note: FNote, manifest: CatalogPackage) {
    return Object.fromEntries(manifest.settings.map((setting) => {
        const stored = note.getOwnedLabelValue(settingLabelName(setting.key));
        return [setting.key, stored === null ? setting.default : parseSettingValue(stored, setting)];
    }));
}

export function parseSettingValue(value: string, setting: PackageSettingDefinition) {
    try {
        return JSON.parse(value);
    } catch {
        if (setting.type === "boolean") return value === "true";
        if (setting.type === "number") return Number(value);
        return value;
    }
}

export function serializeSetting(value: unknown) {
    return value === undefined ? "" : JSON.stringify(value);
}

export function settingLabelName(key: string) {
    return `packageSetting:${key}`;
}

export function isNewerVersion(candidate: string, installed: string) {
    const candidateParts = candidate.split(/[.-]/).slice(0, 3).map(Number);
    const installedParts = installed.split(/[.-]/).slice(0, 3).map(Number);
    if (candidateParts.length !== 3 || installedParts.length !== 3 || [...candidateParts, ...installedParts].some(Number.isNaN)) return false;
    for (let index = 0; index < 3; index++) {
        if (candidateParts[index] !== installedParts[index]) return candidateParts[index] > installedParts[index];
    }
    return false;
}

export function compareVersions(left: string, right: string) {
    const leftParts = parseVersionParts(left);
    const rightParts = parseVersionParts(right);
    if (!leftParts || !rightParts) return null;
    for (let index = 0; index < 3; index++) {
        if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
    }
    return 0;
}

function parseVersionParts(version: string) {
    const parts = version.split(/[.-]/).slice(0, 3).map(Number);
    return parts.length === 3 && parts.every((part) => Number.isInteger(part) && part >= 0) ? parts : null;
}
