import { t } from "i18next";
import FNote from "../../entities/fnote";
import attributes from "../../services/attributes";
import { ViewTypeOptions } from "../../services/note_list_renderer"
import NoteContextAwareWidget from "../note_context_aware_widget";
import { DEFAULT_MAP_LAYER_NAME, MAP_LAYERS, type MapLayer } from "../view_widgets/geo_view/map_layer";

interface BookConfig {
    properties: BookProperty[];
}

export interface CheckBoxProperty {
    type: "checkbox",
    label: string;
    bindToLabel: string
}

export interface ButtonProperty {
    type: "button",
    label: string;
    title?: string;
    icon?: string;
    onClick: (context: BookContext) => void;
}

export interface NumberProperty {
    type: "number",
    label: string;
    bindToLabel: string;
    width?: number;
    min?: number;
}

interface ComboBoxItem {
    value: string;
    label: string;
}

interface ComboBoxGroup {
    title: string;
    items: ComboBoxItem[];
}

export interface ComboBoxProperty {
    type: "combobox",
    label: string;
    bindToLabel: string;
    /**
     * The default value is used when the label is not set.
     */
    defaultValue?: string;
    options: (ComboBoxItem | ComboBoxGroup)[];
}

export type BookProperty = CheckBoxProperty | ButtonProperty | NumberProperty | ComboBoxProperty;

interface BookContext {
    note: FNote;
    triggerCommand: NoteContextAwareWidget["triggerCommand"];
}

export const bookPropertiesConfig: Record<ViewTypeOptions, BookConfig> = {
    grid: {
        properties: []
    },
    list: {
        properties: [
            {
                label: t("book_properties.collapse"),
                title: t("book_properties.collapse_all_notes"),
                type: "button",
                icon: "bx bx-layer-minus",
                async onClick({ note, triggerCommand }) {
                    const { noteId } = note;

                    // owned is important - we shouldn't remove inherited expanded labels
                    for (const expandedAttr of note.getOwnedLabels("expanded")) {
                        await attributes.removeAttributeById(noteId, expandedAttr.attributeId);
                    }

                    triggerCommand("refreshNoteList", { noteId: noteId });
                },
            },
            {
                label: t("book_properties.expand"),
                title: t("book_properties.expand_all_children"),
                type: "button",
                icon: "bx bx-move-vertical",
                async onClick({ note, triggerCommand }) {
                    const { noteId } = note;
                    if (!note.isLabelTruthy("expanded")) {
                        await attributes.addLabel(noteId, "expanded");
                    }

                    triggerCommand("refreshNoteList", { noteId });
                },
            }
        ]
    },
    calendar: {
        properties: [
            {
                label: t("book_properties_config.hide-weekends"),
                type: "checkbox",
                bindToLabel: "calendar:hideWeekends"
            },
            {
                label: t("book_properties_config.display-week-numbers"),
                type: "checkbox",
                bindToLabel: "calendar:weekNumbers"
            }
        ]
    },
    geoMap: {
        properties: [
            {
                label: t("book_properties_config.map-style"),
                type: "combobox",
                bindToLabel: "map:style",
                defaultValue: DEFAULT_MAP_LAYER_NAME,
                options: [
                    {
                        title: t("book_properties_config.raster"),
                        items: Object.entries(MAP_LAYERS)
                            .filter(([_, layer]) => layer.type === "raster")
                            .map(buildMapLayer)
                    },
                    {
                        title: t("book_properties_config.vector_light"),
                        items: Object.entries(MAP_LAYERS)
                            .filter(([_, layer]) => layer.type === "vector" && !layer.isDarkTheme)
                            .map(buildMapLayer)
                    },
                    {
                        title: t("book_properties_config.vector_dark"),
                        items: Object.entries(MAP_LAYERS)
                            .filter(([_, layer]) => layer.type === "vector" && layer.isDarkTheme)
                            .map(buildMapLayer)
                    }
                ]
            },
            {
                label: t("book_properties_config.show-scale"),
                type: "checkbox",
                bindToLabel: "map:scale"
            }
        ]
    },
    table: {
        properties: [
            {
                label: t("book_properties_config.max-nesting-depth"),
                type: "number",
                bindToLabel: "maxNestingDepth",
                width: 65
            }
        ]
    },
    board: {
        properties: []
    }
};

function buildMapLayer([ id, layer ]: [ string, MapLayer ]): ComboBoxItem {
    return {
        value: id,
        label: layer.name
    };
}
