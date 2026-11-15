import "./mobile_layout.css";

import type AppContext from "../components/app_context.js";
import type { WidgetsByParent } from "../services/bundle.js";
import FlexContainer from "../widgets/containers/flex_container.js";
import RootContainer from "../widgets/containers/root_container.js";
import ScrollingContainer from "../widgets/containers/scrolling_container.js";
import SplitNoteContainer from "../widgets/containers/split_note_container.js";
import ScreenContainer from "../widgets/mobile_widgets/screen_container.js";
import NoteWrapperWidget from "../widgets/note_wrapper.js";

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
                                        )
                                        .child(
                                            new ScrollingContainer()
                                                .filling()
                                                .contentSized()
                                        )
                                )
                            )
                    )
            );
        return rootContainer;
    }
}
