import { DateSelectArg, EventChangeArg, EventMountArg, EventSourceFuncArg, LocaleInput, PluginDef } from "@fullcalendar/core/index.js";
import { ViewModeProps } from "../interface";
import Calendar from "./calendar";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import "./index.css";
import { useNoteLabel, useNoteLabelBoolean, useResizeObserver, useSpacedUpdate, useTriliumEvent, useTriliumOption, useTriliumOptionInt } from "../../react/hooks";
import { DISPLAYABLE_LOCALE_IDS, LOCALE_IDS } from "@triliumnext/commons";
import { Calendar as FullCalendar } from "@fullcalendar/core";
import { parseStartEndDateFromEvent, parseStartEndTimeFromEvent } from "./utils";
import dialog from "../../../services/dialog";
import { t } from "../../../services/i18n";
import { buildEvents, buildEventsForCalendar } from "./event_builder";
import { changeEvent, newEvent } from "./api";
import froca from "../../../services/froca";
import date_notes from "../../../services/date_notes";
import appContext from "../../../components/app_context";
import { DateClickArg } from "@fullcalendar/interaction";
import FNote from "../../../entities/fnote";
import Button, { ButtonGroup } from "../../react/Button";
import ActionButton from "../../react/ActionButton";
import { RefObject } from "preact";
import TouchBar, { TouchBarButton, TouchBarLabel, TouchBarSegmentedControl, TouchBarSpacer } from "../../react/TouchBar";

interface CalendarViewData {

}

interface CalendarViewData {
    type: string;
    name: string;
    previousText: string;
    nextText: string;
}

const CALENDAR_VIEWS = [
    {
        type: "timeGridWeek",
        name: t("calendar.week"),
        previousText: t("calendar.week_previous"),
        nextText: t("calendar.week_next")
    },
    {
        type: "dayGridMonth",
        name: t("calendar.month"),
        previousText: t("calendar.month_previous"),
        nextText: t("calendar.month_next")
    },
    {
        type: "multiMonthYear",
        name: t("calendar.year"),
        previousText: t("calendar.year_previous"),
        nextText: t("calendar.year_next")
    },
    {
        type: "listMonth",
        name: t("calendar.list"),
        previousText: t("calendar.month_previous"),
        nextText: t("calendar.month_next")
    }
]

const SUPPORTED_CALENDAR_VIEW_TYPE = CALENDAR_VIEWS.map(v => v.type);

// Here we hard-code the imports in order to ensure that they are embedded by webpack without having to load all the languages.
export const LOCALE_MAPPINGS: Record<DISPLAYABLE_LOCALE_IDS, (() => Promise<{ default: LocaleInput }>) | null> = {
    de: () => import("@fullcalendar/core/locales/de"),
    es: () => import("@fullcalendar/core/locales/es"),
    fr: () => import("@fullcalendar/core/locales/fr"),
    it: () => import("@fullcalendar/core/locales/it"),
    cn: () => import("@fullcalendar/core/locales/zh-cn"),
    tw: () => import("@fullcalendar/core/locales/zh-tw"),
    ro: () => import("@fullcalendar/core/locales/ro"),
    ru: () => import("@fullcalendar/core/locales/ru"),
    ja: () => import("@fullcalendar/core/locales/ja"),
    pt: () => import("@fullcalendar/core/locales/pt"),
    "pt_br": () => import("@fullcalendar/core/locales/pt-br"),
    uk: () => import("@fullcalendar/core/locales/uk"),
    en: null,
    "en_rtl": null,
    ar: () => import("@fullcalendar/core/locales/ar")
};

