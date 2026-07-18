import { createPortal } from "preact/compat";
import { useRef,useState } from "preact/hooks";

import { t } from "../../../../services/i18n";
import FormGroup from "../../../react/FormGroup";
import FormSelect from "../../../react/FormSelect";
import FormTextBox from "../../../react/FormTextBox";
import Modal from "../../../react/Modal";

export type ProviderKind = "llm" | "search";

export interface LlmProviderConfig {
    id: string;
    name: string;
    provider: string;
    apiKey: string;
    /** Base URL for self-hosted providers (e.g. Ollama, SearXNG). */
    baseUrl?: string;
    /** "llm" (default when missing, for backward compatibility) or "search". */
    type?: ProviderKind;
}

export interface ProviderType {
    id: string;
    name: string;
    /** What kind of provider this is (defaults to "llm"). */
    type?: ProviderKind;
    /** Whether this provider needs an API key (defaults to true). */
    needsApiKey?: boolean;
    /** Whether this provider needs a base URL. */
    needsBaseUrl?: boolean;
    /** Default base URL for the provider. */
    defaultBaseUrl?: string;
}

export const PROVIDER_TYPES: ProviderType[] = [
    { id: "anthropic", name: "Anthropic" },
    { id: "openai", name: "OpenAI" },
    { id: "google", name: "Google Gemini" },
    { id: "ollama", name: "Ollama", needsApiKey: false, needsBaseUrl: true, defaultBaseUrl: "http://localhost:11434" },
    { id: "tavily", name: "Tavily", type: "search" },
    { id: "searxng", name: "SearXNG", type: "search", needsApiKey: false, needsBaseUrl: true, defaultBaseUrl: "http://localhost:8888" }
];

/** Resolve the kind of a configured provider entry ("llm" when the type is missing). */
export function getProviderKind(provider: LlmProviderConfig): ProviderKind {
    return provider.type ?? "llm";
}

interface AddProviderModalProps {
    show: boolean;
    onHidden: () => void;
    onSave: (provider: LlmProviderConfig) => void;
    /** Which kind of providers to offer (defaults to "llm"). */
    kind?: ProviderKind;
}

export default function AddProviderModal({ show, onHidden, onSave, kind = "llm" }: AddProviderModalProps) {
    const providerTypes = PROVIDER_TYPES.filter(p => (p.type ?? "llm") === kind);

    const [selectedProvider, setSelectedProvider] = useState(providerTypes[0].id);
    const [displayName, setDisplayName] = useState("");
    const [apiKey, setApiKey] = useState("");
    const [baseUrl, setBaseUrl] = useState("");
    const formRef = useRef<HTMLFormElement>(null);

    const providerType = providerTypes.find(p => p.id === selectedProvider) ?? providerTypes[0];
    const needsApiKey = providerType.needsApiKey !== false;
    const needsBaseUrl = providerType.needsBaseUrl === true;

    function handleProviderChange(value: string) {
        setSelectedProvider(value);
        const pt = providerTypes.find(p => p.id === value);
        setBaseUrl(pt?.defaultBaseUrl ?? "");
    }

    function handleSubmit() {
        if (needsApiKey && !apiKey.trim()) {
            return;
        }

        const newProvider: LlmProviderConfig = {
            id: `${providerType.id}_${Date.now()}`,
            name: displayName.trim() || providerType.name,
            provider: providerType.id,
            apiKey: apiKey.trim(),
            ...(needsBaseUrl && baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
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

    const isSubmitDisabled = needsApiKey ? !apiKey.trim() : false;

    return createPortal(
        <Modal
            show={show}
            onHidden={handleCancel}
            onSubmit={handleSubmit}
            formRef={formRef}
            title={kind === "search" ? t("llm.add_search_engine_title") : t("llm.add_provider_title")}
            className="add-provider-modal"
            size="md"
            footer={
                <>
                    <button type="button" className="btn btn-secondary" onClick={handleCancel}>
                        {t("llm.cancel")}
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={isSubmitDisabled}>
                        {kind === "search" ? t("llm.add_search_engine") : t("llm.add_provider")}
                    </button>
                </>
            }
        >
            <FormGroup name="provider-type" label={kind === "search" ? t("llm.search_engine_type") : t("llm.provider_type")}>
                <FormSelect
                    values={providerTypes}
                    keyProperty="id"
                    titleProperty="name"
                    currentValue={selectedProvider}
                    onChange={handleProviderChange}
                />
            </FormGroup>

            <FormGroup name="display-name" label={t("llm.display_name")} description={t("llm.display_name_description")}>
                <FormTextBox
                    currentValue={displayName}
                    onChange={setDisplayName}
                    placeholder={providerType.name}
                />
            </FormGroup>

            {needsApiKey && (
                <FormGroup name="api-key" label={t("llm.api_key")}>
                    <FormTextBox
                        type="password"
                        currentValue={apiKey}
                        onChange={setApiKey}
                        placeholder={t("llm.api_key_placeholder")}
                        autoFocus
                    />
                </FormGroup>
            )}

            {needsBaseUrl && (
                <FormGroup name="base-url" label={t("llm.base_url")}>
                    <FormTextBox
                        currentValue={baseUrl}
                        onChange={setBaseUrl}
                        placeholder={providerType.defaultBaseUrl || "http://localhost:11434"}
                    />
                </FormGroup>
            )}
        </Modal>,
        document.body
    );
}
