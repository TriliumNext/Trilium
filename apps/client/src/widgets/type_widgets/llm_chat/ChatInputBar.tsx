import "./ChatInputBar.css";

import type { AttributeEditor as CKEditorAttributeEditor, CKTextEditor, MentionFeed } from "@triliumnext/ckeditor5";
import type { DISPLAYABLE_LOCALE_IDS } from "@triliumnext/commons";
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
import { FormListHeader, FormListItem } from "../../react/FormList.js";
import { useLegacyImperativeHandlers, useTriliumOption } from "../../react/hooks.js";
import MaskedIcon from "../../react/MaskedIcon.js";
import AddProviderModal, { type LlmProviderConfig, type ProviderStep } from "../options/llm/AddProviderModal.js";
import { providerIconUrl } from "../options/llm/provider_icons.js";
import { computeContextUsage } from "./chat_context_usage.js";
import { insertNewBlock as insertNewBlockCommand, isSelectionInCodeBlock, outdentListItemAtStart } from "./chat_input_editing.js";
import { editorHtmlToMarkdown } from "./chat_input_markdown.js";
import { shortModelName } from "./model_name.js";
import { SafeImage } from "./retry_image.js";
import { useChatAttachments } from "./useChatAttachments.js";
import ViewContextPreview from "./ViewContextPreview.js";
import { type ModelOption, resolveSelectedModel } from "../../../services/llm_providers.js";
import { type UseLlmChatReturn } from "./useLlmChat.js";

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

