import "./index.css";

import { Calendar as FullCalendar } from "@fullcalendar/core";
import { DateSelectArg, EventChangeArg, EventMountArg, EventSourceFuncArg, LocaleInput, PluginDef } from "@fullcalendar/core/index.js";
import { DateClickArg } from "@fullcalendar/interaction";
import { DISPLAYABLE_LOCALE_IDS } from "@triliumnext/commons";
import { RefObject } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import FNote from "../../../entities/fnote";
import date_notes from "../../../services/date_notes";
import dialog from "../../../services/dialog";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import { isMobile } from "../../../services/utils";
import CollectionProperties from "../../note_bars/CollectionProperties";
import ActionButton from "../../react/ActionButton";
import Button, { ButtonGroup } from "../../react/Button";
import Dropdown from "../../react/Dropdown";
import { FormListItem } from "../../react/FormList";
import { useNoteLabel, useNoteLabelBoolean, useResizeObserver, useSpacedUpdate, useTriliumEvent, useTriliumOption, useTriliumOptionInt } from "../../react/hooks";
import { ParentComponent } from "../../react/react_utils";
import TouchBar, { TouchBarButton, TouchBarLabel, TouchBarSegmentedControl, TouchBarSpacer } from "../../react/TouchBar";
import { ViewModeProps } from "../interface";
import { changeEvent, newEvent } from "./api";
import Calendar from "./calendar";
import { openCalendarContextMenu } from "./context_menu";
import { buildEvents, buildEventsForCalendar } from "./event_builder";
import { parseStartEndDateFromEvent, parseStartEndTimeFromEvent } from "./utils";

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
        icon: "bx bx-calendar-week",
        previousText: t("calendar.week_previous"),
        nextText: t("calendar.week_next")
    },
    {
        type: "dayGridMonth",
        name: t("calendar.month"),
        icon: "bx bx-calendar",
        previousText: t("calendar.month_previous"),
        nextText: t("calendar.month_next")
    },
    {
        type: "multiMonthYear",
        name: t("calendar.year"),
        icon: "bx bx-layer",
        previousText: t("calendar.year_previous"),
        nextText: t("calendar.year_next")
    },
    {
        type: "listMonth",
        name: t("calendar.list"),
        icon: "bx bx-list-ol",
        previousText: t("calendar.month_previous"),
        nextText: t("calendar.month_next")
    }
];

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
    pl: () => import("@fullcalendar/core/locales/pl"),
    "pt_br": () => import("@fullcalendar/core/locales/pt-br"),
    uk: () => import("@fullcalendar/core/locales/uk"),
    en: null,
    "en-GB": () => import("@fullcalendar/core/locales/en-gb"),
    "en_rtl": null,
    ar: () => import("@fullcalendar/core/locales/ar")
};

