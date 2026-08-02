import { useCallback, useEffect, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import type FNote from "../../../entities/fnote";
import { setLabel } from "../../../services/attributes";
import { closeActiveDialog } from "../../../services/dialog";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
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
        if (!shouldScheduleUpdateChecks(state.loading, state.checkForUpdates, state.registryUrls, state.directManifestUrls)) return;
        const intervalHours = Math.max(1, state.updateCheckIntervalHours || 24);
        const timer = window.setInterval(() => void refresh(), intervalHours * 60 * 60 * 1000);
        return () => window.clearInterval(timer);
    }, [refresh, state.checkForUpdates, state.directManifestUrls, state.loading, state.registryUrls, state.updateCheckIntervalHours]);

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
            toast.showMessage(t("plugins.package_settings_saved"));
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
            toast.showMessage(t("plugins.plugin_settings_saved", { title: pkg.title }));
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
            toast.showMessage(t(pinned ? "plugins.updates_pinned" : "plugins.updates_unpinned", { title: pkg.title }));
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
            toast.showMessage(t(enabled ? "plugins.plugin_enabled" : "plugins.plugin_disabled", { title: pkg.title }));
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
                title={t("plugins.available_title")}
                description={t("plugins.available_description")}
            >
                {!state.loading && state.interruptedTransactionCount > 0 && (
                    <OptionsRowWithButton
                        label={t("plugins.incomplete_operation_label")}
                        description={t("plugins.incomplete_operation_description", { count: state.interruptedTransactionCount })}
                        icon="bx-error"
                        buttonText={t("plugins.open_recovery")}
                        buttonClassName="btn-warning"
                        onClick={() => void openCatalog()}
                    />
                )}
                {!state.loading && state.manager && availablePackages.length > 0 && (
                    <OptionsRowWithButton
                        label={t("plugins.available_count", { count: availablePackages.length })}
                        description={availablePackages.map((pkg) => pkg.name).join(", ")}
                        icon="bx-package"
                        buttonText={t("plugins.browse_available")}
                        buttonClassName="btn-primary"
                        onClick={() => void openCatalog()}
                    />
                )}
                {!state.loading && state.manager && availablePackages.length === 0 && (
                    <OptionsRowWithButton
                        label={t("plugins.catalog")}
                        description={t("plugins.catalog_description")}
                        icon="bx-package"
                        buttonText={t("plugins.browse_catalog")}
                        onClick={() => void openCatalog()}
                    />
                )}
                {!state.loading && !state.manager && !state.error && (
                    <p>{t("plugins.catalog_not_available")}</p>
                )}
            </OptionsSection>

            <OptionsSection
                title={t("plugins.installed_title")}
                description={t("plugins.installed_description")}
            >
                {state.error && <p role="alert">{t("plugins.load_error", { error: state.error })}</p>}
                {state.loading && <p>{t("plugins.loading")}</p>}
                {!state.loading && !state.packages.length && <NoItems icon="bx bx-package" text={t("plugins.no_installed")} />}
                {state.packages.map((pkg) => (
                    <div key={pkg.noteId}>
                        <OptionsRow name={`community-package-${pkg.noteId}`} label={pkg.title} description={formatInstalledPackageDescription(pkg)}>
                            <span style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "0.4em" }}>
                                <Button
                                    text={pkg.enabled ? t("plugins.disable") : t("plugins.enable")}
                                    kind={pkg.enabled ? undefined : "primary"}
                                    size="micro"
                                    disabled={savingPackage === pkg.id}
                                    onClick={() => void setPackageEnabled(pkg, !pkg.enabled)}
                                />
                                <Button
                                    text={configuredPackage === pkg.id ? t("plugins.hide_settings") : t("plugins.settings_button")}
                                    icon="bx-cog"
                                    size="micro"
                                    disabled={savingPackage === pkg.id}
                                    onClick={() => setConfiguredPackage((current) => current === pkg.id ? "" : pkg.id)}
                                    title={t("plugins.details_title")}
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
                title={t("plugins.updates_title")}
                description={t("plugins.updates_description")}
            >
                {state.registryError && <p role="alert">{t("plugins.update_error", { error: state.registryError })}</p>}
                {!state.loading && state.updateCount === null && !state.registryError && <p>{t("plugins.configure_source")}</p>}
                {!state.loading && state.updateCount === 0 && !state.registryError && <NoItems icon="bx bx-check" text={t("plugins.up_to_date")} />}
                {!state.loading && state.updateCount !== null && state.updateCount > 0 && (
                    <OptionsRowWithButton
                        label={t("plugins.updates_available", { count: state.updateCount })}
                        description={t("plugins.review_updates_description")}
                        buttonText={t("plugins.review_updates")}
                        onClick={() => void openCatalog()}
                    />
                )}
            </OptionsSection>

            <OptionsSection
                title={t("plugins.advanced_title")}
                description={t("plugins.advanced_description")}
            >
                {!state.loading && state.settings ? <>
                    <OptionsRow name="community-package-registries" label={t("plugins.registry_label")} description={t("plugins.registry_description")} stacked>
                        <textarea
                            rows={3}
                            value={state.registryUrls.join("\n")}
                            placeholder={t("plugins.registry_placeholder")}
                            style={{ width: "100%", boxSizing: "border-box" }}
                            onInput={(event) => setState((current) => ({ ...current, registryUrls: parseRegistryUrls(event.currentTarget.value) }))}
                        />
                    </OptionsRow>
                    <OptionsRow name="community-package-direct-manifests" label={t("plugins.direct_manifest_label")} description={t("plugins.direct_manifest_description")} stacked>
                        <textarea
                            rows={3}
                            value={state.directManifestUrls.join("\n")}
                            placeholder={t("plugins.direct_manifest_placeholder")}
                            style={{ width: "100%", boxSizing: "border-box" }}
                            onInput={(event) => setState((current) => ({ ...current, directManifestUrls: parseRegistryUrls(event.currentTarget.value) }))}
                        />
                    </OptionsRow>
                    <OptionsRow name="community-package-source-hosts" label={t("plugins.download_hosts_label")} description={t("plugins.download_hosts_description")} stacked>
                        <textarea
                            rows={3}
                            value={state.allowedSourceHosts}
                            placeholder={t("plugins.download_hosts_placeholder")}
                            style={{ width: "100%", boxSizing: "border-box" }}
                            onInput={(event) => setState((current) => ({ ...current, allowedSourceHosts: event.currentTarget.value }))}
                        />
                    </OptionsRow>
                    <OptionsRowWithToggle
                        name="community-package-network"
                        label={t("plugins.network_label")}
                        description={t("plugins.network_description")}
                        currentValue={state.allowNetworkPackages}
                        onChange={(value) => setState((current) => ({ ...current, allowNetworkPackages: value }))}
                    />
                    <OptionsRowWithToggle
                        name="community-package-check-updates"
                        label={t("plugins.check_updates_label")}
                        description={t("plugins.check_updates_description")}
                        currentValue={state.checkForUpdates}
                        onChange={(value) => setState((current) => ({ ...current, checkForUpdates: value }))}
                    />
                    <OptionsRowWithToggle
                        name="community-package-include-deprecated"
                        label={t("plugins.include_deprecated_label")}
                        description={t("plugins.include_deprecated_description")}
                        currentValue={state.includeDeprecatedPackages}
                        onChange={(value) => setState((current) => ({ ...current, includeDeprecatedPackages: value }))}
                    />
                    <OptionsRow name="community-package-update-interval" label={t("plugins.interval_label")} description={t("plugins.interval_description")}>
                        <FormTextBox
                            type="number"
                            currentValue={String(state.updateCheckIntervalHours)}
                            onChange={(value) => setState((current) => ({ ...current, updateCheckIntervalHours: Math.max(1, Number(value) || 24) }))}
                        />
                    </OptionsRow>
                    <OptionsRowWithButton
                        label={t("plugins.save_advanced_label")}
                        description={t("plugins.save_advanced_description")}
                        buttonText={t("plugins.save_settings")}
                        disabled={savingSettings}
                        onClick={() => void saveSettings()}
                    />
                </> : !state.loading && <p>{t("plugins.initialize_advanced")}</p>}
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

export function shouldScheduleUpdateChecks(loading: boolean, checkForUpdates: boolean, registryUrls: string[], directManifestUrls: string[]) {
    return !loading && checkForUpdates && Boolean(registryUrls.length || directManifestUrls.length);
}

function formatInstalledPackageDescription(pkg: PackageSummary) {
    return t("plugins.installed_summary", {
        id: pkg.id,
        version: pkg.version,
        state: t(pkg.enabled ? "plugins.enabled" : "plugins.disabled"),
        pinned: pkg.pinned ? ` · ${t("plugins.pinned")}` : "",
        health: t(`plugins.health_${pkg.health}`),
        healthMessage: pkg.healthMessage ? ` (${formatHealthMessage(pkg.healthMessage)})` : ""
    });
}

function formatHealthMessage(message: string) {
    if (message === "all artifacts present") return t("plugins.health_all_artifacts");
    if (message === "not checked") return t("plugins.health_not_checked");
    if (message === "not in registry") return t("plugins.health_not_in_registry");
    if (message.startsWith("missing ")) return t("plugins.health_missing", { artifacts: message.slice("missing ".length) });
    return message;
}

function InstalledPackageDetails({ pkg, manifest, onChange, onSave, onPinChange, onRepair, disabled }: { pkg: PackageSummary; manifest?: CatalogPackage; onChange: (key: string, value: unknown) => void; onSave: () => void; onPinChange: (pinned: boolean) => void; onRepair: () => void; disabled: boolean }) {
    return (
        <div className="community-package-details options-section-card">
            <h5>{t("plugins.settings_panel_heading")}</h5>
            <p className="options-section-description">{t("plugins.settings_panel_description")}</p>
            <OptionsRow name={`community-package-health-${pkg.noteId}`} label={t("plugins.health_label")} description={t("plugins.health_description")}>
                <span>{t(`plugins.health_${pkg.health}`)}{pkg.healthMessage ? ` (${formatHealthMessage(pkg.healthMessage)})` : ""}</span>
            </OptionsRow>
            {pkg.health === "broken" && <OptionsRowWithButton
                label={t("plugins.repair_label")}
                description={t("plugins.repair_description")}
                buttonText={t("plugins.open_repair")}
                buttonClassName="btn-primary"
                disabled={disabled}
                onClick={onRepair}
            />}
            {manifest ? <>
                <OptionsRow name={`community-package-maintenance-${pkg.noteId}`} label={t("plugins.registry_status_label")} description={t("plugins.registry_status_description")}>
                    <span>{[manifestStatus(manifest), manifest.maintainer && t("plugins.maintainer", { maintainer: manifest.maintainer }), manifest.license && t("plugins.license", { license: manifest.license })].filter(Boolean).join(" · ") || t("plugins.no_registry_metadata")}</span>
                </OptionsRow>
                <OptionsRow name={`community-package-permissions-${pkg.noteId}`} label={t("plugins.permissions_label")} description={t("plugins.permissions_description")}>
                    <span>{manifest.permissions.length ? manifest.permissions.join(", ") : t("plugins.none_declared")}</span>
                </OptionsRow>
                <OptionsRow name={`community-package-dependencies-${pkg.noteId}`} label={t("plugins.dependencies_label")} description={t("plugins.dependencies_description")}>
                    <span>{manifest.dependencies.length ? manifest.dependencies.map(formatDependency).join(", ") : t("plugins.none_declared")}</span>
                </OptionsRow>
                {manifest.compatibility && <OptionsRow name={`community-package-compatibility-${pkg.noteId}`} label={t("plugins.compatibility_label")} description={t("plugins.compatibility_description")}>
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
                    label={t("plugins.package_settings_label")}
                    description={t("plugins.package_settings_description")}
                    buttonText={t("plugins.save_package_settings")}
                    disabled={disabled}
                    onClick={onSave}
                />}
            </> : <p className="text-muted">{t("plugins.manifest_unavailable")}</p>}
            <OptionsRowWithToggle
                name={`community-package-pinned-${pkg.noteId}`}
                label={t("plugins.pin_label")}
                description={t("plugins.pin_description")}
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
    return compareVersions(candidate, installed) === 1;
}

export function compareVersions(left: string, right: string) {
    const leftParts = parseVersion(left);
    const rightParts = parseVersion(right);
    if (!leftParts || !rightParts) return null;
    for (let index = 0; index < 3; index++) {
        if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
    }
    return comparePrerelease(leftParts[3], rightParts[3]);
}

type ParsedVersion = [number, number, number, string[]];

function parseVersion(version: string): ParsedVersion | null {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
    if (!match) return null;
    const core = match.slice(1, 4).map(Number);
    if (core.some((part) => !Number.isInteger(part) || part < 0)) return null;
    const prerelease = match[4] ? match[4].split(".") : [];
    if (prerelease.some((identifier) => !identifier || !/^[0-9A-Za-z-]+$/.test(identifier))) return null;
    return [core[0], core[1], core[2], prerelease];
}

function comparePrerelease(left: string[], right: string[]) {
    if (!left.length && !right.length) return 0;
    if (!left.length) return 1;
    if (!right.length) return -1;
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
        if (left[index] === undefined) return -1;
        if (right[index] === undefined) return 1;
        const leftNumeric = /^\d+$/.test(left[index]);
        const rightNumeric = /^\d+$/.test(right[index]);
        if (leftNumeric && rightNumeric) {
            const leftNumber = left[index].replace(/^0+/, "") || "0";
            const rightNumber = right[index].replace(/^0+/, "") || "0";
            if (leftNumber.length !== rightNumber.length) return leftNumber.length > rightNumber.length ? 1 : -1;
            if (leftNumber !== rightNumber) return leftNumber > rightNumber ? 1 : -1;
        } else if (leftNumeric !== rightNumeric) {
            return leftNumeric ? -1 : 1;
        } else if (left[index] !== right[index]) {
            return left[index] > right[index] ? 1 : -1;
        }
    }
    return 0;
}