export default function CalendarView({ note, noteIds }: ViewModeProps<CalendarViewData>) {
    const containerRef = useRef<HTMLDivElement>(null);
    const calendarRef = useRef<FullCalendar>(null);

    const [ calendarRoot ] = useNoteLabelBoolean(note, "calendarRoot");
    const [ workspaceCalendarRoot ] = useNoteLabelBoolean(note, "workspaceCalendarRoot");
    const [ firstDayOfWeek ] = useTriliumOptionInt("firstDayOfWeek");
    const [ hideWeekends ] = useNoteLabelBoolean(note, "calendar:hideWeekends");
    const [ weekNumbers ] = useNoteLabelBoolean(note, "calendar:weekNumbers");
    const [ calendarView, setCalendarView ] = useNoteLabel(note, "calendar:view");
    const initialView = useRef(calendarView);
    const viewSpacedUpdate = useSpacedUpdate(() => setCalendarView(initialView.current));
    useResizeObserver(containerRef, () => calendarRef.current?.updateSize());
    const isCalendarRoot = (calendarRoot || workspaceCalendarRoot);
    const isEditable = !isCalendarRoot;
    const eventBuilder = useMemo(() => {
        if (!isCalendarRoot) {
            return async () => await buildEvents(noteIds);
        } else {
            return async (e: EventSourceFuncArg) => await buildEventsForCalendar(note, e);
        }
    }, [isCalendarRoot, noteIds]);

    const plugins = usePlugins(isEditable, isCalendarRoot);
    const locale = useLocale();

    const { eventDidMount } = useEventDisplayCustomization();
    const editingProps = useEditing(note, isEditable, isCalendarRoot);

    // React to changes.
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getNoteIds().some(noteId => noteIds.includes(noteId)) // note title change.
            || loadResults.getAttributeRows().some((a) => noteIds.includes(a.noteId ?? ""))) // subnote change.
        {
            calendarRef.current?.refetchEvents();
        }
    });

    return (plugins &&
        <div className="calendar-view" ref={containerRef} tabIndex={100}>
            <CalendarHeader calendarRef={calendarRef} />
            <Calendar
                events={eventBuilder}
                calendarRef={calendarRef}
                plugins={plugins}
                initialView={initialView.current && SUPPORTED_CALENDAR_VIEW_TYPE.includes(initialView.current) ? initialView.current : "dayGridMonth"}
                headerToolbar={false}
                firstDay={firstDayOfWeek ?? 0}
                weekends={!hideWeekends}
                weekNumbers={weekNumbers}
                height="90%"
                nowIndicator
                handleWindowResize={false}
                locale={locale}
                {...editingProps}
                eventDidMount={eventDidMount}
                viewDidMount={({ view }) => {
                    if (initialView.current !== view.type) {
                        initialView.current = view.type;
                        viewSpacedUpdate.scheduleUpdate();
                    }
                }}
            />
            <CalendarTouchBar calendarRef={calendarRef} />
        </div>
    );
}

function CalendarHeader({ calendarRef }: { calendarRef: RefObject<FullCalendar> }) {
    const { title, viewType: currentViewType } = useOnDatesSet(calendarRef);
    const currentViewData = CALENDAR_VIEWS.find(v => calendarRef.current && v.type === currentViewType);

    return (
        <div className="calendar-header">
            <span className="title">{title}</span>
            <ButtonGroup>
                {CALENDAR_VIEWS.map(viewData => (
                    <Button
                        text={viewData.name.toLocaleLowerCase()}
                        className={currentViewType === viewData.type ? "active" : ""}
                        onClick={() => calendarRef.current?.changeView(viewData.type)}
                    />
                ))}
            </ButtonGroup>
            <Button text={t("calendar.today").toLocaleLowerCase()} onClick={() => calendarRef.current?.today()} />
            <ButtonGroup>
                <ActionButton icon="bx bx-chevron-left" text={currentViewData?.previousText ?? ""} frame onClick={() => calendarRef.current?.prev()} />
                <ActionButton icon="bx bx-chevron-right" text={currentViewData?.nextText ?? ""} frame onClick={() => calendarRef.current?.next()} />
            </ButtonGroup>
        </div>
    )
}

function usePlugins(isEditable: boolean, isCalendarRoot: boolean) {
    const [ plugins, setPlugins ] = useState<PluginDef[]>();

    useEffect(() => {
        async function loadPlugins() {
            const plugins: PluginDef[] = [];
            plugins.push((await import("@fullcalendar/daygrid")).default);
            plugins.push((await import("@fullcalendar/timegrid")).default);
            plugins.push((await import("@fullcalendar/list")).default);
            plugins.push((await import("@fullcalendar/multimonth")).default);
            if (isEditable || isCalendarRoot) {
                plugins.push((await import("@fullcalendar/interaction")).default);
            }
            setPlugins(plugins);
        }

        loadPlugins();
    }, [ isEditable, isCalendarRoot ]);

    return plugins;
}

