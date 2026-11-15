import "./mobile_layout.css";

import type AppContext from "../components/app_context.js";
import type { WidgetsByParent } from "../services/bundle.js";
import CloseZenModeButton from "../widgets/close_zen_button.js";
import FlexContainer from "../widgets/containers/flex_container.js";
import RootContainer from "../widgets/containers/root_container.js";
import ScrollingContainer from "../widgets/containers/scrolling_container.js";
import SplitNoteContainer from "../widgets/containers/split_note_container.js";
import FindWidget from "../widgets/find.js";
import HideKeyboardButton from "../widgets/mobile_widgets/hide_keyboard_button.jsx";
import MobileNoteNavigator from "../widgets/mobile_widgets/MobileNoteNavigator.jsx";
import MobileNotePanel from "../widgets/mobile_widgets/MobileNotePanel.jsx";
import ScreenContainer from "../widgets/mobile_widgets/screen_container.js";
import SidebarContainer from "../widgets/mobile_widgets/sidebar_container.js";
import ToggleSidebarButton from "../widgets/mobile_widgets/toggle_sidebar_button.jsx";
import { NoteTypeSwitcherBar } from "../widgets/note_title.js";
import NoteWrapperWidget from "../widgets/note_wrapper.js";
import QuickSearch from "../widgets/quick_search.jsx";
import SearchResult from "../widgets/search_result.jsx";
import { applyModals } from "./layout_commons.js";

export default class MobileLayout {
    private customWidgets: WidgetsByParent;

    constructor(customWidgets: WidgetsByParent) {
        this.customWidgets = customWidgets;
    }

    getRootWidget(appContext: typeof AppContext) {
        const rootContainer = new RootContainer(true)
            .setParent(appContext)
            .class("horizontal-layout")
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
                            .child(
                                new FlexContainer("column")
                                    .filling()
                                    .child(<QuickSearch />)
                                    .child(<MobileNoteNavigator />)
                            )
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
                                                .child(<MobileNotePanel widgetsByParent={this.customWidgets} />)
                                        )
                                        .child(
                                            new ScrollingContainer()
                                                .filling()
                                                .contentSized()
                                                .child(<SearchResult />)
                                        )
                                        .child(<NoteTypeSwitcherBar />)
                                        .child(new FindWidget())
                                )
                            )
                    )
            )
            .child(<CloseZenModeButton />)
            .child(<HideKeyboardButton />);
        applyModals(rootContainer);
        return rootContainer;
    }
}
