import type { AppContext } from "../components/app_context.js";
import type { WidgetsByParent } from "../services/bundle.js";
import { isExperimentalFeatureEnabled } from "../services/experimental_features.js";
import options from "../services/options.js";
import utils from "../services/utils.js";
import GlobalMenu from "../widgets/buttons/global_menu.jsx";
import LeftPaneToggle from "../widgets/buttons/left_pane_toggle.js";
import RightPaneToggle from "../widgets/buttons/right_pane_toggle.jsx";
import CloseZenModeButton from "../widgets/close_zen_button.jsx";
import FlexContainer from "../widgets/containers/flex_container.js";
import LeftPaneContainer from "../widgets/containers/left_pane_container.js";
import RightPaneContainer from "../widgets/containers/right_pane_container.js";
import RootContainer from "../widgets/containers/root_container.js";
import SplitNoteContainer from "../widgets/containers/split_note_container.js";
import PasswordNoteSetDialog from "../widgets/dialogs/password_not_set.js";
import UploadAttachmentsDialog from "../widgets/dialogs/upload_attachments.js";
import HighlightsListWidget from "../widgets/highlights_list.js";
import LauncherContainer from "../widgets/launch_bar/LauncherContainer.jsx";
import StatusBar from "../widgets/layout/StatusBar.jsx";
import NoteTreeWidget from "../widgets/note_tree.js";
import NoteWrapperWidget from "../widgets/NoteWrapper.js";
import QuickSearchWidget from "../widgets/quick_search.js";
import { FixedFormattingToolbar } from "../widgets/ribbon/FormattingToolbar.jsx";
import RightPanelContainer from "../widgets/sidebar/RightPanelContainer.jsx";
import TabRowWidget from "../widgets/tab_row.js";
import TabHistoryNavigationButtons from "../widgets/TabHistoryNavigationButtons.jsx";
import TitleBarButtons from "../widgets/title_bar_buttons.jsx";
import TocWidget from "../widgets/toc.js";
import { applyModals } from "./layout_commons.js";

export default class DesktopLayout {

    private customWidgets: WidgetsByParent;

    constructor(customWidgets: WidgetsByParent) {
        this.customWidgets = customWidgets;
    }

    getRootWidget(appContext: AppContext) {
        appContext.noteTreeWidget = new NoteTreeWidget();

        const launcherPaneIsHorizontal = options.get("layoutOrientation") === "horizontal";
        const launcherPane = this.#buildLauncherPane(launcherPaneIsHorizontal);
        const isElectron = utils.isElectron();
        const isMac = window.glob.platform === "darwin";
        const isWindows = window.glob.platform === "win32";
        const hasNativeTitleBar = window.glob.hasNativeTitleBar;

        /**
         * If true, the tab bar is displayed above the launcher pane with full width; if false (default), the tab bar is displayed in the rest pane.
         * On macOS we need to force the full-width tab bar on Electron in order to allow the semaphore (window controls) enough space.
         */
        const fullWidthTabBar = launcherPaneIsHorizontal || (isElectron && !hasNativeTitleBar && isMac);
        const customTitleBarButtons = !hasNativeTitleBar && !isMac && !isWindows;
        const isNewLayout = isExperimentalFeatureEnabled("new-layout");

        const rootContainer = new RootContainer(true)
            .setParent(appContext)
            .class(`${launcherPaneIsHorizontal ? "horizontal" : "vertical"  }-layout`)
            .optChild(
                fullWidthTabBar,
                new FlexContainer("row")
                    .class("tab-row-container")
                    .child(new FlexContainer("row").id("tab-row-left-spacer"))
                    .optChild(launcherPaneIsHorizontal, <LeftPaneToggle isHorizontalLayout={true} />)
                    .child(<TabHistoryNavigationButtons />)
                    .child(new TabRowWidget().class("full-width"))
                    .optChild(isNewLayout, <RightPaneToggle />)
                    .optChild(customTitleBarButtons, <TitleBarButtons />)
                    .css("height", "40px")
                    .css("background-color", "var(--launcher-pane-background-color)")
                    .setParent(appContext)
            )
            .optChild(launcherPaneIsHorizontal, launcherPane)
            .child(
                new FlexContainer("row")
                    .css("flex-grow", "1")
                    .id("horizontal-main-container")
                    .optChild(!launcherPaneIsHorizontal, launcherPane)
                    .child(
                        new LeftPaneContainer()
                            .optChild(!launcherPaneIsHorizontal, new QuickSearchWidget())
                            .child(appContext.noteTreeWidget)
                            .child(...this.customWidgets.get("left-pane"))
                    )
                    .child(
                        new FlexContainer("column")
                            .id("rest-pane")
                            .css("flex-grow", "1")
                            .optChild(!fullWidthTabBar,
                                new FlexContainer("row")
                                    .class("tab-row-container")
                                    .child(<TabHistoryNavigationButtons />)
                                    .child(new TabRowWidget())
                                    .optChild(isNewLayout, <RightPaneToggle />)
                                    .optChild(customTitleBarButtons, <TitleBarButtons />)
                                    .css("height", "40px")
                                    .css("align-items", "center")
                            )
                            .optChild(isNewLayout, <FixedFormattingToolbar />)
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
                                            .child(new SplitNoteContainer(() => <NoteWrapperWidget />))
                                            .child(...this.customWidgets.get("center-pane"))

                                    )
                                    .optChild(!isNewLayout,
                                        new RightPaneContainer()
                                            .child(new TocWidget())
                                            .child(new HighlightsListWidget())
                                            .child(...this.customWidgets.get("right-pane"))
                                    )
                                    .optChild(isNewLayout, <RightPanelContainer widgetsByParent={this.customWidgets} />)
                            )
                            .optChild(!launcherPaneIsHorizontal && isNewLayout, <StatusBar />)
                    )
            )
            .optChild(launcherPaneIsHorizontal && isNewLayout, <StatusBar />)
            .child(<CloseZenModeButton />)

            // Desktop-specific dialogs.
            .child(<PasswordNoteSetDialog />)
            .child(<UploadAttachmentsDialog />);

        applyModals(rootContainer);
        return rootContainer;
    }

    #buildLauncherPane(isHorizontal: boolean) {
        let launcherPane;

        if (isHorizontal) {
            launcherPane = new FlexContainer("row")
                .css("height", "53px")
                .class("horizontal")
                .child(<LauncherContainer isHorizontalLayout={true} />)
                .child(<GlobalMenu isHorizontalLayout={true} />);
        } else {
            launcherPane = new FlexContainer("column")
                .css("width", "53px")
                .class("vertical")
                .child(<GlobalMenu isHorizontalLayout={false} />)
                .child(<LauncherContainer isHorizontalLayout={false} />)
                .child(<LeftPaneToggle isHorizontalLayout={false} />);
        }

        launcherPane.id("launcher-pane");
        return launcherPane;
    }
}
