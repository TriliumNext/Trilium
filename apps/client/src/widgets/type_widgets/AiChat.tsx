import { useEffect, useRef, useState } from "preact/hooks";
import { useEditorSpacedUpdate, useLegacyWidget } from "../react/hooks";
import { type TypeWidgetProps } from "./type_widget";
import LlmChatPanel from "../llm_chat";

export default function AiChat({ note, noteContext }: TypeWidgetProps) {
    const dataRef = useRef<object>();
    const spacedUpdate = useEditorSpacedUpdate({
        note,
        noteContext,
        getData: async () => ({
            content: JSON.stringify(dataRef.current)
        }),
        onContentChange: (newContent) => {
            try {
                dataRef.current = JSON.parse(newContent);
                llmChatPanel.refresh();
            } catch (e) {
                dataRef.current = {};
            }
        }
    });
    const [ ChatWidget, llmChatPanel ] = useLegacyWidget(() => {
        const llmChatPanel = new LlmChatPanel();
        llmChatPanel.setDataCallbacks(
            async (data) => {
                dataRef.current = data;
                spacedUpdate.scheduleUpdate();
            },
            async () => dataRef.current
        );
        return llmChatPanel;
    }, {
        noteContext,
        containerStyle: {
            height: "100%"
        }
    });

    useEffect(() => {
        llmChatPanel.setNoteId(note.noteId);
        llmChatPanel.setCurrentNoteId(note.noteId);
        console.log("Refresh!");
    }, [ note ]);

    return ChatWidget;
}
