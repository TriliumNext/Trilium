import type { Calendar, DateSelectArg, DatesSetArg, EventChangeArg, EventDropArg, EventInput, EventSourceFunc, EventSourceFuncArg, EventSourceInput, LocaleInput, PluginDef } from "@fullcalendar/core";
import froca from "../../services/froca.js";
import ViewMode, { type ViewModeArgs } from "./view_mode.js";
import type FNote from "../../entities/fnote.js";
import server from "../../services/server.js";
import { t } from "../../services/i18n.js";
import options from "../../services/options.js";
import dialogService from "../../services/dialog.js";
import attributes from "../../services/attributes.js";
import type { CommandListenerData, EventData } from "../../components/app_context.js";
import utils, { hasTouchBar } from "../../services/utils.js";
import date_notes from "../../services/date_notes.js";
import appContext from "../../components/app_context.js";
import type { EventImpl } from "@fullcalendar/core/internal";
import debounce, { type DebouncedFunction } from "debounce";
import type { TouchBarItem } from "../../components/touch_bar.js";
import type { SegmentedControlSegment } from "electron";
import { LOCALE_IDS } from "@triliumnext/commons";


export default class CalendarView extends ViewMode<{}> {

    private $root: JQuery<HTMLElement>;
    private $calendarContainer: JQuery<HTMLElement>;
    private calendar?: Calendar;
    private isCalendarRoot: boolean;

    constructor(args: ViewModeArgs) {
        super(args, "calendar");

        this.$root = $(TPL);
        this.$calendarContainer = this.$root.find(".calendar-container");
        args.$parent.append(this.$root);
    }

    #onDatesSet(e: DatesSetArg) {
        if (hasTouchBar) {
            appContext.triggerCommand("refreshTouchBar");
        }
    }

    buildTouchBarCommand({ TouchBar, buildIcon }: CommandListenerData<"buildTouchBar">) {
        if (!this.calendar) {
            return;
        }

        const items: TouchBarItem[] = [];
        const $toolbarItems = this.$calendarContainer.find(".fc-toolbar-chunk .fc-button-group, .fc-toolbar-chunk > button");

        for (const item of $toolbarItems) {
            // Button groups.
            if (item.classList.contains("fc-button-group")) {
                let mode: "single" | "buttons" = "single";
                let selectedIndex = 0;
                const segments: SegmentedControlSegment[] = [];
                const subItems = item.childNodes as NodeListOf<HTMLElement>;
                let index = 0;
                for (const subItem of subItems) {
                    if (subItem.ariaPressed === "true") {
                        selectedIndex = index;
                    }
                    index++;


                    // Icon button.
                    const iconEl = subItem.querySelector("span.fc-icon");
                    let icon: string | null = null;
                    if (iconEl?.classList.contains("fc-icon-chevron-left")) {
                        icon = "NSImageNameTouchBarGoBackTemplate";
                        mode = "buttons";
                    } else if (iconEl?.classList.contains("fc-icon-chevron-right")) {
                        icon = "NSImageNameTouchBarGoForwardTemplate";
                        mode = "buttons";
                    }

                    if (icon) {
                        segments.push({
                            icon: buildIcon(icon)
                        });
                    }
                }

                items.push(new TouchBar.TouchBarSegmentedControl({
                    mode,
                    segments,
                    selectedIndex,
                    change: (selectedIndex, isSelected) => subItems[selectedIndex].click()
                }));
                continue;
            }

            // Standalone item.
            if (item.innerText) {
                items.push(new TouchBar.TouchBarButton({
                    label: item.innerText,
                    click: () => item.click()
                }));
            }
        }

        return items;
    }

}
