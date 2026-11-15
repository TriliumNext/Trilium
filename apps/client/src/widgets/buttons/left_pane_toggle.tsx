import "./left_pane_toggle.css";

import clsx from "clsx";
import { useCallback, useContext, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import options from "../../services/options";
import { showLauncherContextMenu } from "../launch_bar/launch_bar_widgets";
import ActionButton from "../react/ActionButton";
import { useTriliumEvent } from "../react/hooks/events";
import type { PaneMode } from "../react/peek_pane";
import PeekPaneButton from "../react/PeekPaneButton";
import { ParentComponent } from "../react/react_utils";

export default function LeftPaneToggle({ isHorizontalLayout }: { isHorizontalLayout: boolean }) {
    const isDocked = useLeftPaneMode() === "docked";
    // The icon's rotation is a CSS animation, which would also play when the button mounts.
    const initiallyDocked = useRef(isDocked);
    const hasToggled = useRef(false);
    hasToggled.current ||= isDocked !== initiallyDocked.current;

    return (
        <ActionButton
            className={clsx(
                isHorizontalLayout ? "toggle-button" : "launcher-button",
                "left-pane-toggle-button",
                isDocked ? "action-collapse" : "action-expand",
                hasToggled.current && "animated"
            )}
            text={t("left_pane_toggle.toggle")}
            titlePosition={isHorizontalLayout ? "bottom" : "right"}
            triggerCommand={isDocked ? "hideLeftPane" : "showLeftPane"}
            icon={isHorizontalLayout ? "bx bx-sidebar" : "bx bx-chevrons-left"}
            onContextMenu={(e) => void showLauncherContextMenu(null, e)}
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

/** The mode `useLeftPane()` reports for the left pane. */
function useLeftPaneMode() {
    const [ mode, setMode ] = useState<PaneMode>(() => options.is("leftPaneVisible") ? "docked" : "closed");
    useTriliumEvent("paneModeChanged", (data) => {
        if (data.pane === "left") {
            setMode(data.mode);
        }
    });
    return mode;
}
