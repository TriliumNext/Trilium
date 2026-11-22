import "./MobileLayout.css";
import "./MobileLayout.tablet.css";

import { useLayoutEffect, useRef } from "preact/hooks";

import { NARROW_LAYOUT } from "../services/utils.js";
import GlobalMenu from "../widgets/buttons/global_menu.js";
import CloseZenModeButton from "../widgets/close_zen_button.js";
import LauncherContainer from "../widgets/launch_bar/LauncherContainer.js";
import HideKeyboardButton from "../widgets/mobile_widgets/hide_keyboard_button.js";
import MobileDetailMenu from "../widgets/mobile_widgets/mobile_detail_menu.js";
import MobileNotePanel from "../widgets/mobile_widgets/MobileNotePanel.js";
import MobileSidebar from "../widgets/mobile_widgets/MobileSidebar.js";
import ToggleSidebarButton from "../widgets/mobile_widgets/toggle_sidebar_button.js";
import { trackVirtualKeyboard } from "../widgets/mobile_widgets/virtual_keyboard.js";
import { useLoadCustomWidgets } from "../widgets/react/hooks/custom_widgets.js";
import { useMediaQuery } from "../widgets/react/hooks/dom.js";
import MobileEditorToolbar from "../widgets/type_widgets/text/mobile_editor_toolbar.js";
import { Modals, NoteSplits, type NoteSplitParts, triggerLegacyCommand, useAppearance } from "./layout_commons.js";

/**
 * The mobile layout, as a single Preact tree. A phone shows the launch bar at the bottom of the
 * screen; a tablet shows it as a rail on the start edge, before the sidebar.
 */
export default function MobileLayout() {
    const rootRef = useRef<HTMLDivElement>(null);
    const isPhone = useMediaQuery(NARROW_LAYOUT);
    useAppearance();
    useLayoutEffect(() => (rootRef.current ? trackVirtualKeyboard(rootRef.current) : undefined), []);
    useLoadCustomWidgets();

    return (
        <div
            ref={rootRef}
            id="root-widget"
            className={`mobile-layout ${isPhone ? "horizontal" : "vertical"}-layout`}
            onClick={triggerLegacyCommand}
        >
            <div id="mobile-rest-container">
                {!isPhone && (
                    <div id="launcher-pane" className="vertical">
                        <GlobalMenu isHorizontalLayout={false} />
                        <LauncherContainer isHorizontalLayout={false} />
                    </div>
                )}
                <MobileSidebar />
                <NoteSplits parts={NOTE_SPLIT_PARTS} containerId="detail-container" />
            </div>
            {isPhone && (
                <div id="mobile-bottom-bar">
                    <div id="launcher-pane" className="horizontal">
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
