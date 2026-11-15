import "./DesktopLayout.css";

import clsx from "clsx";
import { useEffect, useLayoutEffect, useMemo } from "preact/hooks";

import appContext, { type EventNames } from "../components/app_context.js";
import type NoteContext from "../components/note_context.js";
import type { ParentName } from "../services/bundle.js";
import { areWindowControlsOnLeft, isElectron } from "../services/utils.js";
import type BasicWidget from "../widgets/basic_widget.js";
import GlobalMenu from "../widgets/buttons/global_menu.js";
import LeftPaneToggle, { LeftPanePeekButton } from "../widgets/buttons/left_pane_toggle.js";
import RightPaneToggle from "../widgets/buttons/right_pane_toggle.js";
import CloseZenModeButton, { LeaveFullScreenButton } from "../widgets/close_zen_button.js";
import LeftPane, { useLeftPane } from "../widgets/containers/LeftPane.js";
import LauncherContainer from "../widgets/launch_bar/LauncherContainer.js";
import SpacerWidget from "../widgets/launch_bar/SpacerWidget.js";
import { FixedFormattingToolbar } from "../widgets/layout/FormattingToolbar.js";
import NoteActions from "../widgets/layout/NoteActions.js";
import StatusBar from "../widgets/layout/StatusBar.js";
import { useCustomWidgets, useLoadCustomWidgets } from "../widgets/react/hooks/custom_widgets.js";
import { useLegacyWidget } from "../widgets/react/hooks/legacy.js";
import { useTriliumOption } from "../widgets/react/hooks/options.js";
import { useNoteContext } from "../widgets/react/hooks/note_context.js";
import RightPanelContainer from "../widgets/sidebar/RightPanelContainer.js";
import TabRowWidget from "../widgets/tab_row.js";
import TabHistoryNavigationButtons from "../widgets/TabHistoryNavigationButtons.js";
import { LazyDialog, Modals, NoteSplits, type NoteSplitParts, triggerLegacyCommand, useAppearance } from "./layout_commons.js";

/** The desktop layout, as a single Preact tree. */
export default function DesktopLayout() {
    const [ layoutOrientation ] = useTriliumOption("layoutOrientation");
    const isHorizontal = layoutOrientation === "horizontal";
    const orientation = isHorizontal ? "horizontal" : "vertical";
    // `index.ts` sets the class at startup; it follows a change of the option from then on.
    useLayoutEffect(() => {
        document.body.classList.toggle("layout-horizontal", isHorizontal);
        document.body.classList.toggle("layout-vertical", !isHorizontal);
    }, [ isHorizontal ]);
    const leftPane = useLeftPane(isHorizontal);
    useAppearance();
    const widgetsByParent = useCustomWidgets();
    useLoadCustomWidgets();
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
                <LeftPane pane={leftPane}>
                    <CustomWidgets parent="left-pane" />
                </LeftPane>
                <div id="rest-pane">
                    {!fullWidthTabBar && <TabBar fullWidth={false} leftPaneToggle={false} />}
                    <FixedFormattingToolbar />
                    <div id="vertical-main-container">
                        <div id="center-pane">
                            <NoteSplits parts={NOTE_SPLIT_PARTS} containerClassName="note-splits-host" />
                            <CustomWidgets parent="center-pane" />
                        </div>
                        <RightPanelContainer widgetsByParent={widgetsByParent} />
                    </div>
                    {!isHorizontal && <StatusBar />}
                </div>
            </div>
            {isHorizontal && <StatusBar />}
            <CloseZenModeButton />
            <LazyDialog triggerEvents={PASSWORD_NOT_SET_EVENTS} loader={loadPasswordNotSetDialog} />
            <Modals />
        </div>
    );
}

/** A split's actions end its title row, after a spacer, and its custom widgets follow the find bar. */
const NOTE_SPLIT_PARTS: NoteSplitParts = {
    titleRowEnd: () => [ <SpacerWidget baseSize={0} growthFactor={1} />, <NoteActions /> ],
    afterFind: () => [ <CustomWidgets parent="note-detail-pane" /> ]
};

const PASSWORD_NOT_SET_EVENTS: EventNames[] = [ "showPasswordNotSet" ];
const loadPasswordNotSetDialog = () => import("../widgets/dialogs/password_not_set.js");

/** The tabs with the history buttons before them, and the full screen and right pane toggles after. */
function TabBar({ fullWidth, leftPaneToggle }: { fullWidth: boolean, leftPaneToggle: boolean }) {
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
            <RightPaneToggle />
        </div>
    );
}


/**
 * The widgets that `#widget` notes add to `parent`, once they have loaded. A legacy widget gets the
 * note context of the split it is in, if any. The host takes no box of its own, so the widgets lay
 * out as children of the pane, and keeps one root element, which the legacy widget adapter requires.
 */
function CustomWidgets({ parent }: { parent: Exclude<ParentName, "right-pane"> }) {
    const widgetsByParent = useCustomWidgets();
    const { noteContext } = useNoteContext();
    // A legacy widget given as a class is built once per slot, so that each split has its own.
    const legacyWidgets = useMemo(() => widgetsByParent?.getLegacyWidgets(parent) ?? [], [ widgetsByParent, parent ]);
    const preactWidgets = widgetsByParent?.getPreactWidgets(parent) ?? [];

    return (
        <div className="custom-widgets">
            {legacyWidgets.map((widget) => (
                <LegacyCustomWidget key={widget.componentId} widget={widget} noteContext={noteContext} />
            ))}
            {preactWidgets.map((widget, index) => <widget.render key={index} />)}
        </div>
    );
}

function LegacyCustomWidget({ widget, noteContext }: { widget: BasicWidget, noteContext?: NoteContext }) {
    const [ el ] = useLegacyWidget(() => widget, { noteContext, containerClassName: "custom-widget-host" });
    return el;
}