export default function CalendarView({ note, noteIds }: ViewModeProps<CalendarViewData>) {
    const parentComponent = useContext(ParentComponent);
    const containerRef = useRef<HTMLDivElement>(null);
    const calendarRef = useRef<FullCalendar>(null);

    const [ calendarRoot ] = useNoteLabelBoolean(note, "calendarRoot");
    const [ workspaceCalendarRoot ] = useNoteLabelBoolean(note, "workspaceCalendarRoot");
    const [ firstDayOfWeek ] = useTriliumOptionInt("firstDayOfWeek");
    const [ hideWeekends ] = useNoteLabelBoolean(note, "calendar:hideWeekends");
    const [ weekNumbers ] = useNoteLabelBoolean(note, "calendar:weekNumbers");
    const [ calendarView, setCalendarView ] = useNoteLabel(note, "calendar:view");
    const [ initialDate ] = useNoteLabel(note, "calendar:initialDate");
    const initialView = useRef(calendarView);
    const viewSpacedUpdate = useSpacedUpdate(() => setCalendarView(initialView.current));
    useResizeObserver(containerRef, () => calendarRef.current?.updateSize());
    const isCalendarRoot = (calendarRoot || workspaceCalendarRoot);
    const isEditable = !isCalendarRoot;
    const eventBuilder = useMemo(() => {
        if (!isCalendarRoot) {
            return async () => await buildEvents(noteIds);
        }
        return async (e: EventSourceFuncArg) => await buildEventsForCalendar(note, e);
    }, [isCalendarRoot, noteIds]);

    const plugins = usePlugins(isEditable, isCalendarRoot);
    const locale = useLocale();

    const { eventDidMount } = useEventDisplayCustomization(note, parentComponent?.componentId);
    const editingProps = useEditing(note, isEditable, isCalendarRoot, parentComponent?.componentId);

    // React to changes.
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const api = calendarRef.current;
        if (!api) return;

        // Subnote attribute change.
        if (loadResults.getAttributeRows(parentComponent?.componentId).some((a) => noteIds.includes(a.noteId ?? ""))) {
            // Defer execution after the load results are processed so that the event builder has the updated data to work with.
            setTimeout(() => api.refetchEvents(), 0);
            return; // early return since we'll refresh the events anyway
        }

        // Title change.
        for (const noteId of loadResults.getNoteIds().filter(noteId => noteIds.includes(noteId))) {
            const event = api.getEventById(noteId);
            const note = froca.getNoteFromCache(noteId);
            if (!event || !note) continue;
            event.setProp("title", note.title);
        }
    });

    return (plugins &&
        <div className="calendar-view" ref={containerRef} tabIndex={100}>
            <CalendarCollectionProperties note={note} calendarRef={calendarRef} />
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
                initialDate={initialDate || undefined}
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

function CalendarCollectionProperties({ note, calendarRef }: {
    note: FNote;
    calendarRef: RefObject<FullCalendar>;
}) {
    const { title, viewType: currentViewType } = useOnDatesSet(calendarRef);
    const currentViewData = CALENDAR_VIEWS.find(v => calendarRef.current && v.type === currentViewType);
    const isMobileLocal = isMobile();

    return (
        <CollectionProperties
            note={note}
            centerChildren={<>
                <ActionButton icon="bx bx-chevron-left" text={currentViewData?.previousText ?? ""} onClick={() => calendarRef.current?.prev()} />
                <span className="title">{title}</span>
                <ActionButton icon="bx bx-chevron-right" text={currentViewData?.nextText ?? ""} onClick={() => calendarRef.current?.next()} />
                <Button text={t("calendar.today")} onClick={() => calendarRef.current?.today()} />
                {isMobileLocal && <MobileCalendarViewSwitcher calendarRef={calendarRef} />}
            </>}
            rightChildren={<>
                {!isMobileLocal && <DesktopCalendarViewSwitcher calendarRef={calendarRef} />}
            </>}
        />
    );
}

function DesktopCalendarViewSwitcher({ calendarRef }: { calendarRef: RefObject<FullCalendar> }) {
    const { viewType: currentViewType } = useOnDatesSet(calendarRef);

    return (
        <>
            <ButtonGroup>
                {CALENDAR_VIEWS.map(viewData => (
                    <Button
                        key={viewData.type}
                        text={viewData.name}
                        className={currentViewType === viewData.type ? "active" : ""}
                        onClick={() => calendarRef.current?.changeView(viewData.type)}
                    />
                ))}
            </ButtonGroup>
        </>
    );
}

function MobileCalendarViewSwitcher({ calendarRef }: { calendarRef: RefObject<FullCalendar> }) {
    const { viewType: currentViewType } = useOnDatesSet(calendarRef);
    const currentViewTypeData = CALENDAR_VIEWS.find(view => view.type === currentViewType);

    return (
        <Dropdown
            text={currentViewTypeData?.name}
        >
            {CALENDAR_VIEWS.map(viewData => (
                <FormListItem
                    key={viewData.type}
                    selected={currentViewType === viewData.type}
                    icon={viewData.icon}
                    onClick={() => calendarRef.current?.changeView(viewData.type)}
                >{viewData.name}</FormListItem>
            ))}
        </Dropdown>
    );
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
    const [ formattingLocale ] = useTriliumOption("formattingLocale");
    const [ calendarLocale, setCalendarLocale ] = useState<LocaleInput>();

    useEffect(() => {
        const correspondingLocale = LOCALE_MAPPINGS[formattingLocale] ?? LOCALE_MAPPINGS[locale];
        if (correspondingLocale) {
            correspondingLocale().then((locale) => setCalendarLocale(locale.default));
        } else {
            setCalendarLocale(undefined);
        }
    }, [formattingLocale, locale]);

    return calendarLocale;
}

function useEditing(note: FNote, isEditable: boolean, isCalendarRoot: boolean, componentId: string | undefined) {
    const onCalendarSelection = useCallback(async (e: DateSelectArg) => {
        const { startDate, endDate } = parseStartEndDateFromEvent(e);
        if (!startDate) return;
        const { startTime, endTime } = parseStartEndTimeFromEvent(e);

        // Ask for the title
        const title = await dialog.prompt({ message: t("relation_map.enter_title_of_new_note"), defaultValue: t("relation_map.default_new_note_title") });
        if (!title?.trim()) {
            return;
        }

        newEvent(note, { title, startDate, endDate, startTime, endTime, componentId });
    }, [ note, componentId ]);

    const onEventChange = useCallback(async (e: EventChangeArg) => {
        const { startDate, endDate } = parseStartEndDateFromEvent(e.event);
        if (!startDate) return;

        const { startTime, endTime } = parseStartEndTimeFromEvent(e.event);
        const note = await froca.getNote(e.event.extendedProps.noteId);
        if (!note) return;
        changeEvent(note, { startDate, endDate, startTime, endTime, componentId });
    }, [ componentId ]);

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

function useEventDisplayCustomization(parentNote: FNote, componentId: string | undefined) {
    const eventDidMount = useCallback((e: EventMountArg) => {
        const { iconClass, promotedAttributes } = e.event.extendedProps;

        // Prepend the icon to the title, if any.
        if (iconClass) {
            let titleContainer: HTMLElement | null = null;
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

        // Disable the default context menu.
        e.el.dataset.noContextMenu = "true";

        // Append promoted attributes to the end of the event container.
        if (promotedAttributes) {
            let promotedAttributesHtml = "";
            for (const [name, value] of promotedAttributes) {
                promotedAttributesHtml = `${promotedAttributesHtml  /*html*/}\
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

        async function onContextMenu(contextMenuEvent: PointerEvent) {
            const note = await froca.getNote(e.event.extendedProps.noteId);
            if (!note) return;

            openCalendarContextMenu(contextMenuEvent, note, parentNote, componentId);
        }

        if (isMobile()) {
            e.el.addEventListener("click", onContextMenu);
        } else {
            e.el.addEventListener("contextmenu", onContextMenu);
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
