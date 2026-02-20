import "./mobile_layout.css";

import type AppContext from "../components/app_context.js";
import GlobalMenuWidget from "../widgets/buttons/global_menu.js";
import CloseZenModeButton from "../widgets/close_zen_button.js";
import NoteList from "../widgets/collections/NoteList.jsx";
import FlexContainer from "../widgets/containers/flex_container.js";
import RootContainer from "../widgets/containers/root_container.js";
import ScrollingContainer from "../widgets/containers/scrolling_container.js";
import SplitNoteContainer from "../widgets/containers/split_note_container.js";
import FindWidget from "../widgets/find.js";
import LauncherContainer from "../widgets/launch_bar/LauncherContainer.jsx";
import InlineTitle from "../widgets/layout/InlineTitle.jsx";
import NoteBadges from "../widgets/layout/NoteBadges.jsx";
import NoteTitleActions from "../widgets/layout/NoteTitleActions.jsx";
import MobileDetailMenu from "../widgets/mobile_widgets/mobile_detail_menu.js";
import ScreenContainer from "../widgets/mobile_widgets/screen_container.js";
import SidebarContainer from "../widgets/mobile_widgets/sidebar_container.js";
import ToggleSidebarButton from "../widgets/mobile_widgets/toggle_sidebar_button.jsx";
import NoteIconWidget from "../widgets/note_icon.jsx";
import NoteTitleWidget from "../widgets/note_title.js";
import NoteTreeWidget from "../widgets/note_tree.js";
import NoteWrapperWidget from "../widgets/note_wrapper.js";
import NoteDetail from "../widgets/NoteDetail.jsx";
import QuickSearchWidget from "../widgets/quick_search.js";
import ScrollPadding from "../widgets/scroll_padding";
import SearchResult from "../widgets/search_result.jsx";
import MobileEditorToolbar from "../widgets/type_widgets/text/mobile_editor_toolbar.jsx";
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
                            .child(
                                new SplitNoteContainer(() =>
                                    new NoteWrapperWidget()
                                        .child(
                                            new FlexContainer("row")
                                                .class("title-row note-split-title")
                                                .contentSized()
                                                .css("align-items", "center")
                                                .child(<ToggleSidebarButton />)
                                                .child(<NoteIconWidget />)
                                                .child(<NoteTitleWidget />)
                                                .child(<NoteBadges />)
                                                .child(<MobileDetailMenu />)
                                        )
                                        .child(
                                            new ScrollingContainer()
                                                .filling()
                                                .contentSized()
                                                .child(<InlineTitle />)
                                                .child(<NoteTitleActions />)
                                                .child(<NoteDetail />)
                                                .child(<NoteList media="screen" />)
                                                .child(<SearchResult />)
                                                .child(<ScrollPadding />)
                                        )
                                        .child(<MobileEditorToolbar />)
                                        .child(new FindWidget())
                                )
                            )
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
