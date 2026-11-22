import "./MobileLayout.css";
import "./MobileLayout.phone.css";
import "./MobileLayout.tablet.css";

import clsx from "clsx";
import { useLayoutEffect, useRef } from "preact/hooks";

import { NARROW_LAYOUT, STACKED_TREE_LAYOUT } from "../services/utils.js";
import GlobalMenu from "../widgets/buttons/global_menu.js";
import CloseZenModeButton from "../widgets/close_zen_button.js";
import LauncherContainer from "../widgets/launch_bar/LauncherContainer.js";
import HideKeyboardButton from "../widgets/mobile_widgets/hide_keyboard_button.js";
import MobileDetailMenu from "../widgets/mobile_widgets/mobile_detail_menu.js";
import MobileNotePanel from "../widgets/mobile_widgets/MobileNotePanel.js";
import MobileSidebar from "../widgets/mobile_widgets/MobileSidebar.js";
import ToggleSidebarButton from "../widgets/mobile_widgets/toggle_sidebar_button.js";
import { trackVirtualKeyboard } from "../widgets/mobile_widgets/virtual_keyboard.js";
import { useCustomWidgets, useLoadCustomWidgets } from "../widgets/react/hooks/custom_widgets.js";
import { useMediaQuery } from "../widgets/react/hooks/dom.js";
import { useLazyModule } from "../widgets/react/LazyComponent.js";
import MobileEditorToolbar from "../widgets/type_widgets/text/mobile_editor_toolbar.js";
import { Modals, NoteSplits, type NoteSplitParts, triggerLegacyCommand, useAppearance } from "./layout_commons.js";

/**
 * The mobile layout, as a single Preact tree. A phone shows the launch bar at the bottom of the
 * screen. A tablet shows the desktop's tab bar: in portrait across the top of the screen, with
 * the launch bar at the bottom as on a phone; in landscape above the notes, with the launch bar
 * as a rail on the start edge. Either way the tree is docked beside the notes, with its toggle in
 * the launch bar, and the desktop's right pane peeks over the notes from the end edge.
 */
export default function MobileLayout() {
    const rootRef = useRef<HTMLDivElement>(null);
    const isPhone = useMediaQuery(NARROW_LAYOUT);
    const isTreeStacked = useMediaQuery(STACKED_TREE_LAYOUT);
    // `isTablet()`, which this layout follows as a foldable folds.
    const tablet = !isTreeStacked;
    useAppearance();
    useLayoutEffect(() => (rootRef.current ? trackVirtualKeyboard(rootRef.current) : undefined), []);
    // On `body` too, for the dialogs and menus portaled outside the layout.
    useLayoutEffect(() => {
        document.body.classList.toggle("tablet", tablet);
    }, [ tablet ]);
    useLoadCustomWidgets();

    return (
        <div
            ref={rootRef}
            id="root-widget"
            className={clsx(
                "mobile-layout",
                isPhone ? "horizontal-layout" : "vertical-layout",
                tablet && "tablet"
            )}
            onClick={triggerLegacyCommand}
        >
            {tablet && isPhone && <LazyTabBar fullWidth />}
            <div id="mobile-rest-container">
                {!isPhone && (
                    <div id="launcher-pane" className="vertical">
                        <GlobalMenu isHorizontalLayout={false} />
                        <LauncherContainer isHorizontalLayout={false} />
                        <LazyLeftPaneToggle />
                    </div>
                )}
                <MobileSidebar />
                <div id="mobile-rest-pane">
                    {!isPhone && <LazyTabBar fullWidth={false} />}
                    <NoteSplits parts={NOTE_SPLIT_PARTS} containerId="detail-container" />
                </div>
                {tablet && <LazyRightPanel />}
            </div>
            {isPhone && (
                <div id="mobile-bottom-bar">
                    <div id="launcher-pane" className="horizontal">
                        {!isTreeStacked && <LazyLeftPaneToggle />}
                        <LauncherContainer isHorizontalLayout={true} />
                        <GlobalMenu isHorizontalLayout={true} />
                    </div>
                </div>
            )}
            <CloseZenModeButton />
            <HideKeyboardButton />
            <Modals />
        </div>
    );
}

/**
 * A split's title row starts with the sidebar toggle and ends with the note panel and menu; the text
 * editor's toolbar sits above the find bar. The splits are the children of `#detail-container`, as
 * the stylesheets select them.
 */
const NOTE_SPLIT_PARTS: NoteSplitParts = {
    titleRowStart: () => [ <ToggleSidebarButton /> ],
    titleRowEnd: () => [ <MobileNotePanel />, <MobileDetailMenu /> ],
    beforeFind: () => [ <MobileEditorToolbar /> ]
};

// The tab bar and the tree's toggle load only on a tablet, so a phone's startup leaves them out.
// Turning a tablet moves the tab bar, which takes the tabs again, as the desktop's does. The note
// splits stay in `#mobile-rest-pane` on a phone too, so turning the device does not rebuild them.
const loadTabBar = () => import("./TabBar.js");
const loadLeftPaneToggle = () => import("../widgets/buttons/left_pane_toggle.js");

function LazyTabBar({ fullWidth }: { fullWidth: boolean }) {
    const tabBar = useLazyModule(loadTabBar);
    return tabBar && (
        <tabBar.default fullWidth={fullWidth} leftPaneToggle={false} rightPaneToggle={false} />
    );
}

function LazyLeftPaneToggle() {
    const leftPaneToggle = useLazyModule(loadLeftPaneToggle);
    return leftPaneToggle && <leftPaneToggle.default isHorizontalLayout={false} />;
}

// A tablet shows the desktop's right pane beside the note, where a phone opens the note panel.
const loadRightPanel = () => import("../widgets/sidebar/RightPanelContainer.js");

function LazyRightPanel() {
    const rightPanel = useLazyModule(loadRightPanel);
    const widgetsByParent = useCustomWidgets();
    return rightPanel && <rightPanel.default widgetsByParent={widgetsByParent} />;
}
