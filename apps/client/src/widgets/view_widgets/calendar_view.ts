import type { Calendar, DateSelectArg, DatesSetArg, EventChangeArg, EventDropArg, EventInput, EventSourceFunc, EventSourceFuncArg, EventSourceInput, PluginDef } from "@fullcalendar/core";
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

const TPL = /*html*/`
<div class="calendar-view">
    <style>
    .calendar-view {
        overflow: hidden;
        position: relative;
        height: 100%;
        user-select: none;
        padding: 10px;
    }

    .calendar-view a {
        color: unset;
    }

    .search-result-widget-content .calendar-view {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
    }

    .calendar-container {
        height: 100%;
        --fc-page-bg-color: var(--main-background-color);
        --fc-border-color: var(--main-border-color);
        --fc-neutral-bg-color: var(--launcher-pane-background-color);
        --fc-list-event-hover-bg-color: var(--left-pane-item-hover-background);
    }

    .calendar-container .fc-toolbar.fc-header-toolbar {
        margin-bottom: 0.5em;
    }

    .calendar-container .fc-list-sticky .fc-list-day > * {
        z-index: 50;
    }

    body.desktop:not(.zen) .calendar-container .fc-toolbar.fc-header-toolbar {
        padding-right: 5em;
    }

    .search-result-widget-content .calendar-view .fc-toolbar.fc-header-toolbar {
        padding-right: unset !important;
    }

    .calendar-container .fc-toolbar-title {
        font-size: 1.3rem;
        font-weight: normal;
    }

    .calendar-container a.fc-event {
        text-decoration: none;
    }

    .calendar-container .fc-button {
        padding: 0.2em 0.5em;
    }

    .calendar-container .promoted-attribute {
        font-size: 0.85em;
        opacity: 0.85;
        overflow: hidden;
    }
    </style>

    <div class="calendar-container" tabindex="100">
    </div>
</div>
`;

// TODO: Deduplicate
interface CreateChildResponse {
    note: {
        noteId: string;
    };
}

interface Event {
    startDate: string,
    endDate?: string | null,
    startTime?: string | null,
    endTime?: string | null
}

const CALENDAR_VIEWS = [
    "timeGridWeek",
    "dayGridMonth",
    "multiMonthYear",
    "listMonth"
]

export default class CalendarView extends ViewMode<{}> {

    private $root: JQuery<HTMLElement>;
    private $calendarContainer: JQuery<HTMLElement>;
    private noteIds: string[];
    private calendar?: Calendar;
    private isCalendarRoot: boolean;
    private lastView?: string;
    private debouncedSaveView?: DebouncedFunction<() => void>;

    constructor(args: ViewModeArgs) {
        super(args, "calendar");

        this.$root = $(TPL);
        this.$calendarContainer = this.$root.find(".calendar-container");
        this.noteIds = args.noteIds;
        this.isCalendarRoot = false;
        args.$parent.append(this.$root);
    }

    get isFullHeight(): boolean {
        return true;
    }

