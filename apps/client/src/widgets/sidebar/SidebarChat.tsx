import "./SidebarChat.css";

import type { Dropdown as BootstrapDropdown } from "bootstrap";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import dateNoteService, { type RecentLlmChat } from "../../services/date_notes.js";
import { t } from "../../services/i18n.js";
import server from "../../services/server.js";
import { formatDateTime } from "../../utils/formatters";
import ActionButton from "../react/ActionButton.js";
import Dropdown from "../react/Dropdown.js";
import { FormListItem } from "../react/FormList.js";
import { useActiveNoteContext, useNote, useNoteProperty, useSpacedUpdate } from "../react/hooks.js";
import NoItems from "../react/NoItems.js";
import ChatInputBar from "../type_widgets/llm_chat/ChatInputBar.js";
import ChatMessage from "../type_widgets/llm_chat/ChatMessage.js";
import type { LlmChatContent } from "../type_widgets/llm_chat/llm_chat_types.js";
import { useLlmChat } from "../type_widgets/llm_chat/useLlmChat.js";
import RightPanelWidget from "./RightPanelWidget.js";

/**
 * Sidebar chat widget that appears in the right panel.
 * Uses a hidden LLM chat note for persistence across all notes.
 * The same chat persists when switching between notes.
 *
 * Unlike the LlmChat type widget which receives a valid FNote from the
 * framework, the sidebar creates notes lazily. We use useSpacedUpdate with
 * a direct server.put (using the string noteId) instead of useEditorSpacedUpdate
 * (which requires an FNote and silently no-ops when it's null).
 */
