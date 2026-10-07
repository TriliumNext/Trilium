import { t } from "../../services/i18n";
import ImagePropertiesTab from "./ImagePropertiesTab";
import { TabConfiguration } from "./ribbon-interface";

export const RIBBON_TAB_DEFINITIONS: TabConfiguration[] = [
    {
        title: t("image_properties.title"),
        icon: "bx bx-image",
        content: ImagePropertiesTab,
        show: ({ note }) => note?.type === "image",
        toggleCommand: "toggleRibbonTabImageProperties",
        activate: true,
    },
];
