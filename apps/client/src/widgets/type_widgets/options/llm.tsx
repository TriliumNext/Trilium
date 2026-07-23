import "./llm.css";

import { useCallback, useMemo, useState } from "preact/hooks";

import dialog from "../../../services/dialog";
import { t } from "../../../services/i18n";
import { isStandalone } from "../../../services/utils";
import ActionButton from "../../react/ActionButton";
import Button from "../../react/Button";
import FormTextBox from "../../react/FormTextBox";
import FormToggle from "../../react/FormToggle";
import { useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import MaskedIcon from "../../react/MaskedIcon";
import NoItems from "../../react/NoItems";
import OptionsPageHeader from "./components/OptionsPageHeader";
import OptionsRow, { OptionsRowWithToggle } from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";
import AddProviderModal, { getProviderKind, type LlmProviderConfig, PROVIDER_TYPES } from "./llm/AddProviderModal";

export default function LlmSettings() {
    const [aiEnabled, setAiEnabled] = useTriliumOptionBool("aiEnabled");

    if (isStandalone) {
        return (
            <>
                <OptionsPageHeader helpUrl="GBBMSlVSOIGP" />
                <OptionsSection>
                    <NoItems icon="bx bx-bot" text={t("llm.not_available_in_standalone")} />
                </OptionsSection>
            </>
        );
    }

    return (
        <>
            <OptionsPageHeader
                helpUrl="GBBMSlVSOIGP"
                actions={
                    <FormToggle
                        switchOnName="" switchOffName=""
                        switchOnTooltip={t("experimental_features.llm_name")}
                        switchOffTooltip={t("experimental_features.llm_name")}
                        currentValue={aiEnabled}
                        onChange={setAiEnabled}
                    />
                }
            />

            {aiEnabled ? (
                <>
                    <ProviderSettings />
                    <WebSearchSettings />
                    <McpSettings />
                </>
            ) : (
                <OptionsSection>
                    <NoItems icon="bx bx-bot" text={t("llm.disabled_placeholder")} />
                </OptionsSection>
            )}
        </>
    );
}

/** Shared state for the llmProviders option (used by both provider sections). */
function useLlmProviders(): [LlmProviderConfig[], (providers: LlmProviderConfig[]) => void] {
    const [providersJson, setProvidersJson] = useTriliumOption("llmProviders");
    const providers = useMemo<LlmProviderConfig[]>(() => {
        try {
            return providersJson ? JSON.parse(providersJson) : [];
        } catch {
            return [];
        }
    }, [providersJson]);
    const setProviders = useCallback((newProviders: LlmProviderConfig[]) => {
        setProvidersJson(JSON.stringify(newProviders));
    }, [setProvidersJson]);
    return [providers, setProviders];
}

function ProviderSettings() {
    const [providers, setProviders] = useLlmProviders();
    const llmProviders = useMemo(() => providers.filter(p => getProviderKind(p) === "llm"), [providers]);
    const [showAddModal, setShowAddModal] = useState(false);

    const handleAddProvider = useCallback((newProvider: LlmProviderConfig) => {
        setProviders([...providers, newProvider]);
    }, [providers, setProviders]);

    const handleDeleteProvider = useCallback(async (providerId: string, providerName: string) => {
        if (!(await dialog.confirm(t("llm.delete_provider_confirmation", { name: providerName })))) {
            return;
        }
        setProviders(providers.filter(p => p.id !== providerId));
    }, [providers, setProviders]);

    return (
        <OptionsSection title={t("llm.configured_providers")}>
            <ProviderList
                providers={llmProviders}
                emptyText={t("llm.no_providers_configured")}
                onDelete={handleDeleteProvider}
            />

            <OptionsRow name="add-llm-provider" centered>
                <Button
                    name="add-llm-provider-button"
                    size="micro" icon="bx bx-plus"
                    text={t("llm.add_provider")}
                    onClick={() => setShowAddModal(true)}
                />
            </OptionsRow>

            <AddProviderModal
                show={showAddModal}
                onHidden={() => setShowAddModal(false)}
                onSave={handleAddProvider}
            />
        </OptionsSection>
    );
}

function WebSearchSettings() {
    const [providers, setProviders] = useLlmProviders();
    const searchEngines = useMemo(() => providers.filter(p => getProviderKind(p) === "search"), [providers]);
    const [selectedEngine, setSelectedEngine] = useTriliumOption("llmWebSearchEngine");
    const [searchTimeout, setSearchTimeout] = useTriliumOption("llmSearchTimeout");
    const [showAddModal, setShowAddModal] = useState(false);

    const handleAddEngine = useCallback((newEngine: LlmProviderConfig) => {
        setProviders([...providers, newEngine]);
        // Select the newly added engine if the provider default was active
        if (!selectedEngine || selectedEngine === "provider") {
            setSelectedEngine(newEngine.id);
        }
    }, [providers, setProviders, selectedEngine, setSelectedEngine]);

    const handleDeleteEngine = useCallback(async (engineId: string, engineName: string) => {
        if (!(await dialog.confirm(t("llm.delete_provider_confirmation", { name: engineName })))) {
            return;
        }
        setProviders(providers.filter(p => p.id !== engineId));
        if (selectedEngine === engineId) {
            setSelectedEngine("provider");
        }
    }, [providers, setProviders, selectedEngine, setSelectedEngine]);

    return (
        <OptionsSection title={t("llm.web_search_title")}>
            <p className="form-text">{t("llm.web_search_description")}</p>

            <ProviderList
                providers={searchEngines}
                emptyText={t("llm.no_search_engines_configured")}
                onDelete={handleDeleteEngine}
            />

            <OptionsRow name="add-search-engine" centered>
                <Button
                    name="add-search-engine-button"
                    size="micro" icon="bx bx-plus"
                    text={t("llm.add_search_engine")}
                    onClick={() => setShowAddModal(true)}
                />
            </OptionsRow>

            <OptionsRow name="web-search-engine" label={t("llm.web_search_engine")} description={t("llm.web_search_engine_description")}>
                <select
                    className="form-select"
                    value={selectedEngine || "provider"}
                    onChange={(e) => setSelectedEngine((e.target as HTMLSelectElement).value)}
                >
                    <option value="provider">{t("llm.web_search_provider_default")}</option>
                    {searchEngines.map(engine => (
                        <option key={engine.id} value={engine.id}>{engine.name}</option>
                    ))}
                </select>
            </OptionsRow>

            <OptionsRow name="search-timeout" label={t("llm.search_timeout")} description={t("llm.search_timeout_description")}>
                <input
                    type="number"
                    className="form-control"
                    min="1"
                    max="120"
                    value={searchTimeout || "15"}
                    onChange={(e) => setSearchTimeout((e.target as HTMLInputElement).value)}
                />
            </OptionsRow>

            <AddProviderModal
                show={showAddModal}
                onHidden={() => setShowAddModal(false)}
                onSave={handleAddEngine}
                kind="search"
            />
        </OptionsSection>
    );
}

function getMcpEndpointUrl() {
    // On desktop the renderer lives on `trilium-app://app/`, so window.location
    // does not point at a reachable HTTP origin. The server injects an absolute
    // httpBaseUrl in that case; in the browser we derive it from the page.
    if (window.glob.httpBaseUrl) {
        return `${window.glob.httpBaseUrl}/mcp`;
    }
    const port = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
    return `${window.location.protocol}//localhost:${port}/mcp`;
}

function McpSettings() {
    const [mcpEnabled, setMcpEnabled] = useTriliumOptionBool("mcpEnabled");
    const endpointUrl = useMemo(() => getMcpEndpointUrl(), []);

    return (
        <OptionsSection title={t("llm.mcp_title")}>
            <OptionsRowWithToggle
                name="mcp-enabled"
                label={t("llm.mcp_enabled")}
                description={t("llm.mcp_enabled_description")}
                currentValue={mcpEnabled}
                onChange={setMcpEnabled}
            />

            {mcpEnabled && (
                <OptionsRow name="mcp-endpoint" label={t("llm.mcp_endpoint_title")} description={t("llm.mcp_endpoint_description")}>
                    <FormTextBox
                        className="selectable-text"
                        currentValue={endpointUrl}
                        readOnly
                    />
                </OptionsRow>
            )}
        </OptionsSection>
    );
}

interface ProviderListProps {
    providers: LlmProviderConfig[];
    emptyText: string;
    onDelete: (providerId: string, providerName: string) => Promise<void>;
}

function ProviderList({ providers, emptyText, onDelete }: ProviderListProps) {
    if (!providers.length) {
        return <NoItems icon="bx bx-bot" text={emptyText} />;
    }

    return <>
        {providers.map((provider) => {
            const providerType = PROVIDER_TYPES.find(p => p.id === provider.provider);
            return (
                <OptionsRow
                    key={provider.id}
                    name="llm-provider"
                    label={
                        <span className="llm-provider-name">
                            {providerType?.iconUrl && <MaskedIcon url={providerType.iconUrl} />}
                            {provider.name}
                        </span>
                    }
                    description={providerType?.name || provider.provider}
                >
                    <ActionButton
                        icon="bx bx-trash"
                        text={t("llm.delete_provider")}
                        onClick={() => onDelete(provider.id, provider.name)}
                    />
                </OptionsRow>
            );
        })}
    </>;
}
