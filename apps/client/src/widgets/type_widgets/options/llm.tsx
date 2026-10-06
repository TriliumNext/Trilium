import "./llm.css";

import { isProviderOfKind, type LlmProviderKind, type NetworkAddressesResponse } from "@triliumnext/commons";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";

import dialog from "../../../services/dialog";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import { isStandalone } from "../../../services/utils";
import ActionButton from "../../react/ActionButton";
import Button from "../../react/Button";
import { Card, CardSection, OptionCardSection } from "../../react/Card";
import CodeBlock from "../../react/CodeBlock";
import Collapsible from "../../react/Collapsible";
import FormTextBox from "../../react/FormTextBox";
import FormToggle from "../../react/FormToggle";
import { useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import MaskedIcon from "../../react/MaskedIcon";
import NoItems from "../../react/NoItems";
import { shortModelName } from "../llm_chat/model_name";
import OptionsPageHeader from "./components/OptionsPageHeader";
import AddProviderModal, { findProviderType, type LlmProviderConfig } from "./llm/AddProviderModal";

export default function LlmSettings() {
    const [aiEnabled, setAiEnabled] = useTriliumOptionBool("aiEnabled");
    // Read once for both cards: each saves the whole list, so a card holding its own copy would
    // write back the other card's providers as they were before its last edit.
    const [providersJson, setProvidersJson] = useTriliumOption("llmProviders");
    const allProviders = useMemo<LlmProviderConfig[]>(() => {
        try {
            return providersJson ? JSON.parse(providersJson) : [];
        } catch {
            return [];
        }
    }, [providersJson]);
    const setAllProviders = useCallback((newProviders: LlmProviderConfig[]) => {
        setProvidersJson(JSON.stringify(newProviders));
    }, [setProvidersJson]);

    return (
        <>
            {/* The switch governs the whole page rather than anything on it, so it belongs to the
                header — on the row below the title, clear of the dialog's own close button. */}
            <OptionsPageHeader
                helpUrl="GBBMSlVSOIGP"
                below={
                    <OptionCardSection
                        className="options-header-switch"
                        name="ai-enabled"
                        label={t("llm.enabled")}
                        description={t("llm.enabled_description")}
                    >
                        <FormToggle currentValue={aiEnabled} onChange={setAiEnabled} />
                    </OptionCardSection>
                }
            />

            {aiEnabled && (
                <>
                    <ProviderSettings kind="llm" allProviders={allProviders} setAllProviders={setAllProviders} />
                    <ProviderSettings kind="search" allProviders={allProviders} setAllProviders={setAllProviders} />
                    <McpSettings />
                </>
            )}
        </>
    );
}

/** The configured providers of one kind. Both kinds are stored in the `llmProviders` option. */
function ProviderSettings({ kind, allProviders, setAllProviders }: {
    kind: LlmProviderKind;
    /** Every configured provider, of both kinds. */
    allProviders: LlmProviderConfig[];
    setAllProviders: (providers: LlmProviderConfig[]) => void;
}) {
    const providers = useMemo(() => allProviders.filter(p => isProviderOfKind(p, kind)), [allProviders, kind]);
    // `undefined` while closed; the edited provider (or a fresh marker) while open.
    // The bumping token keys the modal so it re-initializes its wizard on every open.
    const [modalProvider, setModalProvider] = useState<LlmProviderConfig | undefined>();
    const [modalOpen, setModalOpen] = useState(false);
    const [openToken, setOpenToken] = useState(0);

    const openModal = useCallback((provider?: LlmProviderConfig) => {
        setModalProvider(provider);
        setOpenToken(token => token + 1);
        setModalOpen(true);
    }, []);

    // Upsert: editing replaces the config with the matching id, adding appends.
    const handleSaveProvider = useCallback((saved: LlmProviderConfig) => {
        setAllProviders(allProviders.some(p => p.id === saved.id)
            ? allProviders.map(p => (p.id === saved.id ? saved : p))
            : [...allProviders, saved]);
    }, [allProviders, setAllProviders]);

    const handleDeleteProvider = useCallback(async (providerId: string, providerName: string) => {
        if (!(await dialog.confirm(t("llm.delete_provider_confirmation", { name: providerName })))) {
            return;
        }
        setAllProviders(allProviders.filter(p => p.id !== providerId));
    }, [allProviders, setAllProviders]);

    const isSearch = kind === "search";

    return (<>
        <Card heading={isSearch ? t("llm.search_providers") : t("llm.model_providers")}>
            <ProviderList
                providers={providers}
                emptyIcon={isSearch ? "bx bx-search" : "bx bx-bot"}
                emptyText={isSearch ? t("llm.no_search_providers_configured") : t("llm.no_model_providers_configured")}
                onEdit={openModal}
                onDelete={handleDeleteProvider}
            />

            <CardSection className="llm-add-provider">
                <Button
                    name={isSearch ? "add-search-provider-button" : "add-llm-provider-button"}
                    size="micro" icon="bx-plus"
                    text={isSearch ? t("llm.add_search_provider") : t("llm.add_model_provider")}
                    onClick={() => openModal()}
                />
            </CardSection>
        </Card>

        <AddProviderModal
            key={openToken}
            show={modalOpen}
            existingProvider={modalProvider}
            kind={kind}
            onHidden={() => setModalOpen(false)}
            onSave={handleSaveProvider}
        />
    </>);
}

function McpSettings() {
    const [mcpEnabled, setMcpEnabled] = useTriliumOptionBool("mcpEnabled");
    const [networkInfo, setNetworkInfo] = useState<NetworkAddressesResponse | null>(null);
    const localUrl = useMemo(() => getMcpEndpointUrl(), []);
    const tokenPlaceholder = t("llm.mcp_config_token_placeholder");

    // MCP is the one inbound part of the feature: everything else here dials out to
    // a provider, while MCP publishes Trilium's tools to programs that dial in. The
    // standalone build binds no socket — its server is a worker inside this page, and
    // /mcp is mounted on an Express app it never runs — so there is no address to
    // hand out and no ETAPI token to reach it with. Shown disabled rather than
    // hidden, so the section reads as "not in this build" instead of "not a feature".
    //
    // Forced off rather than merely left untoggleable: mcpEnabled is unsynced, but a
    // database restored from a desktop instance carries the option inside it, so the
    // stored value can be true even here.
    const mcpUnavailable = isStandalone;
    const mcpServing = mcpEnabled && !mcpUnavailable;

    // The renderer can't enumerate network interfaces itself (Node integration is
    // disabled on desktop), so reuse the endpoint the sync-from-desktop setup screen
    // already uses — it resolves the real protocol and port server-side too.
    useEffect(() => {
        if (!mcpServing) return;
        let cancelled = false;
        void server.get<NetworkAddressesResponse>("network-addresses")
            .then((info) => { if (!cancelled) setNetworkInfo(info); });
        return () => { cancelled = true; };
    }, [mcpServing]);

    // Only advertise LAN addresses when Trilium is actually bound to a reachable
    // interface; on a loopback-only binding they would all refuse the connection.
    const networkUrls = useMemo(() => {
        if (!networkInfo?.reachableOnNetwork) return [];
        return networkInfo.addresses
            .map((address) => `${address}/mcp`)
            .filter((url) => url !== localUrl);
    }, [networkInfo, localUrl]);

    return (
        <Card heading={t("llm.mcp_title")}>
            <OptionCardSection
                name="mcp-enabled"
                label={t("llm.mcp_enabled")}
                description={mcpUnavailable ? t("llm.mcp_unavailable_standalone") : t("llm.mcp_enabled_description")}
            >
                <FormToggle
                    currentValue={mcpServing}
                    onChange={setMcpEnabled}
                    disabled={mcpUnavailable}
                />
            </OptionCardSection>

            {mcpServing && (
                <>
                    <OptionCardSection
                        name="mcp-endpoint"
                        label={t("llm.mcp_endpoint_title")}
                        description={t("llm.mcp_endpoint_description")}
                        stacked
                    >
                        <div class="mcp-endpoint-list">
                            <McpEndpointGroup label={t("llm.mcp_endpoint_this_device")} urls={[localUrl]} />
                            {networkUrls.length > 0 && (
                                <McpEndpointGroup label={t("llm.mcp_endpoint_network")} urls={networkUrls} />
                            )}
                            {networkInfo && !networkInfo.reachableOnNetwork && (
                                <p class="mcp-endpoint-note">{t("llm.mcp_endpoint_loopback_only")}</p>
                            )}
                        </div>
                    </OptionCardSection>

                    <CardSection>
                        <Collapsible title={t("llm.mcp_config_title")} initiallyExpanded>
                            <p>{t("llm.mcp_config_description")}</p>
                            <CodeBlock
                                mimeType="application/json"
                                code={buildMcpClientConfig(localUrl, tokenPlaceholder)}
                                placeholder={tokenPlaceholder}
                            />
                            <p>{t("llm.mcp_config_cli_description")}</p>
                            <CodeBlock
                                mimeType="text/x-sh"
                                code={buildMcpClientCommand(localUrl, tokenPlaceholder)}
                                placeholder={tokenPlaceholder}
                                wrap
                            />
                            <p class="mcp-config-warning">{t("llm.mcp_config_warning")}</p>
                        </Collapsible>
                    </CardSection>
                </>
            )}
        </Card>
    );
}

function McpEndpointGroup({ label, urls }: { label: string; urls: string[] }) {
    return (
        <div class="mcp-endpoint-group">
            <span class="mcp-endpoint-group-label">{label}</span>
            {urls.map((url) => (
                <FormTextBox key={url} className="selectable-text" currentValue={url} readOnly />
            ))}
        </div>
    );
}

/**
 * The `.mcp.json`-style entry most clients accept (Claude Code, Codex, Cursor, VS Code).
 * `http` is used rather than the spec's `streamable-http` spelling because it is the value
 * every one of those clients understands — Claude Code treats the two as aliases, but the
 * others only recognise `http`. Either way this must not be configured as an SSE server:
 * the MCP SDK validates the `Accept` header strictly and SSE-mode clients fail to connect.
 */
export function buildMcpClientConfig(endpointUrl: string, tokenPlaceholder: string) {
    return JSON.stringify({
        mcpServers: {
            trilium: {
                type: "http",
                url: endpointUrl,
                headers: { Authorization: `Bearer ${tokenPlaceholder}` }
            }
        }
    }, null, 2);
}

export function buildMcpClientCommand(endpointUrl: string, tokenPlaceholder: string) {
    return `claude mcp add --transport http trilium ${endpointUrl} \\\n  --header "Authorization: Bearer ${tokenPlaceholder}"`;
}

function getMcpEndpointUrl() {
    // On desktop the renderer lives on `trilium-app://app/`, so window.location
    // does not point at a reachable HTTP origin. The server injects an absolute
    // httpBaseUrl in that case; in the browser we derive it from the page — using
    // the host the user actually reached Trilium on, which is not always localhost.
    if (window.glob.httpBaseUrl) {
        return `${window.glob.httpBaseUrl}/mcp`;
    }
    return `${window.location.protocol}//${window.location.host}/mcp`;
}

interface ProviderListProps {
    providers: LlmProviderConfig[];
    emptyIcon: string;
    emptyText: string;
    onEdit: (provider: LlmProviderConfig) => void;
    onDelete: (providerId: string, providerName: string) => Promise<void>;
}

function ProviderList({ providers, emptyIcon, emptyText, onEdit, onDelete }: ProviderListProps) {
    if (!providers.length) {
        return (
            <CardSection>
                <NoItems icon={emptyIcon} text={emptyText} />
            </CardSection>
        );
    }

    return <>
        {providers.map((provider) => {
            const providerType = findProviderType(provider.provider);
            return (
                <OptionCardSection
                    key={provider.id}
                    label={
                        <span className="llm-provider-name">
                            {providerType?.iconUrl && <MaskedIcon url={providerType.iconUrl} />}
                            {provider.name}
                        </span>
                    }
                    description={isProviderOfKind(provider, "llm") ? <ModelList provider={provider} /> : provider.baseURL}
                >
                    <span className="tn-card-option-actions">
                        <ActionButton
                            icon="bx bx-edit"
                            text={t("llm.edit_provider")}
                            onClick={() => onEdit(provider)}
                        />
                        <ActionButton
                            className="destructive-action-icon"
                            icon="bx bx-trash"
                            text={t("llm.delete_provider")}
                            onClick={() => onDelete(provider.id, provider.name)}
                        />
                    </span>
                </OptionCardSection>
            );
        })}
    </>;
}

/** The short names of a model provider's selected models, as the chat's picker shows them. */
function ModelList({ provider }: { provider: LlmProviderConfig }) {
    const models = provider.selectedModels ?? [];
    if (!models.length) {
        return <>{t("llm.provider_no_models")}</>;
    }
    const names = models.map((model) => shortModelName(model.name, provider.provider)).join(", ");
    return <span className="llm-provider-models" title={names}>{names}</span>;
}
