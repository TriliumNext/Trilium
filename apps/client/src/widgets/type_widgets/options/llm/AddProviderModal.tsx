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
import githubCopilotIcon from "./icons/github-copilot.svg?url";
import openaiIcon from "./icons/openai.svg?url";

export interface LlmProviderConfig {
    id: string;
    name: string;
    provider: string;
    apiKey: string;
    baseURL?: string;
}

export interface ProviderType {
    id: string;
    name: string;
    defaultBaseUrl: string;
    /** URL of the provider's logo (an imported `*.svg?url`), rendered monochrome via a CSS mask. */
    iconUrl: string;
    /** Short blurb shown under the provider name on its selectable card. */
    description: string;
    /** Marks the provider as beta, shown as a badge next to its name. */
    beta?: boolean;
    /** When false, the provider needs no API key or base URL (e.g. subscription-based auth). */
    usesApiKey?: boolean;
    /** Connection-details blurb shown instead of the API-key field when `usesApiKey` is false. */
    connectionDescription?: string;
}

// The two Claude-powered providers lead the list so they sit together on the top row,
// making the subscription-vs-API-key choice easy to spot.
export const PROVIDER_TYPES: ProviderType[] = [
    { id: "anthropic", name: "Anthropic", defaultBaseUrl: "https://api.anthropic.com/v1", iconUrl: anthropicIcon, description: t("llm.provider_desc_anthropic") },
    // Uses the Claude Agent SDK on the server; auth belongs to Claude Code (`claude /login`).
    { id: "claude-agent", name: "Claude Code", defaultBaseUrl: "", iconUrl: claudeAgentIcon, description: t("llm.provider_desc_claude_agent"), beta: true, usesApiKey: false, connectionDescription: t("llm.claude_agent_description") },
    { id: "openai", name: "OpenAI", defaultBaseUrl: "https://api.openai.com/v1", iconUrl: openaiIcon, description: t("llm.provider_desc_openai") },
    { id: "google", name: "Google Gemini", defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta", iconUrl: geminiIcon, description: t("llm.provider_desc_google") },
    // Uses the GitHub Copilot CLI in ACP mode on the server; auth belongs to the CLI (`copilot login`).
    { id: "copilot-agent", name: "GitHub Copilot", defaultBaseUrl: "", iconUrl: githubCopilotIcon, description: t("llm.provider_desc_copilot_agent"), beta: true, usesApiKey: false, connectionDescription: t("llm.copilot_agent_description") }
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
}

export default function AddProviderModal({ show, onHidden, onSave }: AddProviderModalProps) {
    const [selectedProvider, setSelectedProvider] = useState(PROVIDER_TYPES[0].id);
    const [apiKey, setApiKey] = useState("");
    const [baseUrl, setBaseUrl] = useState("");
    const formRef = useRef<HTMLFormElement>(null);

    const providerType = useMemo(
        () => PROVIDER_TYPES.find(p => p.id === selectedProvider),
        [selectedProvider]
    );
    const usesApiKey = providerType?.usesApiKey !== false;
    const trimmedBaseUrl = baseUrl.trim();
    const baseUrlIsValid = isValidBaseUrl(trimmedBaseUrl);
    const canSubmit = usesApiKey ? !!apiKey.trim() && baseUrlIsValid : true;

    function handleSubmit() {
        if (!canSubmit) {
            return;
        }

        const newProvider: LlmProviderConfig = {
            id: `${selectedProvider}_${Date.now()}`,
            name: providerType?.name || selectedProvider,
            provider: selectedProvider,
            apiKey: usesApiKey ? apiKey.trim() : "",
            ...(usesApiKey && trimmedBaseUrl && { baseURL: trimmedBaseUrl })
        };

        onSave(newProvider);
        resetForm();
        onHidden();
    }

    function resetForm() {
        setSelectedProvider(PROVIDER_TYPES[0].id);
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
            title={t("llm.add_provider_title")}
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
                        {t("llm.add_provider")}
                    </button>
                </>
            }
        >
            <Card heading={t("llm.provider_type")}>
                <CardSection>
                    <SelectableCardGrid columns={2}>
                        {PROVIDER_TYPES.map((provider) => (
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
                    ) : (
                        <p>{providerType?.connectionDescription}</p>
                    )}
                </CardSection>
            </Card>

            {usesApiKey && (
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