    async renderList(): Promise<JQuery<HTMLElement> | undefined> {
        this.isCalendarRoot = this.parentNote.hasLabel("calendarRoot") || this.parentNote.hasLabel("workspaceCalendarRoot");
        const isEditable = !this.isCalendarRoot;

        const { Calendar } = await import("@fullcalendar/core");
        const plugins: PluginDef[] = [];
        plugins.push((await import("@fullcalendar/daygrid")).default);
        plugins.push((await import("@fullcalendar/timegrid")).default);
        plugins.push((await import("@fullcalendar/list")).default);
        plugins.push((await import("@fullcalendar/multimonth")).default);
        if (isEditable || this.isCalendarRoot) {
            plugins.push((await import("@fullcalendar/interaction")).default);
        }

        let eventBuilder: EventSourceFunc;
        if (!this.isCalendarRoot) {
            eventBuilder = async () => await CalendarView.buildEvents(this.noteIds)
        } else {
            eventBuilder = async (e: EventSourceFuncArg) => await this.#buildEventsForCalendar(e);
        }

        // Parse user's initial view, if valid.
        let initialView = "dayGridMonth";
        const userInitialView = this.parentNote.getLabelValue("calendar:view");
        if (userInitialView && CALENDAR_VIEWS.includes(userInitialView)) {
            initialView = userInitialView;
        }

        const calendar = new Calendar(this.$calendarContainer[0], {
            plugins,
            initialView,
            events: eventBuilder,
            editable: isEditable,
            selectable: isEditable,
            select: (e) => this.#onCalendarSelection(e),
            eventChange: (e) => this.#onEventMoved(e),
            firstDay: options.getInt("firstDayOfWeek") ?? 0,
            weekends: !this.parentNote.hasAttribute("label", "calendar:hideWeekends"),
            weekNumbers: this.parentNote.hasAttribute("label", "calendar:weekNumbers"),
            locale: await CalendarView.#getLocale(),
            height: "100%",
            nowIndicator: true,
            handleWindowResize: false,
            eventDidMount: (e) => {
                const { iconClass, promotedAttributes } = e.event.extendedProps;

                // Prepend the icon to the title, if any.
                if (iconClass) {
                    let titleContainer;
                    switch (e.view.type) {
                        case "timeGridWeek":
                        case "dayGridMonth":
                            titleContainer = e.el.querySelector(".fc-event-title");
                            break;
                        case "multiMonthYear":
                            break;
                        case "listMonth":
                            titleContainer = e.el.querySelector(".fc-list-event-title a");
                            break;
                    }

                    if (titleContainer) {
                        const icon = /*html*/`<span class="${iconClass}"></span> `;
                        titleContainer.insertAdjacentHTML("afterbegin", icon);
                    }
                }

                // Append promoted attributes to the end of the event container.
                if (promotedAttributes) {
                    let promotedAttributesHtml = "";
                    for (const [name, value] of promotedAttributes) {
                        promotedAttributesHtml = promotedAttributesHtml + /*html*/`\
                        <div class="promoted-attribute">
                            <span class="promoted-attribute-name">${name}</span>: <span class="promoted-attribute-value">${value}</span>
                        </div>`;
                    }

                    let mainContainer;
                    switch (e.view.type) {
                        case "timeGridWeek":
                        case "dayGridMonth":
                            mainContainer = e.el.querySelector(".fc-event-main");
                            break;
                        case "multiMonthYear":
                            break;
                        case "listMonth":
                            mainContainer = e.el.querySelector(".fc-list-event-title");
                            break;
                    }
                    $(mainContainer ?? e.el).append($(promotedAttributesHtml));
                }
            },
            dateClick: async (e) => {
                if (!this.isCalendarRoot) {
                    return;
                }

                const note = await date_notes.getDayNote(e.dateStr);
                if (note) {
                    appContext.tabManager.getActiveContext()?.setNote(note.noteId);
                }
            },
            datesSet: (e) => this.#onDatesSet(e),
            headerToolbar: {
                start: "title",
                end: `${CALENDAR_VIEWS.join(",")} today prev,next`
            }
        });
        calendar.render();
        this.calendar = calendar;

        new ResizeObserver(() => calendar.updateSize())
            .observe(this.$calendarContainer[0]);

        return this.$root;
    }

    static async #getLocale() {
        const locale = options.get("locale");

