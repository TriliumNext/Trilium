import "./selection_bar.css";

import { type ComponentChildren } from "preact";

import { t } from "../../../services/i18n";
import { isMobile } from "../../../services/utils";
import ActionButton from "../../react/ActionButton";

interface BoardHeaderToolsProps {
    /** The grouping and the filter, after the toggle, which the selection bar covers meanwhile. */
    children: ComponentChildren;
    isSelecting: boolean;
    onToggleSelecting: () => void;
    /** How many cards are picked out. */
    count: number;
    /** Whether a column can be selected whole, which needs a picked card to name it. */
    canSelectColumn: boolean;
    onSelectColumn: () => void;
    /** Drops the selection and ends selection mode, the bar covering the button that started it. */
    onReset: () => void;
}

/**
 * The trailing end of the board's header: the grouping and the filter, and on mobile the button
 * that starts selection mode, where a tap picks a card out instead of opening it. While the mode
 * lasts a bar stands over all of it, with the count and what can be done with the selection.
 */
export default function BoardHeaderTools({
    children, isSelecting, onToggleSelecting, count, canSelectColumn, onSelectColumn, onReset
}: BoardHeaderToolsProps) {
    return (
        <div className="board-header-tools">
            {isMobile() && (
                <ActionButton
                    className="board-selection-toggle"
                    icon="bx bx-select-multiple"
                    text={t("board_view.selection-mode")}
                    active={isSelecting}
                    noTooltipOnTouch
                    onClick={onToggleSelecting}
                />
            )}
            {children}
            {isMobile() && isSelecting && (
                <div className="board-selection-bar" role="toolbar">
                    <span className="board-selection-count">
                        {t("board_view.cards-selected", { count })}
                    </span>
                    <ActionButton
                        icon="bx bx-list-check"
                        text={t("board_view.select-column-cards")}
                        disabled={!canSelectColumn}
                        noTooltipOnTouch
                        onClick={onSelectColumn}
                    />
                    <ActionButton
                        icon="bx bx-x"
                        text={t("board_view.reset-selection")}
                        noTooltipOnTouch
                        onClick={onReset}
                    />
                </div>
            )}
        </div>
    );
}
