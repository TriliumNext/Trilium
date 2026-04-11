import { createPortal } from "preact/compat";
import { useState, useRef } from "preact/hooks";
import Modal from "../../../react/Modal";
import FormGroup from "../../../react/FormGroup";
import FormSelect from "../../../react/FormSelect";
import FormTextBox from "../../../react/FormTextBox";
import { t } from "../../../../services/i18n";

export interface LlmProviderConfig {
    id: string;
    name: string;
    provider: string;
    apiKey: string;
    /** Base URL for self-hosted providers (e.g. Ollama). */
    baseUrl?: string;
}

export interface ProviderType {
    id: string;
    name: string;
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
    { id: "ollama", name: "Ollama", needsApiKey: false, needsBaseUrl: true, defaultBaseUrl: "http://localhost:11434" }
];

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

    const providerType = PROVIDER_TYPES.find(p => p.id === selectedProvider);
    const needsApiKey = providerType?.needsApiKey !== false;
    const needsBaseUrl = providerType?.needsBaseUrl === true;

    function handleProviderChange(value: string) {
        setSelectedProvider(value);
        const pt = PROVIDER_TYPES.find(p => p.id === value);
        if (pt?.defaultBaseUrl) {
            setBaseUrl(pt.defaultBaseUrl);
        } else {
            setBaseUrl("");
        }
    }

    function handleSubmit() {
        if (needsApiKey && !apiKey.trim()) {
            return;
        }

        const newProvider: LlmProviderConfig = {
            id: `${selectedProvider}_${Date.now()}`,
            name: providerType?.name || selectedProvider,
            provider: selectedProvider,
            apiKey: apiKey.trim(),
            ...(needsBaseUrl && baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {})
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

    const isSubmitDisabled = needsApiKey ? !apiKey.trim() : false;

    return createPortal(
        <Modal
            show={show}
            onHidden={handleCancel}
            onSubmit={handleSubmit}
            formRef={formRef}
            title={t("llm.add_provider_title")}
            className="add-provider-modal"
            size="md"
            footer={
                <>
                    <button type="button" className="btn btn-secondary" onClick={handleCancel}>
                        {t("llm.cancel")}
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={isSubmitDisabled}>
                        {t("llm.add_provider")}
                    </button>
                </>
            }
        >
            <FormGroup name="provider-type" label={t("llm.provider_type")}>
                <FormSelect
                    values={PROVIDER_TYPES}
                    keyProperty="id"
                    titleProperty="name"
                    currentValue={selectedProvider}
                    onChange={handleProviderChange}
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
                        placeholder={providerType?.defaultBaseUrl || "http://localhost:11434"}
                    />
                </FormGroup>
            )}
        </Modal>,
        document.body
    );
}
