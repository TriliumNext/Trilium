import "./AddProviderModal.css";

import { createPortal } from "preact/compat";
import { useMemo, useRef, useState } from "preact/hooks";

import { t } from "../../../../services/i18n";
import { Badge } from "../../../react/Badge";
import { Card, CardSection } from "../../../react/Card";
import FormGroup from "../../../react/FormGroup";
import FormTextBox from "../../../react/FormTextBox";
import Modal from "../../../react/Modal";
import SelectableCard, { SelectableCardGrid } from "../../../react/SelectableCard";
import anthropicIcon from "./icons/anthropic.svg?url";
import claudeAgentIcon from "./icons/claude-ai.svg?url";
import geminiIcon from "./icons/gemini.svg?url";
import ollamaIcon from "./icons/ollama.svg?url";
import openaiIcon from "./icons/openai.svg?url";
import searxngIcon from "./icons/searxng.svg?url";
import tavilyIcon from "./icons/tavily.svg?url";

export type ProviderKind = "llm" | "search";

export interface LlmProviderConfig {
    id: string;
    name: string;
    provider: string;
    apiKey: string;
    baseURL?: string;
    /** "llm" (default when missing, for backward compatibility) or "search". */
    type?: ProviderKind;
}

/** Resolve the kind of a configured provider entry ("llm" when the type is missing). */
export function getProviderKind(provider: LlmProviderConfig): ProviderKind {
    return provider.type ?? "llm";
}

export interface ProviderType {
    id: string;
    name: string;
    defaultBaseUrl: string;
    /** URL of the provider's logo (an imported `*.svg?url`), rendered monochrome via a CSS mask. */
    iconUrl: string;
    /** Short blurb shown under the provider name on its selectable card. */
    description: string;
    /** What kind of provider this is (defaults to "llm"). */
    type?: ProviderKind;
    /** Marks the provider as beta, shown as a badge next to its name. */
    beta?: boolean;
    /** When false, the provider needs no API key or base URL (e.g. subscription-based auth). */
    usesApiKey?: boolean;
    /** When true (with usesApiKey: false), the base URL is the primary connection detail (e.g. Ollama, SearXNG). */
    usesBaseUrl?: boolean;
}

