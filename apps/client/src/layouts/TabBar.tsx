import "./TabBar.css";

import { useEffect } from "preact/hooks";

import appContext from "../components/app_context.js";
import LeftPaneToggle from "../widgets/buttons/left_pane_toggle.js";
import RightPaneToggle from "../widgets/buttons/right_pane_toggle.js";
import { LeaveFullScreenButton } from "../widgets/close_zen_button.js";
import { useLegacyWidget } from "../widgets/react/hooks/legacy.js";
import TabRowWidget from "../widgets/tab_row.js";
import TabHistoryNavigationButtons from "../widgets/TabHistoryNavigationButtons.js";

/**
 * The tabs with the history buttons before them, and the full screen and right pane toggles after.
 * The desktop layout shows it, and so does a tablet's mobile layout, which has no right pane.
 */
export default function TabBar({ fullWidth, leftPaneToggle, rightPaneToggle = true }: {
    fullWidth: boolean;
    leftPaneToggle: boolean;
    rightPaneToggle?: boolean;
}) {
    const [ tabRow, tabRowWidget ] = useLegacyWidget(() => {
        const widget = new TabRowWidget();
        return fullWidth ? widget.class("full-width") : widget;
    }, { containerClassName: "tab-row-host" });
    // A change of orientation moves the tab bar, and the tab row it builds anew takes the tabs.
    useEffect(() => {
        if (appContext.tabManager?.tabsRestored) {
            void tabRowWidget.showExistingTabs();
        }
    }, [ tabRowWidget ]);

    return (
        <div className={`tab-row-container ${fullWidth ? "full-width" : ""}`}>
            {fullWidth && <div id="tab-row-left-spacer" />}
            {leftPaneToggle && <LeftPaneToggle isHorizontalLayout={true} />}
            <TabHistoryNavigationButtons />
            {tabRow}
            <LeaveFullScreenButton />
            {rightPaneToggle && <RightPaneToggle />}
        </div>
    );
}
