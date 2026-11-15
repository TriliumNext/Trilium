import "./DesktopLayout.css";

import clsx from "clsx";

import type { CommandNames } from "../components/app_context.js";
import type Component from "../components/component.js";
import { areWindowControlsOnLeft, isElectron } from "../services/utils.js";
import GlobalMenu from "../widgets/buttons/global_menu.js";
import LeftPaneToggle, { LeftPanePeekButton } from "../widgets/buttons/left_pane_toggle.js";
import RightPaneToggle from "../widgets/buttons/right_pane_toggle.js";
import { LeaveFullScreenButton } from "../widgets/close_zen_button.js";
import LeftPane, { useLeftPane } from "../widgets/containers/LeftPane.js";
import LauncherContainer from "../widgets/launch_bar/LauncherContainer.js";
import { useLegacyWidget } from "../widgets/react/hooks/legacy.js";
import TabRowWidget from "../widgets/tab_row.js";
import TabHistoryNavigationButtons from "../widgets/TabHistoryNavigationButtons.js";

/** The desktop layout as a single Preact tree, which `desktop_layout.tsx` is moved into piece by piece. */
export default function DesktopLayout() {
    const isHorizontal = window.glob.layoutOrientation === "horizontal";
    const orientation = isHorizontal ? "horizontal" : "vertical";
    const leftPane = useLeftPane(isHorizontal);
    // Above the launch bar, across the whole window, in the horizontal layout and wherever the window
    // controls sit on the left: the rest pane starts past the launch bar, so a tab bar there would
    // leave the controls drawn over the launch bar.
    const fullWidthTabBar = isHorizontal
        || (isElectron() && !window.glob.hasNativeTitleBar && areWindowControlsOnLeft());
    const launcherPane = (
        <div id="launcher-pane" className={orientation}>
            {!isHorizontal && <>
                <GlobalMenu isHorizontalLayout={false} />
                <LeftPaneToggle isHorizontalLayout={false} />
            </>}
            <LauncherContainer isHorizontalLayout={isHorizontal} />
            {isHorizontal && <GlobalMenu isHorizontalLayout={true} />}
        </div>
    );

    return (
        <div id="root-widget" className={`desktop-layout ${orientation}-layout`} onClick={triggerLegacyCommand}>
            {fullWidthTabBar && <TabBar fullWidth leftPaneToggle={isHorizontal} />}
            {isHorizontal && launcherPane}
            <div
                id="horizontal-main-container"
                className={clsx(leftPane.mode !== "docked" && "left-pane-hidden")}
            >
                {!isHorizontal && launcherPane}
                <LeftPanePeekButton />
                <LeftPane pane={leftPane} />
                <div id="rest-pane">
                    {!fullWidthTabBar && <TabBar fullWidth={false} leftPaneToggle={false} />}
                </div>
            </div>
        </div>
    );
}

/** The tabs with the history buttons before them, and the full screen and right pane toggles after. */
function TabBar({ fullWidth, leftPaneToggle }: { fullWidth: boolean, leftPaneToggle: boolean }) {
    const [ tabRow ] = useLegacyWidget(() => {
        const widget = new TabRowWidget();
        return fullWidth ? widget.class("full-width") : widget;
    }, { containerClassName: "tab-row-host" });

    return (
        <div className={`tab-row-container ${fullWidth ? "full-width" : ""}`}>
            {fullWidth && <div id="tab-row-left-spacer" />}
            {leftPaneToggle && <LeftPaneToggle isHorizontalLayout={true} />}
            <TabHistoryNavigationButtons />
            {tabRow}
            <LeaveFullScreenButton />
            <RightPaneToggle />
        </div>
    );
}

/**
 * Runs the command that an element of a legacy widget names in `data-trigger-command`, from the
 * widget it belongs to, as `app_startup.ts` does for the old layout.
 */
function triggerLegacyCommand(e: MouseEvent) {
    const target = (e.target as Element).closest<HTMLElement>("[data-trigger-command]");
    if (!target || target.classList.contains("disabled")) return;

    const component = $(target).closest(".component").prop("component") as Component | undefined;
    void component?.triggerCommand(target.dataset.triggerCommand as CommandNames, { $el: $(target) });
}
