import "./ChatHighlightsList.css";

import { useContext } from "preact/hooks";

import dialog from "../../services/dialog";
import { t } from "../../services/i18n";
import ActionButton from "../react/ActionButton";
import { useFilterState } from "../react/filter";
import { useGetContextData } from "../react/hooks/tree";
import { HighlightedText } from "../react/RawHtml";
import { useOutlineFilter } from "./outline_filter";
import RightPanelWidget, { NavigatedInNote } from "./RightPanelWidget";

/**
 * Sidebar list of the user's highlights in the active AI chat. The data (and the scroll/remove
 * actions) are published by {@link useChatHighlights} into the note context; this widget only renders.
 */
export default function ChatHighlightsList() {
    const data = useGetContextData("chatHighlights");
    const highlights = data?.highlights ?? NO_HIGHLIGHTS;
    const onNavigated = useContext(NavigatedInNote);
    const tokens = useFilterState()?.tokens;

    function activate(id: string) {
        data?.scrollToHighlight(id);
        onNavigated?.();
    }

    const matches = useOutlineFilter(highlights, {
        section: "chat-highlights",
        getText: (highlight) => highlight.text,
        activate: (highlight) => activate(highlight.id)
    });
    const shown = matches ? matches.map(({ item }) => item) : highlights;

    return (
        <RightPanelWidget id="chat-highlights" title={t("llm_chat.highlights_title", { count: highlights.length })} grow>
            <div className="chat-highlights-list">
                {shown.length > 0 && (
                    <ol>
                        {shown.map(highlight => (
                            <li key={highlight.id}>
                                {/* The text is the focusable scroll target (keyboard-accessible); the ✕
                                    stays a separate button rather than nesting inside an interactive row. */}
                                <span
                                    className="chat-highlight-text"
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => activate(highlight.id)}
                                    onKeyDown={e => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            activate(highlight.id);
                                        }
                                    }}
                                >
                                    <HighlightedText
                                        text={highlight.text}
                                        highlightedTokens={tokens}
                                    />
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
                )}
                {!matches && highlights.length === 0 && (
                    <div className="no-highlights">{t("llm_chat.highlights_empty")}</div>
                )}
            </div>
        </RightPanelWidget>
    );
}

const NO_HIGHLIGHTS: never[] = [];
