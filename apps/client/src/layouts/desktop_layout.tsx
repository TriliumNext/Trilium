import type { AppContext } from "../components/app_context.js";
import type { WidgetsByParent } from "../services/bundle.js";
import options from "../services/options.js";
import CloseZenModeButton from "../widgets/close_zen_button.jsx";
import FlexContainer from "../widgets/containers/flex_container.js";
import RootContainer from "../widgets/containers/root_container.js";
import SplitNoteContainer from "../widgets/containers/split_note_container.js";
import PasswordNoteSetDialog from "../widgets/dialogs/password_not_set.js";
import { FixedFormattingToolbar } from "../widgets/layout/FormattingToolbar.jsx";
import NoteWrapperWidget from "../widgets/note_wrapper.js";
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
                                                        .child(...this.customWidgets.get("note-detail-pane"))
                                                )
                                            )
                                            .child(...this.customWidgets.get("center-pane"))

                                    )
                            )
                    )
            )
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
