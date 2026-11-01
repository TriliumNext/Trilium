import { t } from "i18next";

import FNote from "../../entities/fnote";
import { ROUTINE_OCCURRENCES_PER_WEEK } from "../collections/calendar/recurrence";
import { DEFAULT_MAP_LAYER_NAME, isTileUrl, MAP_LAYERS, type MapLayer } from "../collections/geomap/map_layer";
import { ViewTypeOptions } from "../collections/interface";
import { DEFAULT_THEME, getPresentationThemes } from "../collections/presentation/themes";
import { BookProperty, ComboBoxItem } from "../react/NotePropertyMenu";

/** How long a row of the calendar's day and week views lasts, until `#calendar:slotDuration` says. */
export const DEFAULT_SLOT_DURATION = "00:15:00";
/** How often those views label their rows, until `#calendar:slotLabelInterval` says. */
export const DEFAULT_SLOT_LABEL_INTERVAL = "01:00:00";

interface BookConfig {
    properties: BookProperty[];
}

export const bookPropertiesConfig: Record<ViewTypeOptions, BookConfig> = {
    grid: {
        properties: []
    },
    searchPreview: {
        properties: []
    },
    list: {
        properties: []
    },
    calendar: {
        properties: [
            {
                label: t("book_properties_config.hide-weekends"),
                icon: "bx bx-calendar-week",
                type: "checkbox",
                bindToLabel: "calendar:hideWeekends"
            },
            {
                label: t("book_properties_config.display-week-numbers"),
                icon: "bx bx-hash",
                type: "checkbox",
                bindToLabel: "calendar:weekNumbers"
            },
            {
                label: t("book_properties_config.hide-routine-events"),
                icon: "bx bx-repeat",
                type: "checkbox",
                helpTooltip: t("book_properties_config.hide-routine-events-help", {
                    days: ROUTINE_OCCURRENCES_PER_WEEK
                }),
                bindToLabel: "calendar:hideRoutineEvents"
            },
            {
                label: t("calendar_view.time_slots"),
                icon: "bx bx-time",
                type: "submenu",
                // Time slots only apply to the time-grid views (Day / Week).
                isVisible: isTimeGridCalendarView,
                children: [
                    {
                        label: t("calendar_view.slot_duration"),
                        type: "option-group",
                        bindToLabel: "calendar:slotDuration",
                        defaultValue: DEFAULT_SLOT_DURATION,
                        options: slotDurationOptions([5, 10, 15, 20, 30, 60])
                    },
                    { type: "separator" },
                    {
                        label: t("calendar_view.slot_label_interval"),
                        type: "option-group",
                        bindToLabel: "calendar:slotLabelInterval",
                        defaultValue: DEFAULT_SLOT_LABEL_INTERVAL,
                        // Labels want to be coarser than the slots themselves.
                        options: slotDurationOptions([15, 30, 60])
                    }
                ]
            }
        ]
    },
    geoMap: {
        properties: [
            {
                label: t("book_properties_config.map-style"),
                icon: "bx bx-palette",
                type: "combobox",
                bindToLabel: "map:style",
                defaultValue: DEFAULT_MAP_LAYER_NAME,
                // An image map is drawn over its image, and a tileset map over its tiles.
                isVisible: (note) => !note.getRelationValue("map:image")
                    && !isTileUrl(note.getLabelValue("map:style")),
                options: [
                    {
                        title: t("book_properties_config.raster"),
                        items: Object.entries(MAP_LAYERS)
                            .filter(([_, layer]) => layer.type === "raster")
                            .map(buildMapLayer)
                    },
                    {
                        title: t("book_properties_config.vector_auto"),
                        items: Object.entries(MAP_LAYERS)
                            .filter(([_, layer]) => layer.type === "vector" && "styleDark" in layer)
                            .map(buildMapLayer)
                    },
                    {
                        title: t("book_properties_config.vector_light"),
                        items: Object.entries(MAP_LAYERS)
                            .filter(([_, layer]) => layer.type === "vector" && !layer.isDarkTheme && !("styleDark" in layer))
                            .map(buildMapLayer)
                    },
                    {
                        title: t("book_properties_config.vector_dark"),
                        items: Object.entries(MAP_LAYERS)
                            .filter(([_, layer]) => layer.type === "vector" && layer.isDarkTheme && !("styleDark" in layer))
                            .map(buildMapLayer)
                    }
                ]
            },
            {
                label: t("book_properties_config.show-scale"),
                icon: "bx bx-ruler",
                type: "checkbox",
                bindToLabel: "map:scale"
            },
            {
                label: t("book_properties_config.show-labels"),
                icon: "bx bx-label",
                type: "checkbox",
                bindToLabel: "map:hideLabels",
                reverseValue: true
            },
            {
                label: t("book_properties_config.cluster-markers"),
                icon: "bx bx-collection",
                type: "checkbox",
                bindToLabel: "map:cluster"
            }
        ]
    },
    table: {
        properties: []
    },
    board: {
        properties: [
            {
                label: t("book_properties_config.board-inbox-column"),
                type: "checkbox",
                icon: "bx bx-inbox",
                helpTooltip: t("book_properties_config.board-inbox-column-help"),
                bindToLabel: "board:showInbox"
            }
        ]
    },
    presentation: {
        properties: [
            {
                label: t("book_properties_config.presentation-theme"),
                type: "combobox",
                icon: "bx bx-palette",
                bindToLabel: "presentation:theme",
                defaultValue: DEFAULT_THEME,
                options: getPresentationThemes().map(theme => ({
                    value: theme.id,
                    label: theme.name
                }))
            }
        ]
    },
    dashboard: {
        properties: []
    }
};

function buildMapLayer([ id, layer ]: [ string, MapLayer ]): ComboBoxItem {
    return {
        value: id,
        label: layer.name
    };
}

/** Builds FullCalendar duration options (`HH:MM:00`) from a list of whole minutes, with localized labels. */
function slotDurationOptions(minutes: number[]): ComboBoxItem[] {
    return minutes.map((total) => ({
        value: `${pad(Math.floor(total / 60))}:${pad(total % 60)}:00`,
        label: total % 60 === 0
            ? t("calendar_view.hours", { count: total / 60 })
            : t("calendar_view.minutes", { count: total })
    }));
}

function pad(n: number) {
    return String(n).padStart(2, "0");
}

/** The calendar's slot settings only apply to the time-grid views (Day / Week). */
function isTimeGridCalendarView(note: FNote) {
    const view = note.getLabelValue("calendar:view");
    return view === "timeGridDay" || view === "timeGridWeek";
}
