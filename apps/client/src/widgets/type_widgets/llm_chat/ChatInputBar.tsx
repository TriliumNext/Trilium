import "./ChatInputBar.css";

import type { RefObject } from "preact";
import { useState, useCallback } from "preact/hooks";

import { t } from "../../../services/i18n.js";
import ActionButton from "../../react/ActionButton.js";
import Button from "../../react/Button.js";
import Dropdown from "../../react/Dropdown.js";
import { FormDropdownDivider, FormDropdownSubmenu, FormListItem, FormListToggleableItem } from "../../react/FormList.js";
import type { UseLlmChatReturn } from "./useLlmChat.js";
import AddProviderModal, { type LlmProviderConfig } from "../options/llm/AddProviderModal.js";
import options from "../../../services/options.js";

/** Format token count with thousands separators */
function formatTokenCount(tokens: number): string {
    return tokens.toLocaleString();
}

interface ChatInputBarProps {
    /** The chat hook result */
    chat: UseLlmChatReturn;
    /** Number of rows for the textarea (default: 3) */
    rows?: number;
    /** Current active note ID (for note context toggle) */
    activeNoteId?: string;
    /** Current active note title (for note context toggle) */
    activeNoteTitle?: string;
    /** Custom submit handler (overrides chat.handleSubmit) */
    onSubmit?: (e: Event) => void;
    /** Custom key down handler (overrides chat.handleKeyDown) */
    onKeyDown?: (e: KeyboardEvent) => void;
    /** Callback when web search toggle changes */
    onWebSearchChange?: () => void;
    /** Callback when note tools toggle changes */
    onNoteToolsChange?: () => void;
    /** Callback when extended thinking toggle changes */
    onExtendedThinkingChange?: () => void;
    /** Callback when model changes */
    onModelChange?: (model: string) => void;
}

