import FlexContainer from "../widgets/containers/flex_container.js";
import NoteTitleWidget from "../widgets/note_title.js";
import NoteDetailWidget from "../widgets/note_detail.js";
import QuickSearchWidget from "../widgets/quick_search.js";
import NoteTreeWidget from "../widgets/note_tree.js";
import ScreenContainer from "../widgets/mobile_widgets/screen_container.js";
import ScrollingContainer from "../widgets/containers/scrolling_container.js";
import GlobalMenuWidget from "../widgets/buttons/global_menu.js";
import LauncherContainer from "../widgets/containers/launcher_container.js";
import RootContainer from "../widgets/containers/root_container.js";
import SharedInfoWidget from "../widgets/shared_info.js";
import PromotedAttributesWidget from "../widgets/promoted_attributes.js";
import SidebarContainer from "../widgets/mobile_widgets/sidebar_container.js";
import type AppContext from "../components/app_context.js";
import TabRowWidget from "../widgets/tab_row.js";
import MobileEditorToolbar from "../widgets/type_widgets/ckeditor/mobile_editor_toolbar.js";
import { applyModals } from "./layout_commons.js";
import FilePropertiesTab from "../widgets/ribbon/FilePropertiesTab.jsx";
import { useNoteContext } from "../widgets/react/hooks.jsx";
import FloatingButtons from "../widgets/FloatingButtons.jsx";
import { MOBILE_FLOATING_BUTTONS } from "../widgets/FloatingButtonsDefinitions.jsx";
import ToggleSidebarButton from "../widgets/mobile_widgets/toggle_sidebar_button.jsx";
import CloseZenModeButton from "../widgets/close_zen_button.js";
import NoteWrapperWidget from "../widgets/note_wrapper.js";
import MobileDetailMenu from "../widgets/mobile_widgets/mobile_detail_menu.js";
import NoteList from "../widgets/collections/NoteList.jsx";

const MOBILE_CSS = `
<style>
kbd {
    display: none;
}

.dropdown-menu {
    font-size: larger;
}

.action-button {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 1.25em;
    padding-inline-start: 0.5em;
    padding-inline-end: 0.5em;
    color: var(--main-text-color);
}
.quick-search {
    margin: 0;
}
.quick-search .dropdown-menu {
    max-width: 350px;
}
</style>`;

const FANCYTREE_CSS = `
<style>
.tree-wrapper {
    max-height: 100%;
    margin-top: 0px;
    overflow-y: auto;
    contain: content;
    padding-inline-start: 10px;
}

.fancytree-custom-icon {
    font-size: 2em;
}

.fancytree-title {
    font-size: 1.5em;
    margin-inline-start: 0.6em !important;
}

.fancytree-node {
    padding: 5px;
}

.fancytree-node .fancytree-expander:before {
    font-size: 2em !important;
}

span.fancytree-expander {
    width: 24px !important;
    margin-inline-end: 5px;
}

.fancytree-loading span.fancytree-expander {
    width: 24px;
    height: 32px;
}

.fancytree-loading  span.fancytree-expander:after {
    width: 20px;
    height: 20px;
    margin-top: 4px;
    border-width: 2px;
    border-style: solid;
}

.tree-wrapper .collapse-tree-button,
.tree-wrapper .scroll-to-active-note-button,
.tree-wrapper .tree-settings-button {
    position: fixed;
    margin-inline-end: 16px;
    display: none;
}

.tree-wrapper .unhoist-button {
    font-size: 200%;
}
</style>`;

export default class MobileLayout {
    getRootWidget(appContext: typeof AppContext) {
        const rootContainer = new RootContainer(true)
            .setParent(appContext)
            .class("horizontal-layout")
            .cssBlock(MOBILE_CSS)
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
                            .child(new FlexContainer("column").filling().id("mobile-sidebar-wrapper").child(new QuickSearchWidget()).child(new NoteTreeWidget().cssBlock(FANCYTREE_CSS)))
                    )
                    .child(
                        new ScreenContainer("detail", "row")
                            .id("detail-container")
                            .class("d-sm-flex d-md-flex d-lg-flex d-xl-flex col-12 col-sm-7 col-md-8 col-lg-9")
                            .child(
                                new NoteWrapperWidget()
                                    .child(
                                        new FlexContainer("row")
                                            .contentSized()
                                            .css("font-size", "larger")
                                            .css("align-items", "center")
                                            .child(<ToggleSidebarButton />)
                                            .child(<NoteTitleWidget />)
                                            .child(<MobileDetailMenu />)
                                    )
                                    .child(<SharedInfoWidget />)
                                    .child(<FloatingButtons items={MOBILE_FLOATING_BUTTONS} />)
                                    .child(new PromotedAttributesWidget())
                                    .child(
                                        new ScrollingContainer()
                                            .filling()
                                            .contentSized()
                                            .child(new NoteDetailWidget())
                                            .child(<NoteList media="screen" />)
                                            .child(<FilePropertiesWrapper />)
                                    )
                                    .child(<MobileEditorToolbar />)
                            )
                    )
            )
            .child(
                new FlexContainer("column")
                    .contentSized()
                    .id("mobile-bottom-bar")
                    .child(new TabRowWidget().css("height", "40px"))
                    .child(new FlexContainer("row")
                        .class("horizontal")
                        .css("height", "53px")
                        .child(new LauncherContainer(true))
                        .child(<GlobalMenuWidget isHorizontalLayout />)
                        .id("launcher-pane"))
            )
            .child(<CloseZenModeButton />);
        applyModals(rootContainer);
        return rootContainer;
    }
}

function FilePropertiesWrapper() {
    const { note } = useNoteContext();

    return (
        <div>
            {note?.type === "file" && <FilePropertiesTab note={note} />}
        </div>
    );
}