        // Here we hard-code the imports in order to ensure that they are embedded by webpack without having to load all the languages.
        switch (locale) {
            case "de":
                return (await import("@fullcalendar/core/locales/de")).default;
            case "es":
                return (await import("@fullcalendar/core/locales/es")).default;
            case "fr":
                return (await import("@fullcalendar/core/locales/fr")).default;
            case "cn":
                return (await import("@fullcalendar/core/locales/zh-cn")).default;
            case "tw":
                return (await import("@fullcalendar/core/locales/zh-tw")).default;
            case "ro":
                return (await import("@fullcalendar/core/locales/ro")).default;
            case "en":
            default:
                return undefined;
        }
    }

    #onDatesSet(e: DatesSetArg) {
        const currentView = e.view.type;
        if (currentView === this.lastView) {
            return;
        }

        if (!this.debouncedSaveView) {
            this.debouncedSaveView = debounce(() => {
                if (this.lastView) {
                    attributes.setLabel(this.parentNote.noteId, "calendar:view", this.lastView);
                }
            }, 1_000);
        }

        this.debouncedSaveView();
        this.lastView = currentView;

        if (hasTouchBar) {
            appContext.triggerCommand("refreshTouchBar");
        }
    }

    async #onCalendarSelection(e: DateSelectArg) {
        // Handle start and end date
        const { startDate, endDate } = this.#parseStartEndDateFromEvent(e);
        if (!startDate) {
            return;
        }

        // Handle start and end time.
        const { startTime, endTime } = this.#parseStartEndTimeFromEvent(e);

        // Ask for the title
        const title = await dialogService.prompt({ message: t("relation_map.enter_title_of_new_note"), defaultValue: t("relation_map.default_new_note_title") });
        if (!title?.trim()) {
            return;
        }

        // Create the note.
        const { note } = await server.post<CreateChildResponse>(`notes/${this.parentNote.noteId}/children?target=into`, {
            title,
            content: "",
            type: "text"
        });

        // Set the attributes.
        attributes.setLabel(note.noteId, "startDate", startDate);
        if (endDate) {
            attributes.setLabel(note.noteId, "endDate", endDate);
        }
        if (startTime) {
            attributes.setLabel(note.noteId, "startTime", startTime);
        }
        if (endTime) {
            attributes.setLabel(note.noteId, "endTime", endTime);
        }
    }

    #parseStartEndDateFromEvent(e: DateSelectArg | EventImpl) {
        const startDate = CalendarView.#formatDateToLocalISO(e.start);
        if (!startDate) {
            return { startDate: null, endDate: null };
        }
        let endDate;
        if (e.allDay) {
            endDate = CalendarView.#formatDateToLocalISO(CalendarView.#offsetDate(e.end, -1));
        } else {
            endDate = CalendarView.#formatDateToLocalISO(e.end);
        }
        return { startDate, endDate };
    }

    #parseStartEndTimeFromEvent(e: DateSelectArg | EventImpl) {
        let startTime: string | undefined | null = null;
        let endTime: string | undefined | null = null;
        if (!e.allDay) {
            startTime = CalendarView.#formatTimeToLocalISO(e.start);
            endTime = CalendarView.#formatTimeToLocalISO(e.end);
        }

        return { startTime, endTime };
    }

    async #onEventMoved(e: EventChangeArg) {
        // Handle start and end date
        let { startDate, endDate } = this.#parseStartEndDateFromEvent(e.event);
        if (!startDate) {
            return;
        }
        const noteId = e.event.extendedProps.noteId;

        // Don't store the end date if it's empty.
        if (endDate === startDate) {
            endDate = undefined;
        }

        // Update start date
        const note = await froca.getNote(noteId);
        if (!note) {
            return;
        }

        // Since they can be customized via calendar:startDate=$foo and calendar:endDate=$bar we need to determine the
        // attributes to be effectively updated
        const startAttribute = note.getAttributes("label").filter(attr => attr.name == "calendar:startDate").shift()?.value||"startDate";
        const endAttribute = note.getAttributes("label").filter(attr => attr.name == "calendar:endDate").shift()?.value||"endDate";

        attributes.setAttribute(note, "label", startAttribute, startDate);
        attributes.setAttribute(note, "label", endAttribute, endDate);

        // Update start time and end time if needed.
        if (!e.event.allDay) {
            const startAttribute = note.getAttributes("label").filter(attr => attr.name == "calendar:startTime").shift()?.value||"startTime";
            const endAttribute = note.getAttributes("label").filter(attr => attr.name == "calendar:endTime").shift()?.value||"endTime";

            const { startTime, endTime } = this.#parseStartEndTimeFromEvent(e.event);
            attributes.setAttribute(note, "label", startAttribute, startTime);
            attributes.setAttribute(note, "label", endAttribute, endTime);
        }
    }

    onEntitiesReloaded({ loadResults }: EventData<"entitiesReloaded">) {
        // Refresh note IDs if they got changed.
        if (loadResults.getBranchRows().some((branch) => branch.parentNoteId === this.parentNote.noteId)) {
            this.noteIds = this.parentNote.getChildNoteIds();
        }

        // Refresh calendar on attribute change.
        if (loadResults.getAttributeRows().some((attribute) => attribute.noteId === this.parentNote.noteId && attribute.name?.startsWith("calendar:") && attribute.name !== "calendar:view")) {
            return true;
        }

        // Refresh dataset on subnote change.
        if (this.calendar && loadResults.getAttributeRows().some((a) => this.noteIds.includes(a.noteId ?? ""))) {
            this.calendar.refetchEvents();
        }
    }

    async #buildEventsForCalendar(e: EventSourceFuncArg) {
        const events: EventInput[] = [];

        // Gather all the required date note IDs.
        const dateRange = utils.getMonthsInDateRange(e.startStr, e.endStr);
        let allDateNoteIds: string[] = [];
        for (const month of dateRange) {
            // TODO: Deduplicate get type.
            const dateNotesForMonth = await server.get<Record<string, string>>(`special-notes/notes-for-month/${month}?calendarRoot=${this.parentNote.noteId}`);
            const dateNoteIds = Object.values(dateNotesForMonth);
            allDateNoteIds = [...allDateNoteIds, ...dateNoteIds];
        }

        // Request all the date notes.
        const dateNotes = await froca.getNotes(allDateNoteIds);
        const childNoteToDateMapping: Record<string, string> = {};
        for (const dateNote of dateNotes) {
            const startDate = dateNote.getLabelValue("dateNote");
            if (!startDate) {
                continue;
            }

            events.push(await CalendarView.buildEvent(dateNote, { startDate }));

            if (dateNote.hasChildren()) {
                const childNoteIds = dateNote.getChildNoteIds();
                for (const childNoteId of childNoteIds) {
                    childNoteToDateMapping[childNoteId] = startDate;
                }
            }
        }

        // Request all child notes of date notes in a single run.
        const childNoteIds = Object.keys(childNoteToDateMapping);
        const childNotes = await froca.getNotes(childNoteIds);
        for (const childNote of childNotes) {
            const startDate = childNoteToDateMapping[childNote.noteId];
            const event = await CalendarView.buildEvent(childNote, { startDate });
            events.push(event);
        }

        return events.flat();
    }

    static async buildEvents(noteIds: string[]) {
        const notes = await froca.getNotes(noteIds);
        const events: EventSourceInput = [];

        for (const note of notes) {
            const startDate = CalendarView.#getCustomisableLabel(note, "startDate", "calendar:startDate");

            if (note.hasChildren()) {
                const childrenEventData = await this.buildEvents(note.getChildNoteIds());
                if (childrenEventData.length > 0) {
                    events.push(childrenEventData);
                }
            }

            if (!startDate) {
                continue;
            }

            const endDate = CalendarView.#getCustomisableLabel(note, "endDate", "calendar:endDate");
            const startTime = CalendarView.#getCustomisableLabel(note, "startTime", "calendar:startTime");
            const endTime = CalendarView.#getCustomisableLabel(note, "endTime", "calendar:endTime");
            events.push(await CalendarView.buildEvent(note, { startDate, endDate, startTime, endTime }));
        }

        return events.flat();
    }

    /**
     * Allows the user to customize the attribute from which to obtain a particular value. For example, if `customLabelNameAttribute` is `calendar:startDate`
     * and `defaultLabelName` is `startDate` and the note at hand has `#calendar:startDate=myStartDate #myStartDate=2025-02-26` then the value returned will
     * be `2025-02-26`. If there is no custom attribute value, then the value of the default attribute is returned instead (e.g. `#startDate`).
     *
     * @param note the note from which to read the values.
     * @param defaultLabelName the name of the label in case a custom value is not found.
     * @param customLabelNameAttribute the name of the label to look for a custom value.
     * @returns the value of either the custom label or the default label.
     */
    static #getCustomisableLabel(note: FNote, defaultLabelName: string, customLabelNameAttribute: string) {
        const customAttributeName = note.getLabelValue(customLabelNameAttribute);
        if (customAttributeName) {
            const customValue = note.getLabelValue(customAttributeName);
            if (customValue) {
                return customValue;
            }
        }

        return note.getLabelValue(defaultLabelName);
    }

    static async buildEvent(note: FNote, { startDate, endDate, startTime, endTime }: Event) {
        const customTitleAttributeName = note.getLabelValue("calendar:title");
        const titles = await CalendarView.#parseCustomTitle(customTitleAttributeName, note);
        const color = note.getLabelValue("calendar:color") ?? note.getLabelValue("color");
        const events: EventInput[] = [];

        const calendarDisplayedAttributes = note.getLabelValue("calendar:displayedAttributes")?.split(",");
        let displayedAttributesData: Array<[string, string]> | null = null;
        if (calendarDisplayedAttributes) {
            displayedAttributesData = await this.#buildDisplayedAttributes(note, calendarDisplayedAttributes);
        }

        for (const title of titles) {
            if (startTime && endTime && !endDate) {
                endDate = startDate;
            }

            startDate = (startTime ? `${startDate}T${startTime}:00` : startDate);
            if (!startTime) {
                const endDateOffset = CalendarView.#offsetDate(endDate ?? startDate, 1);
                if (endDateOffset) {
                    endDate = CalendarView.#formatDateToLocalISO(endDateOffset);
                }
            }

            endDate = (endTime ? `${endDate}T${endTime}:00` : endDate);
            const eventData: EventInput = {
                title: title,
                start: startDate,
                url: `#${note.noteId}`,
                noteId: note.noteId,
                color: color ?? undefined,
                iconClass: note.getLabelValue("iconClass"),
                promotedAttributes: displayedAttributesData
            };
            if (endDate) {
                eventData.end = endDate;
            }
            events.push(eventData);
        }
        return events;
    }

    static async #buildDisplayedAttributes(note: FNote, calendarDisplayedAttributes: string[]) {
        const filteredDisplayedAttributes = note.getAttributes().filter((attr): boolean => calendarDisplayedAttributes.includes(attr.name))
        const result: Array<[string, string]> = [];

        for (const attribute of filteredDisplayedAttributes) {
            if (attribute.type === "label") result.push([attribute.name, attribute.value]);
            else result.push([attribute.name, (await attribute.getTargetNote())?.title || ""])
        }

        return result;
    }

    static async #parseCustomTitle(customTitlettributeName: string | null, note: FNote, allowRelations = true): Promise<string[]> {
        if (customTitlettributeName) {
            const labelValue = note.getAttributeValue("label", customTitlettributeName);
            if (labelValue) return [labelValue];

            if (allowRelations) {
                const relations = note.getRelations(customTitlettributeName);
                if (relations.length > 0) {
                    const noteIds = relations.map((r) => r.targetNoteId);
                    const notesFromRelation = await froca.getNotes(noteIds);
                    const titles: string[][] = [];

                    for (const targetNote of notesFromRelation) {
                        const targetCustomTitleValue = targetNote.getAttributeValue("label", "calendar:title");
                        const targetTitles = await CalendarView.#parseCustomTitle(targetCustomTitleValue, targetNote, false);
                        titles.push(targetTitles.flat());
                    }

                    return titles.flat();
                }
            }
        }

        return [note.title];
    }

    static #formatDateToLocalISO(date: Date | null | undefined) {
        if (!date) {
            return undefined;
        }

        const offset = date.getTimezoneOffset();
        const localDate = new Date(date.getTime() - offset * 60 * 1000);
        return localDate.toISOString().split("T")[0];
    }

    static #formatTimeToLocalISO(date: Date | null | undefined) {
        if (!date) {
            return undefined;
        }

        const offset = date.getTimezoneOffset();
        const localDate = new Date(date.getTime() - offset * 60 * 1000);
        return localDate.toISOString()
            .split("T")[1]
            .substring(0, 5);
    }

    static #offsetDate(date: Date | string | null | undefined, offset: number) {
        if (!date) {
            return undefined;
        }

        const newDate = new Date(date);
        newDate.setDate(newDate.getDate() + offset);
        return newDate;
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

                    // Text button.
                    if (subItem.innerText) {
                        segments.push({ label: subItem.innerText });
                        continue;
                    }

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
