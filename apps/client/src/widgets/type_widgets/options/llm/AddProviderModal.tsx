import { createPortal } from "preact/compat";
import { useMemo, useRef, useState } from "preact/hooks";
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
    baseURL?: string;
}

export interface ProviderType {
    id: string;
    name: string;
    defaultBaseUrl: string;
}

export const PROVIDER_TYPES: ProviderType[] = [
    { id: "anthropic", name: "Anthropic", defaultBaseUrl: "https://api.anthropic.com/v1" },
    { id: "openai", name: "OpenAI", defaultBaseUrl: "https://api.openai.com/v1" },
    { id: "google", name: "Google Gemini", defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta" }
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
    const trimmedBaseUrl = baseUrl.trim();
    const baseUrlIsValid = isValidBaseUrl(trimmedBaseUrl);
    const canSubmit = !!apiKey.trim() && baseUrlIsValid;

    function handleSubmit() {
        if (!canSubmit) {
            return;
        }

        const newProvider: LlmProviderConfig = {
            id: `${selectedProvider}_${Date.now()}`,
            name: providerType?.name || selectedProvider,
            provider: selectedProvider,
            apiKey: apiKey.trim(),
            ...(trimmedBaseUrl && { baseURL: trimmedBaseUrl })
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
            <FormGroup name="provider-type" label={t("llm.provider_type")}>
                <FormSelect
                    values={PROVIDER_TYPES}
                    keyProperty="id"
                    titleProperty="name"
                    currentValue={selectedProvider}
                    onChange={setSelectedProvider}
                />
            </FormGroup>

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

            <FormGroup name="api-key" label={t("llm.api_key")}>
                <FormTextBox
                    type="password"
                    currentValue={apiKey}
                    onChange={setApiKey}
                    placeholder={t("llm.api_key_placeholder")}
                    autoFocus
                />
            </FormGroup>
        </Modal>,
        document.body
    );
}
