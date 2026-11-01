import "./ChatHighlightsList.css";

import dialog from "../../services/dialog";
import { t } from "../../services/i18n";
import ActionButton from "../react/ActionButton";
import { useGetContextData } from "../react/hooks";
import RightPanelWidget from "./RightPanelWidget";

/**
 * Sidebar list of the user's highlights in the active AI chat. The data (and the scroll/remove
 * actions) are published by {@link useChatHighlights} into the note context; this widget only renders.
 */
export default function ChatHighlightsList() {
    const data = useGetContextData("chatHighlights");
    const highlights = data?.highlights ?? [];

    return (
        <RightPanelWidget id="chat-highlights" title={t("llm_chat.highlights_title", { count: highlights.length })} grow>
            <div className="chat-highlights-list">
                {highlights.length > 0 ? (
                    <ol>
                        {highlights.map(highlight => (
                            <li key={highlight.id}>
                                {/* The text is the focusable scroll target (keyboard-accessible); the ✕
                                    stays a separate button rather than nesting inside an interactive row. */}
                                <span
                                    className="chat-highlight-text"
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => data?.scrollToHighlight(highlight.id)}
                                    onKeyDown={e => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            data?.scrollToHighlight(highlight.id);
                                        }
                                    }}
                                >
                                    {highlight.text}
                                </span>
                                <ActionButton
                                    className="chat-highlight-remove"
                                    icon="bx bx-x"
                                    text={t("llm_chat.highlight_remove")}
                                    onClick={e => {
                                        // Confirm here only: the list's small ✕ is easy to hit by accident,
                                        // unlike the deliberate right-click "Remove highlight" on the text itself.
                                        e.stopPropagation();
                                        void (async () => {
                                            if (await dialog.confirm(t("llm_chat.highlight_remove_confirm"))) {
                                                data?.removeHighlight(highlight.id);
                                            }
                                        })();
                                    }}
                                />
                            </li>
                        ))}
                    </ol>
                ) : (
                    <div className="no-highlights">{t("llm_chat.highlights_empty")}</div>
                )}
            </div>
        </RightPanelWidget>
    );
}
