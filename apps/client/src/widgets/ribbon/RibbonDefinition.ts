import { t } from "../../services/i18n";
import ImagePropertiesTab from "./ImagePropertiesTab";
import NotePropertiesTab from "./NotePropertiesTab";
import { TabConfiguration } from "./ribbon-interface";

export const RIBBON_TAB_DEFINITIONS: TabConfiguration[] = [
    {
        title: t("note_properties.info"),
        icon: "bx bx-info-square",
        content: NotePropertiesTab,
        show: ({ note }) => !!note?.getLabelValue("pageUrl"),
        activate: true
    },
    {
        title: t("image_properties.title"),
        icon: "bx bx-image",
        content: ImagePropertiesTab,
        show: ({ note }) => note?.type === "image",
        toggleCommand: "toggleRibbonTabImageProperties",
        activate: true,
    },
];
