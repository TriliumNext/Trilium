import "./LlmChat.css";

import { useCallback, useEffect, useRef } from "preact/hooks";

import { t } from "../../../services/i18n.js";
import { useEditorSpacedUpdate } from "../../react/hooks.js";
import { TypeWidgetProps } from "../type_widget.js";
import ChatInputBar from "./ChatInputBar.js";
import ChatMessageList from "./ChatMessageList.js";
import type { LlmChatContent } from "./llm_chat_types.js";
import { useLlmChat } from "./useLlmChat.js";

export default function LlmChat({ note, ntxId, noteContext }: TypeWidgetProps) {
    const spacedUpdateRef = useRef<{ scheduleUpdate: () => void }>(null);

    const chat = useLlmChat(
        // onMessagesChange - trigger save
        () => spacedUpdateRef.current?.scheduleUpdate(),
        { defaultEnableNoteTools: false, supportsExtendedThinking: true, chatNoteId: note?.noteId }
    );

    // Keep chatNoteId in sync when the note changes
    useEffect(() => {
        chat.setChatNoteId(note?.noteId);
    }, [note?.noteId, chat.setChatNoteId]);

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
            <ChatInputBar
                chat={chat}
                onWebSearchChange={triggerSave}
                onNoteToolsChange={triggerSave}
                onExtendedThinkingChange={triggerSave}
                onModelChange={triggerSave}
            />
        </div>
    );
}
