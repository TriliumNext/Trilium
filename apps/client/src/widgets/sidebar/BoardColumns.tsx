import "./BoardColumns.css";

import { t } from "../../services/i18n";
import SimpleBadge from "../react/Badge";
import { useGetContextData } from "../react/hooks";
import Icon from "../react/Icon";
import RightPanelWidget from "./RightPanelWidget";

/**
 * The board's columns, in the order it draws them, so that one of them can be reached on a board
 * too wide to see at once. The board publishes the list and the scrolling; this widget draws it.
 */
export default function BoardColumns() {
    const data = useGetContextData("boardColumns");
    const columns = data?.columns ?? [];

    return (
        <RightPanelWidget id="board-columns" title={t("board_view.columns-title")} grow>
            <div className="board-columns-list">
                {columns.length > 0 ? (
                    <ol>
                        {columns.map(column => (
                            <li key={column.value}>
                                {/* The row is the scroll target, reachable by keyboard as the
                                    other lists of the pane are. */}
                                <span
                                    className="board-column-entry"
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => data?.scrollToColumn(column.value)}
                                    onKeyDown={e => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            data?.scrollToColumn(column.value);
                                        }
                                    }}
                                >
                                    <Icon icon={column.icon} />
                                    <span className="board-column-name">{column.title}</span>
                                    <SimpleBadge title={column.count} />
                                </span>
                            </li>
                        ))}
                    </ol>
                ) : (
                    <div className="no-columns">{t("board_view.columns-empty")}</div>
                )}
            </div>
        </RightPanelWidget>
    );
}
