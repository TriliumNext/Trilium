import "./LlmChat.css";

import { useCallback, useEffect, useRef } from "preact/hooks";

import { t } from "../../../services/i18n.js";
import { useEditorSpacedUpdate, useNoteLabelBoolean } from "../../react/hooks.js";
import { TypeWidgetProps } from "../type_widget.js";
import { useChatContextMenu } from "./chat_context_menu.js";
import { useChatHighlights } from "./chat_highlights.js";
import { useChatMessageJumps } from "./chat_message_jump.js";
import { useChatToc } from "./chat_toc.js";
import ChatInputBar from "./ChatInputBar.js";
import ChatMessageList from "./ChatMessageList.js";
import ChatReadOnlyNotice from "./ChatReadOnlyNotice.js";
import type { LlmChatContent } from "./llm_chat_types.js";
import { useLlmChat } from "./useLlmChat.js";

export default function LlmChat({ note, noteContext }: TypeWidgetProps) {
    const spacedUpdateRef = useRef<{ scheduleUpdate: () => void }>(null);

    // A `#readOnly` chat is immutable: the reply bar is replaced by a notice and every
    // mutating command is suppressed. Reactive, so toggling the label updates the UI live.
    const [readOnly] = useNoteLabelBoolean(note, "readOnly");

    const chat = useLlmChat(
        // onMessagesChange - trigger save
        () => spacedUpdateRef.current?.scheduleUpdate(),
        { defaultEnableNoteTools: false, supportsExtendedThinking: true, chatNoteId: note?.noteId }
    );

    // Keep chatNoteId in sync when the note changes
    useEffect(() => {
        chat.setChatNoteId(note?.noteId);
    }, [note?.noteId, chat.setChatNoteId]);

    // Publish a table of contents (one entry per user message) for the sidebar widget.
    useChatToc(chat, noteContext);

    // Paint user-created highlights over the replies and publish them for the sidebar widget.
    const highlights = useChatHighlights(chat, noteContext);

    // Right-click menu over the timeline, with highlights contributing their add/remove items.
    useChatContextMenu({ chat, noteContext, contextMenuItems: highlights.highlightMenuItems, readOnly });

    // Make the "Show quote source" links in submitted quotes jump to the referenced message.
    useChatMessageJumps(chat.scrollContainerRef);

    const spacedUpdate = useEditorSpacedUpdate({
        note,
        noteType: "llmChat",
        noteContext,
        getData: () => {
            const content = chat.getContent();
            return { content: JSON.stringify(content) };
        },
        onContentChange: (content) => {
            if (!content) {
                chat.clearMessages();
                return;
            }
            try {
                const parsed: LlmChatContent = JSON.parse(content);
                chat.loadFromContent(parsed);
            } catch (e) {
                console.error("Failed to parse LLM chat content:", e);
                chat.clearMessages();
            }
        }
    });
    spacedUpdateRef.current = spacedUpdate;

    const triggerSave = useCallback(() => {
        spacedUpdateRef.current?.scheduleUpdate();
    }, []);

    return (
        <div className="llm-chat-container">
            <ChatMessageList
                chat={chat}
                className="llm-chat-messages"
                emptyStateText={t("llm_chat.empty_state")}
            />
            {readOnly ? (
                <ChatReadOnlyNotice />
            ) : (
                <ChatInputBar
                    chat={chat}
                    onWebSearchChange={triggerSave}
                    onNoteToolsChange={triggerSave}
                    onExtendedThinkingChange={triggerSave}
                    onToolPermissionModeChange={triggerSave}
                    onModelChange={triggerSave}
                />
            )}
        </div>
    );
}
