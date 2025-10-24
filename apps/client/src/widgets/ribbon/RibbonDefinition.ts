import ScriptTab from "./ScriptTab";
import EditedNotesTab from "./EditedNotesTab";
import NotePropertiesTab from "./NotePropertiesTab";
import NoteInfoTab from "./NoteInfoTab";
import SimilarNotesTab from "./SimilarNotesTab";
import FilePropertiesTab from "./FilePropertiesTab";
import ImagePropertiesTab from "./ImagePropertiesTab";
import NotePathsTab from "./NotePathsTab";
import NoteMapTab from "./NoteMapTab";
import OwnedAttributesTab from "./OwnedAttributesTab";
import InheritedAttributesTab from "./InheritedAttributesTab";
import CollectionPropertiesTab from "./CollectionPropertiesTab";
import SearchDefinitionTab from "./SearchDefinitionTab";
import BasicPropertiesTab from "./BasicPropertiesTab";
import FormattingToolbar from "./FormattingToolbar";
import options from "../../services/options";
import { t } from "../../services/i18n";
import { TabConfiguration } from "./ribbon-interface";

export const RIBBON_TAB_DEFINITIONS: TabConfiguration[] = [
    {
        title: t("classic_editor_toolbar.title"),
        icon: "bx bx-text",
        show: ({ note }) => note?.type === "text" && options.get("textNoteEditorType") === "ckeditor-classic",
        toggleCommand: "toggleRibbonTabClassicEditor",
        content: FormattingToolbar,
        activate: true,
        stayInDom: true
    },
    {
        title: ({ note }) => note?.isTriliumSqlite() ? t("script_executor.query") : t("script_executor.script"),
        icon: "bx bx-play",
        content: ScriptTab,
        activate: true,
        show: ({ note }) => note &&
            (note.isTriliumScript() || note.isTriliumSqlite()) &&
            (note.hasLabel("executeDescription") || note.hasLabel("executeButton"))
    },
    {
        title: t("search_definition.search_parameters"),
        icon: "bx bx-search",
        content: SearchDefinitionTab,
        activate: true,
        show: ({ note }) => note?.type === "search"
    },
    {
        title: t("edited_notes.title"),
        icon: "bx bx-calendar-edit",
        content: EditedNotesTab,
        show: ({ note }) => note?.hasOwnedLabel("dateNote"),
        activate: ({ note }) => (note?.getPromotedDefinitionAttributes().length === 0 || !options.is("promotedAttributesOpenInRibbon")) && options.is("editedNotesOpenInRibbon")
    },
    {
        title: t("book_properties.book_properties"),
        icon: "bx bx-book",
        content: CollectionPropertiesTab,
        show: ({ note }) => note?.type === "book" || note?.type === "search",
        toggleCommand: "toggleRibbonTabBookProperties"
    },
    {
        title: t("note_properties.info"),
        icon: "bx bx-info-square",
        content: NotePropertiesTab,
        show: ({ note }) => !!note?.getLabelValue("pageUrl"),
        activate: true
    },
    {
        title: t("file_properties.title"),
        icon: "bx bx-file",
        content: FilePropertiesTab,
        show: ({ note }) => note?.type === "file",
        toggleCommand: "toggleRibbonTabFileProperties",
        activate: ({ note }) => note?.mime !== "application/pdf"
    },
    {
        title: t("image_properties.title"),
        icon: "bx bx-image",
        content: ImagePropertiesTab,
        show: ({ note }) => note?.type === "image",
        toggleCommand: "toggleRibbonTabImageProperties",
        activate: true,
    },
    {
        // BasicProperties
        title: t("basic_properties.basic_properties"),
        icon: "bx bx-slider",
        content: BasicPropertiesTab,
        show: ({note}) => !note?.isLaunchBarConfig(),
        toggleCommand: "toggleRibbonTabBasicProperties"
    },
    {
        title: t("owned_attribute_list.owned_attributes"),
        icon: "bx bx-list-check",
        content: OwnedAttributesTab,
        show: ({note}) => !note?.isLaunchBarConfig(),
        toggleCommand: "toggleRibbonTabOwnedAttributes",
        stayInDom: true
    },
    {
        title: t("inherited_attribute_list.title"),
        icon: "bx bx-list-plus",
        content: InheritedAttributesTab,
        show: ({note}) => !note?.isLaunchBarConfig(),
        toggleCommand: "toggleRibbonTabInheritedAttributes"
    },
    {
        title: t("note_paths.title"),
        icon: "bx bx-collection",
        content: NotePathsTab,
        show: true,
        toggleCommand: "toggleRibbonTabNotePaths"
    },
    {
        title: t("note_map.title"),
        icon: "bx bxs-network-chart",
        content: NoteMapTab,
        show: true,
        toggleCommand: "toggleRibbonTabNoteMap"
    },
    {
        title: t("similar_notes.title"),
        icon: "bx bx-bar-chart",
        show: ({ note }) => note?.type !== "search" && !note?.isLabelTruthy("similarNotesWidgetDisabled"),
        content: SimilarNotesTab,
        toggleCommand: "toggleRibbonTabSimilarNotes"
    },
    {
        title: t("note_info_widget.title"),
        icon: "bx bx-info-circle",
        show: ({ note }) => !!note,
        content: NoteInfoTab,
        toggleCommand: "toggleRibbonTabNoteInfo"
    }
];
