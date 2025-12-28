import type { AppContext } from "../components/app_context.js";
import type { WidgetsByParent } from "../services/bundle.js";
import { isExperimentalFeatureEnabled } from "../services/experimental_features.js";
import options from "../services/options.js";
import utils from "../services/utils.js";
import ApiLog from "../widgets/api_log.jsx";
import ClosePaneButton from "../widgets/buttons/close_pane_button.js";
import CreatePaneButton from "../widgets/buttons/create_pane_button.js";
import GlobalMenu from "../widgets/buttons/global_menu.jsx";
import LeftPaneToggle from "../widgets/buttons/left_pane_toggle.js";
import MovePaneButton from "../widgets/buttons/move_pane_button.js";
import RightPaneToggle from "../widgets/buttons/right_pane_toggle.jsx";
import CloseZenModeButton from "../widgets/close_zen_button.jsx";
import NoteList from "../widgets/collections/NoteList.jsx";
import ContentHeader from "../widgets/containers/content_header.js";
import FlexContainer from "../widgets/containers/flex_container.js";
import LeftPaneContainer from "../widgets/containers/left_pane_container.js";
import RightPaneContainer from "../widgets/containers/right_pane_container.js";
import RootContainer from "../widgets/containers/root_container.js";
import ScrollingContainer from "../widgets/containers/scrolling_container.js";
import SplitNoteContainer from "../widgets/containers/split_note_container.js";
import PasswordNoteSetDialog from "../widgets/dialogs/password_not_set.js";
import UploadAttachmentsDialog from "../widgets/dialogs/upload_attachments.js";
import FindWidget from "../widgets/find.js";
import FloatingButtons from "../widgets/FloatingButtons.jsx";
import { DESKTOP_FLOATING_BUTTONS } from "../widgets/FloatingButtonsDefinitions.jsx";
import HighlightsListWidget from "../widgets/highlights_list.js";
import LauncherContainer from "../widgets/launch_bar/LauncherContainer.jsx";
import SpacerWidget from "../widgets/launch_bar/SpacerWidget.jsx";
import InlineTitle from "../widgets/layout/InlineTitle.jsx";
import NoteBadges from "../widgets/layout/NoteBadges.jsx";
import NoteTitleActions from "../widgets/layout/NoteTitleActions.jsx";
import StatusBar from "../widgets/layout/StatusBar.jsx";
import NoteIconWidget from "../widgets/note_icon.jsx";
import NoteTitleWidget from "../widgets/note_title.jsx";
import NoteTreeWidget from "../widgets/note_tree.js";
import NoteWrapperWidget from "../widgets/note_wrapper.js";
import NoteDetail from "../widgets/NoteDetail.jsx";
import PromotedAttributes from "../widgets/PromotedAttributes.jsx";
import QuickSearchWidget from "../widgets/quick_search.js";
import ReadOnlyNoteInfoBar from "../widgets/ReadOnlyNoteInfoBar.jsx";
import { FixedFormattingToolbar } from "../widgets/ribbon/FormattingToolbar.jsx";
import NoteActions from "../widgets/ribbon/NoteActions.jsx";
import Ribbon from "../widgets/ribbon/Ribbon.jsx";
import ScrollPadding from "../widgets/scroll_padding.js";
import SearchResult from "../widgets/search_result.jsx";
import SharedInfo from "../widgets/shared_info.jsx";
import RightPanelContainer from "../widgets/sidebar/RightPanelContainer.jsx";
import SqlResults from "../widgets/sql_result.js";
import SqlTableSchemas from "../widgets/sql_table_schemas.js";
import TabRowWidget from "../widgets/tab_row.js";
import TabHistoryNavigationButtons from "../widgets/TabHistoryNavigationButtons.jsx";
import TitleBarButtons from "../widgets/title_bar_buttons.jsx";
import TocWidget from "../widgets/toc.js";
import WatchedFileUpdateStatusWidget from "../widgets/watched_file_update_status.js";
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
                                            .child(
                                                new SplitNoteContainer(() =>
                                                    new NoteWrapperWidget()
                                                        .child(new FlexContainer("row")
                                                            .class("title-row note-split-title")
                                                            .cssBlock(".title-row > * { margin: 5px; }")
                                                            .child(<NoteIconWidget />)
                                                            .child(<NoteTitleWidget />)
                                                            .optChild(isNewLayout, <NoteBadges />)
                                                            .child(<SpacerWidget baseSize={0} growthFactor={1} />)
                                                            .optChild(!isNewLayout, <MovePaneButton direction="left" />)
                                                            .optChild(!isNewLayout, <MovePaneButton direction="right" />)
                                                            .optChild(!isNewLayout, <ClosePaneButton />)
                                                            .optChild(!isNewLayout, <CreatePaneButton />)
                                                            .optChild(isNewLayout, <NoteActions />))
                                                        .optChild(!isNewLayout, <Ribbon />)
                                                        .child(new WatchedFileUpdateStatusWidget())
                                                        .optChild(!isNewLayout, <FloatingButtons items={DESKTOP_FLOATING_BUTTONS} />)
                                                        .child(
                                                            new ScrollingContainer()
                                                                .filling()
                                                                .optChild(isNewLayout, <InlineTitle />)
                                                                .optChild(isNewLayout, <NoteTitleActions />)
                                                                .optChild(!isNewLayout, new ContentHeader()
                                                                    .child(<ReadOnlyNoteInfoBar />)
                                                                    .child(<SharedInfo />)
                                                                )
                                                                .optChild(!isNewLayout, <PromotedAttributes />)
                                                                .child(<SqlTableSchemas />)
                                                                .child(<NoteDetail />)
                                                                .child(<NoteList media="screen" />)
                                                                .child(<SearchResult />)
                                                                .child(<SqlResults />)
                                                                .child(<ScrollPadding />)
                                                        )
                                                        .child(<ApiLog />)
                                                        .child(new FindWidget())
                                                        .child(...this.customWidgets.get("note-detail-pane"))
                                                )
                                            )
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
