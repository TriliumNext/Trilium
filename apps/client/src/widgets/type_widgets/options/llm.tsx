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
import AddProviderModal, { type LlmProviderConfig, PROVIDER_TYPES } from "./llm/AddProviderModal";

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

function ProviderSettings() {
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
                providers={providers}
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
    onDelete: (providerId: string, providerName: string) => Promise<void>;
}

function ProviderList({ providers, onDelete }: ProviderListProps) {
    if (!providers.length) {
        return <NoItems icon="bx bx-bot" text={t("llm.no_providers_configured")} />;
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
