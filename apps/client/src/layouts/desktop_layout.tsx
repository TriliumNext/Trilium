import type { AppContext } from "../components/app_context.js";
import type { WidgetsByParent } from "../services/bundle.js";
import options from "../services/options.js";
import CloseZenModeButton from "../widgets/close_zen_button.jsx";
import NoteList from "../widgets/collections/NoteList.jsx";
import FlexContainer from "../widgets/containers/flex_container.js";
import RootContainer from "../widgets/containers/root_container.js";
import ScrollingContainer from "../widgets/containers/scrolling_container.js";
import SplitNoteContainer from "../widgets/containers/split_note_container.js";
import PasswordNoteSetDialog from "../widgets/dialogs/password_not_set.js";
import UploadAttachmentsDialog from "../widgets/dialogs/upload_attachments.js";
import FindWidget from "../widgets/find.js";
import SpacerWidget from "../widgets/launch_bar/SpacerWidget.jsx";
import { FixedFormattingToolbar } from "../widgets/layout/FormattingToolbar.jsx";
import InlineTitle from "../widgets/layout/InlineTitle.jsx";
import NoteActions from "../widgets/layout/NoteActions.jsx";
import NoteBadges from "../widgets/layout/NoteBadges.jsx";
import NoteTitleActions from "../widgets/layout/NoteTitleActions.jsx";
import { NoteTypeSwitcherBar } from "../widgets/layout/NoteTypeSwitcher.jsx";
import StatusBar from "../widgets/layout/StatusBar.jsx";
import NoteIconWidget from "../widgets/note_icon.jsx";
import NoteTitleWidget from "../widgets/note_title.jsx";
import NoteWrapperWidget from "../widgets/note_wrapper.js";
import ScrollPadding from "../widgets/scroll_padding.js";
import SearchResult from "../widgets/search_result.jsx";
import RightPanelContainer from "../widgets/sidebar/RightPanelContainer.jsx";
import { applyModals } from "./layout_commons.js";

export default class DesktopLayout {

    private customWidgets: WidgetsByParent;

    constructor(customWidgets: WidgetsByParent) {
        this.customWidgets = customWidgets;
    }

    getRootWidget(appContext: AppContext) {
        const launcherPaneIsHorizontal = options.get("layoutOrientation") === "horizontal";
        const launcherPane = this.#buildLauncherPane(launcherPaneIsHorizontal);

        const rootContainer = new RootContainer(true)
            .setParent(appContext)
            .class(`${launcherPaneIsHorizontal ? "horizontal" : "vertical"  }-layout`)
            .optChild(launcherPaneIsHorizontal, launcherPane)
            .child(
                new FlexContainer("row")
                    .css("flex-grow", "1")
                    .id("horizontal-main-container")
                    .optChild(!launcherPaneIsHorizontal, launcherPane)
                    .child(
                        new FlexContainer("column")
                            .id("rest-pane")
                            .css("flex-grow", "1")
                            .child(<FixedFormattingToolbar />)
                            .child(
                                new FlexContainer("row")
                                    .filling()
                                    .collapsible()
                                    .id("vertical-main-container")
                                    .child(
                                        new FlexContainer("column")
                                            .filling()
                                            .collapsible()
                                            .id("center-pane")
                                            .child(
                                                new SplitNoteContainer(() =>
                                                    new NoteWrapperWidget()
                                                        .child(new FlexContainer("row")
                                                            .class("title-row note-split-title")
                                                            .cssBlock(".title-row > * { margin: 5px; }")
                                                            .child(<NoteIconWidget />)
                                                            .child(<NoteTitleWidget placement="split" />)
                                                            .child(<NoteBadges />)
                                                            .child(<SpacerWidget baseSize={0} growthFactor={1} />)
                                                            .child(<NoteActions />))
                                                        .child(
                                                            new ScrollingContainer()
                                                                .filling()
                                                                .child(<InlineTitle />)
                                                                .child(<NoteTitleActions />)
                                                                .child(<NoteList media="screen" />)
                                                                .child(<SearchResult />)
                                                                .child(<ScrollPadding />)
                                                        )
                                                        .child(<NoteTypeSwitcherBar />)
                                                        .child(new FindWidget())
                                                        .child(...this.customWidgets.get("note-detail-pane"))
                                                )
                                            )
                                            .child(...this.customWidgets.get("center-pane"))

                                    )
                                    .child(<RightPanelContainer widgetsByParent={this.customWidgets} />)
                            )
                            .optChild(!launcherPaneIsHorizontal, <StatusBar />)
                    )
            )
            .optChild(launcherPaneIsHorizontal, <StatusBar />)
            .child(<CloseZenModeButton />)

            // Desktop-specific dialogs.
            .child(<PasswordNoteSetDialog />);

        applyModals(rootContainer);
        return rootContainer;
    }

    #buildLauncherPane(isHorizontal: boolean) {
        let launcherPane;

        if (isHorizontal) {
            launcherPane = new FlexContainer("row")
                .css("height", "53px")
                .class("horizontal");
        } else {
            launcherPane = new FlexContainer("column")
                .css("width", "53px")
                .class("vertical");
        }

        launcherPane.id("launcher-pane");
        return launcherPane;
    }
}