// The two Claude-powered providers lead the list so they sit together on the top row,
// making the subscription-vs-API-key choice easy to spot.
export const PROVIDER_TYPES: ProviderType[] = [
    { id: "anthropic", name: "Anthropic", defaultBaseUrl: "https://api.anthropic.com/v1", iconUrl: anthropicIcon, description: t("llm.provider_desc_anthropic") },
    // Uses the Claude Agent SDK on the server; auth belongs to Claude Code (`claude /login`).
    { id: "claude-agent", name: "Claude Code", defaultBaseUrl: "", iconUrl: claudeAgentIcon, description: t("llm.provider_desc_claude_agent"), beta: true, usesApiKey: false },
    { id: "openai", name: "OpenAI", defaultBaseUrl: "https://api.openai.com/v1", iconUrl: openaiIcon, description: t("llm.provider_desc_openai") },
    { id: "google", name: "Google Gemini", defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta", iconUrl: geminiIcon, description: t("llm.provider_desc_google") },
    // Local models via Ollama — no API key, only the instance URL.
    { id: "ollama", name: "Ollama", defaultBaseUrl: "http://localhost:11434", iconUrl: ollamaIcon, description: t("llm.provider_desc_ollama"), usesApiKey: false, usesBaseUrl: true },
    // Web search engines (type: "search") — configured alongside LLM providers
    // in the same llmProviders option, offered by the modal's "search" kind.
    { id: "tavily", name: "Tavily", defaultBaseUrl: "", iconUrl: tavilyIcon, description: t("llm.provider_desc_tavily"), type: "search" },
    { id: "searxng", name: "SearXNG", defaultBaseUrl: "http://localhost:8888", iconUrl: searxngIcon, description: t("llm.provider_desc_searxng"), type: "search", usesApiKey: false, usesBaseUrl: true }
];

function isValidBaseUrl(value: string): boolean {
    if (!value) {
        return true;
    }
    try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}

interface AddProviderModalProps {
    show: boolean;
    onHidden: () => void;
    onSave: (provider: LlmProviderConfig) => void;
    /** Which kind of providers to offer (defaults to "llm"). */
    kind?: ProviderKind;
}

export default function AddProviderModal({ show, onHidden, onSave, kind = "llm" }: AddProviderModalProps) {
    const providerTypes = useMemo(
        () => PROVIDER_TYPES.filter(p => (p.type ?? "llm") === kind),
        [kind]
    );
    const [selectedProvider, setSelectedProvider] = useState(providerTypes[0].id);
    const [displayName, setDisplayName] = useState("");
    const [apiKey, setApiKey] = useState("");
    const [baseUrl, setBaseUrl] = useState("");
    const formRef = useRef<HTMLFormElement>(null);

    const providerType = useMemo(
        () => providerTypes.find(p => p.id === selectedProvider) ?? providerTypes[0],
        [providerTypes, selectedProvider]
    );
    const usesApiKey = providerType.usesApiKey !== false;
    // Providers with an API key can override the base URL as an advanced option;
    // key-less providers (Ollama, SearXNG) can declare it as their primary connection detail.
    const usesBaseUrl = usesApiKey || providerType.usesBaseUrl === true;
    // Search engines have no server-side fallback URL, so an explicit one is required —
    // otherwise the entry would be saved unusable and silently fall back to native search.
    const requiresBaseUrl = kind === "search" && providerType.usesBaseUrl === true;
    const trimmedBaseUrl = baseUrl.trim();
    const baseUrlIsValid = isValidBaseUrl(trimmedBaseUrl) && (!requiresBaseUrl || !!trimmedBaseUrl);
    const canSubmit = (usesApiKey ? !!apiKey.trim() : true) && (usesBaseUrl ? baseUrlIsValid : true);

    function handleSubmit() {
        if (!canSubmit) {
            return;
        }

        const newProvider: LlmProviderConfig = {
            id: `${providerType.id}_${Date.now()}`,
            name: displayName.trim() || providerType.name,
            provider: providerType.id,
            apiKey: usesApiKey ? apiKey.trim() : "",
            ...(usesBaseUrl && trimmedBaseUrl && { baseURL: trimmedBaseUrl }),
            // Only search engines get an explicit type; LLM entries stay without
            // one to remain compatible with configurations from older versions.
            ...(kind === "search" ? { type: "search" as const } : {})
        };

        onSave(newProvider);
        resetForm();
        onHidden();
    }

    function resetForm() {
        setSelectedProvider(providerTypes[0].id);
        setDisplayName("");
        setApiKey("");
        setBaseUrl("");
    }

    function handleCancel() {
        resetForm();
        onHidden();
    }

    return createPortal(
        <Modal
            show={show}
            onHidden={handleCancel}
            onSubmit={handleSubmit}
            formRef={formRef}
            title={kind === "search" ? t("llm.add_search_engine_title") : t("llm.add_provider_title")}
            className="add-provider-modal"
            size="md"
            maxWidth={600}
            stackable
            footer={
                <>
                    <button type="button" className="btn btn-secondary" onClick={handleCancel}>
                        {t("llm.cancel")}
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
                        {kind === "search" ? t("llm.add_search_engine") : t("llm.add_provider")}
                    </button>
                </>
            }
        >
            <Card heading={kind === "search" ? t("llm.search_engine_type") : t("llm.provider_type")}>
                <CardSection>
                    <SelectableCardGrid columns={2}>
                        {providerTypes.map((provider) => (
                            <SelectableCard
                                key={provider.id}
                                iconUrl={provider.iconUrl}
                                title={provider.beta
                                    ? <span className="add-provider-card-heading">{provider.name}<Badge text={t("llm.beta")} className="add-provider-beta-badge" outline /></span>
                                    : provider.name}
                                description={provider.description}
                                selected={selectedProvider === provider.id}
                                onSelect={() => setSelectedProvider(provider.id)}
                            />
                        ))}
                    </SelectableCardGrid>
                </CardSection>
            </Card>

            <Card heading={t("llm.connection_details")}>
                <CardSection>
                    <FormGroup name="display-name" label={t("llm.display_name")} description={t("llm.display_name_description")}>
                        <FormTextBox
                            currentValue={displayName}
                            onChange={setDisplayName}
                            placeholder={providerType.name}
                        />
                    </FormGroup>
                    {usesApiKey ? (
                        <FormGroup name="api-key" label={t("llm.api_key")}>
                            <FormTextBox
                                type="password"
                                currentValue={apiKey}
                                onChange={setApiKey}
                                placeholder={t("llm.api_key_placeholder")}
                                autoFocus
                            />
                        </FormGroup>
                    ) : usesBaseUrl ? (
                        // Key-less self-hosted provider (Ollama): the base URL is
                        // the primary connection detail.
                        <FormGroup
                            name="base-url"
                            label={t("llm.base_url")}
                            description={
                                !baseUrlIsValid
                                    ? <span className="text-danger">{t("llm.base_url_invalid")}</span>
                                    : t("llm.base_url_description")
                            }
                        >
                            <FormTextBox
                                type="text"
                                currentValue={baseUrl}
                                onChange={setBaseUrl}
                                placeholder={providerType?.defaultBaseUrl}
                                autoFocus
                            />
                        </FormGroup>
                    ) : (
                        <p>{t("llm.claude_agent_description")}</p>
                    )}
                </CardSection>
            </Card>

            {usesApiKey && kind === "llm" && (
                <Card heading={t("llm.advanced_options")}>
                    <CardSection>
                        <FormGroup
                            name="base-url"
                            label={t("llm.base_url")}
                            description={
                                !baseUrlIsValid
                                    ? <span className="text-danger">{t("llm.base_url_invalid")}</span>
                                    : t("llm.base_url_description")
                            }
                        >
                            <FormTextBox
                                type="text"
                                currentValue={baseUrl}
                                onChange={setBaseUrl}
                                placeholder={providerType?.defaultBaseUrl}
                            />
                        </FormGroup>
                    </CardSection>
                </Card>
            )}
        </Modal>,
        document.body
    );
}
