import "./DesktopLayout.css";

import clsx from "clsx";
import { useEffect, useLayoutEffect, useMemo, useState } from "preact/hooks";

import appContext, { type EventNames } from "../components/app_context.js";
import type NoteContext from "../components/note_context.js";
import type { ParentName, WidgetsByParent } from "../services/bundle.js";
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
import { placeCustomWidgets, useCustomWidgets, useLoadCustomWidgets } from "../widgets/react/hooks/custom_widgets.js";
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
    const [ paneSlots ] = useState(() => ({ leftPane: {}, centerPane: {} }));
    // Above the launch bar, across the whole window, in the horizontal layout and wherever the window
    // controls sit on the left: the rest pane starts past the launch bar, so a tab bar there would
    // leave the controls drawn over the launch bar.
    const fullWidthTabBar = isHorizontal
        || (isElectron() && !window.glob.hasNativeTitleBar && areWindowControlsOnLeft());
    const launcherPane = (
        <div id="launcher-pane" className={orientation}>
            {!isHorizontal && <GlobalMenu isHorizontalLayout={false} />}
            <LauncherContainer isHorizontalLayout={isHorizontal} />
            {isHorizontal
                ? <GlobalMenu isHorizontalLayout={true} />
                : <LeftPaneToggle isHorizontalLayout={false} />}
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
                <LeftPane pane={leftPane} between={(gap, builtInCount) => <CustomWidgets parent="left-pane" slot={paneSlots.leftPane} gap={gap} builtInCount={builtInCount} />} />
                <div id="rest-pane">
                    {!fullWidthTabBar && <TabBar fullWidth={false} leftPaneToggle={false} />}
                    <FixedFormattingToolbar />
                    <div id="vertical-main-container">
                        <div id="center-pane">
                            <CustomWidgets parent="center-pane" slot={paneSlots.centerPane} gap={0} builtInCount={1} />
                            <NoteSplits parts={NOTE_SPLIT_PARTS} containerClassName="note-splits-host" />
                            <CustomWidgets parent="center-pane" slot={paneSlots.centerPane} gap={1} builtInCount={1} />
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

/** A split's actions end its title row, after a spacer, and its custom widgets go among its parts. */
const NOTE_SPLIT_PARTS: NoteSplitParts = {
    titleRowEnd: () => [ <SpacerWidget baseSize={0} growthFactor={1} />, <NoteActions /> ],
    between: (gap, builtInCount, split) => [
        <CustomWidgets key={gap} parent="note-detail-pane" slot={split} gap={gap} builtInCount={builtInCount} keepsRoot />
    ]
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
 * The widgets that `#widget` notes add to `parent`, once they have loaded, that go in gap `gap` of
 * the `builtInCount` built-in children of the pane, by their `position` (see `placeCustomWidgets()`).
 * The gaps of a pane or of a split share one `slot`, for which `placeSlotWidgets()` builds the
 * widgets once.
 * A legacy widget in a split gets the note context of that split. One outside the splits starts on
 * the active note context and follows it through `activeContextChanged`, as a child of `appContext`:
 * `useNoteContext()` there would take the context of any tab that switches its note, even a tab in
 * the background. The host takes no box of its own, so the widgets lay out as children of the pane.
 * An empty gap renders nothing, which keeps the built-in children adjacent, unless `keepsRoot` is
 * set: a part of a legacy container must keep its one root element, since the widgets load after
 * the container is built.
 */
function CustomWidgets({ parent, slot, gap, builtInCount, keepsRoot }: {
    parent: Exclude<ParentName, "right-pane">;
    slot: object;
    gap: number;
    builtInCount: number;
    keepsRoot?: boolean;
}) {
    const widgetsByParent = useCustomWidgets();
    const { noteContext: splitNoteContext } = useNoteContext();
    const noteContext = parent === "note-detail-pane" ? splitNoteContext : undefined;
    const widgets = useMemo(() => (widgetsByParent
        ? placeSlotWidgets(slot, widgetsByParent, parent, builtInCount)[gap] ?? []
        : []), [ widgetsByParent, slot, parent, gap, builtInCount ]);
    // A gap that mounts again builds the widgets anew, as the ones it unmounted have been cleaned up.
    useEffect(() => () => {
        placedSlotWidgets.delete(slot);
    }, [ slot ]);

    if (!widgets.length && !keepsRoot) return null;
    return (
        <div className="custom-widgets">
            {widgets.map((widget) => ("legacy" in widget
                ? <LegacyCustomWidget key={widget.legacy.componentId} widget={widget.legacy} noteContext={noteContext} />
                : <widget.preact.render key={widget.key} />
            ))}
        </div>
    );
}

type PlacedWidget = { legacy: BasicWidget } | { preact: ReturnType<WidgetsByParent["getPreactWidgets"]>[number], key: string };

/** The custom widgets of each slot, by gap, with what they were placed from. */
const placedSlotWidgets = new WeakMap<object, {
    widgetsByParent: WidgetsByParent;
    builtInCount: number;
    gaps: PlacedWidget[][];
}>();

/**
 * The custom widgets of `slot`, by gap. A legacy widget given as a class is built once per slot,
 * so that each split has its own, and its position is read from the instance.
 */
function placeSlotWidgets(slot: object, widgetsByParent: WidgetsByParent, parent: ParentName, builtInCount: number) {
    const placed = placedSlotWidgets.get(slot);
    if (placed?.widgetsByParent === widgetsByParent && placed.builtInCount === builtInCount) {
        return placed.gaps;
    }

    const legacyWidgets = widgetsByParent.getLegacyWidgets(parent)
        .map((widget) => ({ widget: { legacy: widget }, position: widget.position }));
    const preactWidgets = widgetsByParent.getPreactWidgets(parent)
        .map((widget, index) => ({ widget: { preact: widget, key: `preact-${index}` }, position: widget.position }));
    const gaps = placeCustomWidgets<PlacedWidget>([ ...legacyWidgets, ...preactWidgets ], builtInCount);
    placedSlotWidgets.set(slot, { widgetsByParent, builtInCount, gaps });
    return gaps;
}

function LegacyCustomWidget({ widget, noteContext }: { widget: BasicWidget, noteContext?: NoteContext }) {
    // The tabs can load before the widget does, which then misses their `activeContextChanged`.
    const [ activeNoteContext ] = useState(() => appContext.tabManager?.getActiveContext() ?? undefined);
    const [ el ] = useLegacyWidget(() => widget, {
        noteContext: noteContext ?? activeNoteContext,
        containerClassName: "custom-widget-host"
    });
    return el;
}
