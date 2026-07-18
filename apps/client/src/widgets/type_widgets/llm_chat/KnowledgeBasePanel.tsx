import "./KnowledgeBasePanel.css";

import { useState, useCallback, useEffect, useRef } from "preact/hooks";

import froca from "../../../services/froca.js";
import { t } from "../../../services/i18n.js";
import NoteAutocomplete from "../../react/NoteAutocomplete.js";

interface KnowledgeBasePanelProps {
    /** Note IDs currently selected as knowledge base sources */
    sourceNoteIds: string[];
    /** Add a note to the knowledge base */
    onAddSource: (noteId: string) => void;
    /** Remove a note from the knowledge base */
    onRemoveSource: (noteId: string) => void;
    /** Disable interactions while a response is streaming */
    disabled?: boolean;
}

/**
 * Panel shown above the chat input when knowledge base mode is enabled.
 * Lets the user pick notes (as chips) that ground the AI's answers.
 */
export default function KnowledgeBasePanel({ sourceNoteIds, onAddSource, onRemoveSource, disabled }: KnowledgeBasePanelProps) {
    const [sourceTitles, setSourceTitles] = useState<Record<string, string>>({});
    const autocompleteContainerRef = useRef<HTMLDivElement>(null);

    // Resolve note titles for source note chips
    useEffect(() => {
        const ids = sourceNoteIds.filter(id => !sourceTitles[id]);
        if (ids.length === 0) return;

        Promise.all(ids.map(id => froca.getNote(id, true))).then(notes => {
            const newTitles: Record<string, string> = {};
            for (let i = 0; i < ids.length; i++) {
                newTitles[ids[i]] = notes[i]?.title ?? ids[i];
            }
            setSourceTitles(prev => ({ ...prev, ...newTitles }));
        });
    }, [sourceNoteIds]);

    const handleAddSourceNote = useCallback((noteId: string) => {
        if (noteId) {
            onAddSource(noteId);
        }
    }, [onAddSource]);

    return (
        <div className="llm-chat-kb-sources">
            <div className="llm-chat-kb-header">
                <span className="bx bx-book-open" />
                <span>{t("llm_chat.knowledge_base_sources")}</span>
            </div>
            <div className="llm-chat-kb-chips">
                {sourceNoteIds.map(noteId => (
                    <span key={noteId} className="llm-chat-kb-chip">
                        <span className="llm-chat-kb-chip-title">{sourceTitles[noteId] ?? noteId}</span>
                        <button
                            type="button"
                            className="llm-chat-kb-chip-remove"
                            onClick={() => onRemoveSource(noteId)}
                            disabled={disabled}
                            title={t("llm_chat.knowledge_base_remove")}
                        >
                            <span className="bx bx-x" />
                        </button>
                    </span>
                ))}
            </div>
            <div className="llm-chat-kb-autocomplete-wrapper" ref={autocompleteContainerRef}>
                <NoteAutocomplete
                    placeholder={t("llm_chat.knowledge_base_add")}
                    noteIdChanged={handleAddSourceNote}
                    container={autocompleteContainerRef}
                    opts={{ closeOnBlur: true }}
                />
            </div>
        </div>
    );
}
