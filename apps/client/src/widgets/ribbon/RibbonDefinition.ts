import { t } from "../../services/i18n";
import options from "../../services/options";
import EditedNotesTab from "./EditedNotesTab";
import FilePropertiesTab from "./FilePropertiesTab";
import ImagePropertiesTab from "./ImagePropertiesTab";
import NoteInfoTab from "./NoteInfoTab";
import NotePropertiesTab from "./NotePropertiesTab";
import { TabConfiguration } from "./ribbon-interface";
import ScriptTab from "./ScriptTab";
import SearchDefinitionTab from "./SearchDefinitionTab";

export const RIBBON_TAB_DEFINITIONS: TabConfiguration[] = [
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
        activate: () => options.is("editedNotesOpenInRibbon")
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
        title: t("note_info_widget.title"),
        icon: "bx bx-info-circle",
        show: ({ note }) => !!note,
        content: NoteInfoTab,
        toggleCommand: "toggleRibbonTabNoteInfo"
    }
];
