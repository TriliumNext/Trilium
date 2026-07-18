import { useCallback, useMemo, useState } from "preact/hooks";

import dialog from "../../../services/dialog";
import { isExperimentalFeatureEnabled } from "../../../services/experimental_features";
import { t } from "../../../services/i18n";
import ActionButton from "../../react/ActionButton";
import Button from "../../react/Button";
import FormToggle from "../../react/FormToggle";
import { useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import OptionsRow from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";
import AddProviderModal, { getProviderKind, type LlmProviderConfig, PROVIDER_TYPES } from "./llm/AddProviderModal";

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

export default function LlmSettings() {
    if (!isExperimentalFeatureEnabled("llm")) {
        return (
            <OptionsSection title={t("llm.settings_title")}>
                <p className="form-text">{t("llm.feature_not_enabled")}</p>
            </OptionsSection>
        );
    }

    return (
        <>
            <ProviderSettings />
            <WebSearchSettings />
            <McpSettings />
        </>
    );
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
        <OptionsSection title={t("llm.settings_title")}>
            <p className="form-text">{t("llm.settings_description")}</p>

            <Button
                size="small"
                icon="bx bx-plus"
                text={t("llm.add_provider")}
                onClick={() => setShowAddModal(true)}
            />

            <hr />

            <h5>{t("llm.configured_providers")}</h5>
            <ProviderList
                providers={llmProviders}
                emptyText={t("llm.no_providers_configured")}
                onDelete={handleDeleteProvider}
            />

            <AddProviderModal
                show={showAddModal}
                onHidden={() => setShowAddModal(false)}
                onSave={handleAddProvider}
            />
        </OptionsSection>
    );
}

function getMcpEndpointUrl() {
    const port = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
    return `${window.location.protocol}//localhost:${port}/mcp`;
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

            <Button
                size="small"
                icon="bx bx-plus"
                text={t("llm.add_search_engine")}
                onClick={() => setShowAddModal(true)}
            />

            <hr />

            <h5>{t("llm.configured_search_engines")}</h5>
            <ProviderList
                providers={searchEngines}
                emptyText={t("llm.no_search_engines_configured")}
                onDelete={handleDeleteEngine}
            />

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

function McpSettings() {
    const [mcpEnabled, setMcpEnabled] = useTriliumOptionBool("mcpEnabled");
    const endpointUrl = useMemo(() => getMcpEndpointUrl(), []);

    return (
        <OptionsSection title={t("llm.mcp_title")}>
            <OptionsRow name="mcp-enabled" label={t("llm.mcp_enabled")} description={t("llm.mcp_enabled_description")}>
                <FormToggle
                    switchOnName="" switchOffName=""
                    currentValue={mcpEnabled}
                    onChange={setMcpEnabled}
                />
            </OptionsRow>

            {mcpEnabled && (
                <OptionsRow name="mcp-endpoint" label={t("llm.mcp_endpoint_title")} description={t("llm.mcp_endpoint_description")}>
                    <input
                        type="text"
                        className="form-control"
                        value={endpointUrl}
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
        return <div>{emptyText}</div>;
    }

    return (
        <div style={{ overflow: "auto" }}>
            <table className="table table-stripped">
                <thead>
                    <tr>
                        <th>{t("llm.provider_name")}</th>
                        <th>{t("llm.provider_type")}</th>
                        <th>{t("llm.actions")}</th>
                    </tr>
                </thead>
                <tbody>
                    {providers.map((provider) => {
                        const providerType = PROVIDER_TYPES.find(p => p.id === provider.provider);
                        return (
                            <tr key={provider.id}>
                                <td>{provider.name}</td>
                                <td>{providerType?.name || provider.provider}</td>
                                <td>
                                    <ActionButton
                                        icon="bx bx-trash"
                                        text={t("llm.delete_provider")}
                                        onClick={() => onDelete(provider.id, provider.name)}
                                    />
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
