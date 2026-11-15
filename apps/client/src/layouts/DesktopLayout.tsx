import "./DesktopLayout.css";

import { areWindowControlsOnLeft, isElectron } from "../services/utils.js";
import GlobalMenu from "../widgets/buttons/global_menu.js";
import RightPaneToggle from "../widgets/buttons/right_pane_toggle.js";
import { LeaveFullScreenButton } from "../widgets/close_zen_button.js";
import LauncherContainer from "../widgets/launch_bar/LauncherContainer.js";
import { useLegacyWidget } from "../widgets/react/hooks/legacy.js";
import TabRowWidget from "../widgets/tab_row.js";
import TabHistoryNavigationButtons from "../widgets/TabHistoryNavigationButtons.js";

/** The desktop layout as a single Preact tree, which `desktop_layout.tsx` is moved into piece by piece. */
export default function DesktopLayout() {
    const isHorizontal = window.glob.layoutOrientation === "horizontal";
    const orientation = isHorizontal ? "horizontal" : "vertical";
    // Above the launch bar, across the whole window, in the horizontal layout and wherever the window
    // controls sit on the left: the rest pane starts past the launch bar, so a tab bar there would
    // leave the controls drawn over the launch bar.
    const fullWidthTabBar = isHorizontal
        || (isElectron() && !window.glob.hasNativeTitleBar && areWindowControlsOnLeft());
    const launcherPane = (
        <div id="launcher-pane" className={orientation}>
            {!isHorizontal && <GlobalMenu isHorizontalLayout={false} />}
            <LauncherContainer isHorizontalLayout={isHorizontal} />
            {isHorizontal && <GlobalMenu isHorizontalLayout={true} />}
        </div>
    );

    return (
        <div id="root-widget" className={`desktop-layout ${orientation}-layout`}>
            {fullWidthTabBar && <TabBar fullWidth />}
            {isHorizontal && launcherPane}
            <div id="horizontal-main-container">
                {!isHorizontal && launcherPane}
                <div id="rest-pane">
                    {!fullWidthTabBar && <TabBar fullWidth={false} />}
                </div>
            </div>
        </div>
    );
}

/** The tabs with the history buttons before them, and the full screen and right pane toggles after. */
function TabBar({ fullWidth }: { fullWidth: boolean }) {
    const [ tabRow ] = useLegacyWidget(() => {
        const widget = new TabRowWidget();
        return fullWidth ? widget.class("full-width") : widget;
    }, { containerClassName: "tab-row-host" });

    return (
        <div className={`tab-row-container ${fullWidth ? "full-width" : ""}`}>
            {fullWidth && <div id="tab-row-left-spacer" />}
            <TabHistoryNavigationButtons />
            {tabRow}
            <LeaveFullScreenButton />
            <RightPaneToggle />
        </div>
    );
}
