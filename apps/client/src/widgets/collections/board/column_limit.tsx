import "./column_limit.css";

import { useEffect, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import Button from "../../react/Button";
import FormTextBox from "../../react/FormTextBox";
import FormToggle from "../../react/FormToggle";
import Modal from "../../react/Modal";
import BoardApi from "./api";

const DEFAULT_LIMIT = 5;

/**
 * Asks how many cards a column is meant to hold.
 *
 * The switch disables the limit, rather than a value such as 0 or -1 standing for "no limit".
 */
export default function ColumnLimitDialog({ api, column, onClose }: {
    api: BoardApi,
    /** The column being given a limit, or nothing while the dialog is not being asked for. */
    column?: string,
    onClose: () => void
}) {
    const stored = column !== undefined ? api.getColumnLimit(column) : undefined;
    const [ isLimited, setIsLimited ] = useState(stored !== undefined);
    const [ limit, setLimit ] = useState(stored ?? DEFAULT_LIMIT);

    // The dialog is kept mounted and opened by naming a column, so what it shows is read again
    // each time it is opened rather than only when it is first drawn.
    useEffect(() => {
        setIsLimited(stored !== undefined);
        setLimit(stored ?? DEFAULT_LIMIT);
    }, [ column, stored ]);

    return (
        <Modal
            className="board-column-limit-dialog"
            title={t("board_view.set-limit")}
            size="md"
            // Raised the way every dialog opened from a context menu is: the menu's own backdrop
            // stands above the stock modal layer, and would otherwise cover this.
            zIndex={2000}
            show={column !== undefined}
            onSubmit={() => {
                if (column !== undefined) {
                    api.setColumnLimit(column, isLimited ? limit : undefined);
                }
                onClose();
            }}
            onHidden={onClose}
            footer={<>
                <Button text={t("modal.cancel")} onClick={onClose} />
                <Button
                    text={t("board_view.set-limit-ok")}
                    keyboardShortcut="Enter"
                    kind="primary"
                />
            </>}
        >
            <div className="board-column-limit-fields">
                {/* Labelled here, not through the switch: its own label sits inside the
                    switch and would fall outside the grid. */}
                <label for="board-column-limit-toggle">{t("board_view.limit-capacity")}</label>
                <FormToggle
                    id="board-column-limit-toggle"
                    currentValue={isLimited}
                    onChange={setIsLimited}
                />

                <label for="board-column-limit-count">{t("board_view.limit-count")}</label>
                <FormTextBox
                    id="board-column-limit-count"
                    className="board-column-limit-count"
                    type="number"
                    min={1}
                    disabled={!isLimited}
                    currentValue={String(limit)}
                    onChange={(value) => setLimit(Math.max(1, parseInt(value, 10) || 1))}
                />
            </div>
        </Modal>
    );
}
