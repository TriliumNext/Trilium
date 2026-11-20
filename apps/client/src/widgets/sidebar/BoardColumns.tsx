import "./BoardColumns.css";

import { useContext } from "preact/hooks";

import { t } from "../../services/i18n";
import SimpleBadge from "../react/Badge";
import { useFilterState } from "../react/filter";
import { useGetContextData } from "../react/hooks/tree";
import Icon from "../react/Icon";
import { HighlightedText } from "../react/RawHtml";
import { useOutlineFilter } from "./outline_filter";
import RightPanelWidget, { NavigatedInNote } from "./RightPanelWidget";

/**
 * The board's columns, in the order it draws them, so that one of them can be reached on a board
 * too wide to see at once. The board publishes the list and the scrolling; this widget draws it.
 */
export default function BoardColumns() {
    const data = useGetContextData("boardColumns");
    const columns = data?.columns ?? NO_COLUMNS;
    const onNavigated = useContext(NavigatedInNote);
    const tokens = useFilterState()?.tokens;

    function activate(value: string) {
        data?.scrollToColumn(value);
        onNavigated?.();
    }

    const matches = useOutlineFilter(columns, {
        section: "board-columns",
        getText: (column) => column.title,
        activate: (column) => activate(column.value)
    });
    const shown = matches ? matches.map(({ item }) => item) : columns;

    return (
        <RightPanelWidget id="board-columns" title={t("board_view.columns-title")} grow>
            <div className="board-columns-list">
                {shown.length > 0 && (
                    <ol>
                        {shown.map(column => (
                            <li key={column.value}>
                                {/* The row is the scroll target, reachable by keyboard as the
                                    other lists of the pane are. */}
                                <span
                                    className="board-column-entry"
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => activate(column.value)}
                                    onKeyDown={e => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            activate(column.value);
                                        }
                                    }}
                                >
                                    <Icon icon={column.icon} />
                                    <HighlightedText
                                        className="board-column-name"
                                        text={column.title}
                                        highlightedTokens={tokens}
                                    />
                                    <SimpleBadge title={column.count} />
                                </span>
                            </li>
                        ))}
                    </ol>
                )}
                {!matches && columns.length === 0 && (
                    <div className="no-columns">{t("board_view.columns-empty")}</div>
                )}
            </div>
        </RightPanelWidget>
    );
}

const NO_COLUMNS: never[] = [];
