import { useCallback, useEffect, useState } from "preact/hooks";
import { t } from "../../../services/i18n";
import toast from "../../../services/toast";
import FormCheckbox from "../../react/FormCheckbox";
import FormGroup from "../../react/FormGroup";
import { useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import OptionsSection from "./components/OptionsSection";
import Admonition from "../../react/Admonition";
import FormSelect from "../../react/FormSelect";
import FormTextBox from "../../react/FormTextBox";
import type { OllamaModelResponse, OpenAiOrAnthropicModelResponse, OptionNames } from "@triliumnext/commons";
import server from "../../../services/server";
import Button from "../../react/Button";
import FormTextArea from "../../react/FormTextArea";

export default function AiSettings() {
    return (
        <>
            <EnableAiSettings />
            <ProviderSettings />
        </>
    );
}

function EnableAiSettings() {
    const [ aiEnabled, setAiEnabled ] = useTriliumOptionBool("aiEnabled");

    return (
        <>            
            <OptionsSection title={t("ai_llm.title")}>                            
                <FormGroup name="ai-enabled" description={t("ai_llm.enable_ai_description")}>
                    <FormCheckbox                        
                        label={t("ai_llm.enable_ai_features")}
                        currentValue={aiEnabled} onChange={(isEnabled) => {
                            if (isEnabled) {
                                toast.showMessage(t("ai_llm.ai_enabled"));
                            } else {
                                toast.showMessage(t("ai_llm.ai_disabled"));
                            }

                            setAiEnabled(isEnabled);
                        }}
                    />
                </FormGroup>
                {aiEnabled && <Admonition type="warning">{t("ai_llm.experimental_warning")}</Admonition>}
            </OptionsSection>
        </>        
    );
}

function ProviderSettings() {
    const [ aiSelectedProvider, setAiSelectedProvider ] = useTriliumOption("aiSelectedProvider");
    const [ aiTemperature, setAiTemperature ] = useTriliumOption("aiTemperature");
    const [ aiSystemPrompt, setAiSystemPrompt ] = useTriliumOption("aiSystemPrompt");

    return (
        <OptionsSection title={t("ai_llm.provider_configuration")}>
            <FormGroup name="selected-provider" label={t("ai_llm.selected_provider")} description={t("ai_llm.selected_provider_description")}>
                <FormSelect
                    values={[
                        { value: "", text: t("ai_llm.select_provider") },
                        { value: "openai", text: "OpenAI" },
                        { value: "anthropic", text: "Anthropic" },
                        { value: "ollama", text: "Ollama" }
                    ]}
                    currentValue={aiSelectedProvider} onChange={setAiSelectedProvider}
                    keyProperty="value" titleProperty="text"
                />
            </FormGroup>

            {
                aiSelectedProvider === "openai" ?
                    <SingleProviderSettings
                        title={t("ai_llm.openai_settings")}
                        apiKeyDescription={t("ai_llm.openai_api_key_description")}
                        baseUrlDescription={t("ai_llm.openai_url_description")}
                        modelDescription={t("ai_llm.openai_model_description")}
                        validationErrorMessage={t("ai_llm.empty_key_warning.openai")}
                        apiKeyOption="openaiApiKey" baseUrlOption="openaiBaseUrl" modelOption="openaiDefaultModel"
                        provider={aiSelectedProvider}
                    />
                : aiSelectedProvider === "anthropic" ?
                    <SingleProviderSettings
                        title={t("ai_llm.anthropic_settings")}
                        apiKeyDescription={t("ai_llm.anthropic_api_key_description")}
                        modelDescription={t("ai_llm.anthropic_model_description")}
                        baseUrlDescription={t("ai_llm.anthropic_url_description")}
                        validationErrorMessage={t("ai_llm.empty_key_warning.anthropic")}
                        apiKeyOption="anthropicApiKey" baseUrlOption="anthropicBaseUrl" modelOption="anthropicDefaultModel"
                        provider={aiSelectedProvider}
                    />
                : aiSelectedProvider === "ollama" ?
                    <SingleProviderSettings
                        title={t("ai_llm.ollama_settings")}
                        baseUrlDescription={t("ai_llm.ollama_url_description")}
                        modelDescription={t("ai_llm.ollama_model_description")}
                        validationErrorMessage={t("ai_llm.ollama_no_url")}
                        baseUrlOption="ollamaBaseUrl"
                        provider={aiSelectedProvider} modelOption="ollamaDefaultModel"
                    />
                :
                    <></>
            }    

            <FormGroup name="ai-temperature" label={t("ai_llm.temperature")} description={t("ai_llm.temperature_description")}>
                <FormTextBox
                    type="number" min="0" max="2" step="0.1"
                    currentValue={aiTemperature} onChange={setAiTemperature}
                />
            </FormGroup>

            <FormGroup name="system-prompt" label={t("ai_llm.system_prompt")} description={t("ai_llm.system_prompt_description")}>
                <FormTextArea
                    rows={3}
                    currentValue={aiSystemPrompt} onBlur={setAiSystemPrompt}
                />
            </FormGroup>
        </OptionsSection>
    )
}

interface SingleProviderSettingsProps {
    provider: string;
    title: string;    
    apiKeyDescription?: string;
    baseUrlDescription: string;
    modelDescription: string;
    validationErrorMessage: string;
    apiKeyOption?: OptionNames;
    baseUrlOption: OptionNames;
    modelOption: OptionNames;
}

function SingleProviderSettings({ provider, title, apiKeyDescription, baseUrlDescription, modelDescription, validationErrorMessage, apiKeyOption, baseUrlOption, modelOption }: SingleProviderSettingsProps) {
    const [ apiKey, setApiKey ] = useTriliumOption(apiKeyOption ?? baseUrlOption);
    const [ baseUrl, setBaseUrl ] = useTriliumOption(baseUrlOption);
    const isValid = (apiKeyOption ? !!apiKey : !!baseUrl);

    return (
        <div class="provider-settings">
            <div class="card mt-3">
                <div class="card-header">
                    <h5>{title}</h5>
                </div>

                <div class="card-body">
                    {!isValid && <Admonition type="caution">{validationErrorMessage}</Admonition> }

                    {apiKeyOption && (
                        <FormGroup name="api-key" label={t("ai_llm.api_key")} description={apiKeyDescription}>
                            <FormTextBox
                                type="password" autoComplete="off"
                                currentValue={apiKey} onChange={setApiKey}
                            />
                        </FormGroup>
                    )}

                    <FormGroup name="base-url" label={t("ai_llm.url")} description={baseUrlDescription}>
                        <FormTextBox
                            currentValue={baseUrl ?? "https://api.openai.com/v1"} onChange={setBaseUrl}
                        />
                    </FormGroup>

                    {isValid && 
                        <FormGroup name="model" label={t("ai_llm.model")} description={modelDescription}>
                            <ModelSelector provider={provider} baseUrl={baseUrl} modelOption={modelOption} />
                        </FormGroup>
                    }
                </div>
            </div>
        </div>
    )
}

function ModelSelector({ provider, baseUrl, modelOption }: { provider: string; baseUrl: string, modelOption: OptionNames }) {
    const [ model, setModel ] = useTriliumOption(modelOption);
    const [ models, setModels ] = useState<{ name: string, id: string }[]>([]);

    const loadProviders = useCallback(async () => {
        switch (provider) {
            case "openai":
            case "anthropic": {
                try {
                    const response = await server.get<OpenAiOrAnthropicModelResponse>(`llm/providers/${provider}/models?baseUrl=${encodeURIComponent(baseUrl)}`);
                    if (response.success) {
                        setModels(response.chatModels.toSorted((a, b) => a.name.localeCompare(b.name)));
                    } else {
                        toast.showError(t("ai_llm.no_models_found_online"));
                    }
                } catch (e) {
                    toast.showError(t("ai_llm.error_fetching", { error: e }));
                }
                break;
            }
            case "ollama": {
                try {
                    const response = await server.get<OllamaModelResponse>(`llm/providers/ollama/models?baseUrl=${encodeURIComponent(baseUrl)}`);
                    if (response.success) {
                        setModels(response.models
                            .map(model => ({
                                name: model.name,
                                id: model.model
                            }))
                            .toSorted((a, b) => a.name.localeCompare(b.name)));
                    } else {
                        toast.showError(t("ai_llm.no_models_found_ollama"));
                    }
                } catch (e) {
                    toast.showError(t("ai_llm.error_fetching", { error: e }));
                }
                break;
            }
        }
    }, [provider]);

    useEffect(() => {
        loadProviders();
    }, [provider]);

    return (
        <>
            <FormSelect
                values={models}
                keyProperty="id" titleProperty="name"
                currentValue={model} onChange={setModel}
            />

            <Button
                text={t("ai_llm.refresh_models")}
                onClick={loadProviders}
                size="small"
                style={{ marginTop: "0.5em" }}
            />
        </>
    )
}