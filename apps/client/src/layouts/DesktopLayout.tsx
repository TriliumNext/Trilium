import "./DesktopLayout.css";

import clsx from "clsx";
import { useEffect, useLayoutEffect, useMemo } from "preact/hooks";

import appContext, { type CommandNames, type EventNames } from "../components/app_context.js";
import type Component from "../components/component.js";
import type NoteContext from "../components/note_context.js";
import { applyAppearance, applyReloadedAppearance } from "../services/appearance.js";
import type { ParentName } from "../services/bundle.js";
import { areWindowControlsOnLeft, isElectron } from "../services/utils.js";
import type BasicWidget from "../widgets/basic_widget.js";
import GlobalMenu from "../widgets/buttons/global_menu.js";
import LeftPaneToggle, { LeftPanePeekButton } from "../widgets/buttons/left_pane_toggle.js";
import RightPaneToggle from "../widgets/buttons/right_pane_toggle.js";
import CloseZenModeButton, { LeaveFullScreenButton } from "../widgets/close_zen_button.js";
import NoteList from "../widgets/collections/NoteList.js";
import FlexContainer from "../widgets/containers/flex_container.js";
import LeftPane, { useLeftPane } from "../widgets/containers/LeftPane.js";
import ScrollingContainer from "../widgets/containers/scrolling_container.js";
import SplitNoteContainer from "../widgets/containers/split_note_container.js";
import FindWidget from "../widgets/find.js";
import LauncherContainer from "../widgets/launch_bar/LauncherContainer.js";
import SpacerWidget from "../widgets/launch_bar/SpacerWidget.js";
import { FixedFormattingToolbar } from "../widgets/layout/FormattingToolbar.js";
import InlineTitle from "../widgets/layout/InlineTitle.js";
import NoteActions from "../widgets/layout/NoteActions.js";
import NoteBadges from "../widgets/layout/NoteBadges.js";
import NoteTitleActions from "../widgets/layout/NoteTitleActions.js";
import StatusBar from "../widgets/layout/StatusBar.js";
import NoteIcon from "../widgets/note_icon.js";
import NoteTitleWidget, { NoteTypeSwitcherBar } from "../widgets/note_title.js";
import NoteWrapperWidget from "../widgets/note_wrapper.js";
import NoteDetail from "../widgets/NoteDetail.js";
import { useCustomWidgets, useLoadCustomWidgets } from "../widgets/react/hooks/custom_widgets.js";
import { useTriliumEvent } from "../widgets/react/hooks/events.js";
import { useLegacyWidget } from "../widgets/react/hooks/legacy.js";
import { useTriliumOption } from "../widgets/react/hooks/options.js";
import { useNoteContext } from "../widgets/react/hooks/note_context.js";
import ScrollPadding from "../widgets/scroll_padding.js";
import RightPanelContainer from "../widgets/sidebar/RightPanelContainer.js";
import TabRowWidget from "../widgets/tab_row.js";
import TabHistoryNavigationButtons from "../widgets/TabHistoryNavigationButtons.js";
import { LazyDialog, Modals, SearchResults } from "./layout_commons.js";

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
                            <NoteSplits />
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

/**
 * Applies the appearance options to the body before the first paint, and again whenever they are
 * reloaded; see `applyAppearance()`.
 */
function useAppearance() {
    useLayoutEffect(applyAppearance, []);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => applyReloadedAppearance(loadResults));
}

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
 * One note split per note context of the active tab, each with a title row (the note's icon, its
 * compact title, its badges and its actions) above the note's inline title, title actions,
 * content, list of child notes, search results and scroll padding, then the bar that picks the type
 * of an empty note, the find bar and the custom widgets of the split.
 */
function NoteSplits() {
    const [ splits ] = useLegacyWidget(() => new SplitNoteContainer(() =>
        new NoteWrapperWidget()
            .child(new FlexContainer("row")
                .class("title-row note-split-title")
                .cssBlock(".title-row > * { margin: 5px; }")
                .child(<NoteIcon />)
                .child(<NoteTitleWidget placement="split" />)
                .child(<NoteBadges />)
                .child(<SpacerWidget baseSize={0} growthFactor={1} />)
                .child(<NoteActions />))
            .child(new ScrollingContainer()
                .filling()
                .child(<InlineTitle />)
                .child(<NoteTitleActions />)
                .child(<NoteDetail />)
                .child(<NoteList media="screen" />)
                .child(<SearchResults />)
                .child(<ScrollPadding />))
            .child(<NoteTypeSwitcherBar />)
            .child(new FindWidget())
            .child(<CustomWidgets parent="note-detail-pane" />)
    ), { containerClassName: "note-splits-host" });
    return splits;
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

/**
 * Runs the command that an element of a legacy widget names in `data-trigger-command`, from the
 * widget it belongs to, as `app_startup.ts` does for the mobile layout.
 */
function triggerLegacyCommand(e: MouseEvent) {
    const target = (e.target as Element).closest<HTMLElement>("[data-trigger-command]");
    if (!target || target.classList.contains("disabled")) return;

    const component = $(target).closest(".component").prop("component") as Component | undefined;
    void component?.triggerCommand(target.dataset.triggerCommand as CommandNames, { $el: $(target) });
}