/** The pieces of the editor package this bar needs, once it has been fetched. */
interface ChatEditorModule {
    editor: typeof CKEditorAttributeEditor;
    plugins: typeof import("@triliumnext/ckeditor5")["CHAT_INPUT_PLUGINS"];
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
    onModelChange,
    inSidebar
}: ChatInputBarProps) {
    // Provider add/edit modal. `modalProvider` undefined = adding; a config = editing.
    // The bumping token re-keys the modal so it re-initializes its wizard on each open.
    const [modalProvider, setModalProvider] = useState<LlmProviderConfig | undefined>();
    const [modalStep, setModalStep] = useState<ProviderStep | undefined>();
    const [modalOpen, setModalOpen] = useState(false);
    const [openToken, setOpenToken] = useState(0);
    const editorApiRef = useRef<CKEditorApi>();
    const editorInstanceRef = useRef<CKTextEditor>();
    const [ uiLanguage ] = useTriliumOption("locale");
    // CKEditor is the heaviest module the client has, and importing it statically here put it
    // on the startup critical path: the right panel mounts SidebarChat, which pulls this bar,
    // which pulled the editor — and its math plugin, and mathlive — before the app finished
    // rendering. Fetching it on mount keeps that chain off boot. Nothing waits that did not
    // wait already: the wrapper builds the editor from an effect after its own dynamic import.
    const [ ckEditor, setCkEditor ] = useState<ChatEditorModule>();
    useEffect(() => {
        let cancelled = false;
        void import("@triliumnext/ckeditor5").then(({ AttributeEditor, CHAT_INPUT_PLUGINS }) => {
            if (!cancelled) {
                setCkEditor({ editor: AttributeEditor, plugins: CHAT_INPUT_PLUGINS });
            }
        });
        return () => { cancelled = true; };
    }, []);
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
        const hasResolvedModel = !!resolveSelectedModel(chat.availableModels, chat.selectedModel, chat.selectedProvider, chat.selectedProviderId);
        const willSubmit = (chat.hasInputText || chat.pendingAttachments.length > 0) && !chat.isStreaming && hasResolvedModel;
        baseSubmit(e);
        if (willSubmit) {
            editorApiRef.current?.setText("");
            editorApiRef.current?.focus();
        }
    }, [baseSubmit, chat.hasInputText, chat.isStreaming, chat.pendingAttachments.length, chat.availableModels, chat.selectedModel, chat.selectedProvider, chat.selectedProviderId]);
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

    const handleModelSelect = (model: ModelOption) => {
        chat.setSelectedModel(model.id, model.provider, model.providerId);
        onModelChange?.(model.id);
    };

    const handleNoteContextToggle = () => {
        if (chat.contextNoteId) {
            chat.setContextNoteId(undefined);
        } else if (activeNoteId) {
            chat.setContextNoteId(activeNoteId);
        }
    };

    const openModal = useCallback((provider?: LlmProviderConfig, step?: ProviderStep) => {
        setModalProvider(provider);
        setModalStep(step);
        setOpenToken(token => token + 1);
        setModalOpen(true);
    }, []);

    // Open the model-selection step for an existing provider (the dropdown pencil).
    const openEditModels = useCallback((providerId: string) => {
        const configs = (options.getJson("llmProviders") as LlmProviderConfig[] | null) ?? [];
        const config = configs.find(c => c.id === providerId);
        if (config) {
            openModal(config, "models");
        }
    }, [openModal]);

    // Upsert the saved provider (editing replaces by id, adding appends) and refresh the picker.
    const handleSaveProvider = useCallback(async (provider: LlmProviderConfig) => {
        const configs = (options.getJson("llmProviders") as LlmProviderConfig[] | null) ?? [];
        const next = configs.some(c => c.id === provider.id)
            ? configs.map(c => (c.id === provider.id ? provider : c))
            : [...configs, provider];
        await options.save("llmProviders", JSON.stringify(next));
        chat.refreshModels();
    }, [chat]);

    const isNoteContextEnabled = !!chat.contextNoteId && !!activeNoteId;

    // Identify the active model; mirrors the sender's resolution so what the UI
    // shows as selected is exactly what will be sent (see resolveSelectedModel).
    const currentModel = resolveSelectedModel(chat.availableModels, chat.selectedModel, chat.selectedProvider, chat.selectedProviderId);
    const isSelectedModel = (m: ModelOption) => m === currentModel;
    // Gemini 2.x cannot combine googleSearch with function tools in a single
    // request. When note tools are enabled on a Gemini model we silently drop
    // web search server-side; reflect that here by disabling the toggle so the
    // user understands the trade-off instead of seeing it mysteriously ignored.
    const webSearchUnavailable = currentModel?.provider === "google" && chat.enableNoteTools;
    // Null until the window is close enough to matter, and null (rather than a guess) when
    // the model advertises no window at all. See chat_context_usage.
    const contextUsage = computeContextUsage({
        promptTokens: chat.lastPromptTokens,
        completionTokens: chat.lastCompletionTokens,
        draftTokens: chat.draftTokens,
        contextWindow: currentModel?.contextWindow
    });
    // The bar itself carries no text, so the numbers live in its tooltip (and, for assistive
    // tech, in `aria-valuetext`).
    const contextTooltip = contextUsage
        ? t("llm_chat.context_tooltip", {
            used: formatTokenCount(contextUsage.usedTokens),
            total: formatTokenCount(contextUsage.contextWindow),
            percentage: Math.round(contextUsage.percentage)
        })
        : undefined;

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
                        onClick={() => openModal()}
                    />
                </div>
                <AddProviderModal
                    key={openToken}
                    show={modalOpen}
                    existingProvider={modalProvider}
                    initialStep={modalStep}
                    onHidden={() => setModalOpen(false)}
                    onSave={handleSaveProvider}
                />
            </div>
        );
    }

    return (
        <>
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
                {!ckEditor ? (
                    // Holds the input's place for the moment the editor package is in flight, so
                    // the bar does not resize under the user.
                    <div className="llm-chat-input" />
                ) : (
                    <CKEditor
                        apiRef={editorApiRef}
                        className="llm-chat-input"
                        editor={ckEditor.editor}
                        config={{
                        // Markdown autoformatting (block quotes, code fences, lists, links) without a toolbar.
                            extraPlugins: ckEditor.plugins,
                            toolbar: { items: [] },
                            placeholder: t("llm_chat.placeholder"),
                            mention: { feeds: mentionFeeds },
                            licenseKey: "GPL"
                        }}
                        // The strings the box shows of its own — the link balloon it raises on Ctrl+K —
                        // in the language the rest of Trilium is read in; the dictionary is fetched for
                        // it before the editor is raised.
                        uiLanguage={uiLanguage as DISPLAYABLE_LOCALE_IDS}
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
                )}
                <input
                    ref={attachments.fileInputRef}
                    type="file"
                    accept={attachments.acceptAttr}
                    multiple
                    onChange={attachments.handleFilePickerChange}
                    style={{ display: "none" }}
                />
                {/* At the point the window is nearly gone, say so in words — a 2px bar is not
                    enough warning for a hard failure. Nothing in the send path trims the
                    conversation (BaseProvider.chat sends every message; `contextWindow` is
                    metadata the server never reads), so overflow is not graceful degradation:
                    the provider rejects the request and the error lands in the transcript. */}
                {contextUsage?.level === "critical" && (
                    <p className="llm-chat-context-alert">
                        <span className="bx bx-error-circle" />
                        {t("llm_chat.context_nearly_full")}
                    </p>
                )}
                <div className="llm-chat-options">
                    <div className="llm-chat-model-selector">
                        <Dropdown
                            // The provider's mark stands in for the vendor word `shortModelName`
                            // removes — the same information in a glyph's worth of width instead
                            // of a word's, and the only provider signal the collapsed button has.
                            text={currentModel
                                ? <>
                                    <MaskedIcon url={providerIconUrl(currentModel.provider)} className="llm-chat-model-icon" />
                                    <span className="llm-chat-model-select-name">{shortModelName(currentModel.name, currentModel.provider)}</span>
                                </>
                                : <span className="llm-chat-model-select-name llm-chat-model-placeholder">{t("llm_chat.no_model_selected")}</span>}
                            disabled={chat.isStreaming}
                            // The selector is the only item in the row that shrinks, so a long
                            // model name may ellipsize to very little — keep the full one reachable.
                            title={currentModel?.name}
                            titlePosition="top"
                            buttonClassName="llm-chat-model-select"
                            className="llm-chat-model-dropdown"
                            // In the sidebar the menu lives inside `.sidebar-chat-container`'s
                            // `overflow: hidden`, which clips the leftward-opening legacy submenu.
                            // Portal it to the body (with a fixed popper) so it can extend past the
                            // sidebar edge, matching the sidebar's other dropdowns.
                            portalToBody={inSidebar}
                            dropdownOptions={inSidebar ? { popperConfig: { strategy: "fixed" } } : undefined}
                        >
                            {chat.modelGroups.map(group => (
                                <Fragment key={group.id}>
                                    <FormListHeader
                                        text={group.name}
                                        action={
                                            <ActionButton
                                                icon="bx bx-edit"
                                                text={t("llm_chat.edit_models")}
                                                onClick={() => openEditModels(group.id)}
                                            />
                                        }
                                    />
                                    {group.models.length > 0 ? group.models.map(model => (
                                        <FormListItem
                                            key={`${model.providerId ?? model.provider}:${model.id}`}
                                            onClick={() => handleModelSelect(model)}
                                            checked={isSelectedModel(model)}
                                        >
                                            <MaskedIcon url={providerIconUrl(model.provider)} className="llm-chat-model-icon" />
                                            {shortModelName(model.name, model.provider)}{model.costDescription && <> <small>({model.costDescription})</small></>}
                                        </FormListItem>
                                    )) : (
                                    // Provider configured before model selection existed (or with
                                    // everything deselected): keep the group visible with a hint.
                                        <FormListItem disabled onClick={() => {}}>
                                            <small>{t("llm_chat.no_models_selected")}</small>
                                        </FormListItem>
                                    )}
                                </Fragment>
                            ))}
                        </Dropdown>
                    </div>
                    {/* What the model can reach this turn. Lifted out of the model dropdown so
                        their state reads at a glance and flipping one is a single click — the
                        system prompt currently has to tell the user where these live, which is
                        a fair sign a menu was the wrong home. Grouped so they stay together. */}
                    <div className="llm-chat-capabilities">
                        <CapabilityToggle
                            icon="bx bx-globe"
                            label={t("llm_chat.web_search")}
                            active={chat.enableWebSearch && !webSearchUnavailable}
                            onToggle={handleWebSearchToggle}
                            disabled={chat.isStreaming}
                            unavailableReason={webSearchUnavailable ? t("llm_chat.web_search_unavailable_gemini") : undefined}
                        />
                        <CapabilityToggle
                            icon="bx bx-note"
                            label={t("llm_chat.note_tools")}
                            active={chat.enableNoteTools}
                            onToggle={handleNoteToolsToggle}
                            disabled={chat.isStreaming}
                        />
                        <CapabilityToggle
                            icon="bx bx-brain"
                            label={t("llm_chat.extended_thinking")}
                            active={chat.enableExtendedThinking}
                            onToggle={handleExtendedThinkingToggle}
                            disabled={chat.isStreaming}
                        />
                    </div>
                    {/* The actions, boxed so they keep a fixed gap from the capabilities. The
                        row's `auto` spacer collapses to nothing once the row is full — which is
                        the normal state in the sidebar — so grouping can't rest on it alone. */}
                    <div className="llm-chat-actions">
                        {/* With the paperclip rather than the model selector: both answer "what
                            goes into this prompt", not "which model". Icon-only because the label
                            named the note the user is already looking at, duplicating the title
                            shown beside it instead of carrying information — it lives in the
                            tooltip, which is the only place it says anything new. */}
                        {activeNoteId && activeNoteTitle && (
                            <ActionButton
                                icon={isNoteContextEnabled ? "bx bx-file" : "bx bx-hide"}
                                text={isNoteContextEnabled
                                    ? t("llm_chat.note_context_enabled", { title: activeNoteTitle })
                                    : t("llm_chat.note_context_disabled", { title: activeNoteTitle })}
                                active={isNoteContextEnabled}
                                onClick={handleNoteContextToggle}
                                disabled={chat.isStreaming}
                                className="llm-chat-note-context"
                            />
                        )}
                        {isNoteContextEnabled && chat.contextNoteId && (
                            <ViewContextPreview
                                noteId={chat.contextNoteId}
                                included={chat.includeViewContext}
                                onIncludedChange={chat.setIncludeViewContext}
                                disabled={chat.isStreaming}
                            />
                        )}
                        <ActionButton
                            icon="bx bx-paperclip"
                            text={t("llm_chat.attach_file")}
                            onClick={attachments.openFilePicker}
                            disabled={chat.isStreaming || !chat.chatNoteId}
                            className="llm-chat-attach-btn"
                        />
                        <ActionButton
                            icon={chat.isStreaming ? "bx bx-stop" : "bx bx-up-arrow-alt"}
                            text={chat.isStreaming
                                ? t("llm_chat.stop")
                                : !currentModel ? t("llm_chat.no_model_selected") : t("llm_chat.send")}
                            onClick={chat.isStreaming ? chat.stopStreaming : handleSubmit}
                            disabled={!chat.isStreaming && (!currentModel || (!chat.hasInputText && chat.pendingAttachments.length === 0))}
                            className={`llm-chat-send-btn ${chat.isStreaming ? "llm-chat-stop-btn" : ""}`}
                        />
                    </div>
                </div>
                {/* The hairline rides the island's bottom edge, edge to edge, rather than taking
                    a slot in the control row. The outer element only clips to the island's corners
                    and takes no pointer events; the track carries the tooltip and the ARIA, so
                    assistive tech gets the same reading the length gives visually. */}
                {contextUsage && (
                    <div className={`llm-chat-context-bar llm-chat-context-bar-${contextUsage.level}`}>
                        <div
                            className="llm-chat-context-bar-track"
                            role="progressbar"
                            aria-label={t("llm_chat.context_usage_label")}
                            aria-valuenow={Math.round(contextUsage.percentage)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuetext={contextTooltip}
                            title={contextTooltip}
                        >
                            <div
                                className="llm-chat-context-bar-fill"
                                style={{ width: `${contextUsage.percentage}%` }}
                            />
                        </div>
                    </div>
                )}
            </form>
            <AddProviderModal
                key={openToken}
                show={modalOpen}
                existingProvider={modalProvider}
                initialStep={modalStep}
                onHidden={() => setModalOpen(false)}
                onSave={handleSaveProvider}
            />
        </>
    );
}

/**
 * One of the model's per-conversation capability switches, as an icon toggle whose state
 * reads without opening anything. The label is the tooltip.
 */
function CapabilityToggle({ icon, label, active, onToggle, disabled, unavailableReason }: {
    icon: string;
    label: string;
    active: boolean;
    onToggle: (newValue: boolean) => void;
    disabled?: boolean;
    /** Why this capability can't be used with the current model, if it can't. */
    unavailableReason?: string;
}) {
    const button = (
        <ActionButton
            icon={icon}
            text={unavailableReason ?? label}
            active={active}
            disabled={disabled || !!unavailableReason}
            onClick={() => onToggle(!active)}
            className="llm-chat-capability"
        />
    );

    // A disabled <button> receives no mouse events, so its own tooltip never fires — which is
    // why the dropdown this replaced had to put the explanation on a separate info icon. The
    // wrapper carries it instead, and only exists when there is something to explain.
    return unavailableReason
        ? <span className="llm-chat-capability-unavailable" title={unavailableReason}>{button}</span>
        : button;
}