export default function ChatInputBar({
    chat,
    rows = 3,
    activeNoteId,
    activeNoteTitle,
    onSubmit,
    onKeyDown,
    onWebSearchChange,
    onNoteToolsChange,
    onExtendedThinkingChange,
    onModelChange
}: ChatInputBarProps) {
    const [showAddProviderModal, setShowAddProviderModal] = useState(false);

    const handleSubmit = onSubmit ?? chat.handleSubmit;
    const handleKeyDown = onKeyDown ?? chat.handleKeyDown;

    const handleWebSearchToggle = (newValue: boolean) => {
        chat.setEnableWebSearch(newValue);
        onWebSearchChange?.();
    };

    const handleNoteToolsToggle = (newValue: boolean) => {
        chat.setEnableNoteTools(newValue);
        onNoteToolsChange?.();
    };

    const handleExtendedThinkingToggle = (newValue: boolean) => {
        chat.setEnableExtendedThinking(newValue);
        onExtendedThinkingChange?.();
    };

    const handleModelSelect = (model: string) => {
        chat.setSelectedModel(model);
        onModelChange?.(model);
    };

    const handleNoteContextToggle = () => {
        if (chat.contextNoteId) {
            chat.setContextNoteId(undefined);
        } else if (activeNoteId) {
            chat.setContextNoteId(activeNoteId);
        }
    };

    const handleAddProvider = useCallback(async (provider: LlmProviderConfig) => {
        // Get current providers and add the new one
        const currentProviders = options.getJson("llmProviders") || [];
        const newProviders = [...currentProviders, provider];
        await options.save("llmProviders", JSON.stringify(newProviders));
        // Refresh models to pick up the new provider
        chat.refreshModels();
    }, [chat]);

    const isNoteContextEnabled = !!chat.contextNoteId && !!activeNoteId;

    const currentModel = chat.availableModels.find(m => m.id === chat.selectedModel);
    const currentModels = chat.availableModels.filter(m => !m.isLegacy);
    const legacyModels = chat.availableModels.filter(m => m.isLegacy);
    const contextWindow = currentModel?.contextWindow || 200000;
    const percentage = Math.min((chat.lastPromptTokens / contextWindow) * 100, 100);
    const isWarning = percentage > 75;
    const isCritical = percentage > 90;
    const pieColor = isCritical ? "var(--danger-color, #d9534f)" : isWarning ? "var(--warning-color, #f0ad4e)" : "var(--main-selection-color, #007bff)";

    // Show setup prompt if no provider is configured
    if (!chat.isCheckingProvider && !chat.hasProvider) {
        return (
            <div className="llm-chat-no-provider">
                <div className="llm-chat-no-provider-content">
                    <span className="bx bx-bot llm-chat-no-provider-icon" />
                    <p>{t("llm_chat.no_provider_message")}</p>
                    <Button
                        text={t("llm_chat.add_provider")}
                        icon="bx bx-plus"
                        onClick={() => setShowAddProviderModal(true)}
                    />
                </div>
                <AddProviderModal
                    show={showAddProviderModal}
                    onHidden={() => setShowAddProviderModal(false)}
                    onSave={handleAddProvider}
                />
            </div>
        );
    }

    return (
        <form className="llm-chat-input-form" onSubmit={handleSubmit}>
            <textarea
                ref={chat.textareaRef as RefObject<HTMLTextAreaElement>}
                className="llm-chat-input"
                value={chat.input}
                onInput={(e) => chat.setInput((e.target as HTMLTextAreaElement).value)}
                placeholder={t("llm_chat.placeholder")}
                disabled={chat.isStreaming}
                onKeyDown={handleKeyDown}
                rows={rows}
            />
            <div className="llm-chat-options">
                <div className="llm-chat-model-selector">
                    <span className="bx bx-chip" />
                    <Dropdown
                        text={<>{currentModel?.name}</>}
                        disabled={chat.isStreaming}
                        buttonClassName="llm-chat-model-select"
                    >
                        {currentModels.map(model => (
                            <FormListItem
                                key={model.id}
                                onClick={() => handleModelSelect(model.id)}
                                checked={chat.selectedModel === model.id}
                            >
                                {model.name} <small>({model.costDescription})</small>
                            </FormListItem>
                        ))}
                        {legacyModels.length > 0 && (
                            <>
                                <FormDropdownDivider />
                                <FormDropdownSubmenu
                                    icon="bx bx-history"
                                    title={t("llm_chat.legacy_models")}
                                >
                                    {legacyModels.map(model => (
                                        <FormListItem
                                            key={model.id}
                                            onClick={() => handleModelSelect(model.id)}
                                            checked={chat.selectedModel === model.id}
                                        >
                                            {model.name} <small>({model.costDescription})</small>
                                        </FormListItem>
                                    ))}
                                </FormDropdownSubmenu>
                            </>
                        )}
                        <FormDropdownDivider />
                        <FormListToggleableItem
                            icon="bx bx-globe"
                            title={t("llm_chat.web_search")}
                            currentValue={chat.enableWebSearch}
                            onChange={handleWebSearchToggle}
                            disabled={chat.isStreaming}
                        />
                        <FormListToggleableItem
                            icon="bx bx-note"
                            title={t("llm_chat.note_tools")}
                            currentValue={chat.enableNoteTools}
                            onChange={handleNoteToolsToggle}
                            disabled={chat.isStreaming}
                        />
                        <FormListToggleableItem
                            icon="bx bx-brain"
                            title={t("llm_chat.extended_thinking")}
                            currentValue={chat.enableExtendedThinking}
                            onChange={handleExtendedThinkingToggle}
                            disabled={chat.isStreaming}
                        />
                    </Dropdown>
                    {activeNoteId && activeNoteTitle && (
                        <Button
                            text={activeNoteTitle}
                            icon={isNoteContextEnabled ? "bx-file" : "bx-hide"}
                            kind="lowProfile"
                            size="micro"
                            className={`llm-chat-note-context ${isNoteContextEnabled ? "active" : ""}`}
                            onClick={handleNoteContextToggle}
                            disabled={chat.isStreaming}
                            title={isNoteContextEnabled
                                ? t("llm_chat.note_context_enabled", { title: activeNoteTitle })
                                : t("llm_chat.note_context_disabled")}
                        />
                    )}
                    {chat.lastPromptTokens > 0 && (
                        <div
                            className="llm-chat-context-indicator"
                            title={`${formatTokenCount(chat.lastPromptTokens)} / ${formatTokenCount(contextWindow)} ${t("llm_chat.tokens")}`}
                        >
                            <div
                                className="llm-chat-context-pie"
                                style={{
                                    background: `conic-gradient(${pieColor} ${percentage}%, var(--accented-background-color) ${percentage}%)`
                                }}
                            />
                            <span className="llm-chat-context-text">{t("llm_chat.context_used", { percentage: percentage.toFixed(0) })}</span>
                        </div>
                    )}
                </div>
                <ActionButton
                    icon={chat.isStreaming ? "bx bx-stop" : "bx bx-send"}
                    text={chat.isStreaming ? t("llm_chat.stop") : t("llm_chat.send")}
                    onClick={chat.isStreaming ? chat.stopStreaming : handleSubmit}
                    disabled={!chat.isStreaming && !chat.input.trim()}
                    className={`llm-chat-send-btn ${chat.isStreaming ? "llm-chat-stop-btn" : ""}`}
                />
            </div>
        </form>
    );
}
