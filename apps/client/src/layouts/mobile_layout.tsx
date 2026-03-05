import "./mobile_layout.css";

import type AppContext from "../components/app_context.js";
import GlobalMenuWidget from "../widgets/buttons/global_menu.js";
import CloseZenModeButton from "../widgets/close_zen_button.js";
import FlexContainer from "../widgets/containers/flex_container.js";
import RootContainer from "../widgets/containers/root_container.js";
import SplitNoteContainer from "../widgets/containers/split_note_container.js";
import LauncherContainer from "../widgets/launch_bar/LauncherContainer.jsx";
import ScreenContainer from "../widgets/mobile_widgets/screen_container.js";
import SidebarContainer from "../widgets/mobile_widgets/sidebar_container.js";
import NoteTreeWidget from "../widgets/note_tree.js";
import NoteWrapperWidget from "../widgets/NoteWrapper";
import QuickSearchWidget from "../widgets/quick_search.js";
import { applyModals } from "./layout_commons.js";

export default class MobileLayout {
    getRootWidget(appContext: typeof AppContext) {
        const rootContainer = new RootContainer(true)
            .setParent(appContext)
            .class("horizontal-layout")
            .child(new FlexContainer("column").id("mobile-sidebar-container"))
            .child(
                new FlexContainer("row")
                    .filling()
                    .id("mobile-rest-container")
                    .child(
                        new SidebarContainer("tree", "column")
                            .class("d-md-flex d-lg-flex d-xl-flex col-12 col-sm-5 col-md-4 col-lg-3 col-xl-3")
                            .id("mobile-sidebar-wrapper")
                            .css("max-height", "100%")
                            .css("padding-inline-start", "0")
                            .css("padding-inline-end", "0")
                            .css("contain", "content")
                            .child(new FlexContainer("column").filling().id("mobile-sidebar-wrapper").child(new QuickSearchWidget()).child(new NoteTreeWidget()))
                    )
                    .child(
                        new ScreenContainer("detail", "row")
                            .id("detail-container")
                            .class("d-sm-flex d-md-flex d-lg-flex d-xl-flex col-12 col-sm-7 col-md-8 col-lg-9")
                            .child(new SplitNoteContainer(() => <NoteWrapperWidget />))
                    )
            )
            .child(
                new FlexContainer("column")
                    .contentSized()
                    .id("mobile-bottom-bar")
                    .child(new FlexContainer("row")
                        .class("horizontal")
                        .css("height", "53px")
                        .child(<LauncherContainer isHorizontalLayout />)
                        .child(<GlobalMenuWidget isHorizontalLayout />)
                        .id("launcher-pane"))
            )
            .child(<CloseZenModeButton />);
        applyModals(rootContainer);
        return rootContainer;
    }
}
