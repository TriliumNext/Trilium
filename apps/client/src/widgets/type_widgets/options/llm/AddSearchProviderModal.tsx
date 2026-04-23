import { createPortal } from "preact/compat";
import { useRef, useState } from "preact/hooks";

import { t } from "../../../../services/i18n";
import FormGroup from "../../../react/FormGroup";
import FormSelect from "../../../react/FormSelect";
import FormTextBox from "../../../react/FormTextBox";
import Modal from "../../../react/Modal";

export interface SearchProviderConfig {
    id: string;
    name: string;
    provider: string;
    apiKey?: string;
    baseUrl?: string;
}

export interface SearchProviderType {
    id: string;
    name: string;
    /** Whether this provider requires an API key. */
    requiresApiKey: boolean;
    /** Whether this provider requires a base URL (e.g. self-hosted). */
    requiresBaseUrl: boolean;
    apiKeyPlaceholder?: string;
    baseUrlPlaceholder?: string;
}

export const SEARCH_PROVIDER_TYPES: SearchProviderType[] = [
    {
        id: "exa",
        name: "Exa",
        requiresApiKey: true,
        requiresBaseUrl: false,
        apiKeyPlaceholder: "..."
    },
    {
        id: "tavily",
        name: "Tavily",
        requiresApiKey: true,
        requiresBaseUrl: false,
        apiKeyPlaceholder: "tvly-..."
    },
    {
        id: "searxng",
        name: "SearXNG",
        requiresApiKey: false,
        requiresBaseUrl: true,
        baseUrlPlaceholder: "http://localhost:8888"
    }
];

interface AddSearchProviderModalProps {
    show: boolean;
    onHidden: () => void;
    onSave: (provider: SearchProviderConfig) => void;
}

export default function AddSearchProviderModal({ show, onHidden, onSave }: AddSearchProviderModalProps) {
    const [selectedProvider, setSelectedProvider] = useState(SEARCH_PROVIDER_TYPES[0].id);
    const [apiKey, setApiKey] = useState("");
    const [baseUrl, setBaseUrl] = useState("");
    const formRef = useRef<HTMLFormElement>(null);

    const providerType = SEARCH_PROVIDER_TYPES.find(p => p.id === selectedProvider) ?? SEARCH_PROVIDER_TYPES[0];
    const canSubmit =
        (!providerType.requiresApiKey || apiKey.trim().length > 0) &&
        (!providerType.requiresBaseUrl || baseUrl.trim().length > 0);

    function handleSubmit() {
        if (!canSubmit) {
            return;
        }

        const newProvider: SearchProviderConfig = {
            id: `${selectedProvider}_${Date.now()}`,
            name: providerType.name,
            provider: selectedProvider,
            ...(providerType.requiresApiKey && { apiKey: apiKey.trim() }),
            ...(providerType.requiresBaseUrl && { baseUrl: baseUrl.trim() })
        };

        onSave(newProvider);
        resetForm();
        onHidden();
    }

    function resetForm() {
        setSelectedProvider(SEARCH_PROVIDER_TYPES[0].id);
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
            title={t("llm.add_search_provider_title")}
            className="add-search-provider-modal"
            size="md"
            footer={
                <>
                    <button type="button" className="btn btn-secondary" onClick={handleCancel}>
                        {t("llm.cancel")}
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
                        {t("llm.add_search_provider")}
                    </button>
                </>
            }
        >
            <FormGroup name="search-provider-type" label={t("llm.search_provider_type")}>
                <FormSelect
                    values={SEARCH_PROVIDER_TYPES}
                    keyProperty="id"
                    titleProperty="name"
                    currentValue={selectedProvider}
                    onChange={setSelectedProvider}
                />
            </FormGroup>

            {providerType.requiresApiKey && (
                <FormGroup name="search-api-key" label={t("llm.api_key")}>
                    <FormTextBox
                        type="password"
                        currentValue={apiKey}
                        onChange={setApiKey}
                        placeholder={providerType.apiKeyPlaceholder ?? t("llm.api_key_placeholder")}
                        autoFocus
                    />
                </FormGroup>
            )}

            {providerType.requiresBaseUrl && (
                <FormGroup name="search-base-url" label={t("llm.search_provider_base_url")}>
                    <FormTextBox
                        type="url"
                        currentValue={baseUrl}
                        onChange={setBaseUrl}
                        placeholder={providerType.baseUrlPlaceholder ?? ""}
                        autoFocus
                    />
                </FormGroup>
            )}
        </Modal>,
        document.body
    );
}
