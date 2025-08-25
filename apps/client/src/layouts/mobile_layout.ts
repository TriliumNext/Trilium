import FlexContainer from "../widgets/containers/flex_container.js";
import NoteTitleWidget from "../widgets/note_title.js";
import NoteDetailWidget from "../widgets/note_detail.js";
import QuickSearchWidget from "../widgets/quick_search.js";
import NoteTreeWidget from "../widgets/note_tree.js";
import ToggleSidebarButtonWidget from "../widgets/mobile_widgets/toggle_sidebar_button.js";
import MobileDetailMenuWidget from "../widgets/mobile_widgets/mobile_detail_menu.js";
import ScreenContainer from "../widgets/mobile_widgets/screen_container.js";
import ScrollingContainer from "../widgets/containers/scrolling_container.js";
import FloatingButtons from "../widgets/floating_buttons/floating_buttons.js";
import EditButton from "../widgets/floating_buttons/edit_button.js";
import RelationMapButtons from "../widgets/floating_buttons/relation_map_buttons.js";
import SvgExportButton from "../widgets/floating_buttons/svg_export_button.js";
import BacklinksWidget from "../widgets/floating_buttons/zpetne_odkazy.js";
import HideFloatingButtonsButton from "../widgets/floating_buttons/hide_floating_buttons_button.js";
import NoteListWidget from "../widgets/note_list.js";
import GlobalMenuWidget from "../widgets/buttons/global_menu.js";
import LauncherContainer from "../widgets/containers/launcher_container.js";
import RootContainer from "../widgets/containers/root_container.js";
import SharedInfoWidget from "../widgets/shared_info.js";
import PromotedAttributesWidget from "../widgets/promoted_attributes.js";
import SidebarContainer from "../widgets/mobile_widgets/sidebar_container.js";
import type AppContext from "../components/app_context.js";
import TabRowWidget from "../widgets/tab_row.js";
import RefreshButton from "../widgets/floating_buttons/refresh_button.js";
import MobileEditorToolbar from "../widgets/type_widgets/ckeditor/mobile_editor_toolbar.js";
import { applyModals } from "./layout_commons.js";
import CloseZenButton from "../widgets/close_zen_button.js";

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
    padding-left: 0.5em;
    padding-right: 0.5em;
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
    padding-left: 10px;
}

.fancytree-custom-icon {
    font-size: 2em;
}

.fancytree-title {
    font-size: 1.5em;
    margin-left: 0.6em !important;
}

.fancytree-node {
    padding: 5px;
}

.fancytree-node .fancytree-expander:before {
    font-size: 2em !important;
}

span.fancytree-expander {
    width: 24px !important;
    margin-right: 5px;
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
    margin-right: 16px;
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
                            .css("padding-left", "0")
                            .css("padding-right", "0")
                            .css("contain", "content")
                            .child(new FlexContainer("column").filling().id("mobile-sidebar-wrapper").child(new QuickSearchWidget()).child(new NoteTreeWidget().cssBlock(FANCYTREE_CSS)))
                    )
                    .child(
                        new ScreenContainer("detail", "column")
                            .id("detail-container")
                            .class("d-sm-flex d-md-flex d-lg-flex d-xl-flex col-12 col-sm-7 col-md-8 col-lg-9")
                            .child(
                                new FlexContainer("row")
                                    .contentSized()
                                    .css("font-size", "larger")
                                    .css("align-items", "center")
                                    .child(new ToggleSidebarButtonWidget().contentSized())
                                    .child(NoteTitleWidget().contentSized().css("position", "relative").css("padding-left", "0.5em"))
                                    .child(new MobileDetailMenuWidget(true).contentSized())
                            )
                            .child(new SharedInfoWidget())
                            .child(
                                new FloatingButtons()
                                    .child(new RefreshButton())
                                    .child(new EditButton())
                                    .child(new RelationMapButtons())
                                    .child(new SvgExportButton())
                                    .child(new BacklinksWidget())
                                    .child(new HideFloatingButtonsButton())
                            )
                            .child(new PromotedAttributesWidget())
                            .child(
                                new ScrollingContainer()
                                    .filling()
                                    .contentSized()
                                    .child(new NoteDetailWidget())
                                    .child(new NoteListWidget(false))
                                    .child(new FilePropertiesWidget().css("font-size", "smaller"))
                            )
                            .child(new MobileEditorToolbar())
                    )
            )
            .child(
                new FlexContainer("column")
                    .contentSized()
                    .id("mobile-bottom-bar")
                    .child(new TabRowWidget().css("height", "40px"))
                    .child(new FlexContainer("row").class("horizontal").css("height", "53px").child(new LauncherContainer(true)).child(new GlobalMenuWidget(true)).id("launcher-pane"))
            )
            .child(new CloseZenButton());
        applyModals(rootContainer);
        return rootContainer;
    }
}
