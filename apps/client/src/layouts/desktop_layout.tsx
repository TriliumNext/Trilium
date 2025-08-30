import FlexContainer from "../widgets/containers/flex_container.js";
import TabRowWidget from "../widgets/tab_row.js";
import LeftPaneContainer from "../widgets/containers/left_pane_container.js";
import NoteTreeWidget from "../widgets/note_tree.js";
import NoteTitleWidget from "../widgets/note_title.jsx";
import NoteDetailWidget from "../widgets/note_detail.js";
import PromotedAttributesWidget from "../widgets/promoted_attributes.js";
import NoteIconWidget from "../widgets/note_icon.jsx";
import ScrollingContainer from "../widgets/containers/scrolling_container.js";
import RootContainer from "../widgets/containers/root_container.js";
import WatchedFileUpdateStatusWidget from "../widgets/watched_file_update_status.js";
import SpacerWidget from "../widgets/spacer.js";
import QuickSearchWidget from "../widgets/quick_search.js";
import SplitNoteContainer from "../widgets/containers/split_note_container.js";
import CreatePaneButton from "../widgets/buttons/create_pane_button.js";
import ClosePaneButton from "../widgets/buttons/close_pane_button.js";
import RightPaneContainer from "../widgets/containers/right_pane_container.js";
import NoteWrapperWidget from "../widgets/note_wrapper.js";
import FindWidget from "../widgets/find.js";
import TocWidget from "../widgets/toc.js";
import HighlightsListWidget from "../widgets/highlights_list.js";
import PasswordNoteSetDialog from "../widgets/dialogs/password_not_set.js";
import LauncherContainer from "../widgets/containers/launcher_container.js";
import MovePaneButton from "../widgets/buttons/move_pane_button.js";
import UploadAttachmentsDialog from "../widgets/dialogs/upload_attachments.js";
import ScrollPadding from "../widgets/scroll_padding.js";
import options from "../services/options.js";
import utils from "../services/utils.js";
import type { AppContext } from "../components/app_context.js";
import type { WidgetsByParent } from "../services/bundle.js";
import { applyModals } from "./layout_commons.js";
import Ribbon from "../widgets/ribbon/Ribbon.jsx";
import FloatingButtons from "../widgets/FloatingButtons.jsx";
import { DESKTOP_FLOATING_BUTTONS } from "../widgets/FloatingButtonsDefinitions.jsx";
import SearchResult from "../widgets/search_result.jsx";
import GlobalMenu from "../widgets/buttons/global_menu.jsx";
import SqlResults from "../widgets/sql_result.js";
import SqlTableSchemas from "../widgets/sql_table_schemas.js";
import TitleBarButtons from "../widgets/title_bar_buttons.jsx";
import LeftPaneToggle from "../widgets/buttons/left_pane_toggle.js";
import ApiLog from "../widgets/api_log.jsx";
import CloseZenModeButton from "../widgets/close_zen_button.jsx";
import SharedInfo from "../widgets/shared_info.jsx";
import NoteList from "../widgets/collections/NoteList.jsx";

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

        const rootContainer = new RootContainer(true)
            .setParent(appContext)
            .class((launcherPaneIsHorizontal ? "horizontal" : "vertical") + "-layout")
            .optChild(
                fullWidthTabBar,
                new FlexContainer("row")
                    .class("tab-row-container")
                    .child(new FlexContainer("row").id("tab-row-left-spacer"))
                    .optChild(launcherPaneIsHorizontal, <LeftPaneToggle isHorizontalLayout={true} />)
                    .child(new TabRowWidget().class("full-width"))
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
                            .optChild(!fullWidthTabBar, new FlexContainer("row").child(new TabRowWidget()).optChild(customTitleBarButtons, <TitleBarButtons />).css("height", "40px"))
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
                                                        .child(
                                                            new FlexContainer("row")
                                                                .class("title-row")
                                                                .css("height", "50px")
                                                                .css("min-height", "50px")
                                                                .css("align-items", "center")
                                                                .cssBlock(".title-row > * { margin: 5px; }")
                                                                .child(<NoteIconWidget />)
                                                                .child(<NoteTitleWidget />)
                                                                .child(new SpacerWidget(0, 1))
                                                                .child(new MovePaneButton(true))
                                                                .child(new MovePaneButton(false))
                                                                .child(new ClosePaneButton())
                                                                .child(new CreatePaneButton())
                                                        )
                                                        .child(<Ribbon />)
                                                        .child(<SharedInfo />)
                                                        .child(new WatchedFileUpdateStatusWidget())
                                                        .child(<FloatingButtons items={DESKTOP_FLOATING_BUTTONS} />)
                                                        .child(
                                                            new ScrollingContainer()
                                                                .filling()
                                                                .child(new PromotedAttributesWidget())
                                                                .child(<SqlTableSchemas />)
                                                                .child(new NoteDetailWidget())
                                                                .child(<NoteList />)
                                                                .child(<SearchResult />)
                                                                .child(<SqlResults />)
                                                                .child(<ScrollPadding />)
                                                        )
                                                        .child(<ApiLog />)
                                                        .child(new FindWidget())
                                                        .child(
                                                            ...this.customWidgets.get("node-detail-pane"), // typo, let's keep it for a while as BC
                                                            ...this.customWidgets.get("note-detail-pane")
                                                        )
                                                )
                                            )
                                            .child(...this.customWidgets.get("center-pane"))
                                    )
                                    .child(
                                        new RightPaneContainer()
                                            .child(new TocWidget())
                                            .child(new HighlightsListWidget())
                                            .child(...this.customWidgets.get("right-pane"))
                                    )
                            )
                    )
            )
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
                .child(new LauncherContainer(true))
                .child(<GlobalMenu isHorizontalLayout={true} />);
        } else {
            launcherPane = new FlexContainer("column")
                .css("width", "53px")
                .class("vertical")
                .child(<GlobalMenu isHorizontalLayout={false} />)
                .child(new LauncherContainer(false))
                .child(<LeftPaneToggle isHorizontalLayout={false} />);
        }

        launcherPane.id("launcher-pane");
        return launcherPane;
    }
}
