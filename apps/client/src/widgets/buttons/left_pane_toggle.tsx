import "./left_pane_toggle.css";

import clsx from "clsx";
import { useCallback, useContext, useState } from "preact/hooks";

import { showLaunchBarManagementContextMenu } from "../../menus/launcher_button_context_menu";
import { t } from "../../services/i18n";
import options from "../../services/options";
import ActionButton from "../react/ActionButton";
import { useTriliumEvent } from "../react/hooks";
import type { PaneMode } from "../react/peek_pane";
import PeekPaneButton from "../react/PeekPaneButton";
import { ParentComponent } from "../react/react_utils";

export default function LeftPaneToggle({ isHorizontalLayout }: { isHorizontalLayout: boolean }) {
    const isDocked = useLeftPaneMode() === "docked";

    return (
        <ActionButton
            className={clsx(
                isHorizontalLayout ? "toggle-button" : "launcher-button",
                "left-pane-toggle-button",
                isDocked ? "action-collapse" : "action-expand"
            )}
            text={t("left_pane_toggle.toggle")}
            titlePosition={isHorizontalLayout ? "bottom" : "right"}
            triggerCommand={isDocked ? "hideLeftPane" : "showLeftPane"}
            icon={isHorizontalLayout ? "bx bx-sidebar" : "bx bx-chevrons-left"}
            onContextMenu={showLaunchBarManagementContextMenu}
        />
    );
}

/**
 * The edge button that peeks the note tree over the content. It runs along the window's start edge
 * in the horizontal layout, and beside `#launcher-pane` in the vertical one.
 */
export function LeftPanePeekButton() {
    const mode = useLeftPaneMode();
    const parentComponent = useContext(ParentComponent);
    const peek = useCallback(() => parentComponent?.triggerCommand("peekLeftPane"), [ parentComponent ]);

    return (
        <PeekPaneButton
            side="start"
            className="left-pane-peek-button"
            isOpen={mode !== "closed"}
            onToggle={peek}
            hideText={t("left_pane_toggle.hide_panel")}
            peekText={t("left_pane_toggle.peek_panel")}
            keyboardAction="peekLeftPane"
        />
    );
}

/** The mode `LeftPaneContainer` reports for the left pane. */
function useLeftPaneMode() {
    const [ mode, setMode ] = useState<PaneMode>(() => options.is("leftPaneVisible") ? "docked" : "closed");
    useTriliumEvent("paneModeChanged", (data) => {
        if (data.pane === "left") {
            setMode(data.mode);
        }
    });
    return mode;
}