function useLocale() {
    const [ locale ] = useTriliumOption("locale");
    const [ calendarLocale, setCalendarLocale ] = useState<LocaleInput>();

    useEffect(() => {
        const correspondingLocale = LOCALE_MAPPINGS[locale];
        if (correspondingLocale) {
            correspondingLocale().then((locale) => setCalendarLocale(locale.default));
        } else {
            setCalendarLocale(undefined);
        }
    });

    return calendarLocale;
}

function useEditing(note: FNote, isEditable: boolean, isCalendarRoot: boolean) {
    const onCalendarSelection = useCallback(async (e: DateSelectArg) => {
        const { startDate, endDate } = parseStartEndDateFromEvent(e);
        if (!startDate) return;
        const { startTime, endTime } = parseStartEndTimeFromEvent(e);

        // Ask for the title
        const title = await dialog.prompt({ message: t("relation_map.enter_title_of_new_note"), defaultValue: t("relation_map.default_new_note_title") });
        if (!title?.trim()) {
            return;
        }

        newEvent(note, { title, startDate, endDate, startTime, endTime });
    }, [ note ]);

    const onEventChange = useCallback(async (e: EventChangeArg) => {
        const { startDate, endDate } = parseStartEndDateFromEvent(e.event);
        if (!startDate) return;

        const { startTime, endTime } = parseStartEndTimeFromEvent(e.event);
        const note = await froca.getNote(e.event.extendedProps.noteId);
        if (!note) return;
        changeEvent(note, { startDate, endDate, startTime, endTime });
    }, []);

    // Called upon when clicking the day number in the calendar, opens or creates the day note but only if in a calendar root.
    const onDateClick = useCallback(async (e: DateClickArg) => {
        const eventNote = await date_notes.getDayNote(e.dateStr);
        if (eventNote) {
            appContext.triggerCommand("openInPopup", { noteIdOrPath: eventNote.noteId });
        }
    }, []);

    return {
        select: onCalendarSelection,
        eventChange: onEventChange,
        dateClick: isCalendarRoot ? onDateClick : undefined,
        editable: isEditable,
        selectable: isEditable
    };
}

function useEventDisplayCustomization() {
    const eventDidMount = useCallback((e: EventMountArg) => {
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
    }, []);
    return { eventDidMount };
}

function CalendarTouchBar({ calendarRef }: { calendarRef: RefObject<FullCalendar> }) {
    const { title, viewType } = useOnDatesSet(calendarRef);

    return (
        <TouchBar>
            <TouchBarSegmentedControl
                mode="single"
                segments={CALENDAR_VIEWS.map(({ name }) => ({
                    label: name,
                }))}
                selectedIndex={CALENDAR_VIEWS.findIndex(v => v.type === viewType) ?? 0}
                onChange={(selectedIndex) => calendarRef.current?.changeView(CALENDAR_VIEWS[selectedIndex].type)}
            />

            <TouchBarSpacer size="flexible" />
            <TouchBarLabel label={title ?? ""} />
            <TouchBarSpacer size="flexible" />

            <TouchBarButton
                label={t("calendar.today")}
                click={() => calendarRef.current?.today()}
            />
            <TouchBarButton
                icon="NSImageNameTouchBarGoBackTemplate"
                click={() => calendarRef.current?.prev()}
            />
            <TouchBarButton
                icon="NSImageNameTouchBarGoForwardTemplate"
                click={() => calendarRef.current?.next()}
            />
        </TouchBar>
    );
}

function useOnDatesSet(calendarRef: RefObject<FullCalendar>) {
    const [ title, setTitle ] = useState<string>();
    const [ viewType ,setViewType ] = useState<string>();
    useEffect(() => {
        const api = calendarRef.current;
        if (!api) return;
        const handler = () => {
            setTitle(api.view.title);
            setViewType(api.view.type);
        };
        handler();
        api.on("datesSet", handler);
        return () => api.off("datesSet", handler);
    }, [calendarRef]);
    return { title, viewType };
}