export default function SidebarChat() {
    const [chatNoteId, setChatNoteId] = useState<string | null>(null);
    const [recentChats, setRecentChats] = useState<RecentLlmChat[]>([]);
    const historyDropdownRef = useRef<BootstrapDropdown | null>(null);

    // Get the current active note context
    const { noteId: activeNoteId, note: activeNote } = useActiveNoteContext();

    // Reactively watch the chat note's title (updates via WebSocket sync after auto-rename)
    const chatNote = useNote(chatNoteId);
    const chatTitle = useNoteProperty(chatNote, "title") || t("sidebar_chat.title");

    // Refs for stable access in the spaced update callback
    const chatNoteIdRef = useRef(chatNoteId);
    chatNoteIdRef.current = chatNoteId;

    // Use shared chat hook with sidebar-specific options
    const chat = useLlmChat(
        // onMessagesChange - trigger save
        () => spacedUpdate.scheduleUpdate(),
        { defaultEnableNoteTools: true, supportsExtendedThinking: true }
    );

    const chatRef = useRef(chat);
    chatRef.current = chat;

    // Save directly via server.put using the string noteId.
    // This avoids the FNote dependency that useEditorSpacedUpdate requires.
    const spacedUpdate = useSpacedUpdate(async () => {
        const noteId = chatNoteIdRef.current;
        if (!noteId) return;

        const content = chatRef.current.getContent();
        try {
            await server.put(`notes/${noteId}/data`, {
                content: JSON.stringify(content)
            });
        } catch (err) {
            console.error("Failed to save chat:", err);
        }
    });

    // Update chat context when active note changes
    useEffect(() => {
        chat.setContextNoteId(activeNoteId ?? undefined);
    }, [activeNoteId, chat.setContextNoteId]);

    // Sync chatNoteId into the hook for auto-title generation
    useEffect(() => {
        chat.setChatNoteId(chatNoteId ?? undefined);
    }, [chatNoteId, chat.setChatNoteId]);

    // Load the most recent chat on mount (runs once)
    useEffect(() => {
        let cancelled = false;

        const loadMostRecentChat = async () => {
            try {
                const existingChat = await dateNoteService.getMostRecentLlmChat();

                if (cancelled) return;

                if (existingChat) {
                    setChatNoteId(existingChat.noteId);
                    // Load content
                    try {
                        const blob = await server.get<{ content: string }>(`notes/${existingChat.noteId}/blob`);
                        if (!cancelled && blob?.content) {
                            const parsed: LlmChatContent = JSON.parse(blob.content);
                            chatRef.current.loadFromContent(parsed);
                        }
                    } catch (err) {
                        console.error("Failed to load chat content:", err);
                    }
                } else {
                    setChatNoteId(null);
                    chatRef.current.clearMessages();
                }
            } catch (err) {
                console.error("Failed to load sidebar chat:", err);
            }
        };

        loadMostRecentChat();

        return () => {
            cancelled = true;
        };
    }, []);

    // Custom submit handler that ensures chat note exists first
    const handleSubmit = useCallback(async (e: Event) => {
        e.preventDefault();
        if (!chat.input.trim() || chat.isStreaming) return;

        // Ensure chat note exists before sending (lazy creation)
        let noteId = chatNoteId;
        if (!noteId) {
            try {
                const note = await dateNoteService.getOrCreateLlmChat();
                if (note) {
                    setChatNoteId(note.noteId);
                    noteId = note.noteId;
                }
            } catch (err) {
                console.error("Failed to create sidebar chat:", err);
                return;
            }
        }

        if (!noteId) {
            console.error("Cannot send message: no chat note available");
            return;
        }

        // Ensure the hook has the chatNoteId before submitting (state update from
        // setChatNoteId above won't be visible until next render)
        chat.setChatNoteId(noteId);

        // Delegate to shared handler
        await chat.handleSubmit(e);
    }, [chatNoteId, chat]);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    }, [handleSubmit]);

    const handleNewChat = useCallback(async () => {
        // Save any pending changes before switching
        await spacedUpdate.updateNowIfNecessary();

        try {
            const note = await dateNoteService.createLlmChat();
            if (note) {
                setChatNoteId(note.noteId);
                chatRef.current.clearMessages();
            }
        } catch (err) {
            console.error("Failed to create new chat:", err);
        }
    }, [spacedUpdate]);

    const handleSaveChat = useCallback(async () => {
        if (!chatNoteId) return;

        // Save any pending changes before moving the chat
        await spacedUpdate.updateNowIfNecessary();

        try {
            await server.post("special-notes/save-llm-chat", { llmChatNoteId: chatNoteId });
            // Create a new empty chat after saving
            const note = await dateNoteService.createLlmChat();
            if (note) {
                setChatNoteId(note.noteId);
                chatRef.current.clearMessages();
            }
        } catch (err) {
            console.error("Failed to save chat to permanent location:", err);
        }
    }, [chatNoteId, spacedUpdate]);

    const loadRecentChats = useCallback(async () => {
        try {
            const chats = await dateNoteService.getRecentLlmChats(10);
            setRecentChats(chats);
        } catch (err) {
            console.error("Failed to load recent chats:", err);
        }
    }, []);

    const handleSelectChat = useCallback(async (noteId: string) => {
        historyDropdownRef.current?.hide();

        if (noteId === chatNoteId) return;

        // Save any pending changes before switching
        await spacedUpdate.updateNowIfNecessary();

        // Load the selected chat's content
        try {
            const blob = await server.get<{ content: string }>(`notes/${noteId}/blob`);
            if (blob?.content) {
                const parsed: LlmChatContent = JSON.parse(blob.content);
                setChatNoteId(noteId);
                chatRef.current.loadFromContent(parsed);
            }
        } catch (err) {
            console.error("Failed to load selected chat:", err);
        }
    }, [chatNoteId, spacedUpdate]);

    return (
        <RightPanelWidget
            id="sidebar-chat"
            title={chatTitle}
            grow
            buttons={
                <>
                    <ActionButton
                        icon="bx bx-plus"
                        text={t("sidebar_chat.new_chat")}
                        onClick={handleNewChat}
                    />
                    <Dropdown
                        text=""
                        buttonClassName="bx bx-history"
                        title={t("sidebar_chat.history")}
                        iconAction
                        hideToggleArrow
                        dropdownContainerClassName="tn-dropdown-menu-scrollable"
                        dropdownOptions={{ popperConfig: { strategy: "fixed" } }}
                        dropdownRef={historyDropdownRef}
                        onShown={loadRecentChats}
                    >
                        {recentChats.length === 0 ? (
                            <FormListItem disabled>
                                {t("sidebar_chat.no_chats")}
                            </FormListItem>
                        ) : (
                            recentChats.map(chatItem => (
                                <FormListItem
                                    key={chatItem.noteId}
                                    icon="bx bx-message-square-dots"
                                    className={chatItem.noteId === chatNoteId ? "active" : ""}
                                    onClick={() => handleSelectChat(chatItem.noteId)}
                                >
                                    <div className="sidebar-chat-history-item-content">
                                        {chatItem.noteId === chatNoteId
                                            ? <strong>{chatItem.title}</strong>
                                            : <span>{chatItem.title}</span>}
                                        <span className="sidebar-chat-history-date">
                                            {formatDateTime(new Date(chatItem.dateModified), "short", "short")}
                                        </span>
                                    </div>
                                </FormListItem>
                            ))
                        )}
                    </Dropdown>
                    <ActionButton
                        icon="bx bx-save"
                        text={t("sidebar_chat.save_chat")}
                        onClick={handleSaveChat}
                        disabled={chat.messages.length === 0}
                    />
                </>
            }
        >
            <div className="sidebar-chat-container">
                <div className="sidebar-chat-messages" ref={chat.scrollContainerRef}>
                    {chat.messages.length === 0 && !chat.isStreaming && (
                        <NoItems
                            icon="bx bx-conversation"
                            text={t("sidebar_chat.empty_state")}
                        />
                    )}
                    {chat.messages.map(msg => (
                        <ChatMessage key={msg.id} message={msg} />
                    ))}
                    {chat.isStreaming && chat.streamingThinking && (
                        <ChatMessage
                            message={{
                                id: "streaming-thinking",
                                role: "assistant",
                                content: chat.streamingThinking,
                                createdAt: new Date().toISOString(),
                                type: "thinking"
                            }}
                            isStreaming
                        />
                    )}
                    {chat.isStreaming && chat.streamingBlocks.length > 0 && (
                        <ChatMessage
                            message={{
                                id: "streaming",
                                role: "assistant",
                                content: chat.streamingBlocks,
                                createdAt: new Date().toISOString(),
                                citations: chat.pendingCitations.length > 0 ? chat.pendingCitations : undefined
                            }}
                            isStreaming
                        />
                    )}
                    <div ref={chat.messagesEndRef} />
                </div>
                <ChatInputBar
                    chat={chat}
                    rows={2}
                    activeNoteId={activeNoteId ?? undefined}
                    activeNoteTitle={activeNote?.title}
                    onSubmit={handleSubmit}
                    onKeyDown={handleKeyDown}
                />
            </div>
        </RightPanelWidget>
    );
}
