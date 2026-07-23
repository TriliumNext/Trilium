import "./ChatInputBar.css";

import { AttributeEditor as CKEditorAttributeEditor, CHAT_INPUT_PLUGINS, type CKTextEditor, type MentionFeed } from "@triliumnext/ckeditor5";
import { Fragment } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n.js";
import link from "../../../services/link.js";
import note_autocomplete, { type Suggestion } from "../../../services/note_autocomplete.js";
import options from "../../../services/options.js";
import ActionButton from "../../react/ActionButton.js";
import Button from "../../react/Button.js";
import CKEditor, { type CKEditorApi } from "../../react/CKEditor.js";
import Dropdown from "../../react/Dropdown.js";
import { FormDropdownDivider, FormDropdownSubmenu, FormListHeader, FormListItem, FormListToggleableItem } from "../../react/FormList.js";
import { useLegacyImperativeHandlers } from "../../react/hooks.js";
import AddProviderModal, { type LlmProviderConfig, PROVIDER_TYPES } from "../options/llm/AddProviderModal.js";
import KnowledgeBasePanel from "./KnowledgeBasePanel.js";
import { insertNewBlock as insertNewBlockCommand, isSelectionInCodeBlock, outdentListItemAtStart } from "./chat_input_editing.js";
import { editorHtmlToMarkdown } from "./chat_input_markdown.js";
import { SafeImage } from "./retry_image.js";
import { useChatAttachments } from "./useChatAttachments.js";
import type { ModelOption, UseLlmChatReturn } from "./useLlmChat.js";

const READ_ONLY_LOCK = "llm-chat-streaming";

const mentionFeeds: MentionFeed[] = [
    {
        marker: "@",
        feed: (queryText) => note_autocomplete.autocompleteSourceForCKEditor(queryText),
        itemRenderer: (rawItem) => {
            const item = rawItem as Suggestion;
            const itemElement = document.createElement("button");

            const iconElement = document.createElement("span");
            let iconClass = item.icon ?? "bx bx-note";
            if (item.action === "create-note") {
                iconClass = "bx bx-plus";
            }
            iconElement.className = iconClass;

            itemElement.append(iconElement, document.createTextNode(" "));
            const titleContainer = document.createElement("span");
            titleContainer.innerHTML = item.highlightedNotePathTitle ?? "";
            itemElement.append(...titleContainer.childNodes, document.createTextNode(" "));

            return itemElement;
        },
        minimumCharacters: 0
    }
];

/** Format token count with thousands separators */
function formatTokenCount(tokens: number): string {
    return tokens.toLocaleString();
}

interface ChatInputBarProps {
    /** The chat hook result */
    chat: UseLlmChatReturn;
    /** Current active note ID (for note context toggle) */
    activeNoteId?: string;
    /** Current active note title (for note context toggle) */
    activeNoteTitle?: string;
    /** Custom submit handler (overrides chat.handleSubmit) */
    onSubmit?: (e: Event) => void;
    /** Callback when web search toggle changes */
    onWebSearchChange?: () => void;
    /** Callback when note tools toggle changes */
    onNoteToolsChange?: () => void;
    /** Callback when extended thinking toggle changes */
    onExtendedThinkingChange?: () => void;
    /** Callback when the knowledge base toggle or its sources change */
    onKnowledgeBaseChange?: () => void;
    /** Callback when model changes */
    onModelChange?: (model: string) => void;
    /** Rendered inside the narrow right sidebar — opens the model submenu leftwards so it doesn't overflow. */
    inSidebar?: boolean;
}

