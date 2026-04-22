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
}

export interface ProviderType {
    id: string;
    name: string;
}

export const PROVIDER_TYPES: ProviderType[] = [
    { id: "anthropic", name: "Anthropic" },
    { id: "openai", name: "OpenAI" },
    { id: "google", name: "Google Gemini" }
];

interface AddProviderModalProps {
    show: boolean;
    onHidden: () => void;
    onSave: (provider: LlmProviderConfig) => void;
}

export default function AddProviderModal({ show, onHidden, onSave }: AddProviderModalProps) {
    const [selectedProvider, setSelectedProvider] = useState(PROVIDER_TYPES[0].id);
    const [apiKey, setApiKey] = useState("");
    const formRef = useRef<HTMLFormElement>(null);

    function handleSubmit() {
        if (!apiKey.trim()) {
            return;
        }

        const providerType = PROVIDER_TYPES.find(p => p.id === selectedProvider);
        const newProvider: LlmProviderConfig = {
            id: `${selectedProvider}_${Date.now()}`,
            name: providerType?.name || selectedProvider,
            provider: selectedProvider,
            apiKey: apiKey.trim()
        };

        onSave(newProvider);
        resetForm();
        onHidden();
    }

    function resetForm() {
        setSelectedProvider(PROVIDER_TYPES[0].id);
        setApiKey("");
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
            footer={
                <>
                    <button type="button" className="btn btn-secondary" onClick={handleCancel}>
                        {t("llm.cancel")}
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={!apiKey.trim()}>
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
