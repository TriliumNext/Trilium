import "./DesktopLayout.css";

import clsx from "clsx";
import { useLayoutEffect } from "preact/hooks";

import type { CommandNames, EventNames } from "../components/app_context.js";
import type Component from "../components/component.js";
import { applyAppearance, applyReloadedAppearance } from "../services/appearance.js";
import { areWindowControlsOnLeft, isElectron } from "../services/utils.js";
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
import { useTriliumEvent } from "../widgets/react/hooks/events.js";
import { useLegacyWidget } from "../widgets/react/hooks/legacy.js";
import { useNoteProperty } from "../widgets/react/hooks/note.js";
import { useNoteContext } from "../widgets/react/hooks/note_context.js";
import { WithLazyModule } from "../widgets/react/LazyComponent.js";
import ScrollPadding from "../widgets/scroll_padding.js";
import RightPanelContainer from "../widgets/sidebar/RightPanelContainer.js";
import TabRowWidget from "../widgets/tab_row.js";
import TabHistoryNavigationButtons from "../widgets/TabHistoryNavigationButtons.js";
import { LazyDialog, Modals } from "./layout_commons.js";

/** The desktop layout as a single Preact tree, which `desktop_layout.tsx` is moved into piece by piece. */
export default function DesktopLayout() {
    const isHorizontal = window.glob.layoutOrientation === "horizontal";
    const orientation = isHorizontal ? "horizontal" : "vertical";
    const leftPane = useLeftPane(isHorizontal);
    useAppearance();
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
                    <FixedFormattingToolbar />
                    <div id="vertical-main-container">
                        <div id="center-pane">
                            <NoteSplits />
                        </div>
                        <RightPanelContainer />
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
 * One note split per note context of the active tab, each with a title row (the note's icon, its
 * compact title, its badges and its actions) above the note's inline title, title actions,
 * content, list of child notes, search results and scroll padding, then the bar that picks the type
 * of an empty note and the find bar.
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
    ), { containerClassName: "note-splits-host" });
    return splits;
}

const loadSearchResult = () => import("../widgets/search_result.js");

/**
 * The results of a search note, whose module loads once a search note shows. The host keeps one
 * root element, which the legacy widget adapter requires, and takes no box of its own.
 */
function SearchResults() {
    const { note } = useNoteContext();
    const noteType = useNoteProperty(note, "type");

    return (
        <div className="search-result-host">
            {noteType === "search" && (
                <WithLazyModule load={loadSearchResult}>
                    {({ default: SearchResult }) => <SearchResult />}
                </WithLazyModule>
            )}
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