export default function ChatInputBar({
    chat,
    activeNoteId,
    activeNoteTitle,
    onSubmit,
    onWebSearchChange,
    onNoteToolsChange,
    onExtendedThinkingChange,
    onKnowledgeBaseChange,
    onModelChange,
    inSidebar
}: ChatInputBarProps) {
    const [showAddProviderModal, setShowAddProviderModal] = useState(false);
    const editorApiRef = useRef<CKEditorApi>();
    const editorInstanceRef = useRef<CKTextEditor>();
    // Always-fresh submit handler for the editor's enter listener.
    const submitRef = useRef<(e: Event) => void>(() => {});

    // Clipboard / drag-drop / file-picker upload management.
    const attachments = useChatAttachments(chat);

    // CKEditor's ReferenceLink plugin calls back into the parent component to
    // resolve a note's title from its href.
    useLegacyImperativeHandlers({
        async loadReferenceLinkTitle($el: JQuery<HTMLElement>, href: string | null = null) {
            await link.loadReferenceLinkTitle($el, href);
        }
    });

    const baseSubmit = onSubmit ?? chat.handleSubmit;
    // Clear the editor immediately when a submit fires with non-empty, non-streaming
    // input — mirrors the rejection check inside chat.handleSubmit so we don't wipe
    // text that won't actually be sent. Doing it here (instead of as a useEffect on
    // the draft state) avoids the React-render / CKEditor-change-event race that left
    // the editor visually populated after submit.
    const handleSubmit = useCallback((e: Event) => {
        const willSubmit = (chat.hasInputText || chat.pendingAttachments.length > 0) && !chat.isStreaming;
        baseSubmit(e);
        if (willSubmit) {
            editorApiRef.current?.setText("");
            editorApiRef.current?.focus();
        }
    }, [baseSubmit, chat.hasInputText, chat.isStreaming, chat.pendingAttachments.length]);
    submitRef.current = handleSubmit;

    // Expose the reply-input editor to the chat hook so timeline actions (e.g. quoting a selection)
    // can write into it. A stable wrapper reads the live api ref, so it works regardless of whether
    // the CKEditor's imperative handle has committed by the time this effect first runs.
    const registerInputEditor = chat.registerInputEditor;
    useEffect(() => {
        registerInputEditor({ appendBlockQuote: (text) => editorApiRef.current?.appendBlockQuote(text) });
        return () => registerInputEditor(undefined);
    }, [registerInputEditor]);

    // Reflect streaming state into CKEditor's read-only lock.
    useEffect(() => {
        const editor = editorInstanceRef.current;
        if (!editor) return;
        if (chat.isStreaming) {
            editor.enableReadOnlyMode(READ_ONLY_LOCK);
        } else {
            editor.disableReadOnlyMode(READ_ONLY_LOCK);
        }
    }, [chat.isStreaming]);

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

    const handleKnowledgeBaseToggle = (newValue: boolean) => {
        chat.setEnableKnowledgeBase(newValue);
        onKnowledgeBaseChange?.();
    };

    const handleAddSourceNote = (noteId: string) => {
        chat.addSourceNote(noteId);
        onKnowledgeBaseChange?.();
    };

    const handleRemoveSourceNote = (noteId: string) => {
        chat.removeSourceNote(noteId);
        onKnowledgeBaseChange?.();
    };

    const handleModelSelect = (model: string, provider?: string) => {
        chat.setSelectedModel(model, provider);
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

    // Two providers can expose the same model ID (e.g. an Anthropic API key and
    // a Claude subscription both offering "claude-sonnet-5"), so identify the
    // active model by provider too. Mirror the sender's resolution: prefer the
    // recorded provider, else fall back to the first ID match (pre-existing chats).
    const effectiveProvider = chat.selectedProvider
        ?? chat.availableModels.find(m => m.id === chat.selectedModel)?.provider;
    const isSelectedModel = (m: ModelOption) => m.id === chat.selectedModel && m.provider === effectiveProvider;
    const currentModel = chat.availableModels.find(isSelectedModel);
    const currentModels = chat.availableModels.filter(m => !m.isLegacy);
    const currentModelGroups = groupModelsByProvider(currentModels);
    const legacyModels = chat.availableModels.filter(m => m.isLegacy);
    const legacyModelGroups = groupModelsByProvider(legacyModels);
    // Gemini 2.x cannot combine googleSearch with function tools in a single
    // request. When note tools are enabled on a Gemini model we silently drop
    // web search server-side; reflect that here by disabling the toggle so the
    // user understands the trade-off instead of seeing it mysteriously ignored.
    const webSearchUnavailable = currentModel?.provider === "google" && chat.enableNoteTools;
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
        <form
            className="llm-chat-input-form"
            onSubmit={handleSubmit}
            onDrop={attachments.handleDrop}
            onDragOver={attachments.handleDragOver}
        >
            {chat.pendingAttachments.length > 0 && (
                <div className="llm-chat-attachments">
                    {chat.pendingAttachments.map((att) => (
                        <div
                            key={att.attachmentId}
                            className={`llm-chat-attachment-chip llm-chat-attachment-chip-${att.type}`}
                            title={att.title}
                        >
                            {att.type === "image" ? (
                                <SafeImage src={att.url} alt={att.title} />
                            ) : (
                                <div className="llm-chat-attachment-file">
                                    <span className={`bx ${att.type === "file" ? "bxs-file-pdf" : "bxs-file-blank"} llm-chat-attachment-file-icon`} />
                                    <span className="llm-chat-attachment-file-name">{att.title}</span>
                                </div>
                            )}
                            <button
                                type="button"
                                className="llm-chat-attachment-remove"
                                title={t("llm_chat.remove_attachment")}
                                onClick={() => chat.removePendingAttachment(att.attachmentId)}
                                disabled={chat.isStreaming}
                            >
                                <span className="bx bx-x" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
            <CKEditor
                apiRef={editorApiRef}
                className="llm-chat-input"
                editor={CKEditorAttributeEditor}
                config={{
                    // Markdown autoformatting (block quotes, code fences, lists, links) without a toolbar.
                    extraPlugins: CHAT_INPUT_PLUGINS,
                    toolbar: { items: [] },
                    placeholder: t("llm_chat.placeholder"),
                    mention: { feeds: mentionFeeds },
                    licenseKey: "GPL",
                    language: "en"
                }}
                onChange={(html) => {
                    chat.setInput(editorHtmlToMarkdown(html ?? ""));
                }}
                onInitialized={(editor) => {
                    editorInstanceRef.current = editor;
                    const insertNewBlock = () => {
                        insertNewBlockCommand(editor);
                        editor.editing.view.scrollToTheSelection();
                    };
                    editor.editing.view.document.on(
                        "enter",
                        (event, data) => {
                            // Inside a code block, don't submit — let CodeBlock turn Enter/Shift+Enter
                            // into newlines, so multi-line snippets can be typed.
                            if (isSelectionInCodeBlock(editor)) return;
                            // Shift+Enter builds blocks — a new list item / paragraph, or exiting an empty
                            // list item / code-block line — so lists and blocks can be built while plain
                            // Enter submits. Normally handled by the keydown keystroke below; this is a
                            // fallback for the rare case where the keystroke doesn't cancel the event.
                            if (data.isSoft) {
                                event.stop();
                                data.preventDefault();
                                insertNewBlock();
                                return;
                            }
                            // Plain Enter submits.
                            event.stop();
                            data.preventDefault();
                            submitRef.current(new Event("submit"));
                        },
                        { priority: "high" }
                    );
                    // Shift/Ctrl/Alt+Enter all insert a new block. Bind them on keydown via keystrokes
                    // rather than the `enter` view event: modified Enter combos don't fire that event, and
                    // — crucially for Shift+Enter — CodeBlock consumes the `enter` event in its own context
                    // (and stops it) before our handler runs, so intercepting on keydown is the only way to
                    // let Shift+Enter leave a code block from its empty last line.
                    editor.keystrokes.set("Shift+Enter", (_keyEvtData, cancel) => { cancel(); insertNewBlock(); });
                    editor.keystrokes.set("Ctrl+Enter", (_keyEvtData, cancel) => { cancel(); insertNewBlock(); });
                    editor.keystrokes.set("Alt+Enter", (_keyEvtData, cancel) => { cancel(); insertNewBlock(); });
                    // Backspace at the very start of a list item leaves the list (outdent → paragraph)
                    // instead of CKEditor's default, which merges the item into the previous one as a
                    // bullet-less continuation block — confusing in a simple chat input. The list handles
                    // this on the `delete` view event (fired from `beforeinput`), so intercepting on the
                    // earlier `keydown` and cancelling suppresses that event before the list can merge.
                    editor.keystrokes.set("Backspace", (_keyEvtData, cancel) => {
                        if (outdentListItemAtStart(editor)) cancel();
                    });
                    // Capture pasted images at the DOM layer so CKEditor doesn't
                    // try to embed them as base64 data URLs inside the editor.
                    // Go through `pasteHandlerRef` so this one-time registration
                    // always sees the latest closure (chatNoteId arrives via a
                    // useEffect in the parent, after first render).
                    const editable = editor.editing.view.getDomRoot();
                    editable?.addEventListener(
                        "paste",
                        (e) => attachments.pasteHandlerRef.current(e as ClipboardEvent),
                        { capture: true }
                    );
                }}
            />
            <input
                ref={attachments.fileInputRef}
                type="file"
                accept={attachments.acceptAttr}
                multiple
                onChange={attachments.handleFilePickerChange}
                style={{ display: "none" }}
            />
            {chat.enableKnowledgeBase && (
                <KnowledgeBasePanel
                    sourceNoteIds={chat.sourceNoteIds}
                    onAddSource={handleAddSourceNote}
                    onRemoveSource={handleRemoveSourceNote}
                    disabled={chat.isStreaming}
                />
            )}
            <div className="llm-chat-options">
                <div className="llm-chat-model-selector">
                    <span className="bx bx-chip" />
                    <Dropdown
                        text={<>{currentModel?.name}</>}
                        disabled={chat.isStreaming}
                        buttonClassName="llm-chat-model-select"
                        className="llm-chat-model-dropdown"
                        // In the sidebar the menu lives inside `.sidebar-chat-container`'s
                        // `overflow: hidden`, which clips the leftward-opening legacy submenu.
                        // Portal it to the body (with a fixed popper) so it can extend past the
                        // sidebar edge, matching the sidebar's other dropdowns.
                        portalToBody={inSidebar}
                        dropdownOptions={inSidebar ? { popperConfig: { strategy: "fixed" } } : undefined}
                    >
                        {currentModelGroups.map(group => (
                            <Fragment key={group.key}>
                                {group.providerName && <FormListHeader text={group.providerName} />}
                                {group.models.map(model => (
                                    <FormListItem
                                        key={`${model.provider}:${model.id}`}
                                        onClick={() => handleModelSelect(model.id, model.provider)}
                                        checked={isSelectedModel(model)}
                                    >
                                        {model.name}{model.costDescription && <> <small>({model.costDescription})</small></>}
                                    </FormListItem>
                                ))}
                            </Fragment>
                        ))}
                        {legacyModels.length > 0 && (
                            <>
                                <FormDropdownDivider />
                                <FormDropdownSubmenu
                                    icon="bx bx-history"
                                    title={t("llm_chat.legacy_models")}
                                    dropStart={inSidebar}
                                >
                                    {legacyModelGroups.map(group => (
                                        <Fragment key={group.key}>
                                            {group.providerName && <FormListHeader text={group.providerName} />}
                                            {group.models.map(model => (
                                                <FormListItem
                                                    key={`${model.provider}:${model.id}`}
                                                    onClick={() => handleModelSelect(model.id, model.provider)}
                                                    checked={isSelectedModel(model)}
                                                >
                                                    {model.name}{model.costDescription && <> <small>({model.costDescription})</small></>}
                                                </FormListItem>
                                            ))}
                                        </Fragment>
                                    ))}
                                </FormDropdownSubmenu>
                            </>
                        )}
                        <FormDropdownDivider />
                        <FormListToggleableItem
                            icon="bx bx-globe"
                            title={t("llm_chat.web_search")}
                            currentValue={chat.enableWebSearch && !webSearchUnavailable}
                            onChange={handleWebSearchToggle}
                            disabled={chat.isStreaming || webSearchUnavailable}
                            disabledTooltip={webSearchUnavailable ? t("llm_chat.web_search_unavailable_gemini") : undefined}
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
                        <FormDropdownDivider />
                        <FormListToggleableItem
                            icon="bx bx-book-open"
                            title={t("llm_chat.knowledge_base")}
                            currentValue={chat.enableKnowledgeBase}
                            onChange={handleKnowledgeBaseToggle}
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
                    icon="bx bx-paperclip"
                    text={t("llm_chat.attach_file")}
                    onClick={attachments.openFilePicker}
                    disabled={chat.isStreaming || !chat.chatNoteId}
                    className="llm-chat-attach-btn"
                />
                <ActionButton
                    icon={chat.isStreaming ? "bx bx-stop" : "bx bx-send"}
                    text={chat.isStreaming ? t("llm_chat.stop") : t("llm_chat.send")}
                    onClick={chat.isStreaming ? chat.stopStreaming : handleSubmit}
                    disabled={!chat.isStreaming && !chat.hasInputText && chat.pendingAttachments.length === 0}
                    className={`llm-chat-send-btn ${chat.isStreaming ? "llm-chat-stop-btn" : ""}`}
                />
            </div>
        </form>
    );
}

interface ProviderModelGroup {
    /** Stable key for the group (the provider id). */
    key: string;
    /** Friendly provider name shown in the group header. */
    providerName: string;
    models: ModelOption[];
}

/**
 * Groups models by their owning provider, preserving the order in which each provider first
 * appears. The provider's friendly name (from {@link PROVIDER_TYPES}) heads each group.
 */
function groupModelsByProvider(models: ModelOption[]): ProviderModelGroup[] {
    const groups: ProviderModelGroup[] = [];
    const byProvider = new Map<string | undefined, ProviderModelGroup>();

    for (const model of models) {
        let group = byProvider.get(model.provider);
        if (!group) {
            group = {
                key: model.provider ?? "",
                providerName: PROVIDER_TYPES.find(p => p.id === model.provider)?.name ?? model.provider ?? "",
                models: []
            };
            byProvider.set(model.provider, group);
            groups.push(group);
        }
        group.models.push(model);
    }

    return groups;
}
