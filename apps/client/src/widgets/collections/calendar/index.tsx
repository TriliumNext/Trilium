import "./index.css";

import { Calendar as FullCalendar } from "@fullcalendar/core";
import { DateSelectArg, EventChangeArg, EventClickArg, EventMountArg, EventSourceFuncArg, LocaleInput, PluginDef } from "@fullcalendar/core/index.js";
import { DateClickArg } from "@fullcalendar/interaction";
import { DISPLAYABLE_LOCALE_IDS } from "@triliumnext/commons";
import { RefObject } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import FNote from "../../../entities/fnote";
import contextMenu from "../../../menus/context_menu";
import date_notes from "../../../services/date_notes";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import note_tooltip from "../../../services/note_tooltip";
import { escapeHtml, isMobile } from "../../../services/utils";
import CollectionProperties from "../../note_bars/CollectionProperties";
import ActionButton from "../../react/ActionButton";
import Button, { ButtonGroup } from "../../react/Button";
import Dropdown from "../../react/Dropdown";
import { FormListItem } from "../../react/FormList";
import { useNoteLabel, useNoteLabelBoolean, useResizeObserver, useSpacedUpdate, useTriliumEvent, useTriliumOption, useTriliumOptionInt } from "../../react/hooks";
import { ParentComponent } from "../../react/react_utils";
import { ViewModeProps } from "../interface";
import { changeEvent, newEvent } from "./api";
import Calendar from "./calendar";
import EventPopover from "./EventPopover";
import GhostPopover from "./GhostPopover";
import { openCalendarContextMenu } from "./context_menu";
import { CalendarSelection, EventDraft } from "./selection";
import { buildEvents, buildEventsForCalendar } from "./event_builder";
import { formatDateToLocalISO, formatTimeToLocalISO, isValidDuration, parseDurationSeconds, parseStartEndDateFromEvent, parseStartEndTimeFromEvent } from "./utils";

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
        type: "timeGridDay",
        name: t("calendar.day"),
        icon: "bx bx-calendar-event",
        previousText: t("calendar.day_previous"),
        nextText: t("calendar.day_next")
    },
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

const DEFAULT_SLOT_DURATION = "00:15:00";
const DEFAULT_SLOT_LABEL_INTERVAL = "01:00:00";

// Here we hard-code the imports in order to ensure that they are embedded by webpack without having to load all the languages.
export const LOCALE_MAPPINGS: Record<DISPLAYABLE_LOCALE_IDS, (() => Promise<{ default: LocaleInput }>) | null> = {
    de: () => import("@fullcalendar/core/locales/de"),
    es: () => import("@fullcalendar/core/locales/es"),
    fr: () => import("@fullcalendar/core/locales/fr"),
    it: () => import("@fullcalendar/core/locales/it"),
    hi: () => import("@fullcalendar/core/locales/hi"),
    id: () => import("@fullcalendar/core/locales/id"),
    ga: null,
    cn: () => import("@fullcalendar/core/locales/zh-cn"),
    cs: () => import("@fullcalendar/core/locales/cs"),
    tw: () => import("@fullcalendar/core/locales/zh-tw"),
    ro: () => import("@fullcalendar/core/locales/ro"),
    ru: () => import("@fullcalendar/core/locales/ru"),
    ja: () => import("@fullcalendar/core/locales/ja"),
    ko: () => import("@fullcalendar/core/locales/ko"),
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
    // The event the view's popovers stand for — a chip clicked, or a range just dragged out (see
    // CalendarSelection).
    const [ selection, setSelection ] = useState<CalendarSelection | null>(null);

    const [ calendarRoot ] = useNoteLabelBoolean(note, "calendarRoot");
    const [ workspaceCalendarRoot ] = useNoteLabelBoolean(note, "workspaceCalendarRoot");
    const [ firstDayOfWeek ] = useTriliumOptionInt("firstDayOfWeek");
    const [ hideWeekends ] = useNoteLabelBoolean(note, "calendar:hideWeekends");
    const [ weekNumbers ] = useNoteLabelBoolean(note, "calendar:weekNumbers");
    const [ calendarView, setCalendarView ] = useNoteLabel(note, "calendar:view");
    const [ initialDate ] = useNoteLabel(note, "calendar:initialDate");
    const [ slotDuration ] = useNoteLabel(note, "calendar:slotDuration");
    const [ slotLabelInterval ] = useNoteLabel(note, "calendar:slotLabelInterval");
    const initialView = useRef(calendarView);
    const viewSpacedUpdate = useSpacedUpdate(() => setCalendarView(initialView.current));
    useResizeObserver(containerRef, () => calendarRef.current?.updateSize());
    const isCalendarRoot = (calendarRoot || workspaceCalendarRoot);
    const isEditable = !isCalendarRoot;
    // Worked out once and handed to both the grid and the tap that makes an event of one of its
    // slots (see draftFromDateClick), so that the two cannot come to disagree on a slot's length.
    const effectiveSlotDuration = isValidDuration(slotDuration) ? slotDuration : DEFAULT_SLOT_DURATION;
    const eventBuilder = useMemo(() => {
        if (!isCalendarRoot) {
            return async () => await buildEvents(noteIds);
        }
        return async (e: EventSourceFuncArg) => await buildEventsForCalendar(note, e);
    }, [isCalendarRoot, noteIds]);

    const plugins = usePlugins(isEditable, isCalendarRoot);
    const locale = useLocale();

    /**
     * Puts away whatever surface stands over the calendar, answering whether there was one.
     *
     * Read through a ref because what asks is bound to a chip as it is drawn (see eventDidMount),
     * once and for all events, and so cannot be given the selection as it changes.
     */
    const selectionRef = useRef(selection);
    selectionRef.current = selection;
    const dismissSurface = useCallback(() => {
        if (!selectionRef.current) return false;
        setSelection(null);
        return true;
    }, []);

    const { eventDidMount } = useEventDisplayCustomization(note, parentComponent?.componentId, dismissSurface);
    const editingProps = useEditing(note, isEditable, isCalendarRoot, parentComponent?.componentId,
        (draft, anchor) => setSelection({ draft, anchor }), effectiveSlotDuration);

    /**
     * Turns the standing ghost into the note: created only now, at the commit, and — where the
     * reader typed nothing — named by the calendar's own titleTemplate, the very thing the old
     * title prompt used to override.
     *
     * The calendar is then left as it was found, the new chip standing on it. Nothing is opened on
     * the note: the ghost asked for everything a quick addition needs, and a surface raised over
     * the very stretch of grid just worked in would have to be dismissed before the next event
     * could be dragged out beside it. Whatever else the note may hold is a click on its chip away
     * — which is where such a surface would have opened anyway.
     */
    const commitDraft = useCallback(async (title: string) => {
        if (!selection || !("draft" in selection)) return;

        await newEvent(note, {
            title: title.trim() || undefined,
            ...selection.draft,
            componentId: parentComponent?.componentId
        });

        // The range has become an event and its shading has nothing left to stand for; the chip
        // takes its place. Said here because no press said it: committing is a key or a button
        // within the ghost, and the ghost is exempt from clearing the shading.
        calendarRef.current?.unselect();
        setSelection(null);
    }, [ selection, note, parentComponent?.componentId ]);

    /**
     * The ghost given up on rather than pressed away from — Escape, or its own close button.
     * Neither is a press on anything that would settle the shading, so it is let go by hand.
     */
    const cancelDraft = useCallback(() => {
        calendarRef.current?.unselect();
        setSelection(null);
    }, []);

    /**
     * The ghost pressed away from, which is a different thing: the press itself settles what
     * becomes of the shading, and saying anything here would be saying it too early. A press on the
     * grid has already begun the next selection by the time this runs — the drag starts on the
     * press, `selectMinDistance` being 0 — so clearing here would wipe the very range just started,
     * which is why a click used to open a ghost over no shading at all while a drag kept its own
     * (the drag's later moves made the selection again). A press anywhere else clears it through
     * `unselectAuto`, and a press within the ghost is spared by `unselectCancel`.
     */
    const dismissDraft = useCallback(() => setSelection(null), []);

    // An event taken off the calendar takes the dock with it. Not in calendar-root mode, whose
    // events (day notes and their children) are not in the collection's noteIds at all.
    useEffect(() => {
        if (!isCalendarRoot && selection && "noteId" in selection && !noteIds.includes(selection.noteId)) {
            setSelection(null);
        }
    }, [ isCalendarRoot, selection, noteIds ]);

    /**
     * Follows a link inside the event surface whose note stands on this calendar: the surface
     * switches to it — the same as if its chip had been clicked — and the calendar turns to its
     * date, whatever the view (a day, a month), so the chip the surface re-anchors to is on the
     * grid. Answers whether the note stands on the calendar at all, a link to anything else
     * keeping its ordinary meaning (see useFollowLinksWithin in EmbeddedNotePane, and the geo
     * map's followLink, whose bargain this is).
     *
     * The calendar itself is asked rather than the note's labels read: every chip is built with
     * its noteId for an id (see buildEvent), so this honours whatever label names the calendar
     * builds its events by. In calendar-root mode events are fetched by visible range, so a note
     * beyond it is not found and its link keeps its ordinary meaning — a bounded loss, as root
     * calendars are read rather than cross-linked.
     */
    const followLink = useCallback((noteId: string) => {
        const event = calendarRef.current?.getEventById(noteId);
        if (!event) return false;

        // Where the chip is named by the anchor of last resort: null, there being no press on the
        // grid to name one — the popover re-anchors to the first chip drawn (see eventAnchorRect).
        setSelection({ noteId, anchor: null });
        if (event.start) calendarRef.current?.gotoDate(event.start);
        return true;
    }, []);

    // A click on an event opens it into the event surface instead of navigating to the popup the
    // event's `url` names — a popover beside the chip, or a sheet where there is no beside (see
    // EventPopover).
    const onEventClick = useCallback((e: EventClickArg) => {
        // The chip is an anchor at the event's `url`, and the app's document-level link handler
        // (see the delegated listeners in link.ts) would open the popup it names no matter what
        // FullCalendar makes of the click — so the click must not reach the document at all.
        e.jsEvent.preventDefault();
        e.jsEvent.stopPropagation();

        // Which also keeps the click from the tooltip service, whose own document listener is what
        // ordinarily puts a preview away when something is done (see note_tooltip.ts). Said here
        // instead: a preview left standing would cover the very popover the click opens, at the
        // chip both of them are drawn beside.
        note_tooltip.dismissAllTooltips();

        // A menu standing open is what the click is for: putting it away is what a click anywhere
        // means while one is up, and the stop above is what kept this one from saying so on its own
        // (see isShown in context_menu.ts). The event is not opened as well — one press, one thing.
        if (contextMenu.isShown()) {
            void contextMenu.hide();
            return;
        }

        const noteId = e.event.extendedProps.noteId;
        if (noteId) {
            // The click names which of the event's chips to stand by (see eventAnchorRect).
            setSelection({ noteId, anchor: { x: e.jsEvent.clientX, y: e.jsEvent.clientY } });
        }
    }, []);

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
            // Only update the title if it has actually changed.
            // setProp() triggers FullCalendar's eventChange callback, which would
            // re-save the event's dates and cause unwanted side effects.
            if (event.title !== note.title) {
                event.setProp("title", note.title);
            }
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
                slotDuration={effectiveSlotDuration}
                slotLabelInterval={isValidDuration(slotLabelInterval) ? slotLabelInterval : DEFAULT_SLOT_LABEL_INTERVAL}
                height="100%"
                nowIndicator
                handleWindowResize={false}
                initialDate={initialDate || undefined}
                locale={locale}
                {...editingProps}
                // The shading of a dragged range is FullCalendar's to keep and to clear, which it
                // does on the press that follows — except a press within the ghost standing for
                // that very range, whichever shell it wears, which is what the exemption names.
                // Letting it decide is what spares a press on the grid: the next selection has
                // already begun by then, and FullCalendar knows not to clear what the same press
                // has just made.
                unselectCancel=".calendar-ghost-popover, .calendar-ghost-sheet"
                eventClick={onEventClick}
                // The event the popover stands for is marked as such, and asks for no hover
                // preview while it does: the popover beside it already says everything the
                // preview would, at full length and editable, and the two are drawn beside the
                // same chip. The geo map's marker previews keep clear of its detail pane the same
                // way (see Tooltips there).
                eventClassNames={(arg) => selection && "noteId" in selection && arg.event.extendedProps.noteId === selection.noteId
                    ? [ "calendar-event-selected", "no-tooltip-preview" ]
                    : []}
                eventDidMount={eventDidMount}
                viewDidMount={({ view }) => {
                    if (initialView.current !== view.type) {
                        initialView.current = view.type;
                        viewSpacedUpdate.scheduleUpdate();
                    }
                }}
            />
            {selection && "noteId" in selection && (
                <EventPopover
                    noteId={selection.noteId}
                    anchor={selection.anchor}
                    container={containerRef.current}
                    parentNote={note}
                    isEditable={isEditable}
                    onClose={() => setSelection(null)}
                    onFollowLink={followLink}
                />
            )}
            {selection && "draft" in selection && (
                <GhostPopover
                    draft={selection.draft}
                    anchor={selection.anchor}
                    container={containerRef.current}
                    /* Handed over whole rather than fired and forgotten: a creation that fails has
                       to reach the ghost, which is what opens its form again for another try. */
                    onCommit={commitDraft}
                    onCancel={cancelDraft}
                    onDismiss={dismissDraft}
                />
            )}
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
                <PinDateButton note={note} calendarRef={calendarRef} />
                {isMobileLocal && <MobileCalendarViewSwitcher calendarRef={calendarRef} />}
            </>}
            rightChildren={<>
                {!isMobileLocal && <DesktopCalendarViewSwitcher calendarRef={calendarRef} />}
            </>}
        />
    );
}

function PinDateButton({ note, calendarRef }: {
    note: FNote;
    calendarRef: RefObject<FullCalendar>;
}) {
    const [ initialDate, setInitialDate ] = useNoteLabel(note, "calendar:initialDate");
    const isPinned = !!initialDate;

    return (
        <ActionButton
            icon={isPinned ? "bx bxs-pin" : "bx bx-pin"}
            text={isPinned ? t("calendar.unpin_date") : t("calendar.pin_date")}
            onClick={() => {
                if (isPinned) {
                    setInitialDate(null);
                } else {
                    const date = formatDateToLocalISO(calendarRef.current?.view.currentStart);
                    if (date) {
                        setInitialDate(date);
                    }
                }
            }}
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
            plugins.push((await import("@fullcalendar/rrule")).default);
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

function useEditing(note: FNote, isEditable: boolean, isCalendarRoot: boolean, componentId: string | undefined,
    onDraft: (draft: EventDraft, anchor: { x: number; y: number } | null) => void,
    /** The length of one of the grid's slots, which is how long a tapped event lasts. */
    slotDuration: string) {
    const onCalendarSelection = useCallback((e: DateSelectArg) => {
        const { startDate, endDate } = parseStartEndDateFromEvent(e);
        if (!startDate) return;
        const { startTime, endTime } = parseStartEndTimeFromEvent(e);

        // Nothing is created yet: the range is handed over as a draft for the ghost, and a note is
        // made only when the draft is committed (see commitDraft) — a stray drag dismissed costs
        // nothing. The range keeps its shading meanwhile, standing on the grid for the event to be;
        // the view lets it go when the draft resolves. Where the drag ended anchors the ghost
        // beside it (see ghostAnchorRect), which a sheet has no use for.
        onDraft(
            { startDate, endDate, startTime, endTime },
            e.jsEvent ? { x: e.jsEvent.clientX, y: e.jsEvent.clientY } : null
        );
    }, [ onDraft ]);

    const onEventChange = useCallback(async (e: EventChangeArg) => {
        // Only process actual date/time changes, not other property changes (e.g., title via setProp).
        const datesChanged = e.oldEvent.start?.getTime() !== e.event.start?.getTime()
            || e.oldEvent.end?.getTime() !== e.event.end?.getTime()
            || e.oldEvent.allDay !== e.event.allDay;
        if (!datesChanged) return;

        const { startDate, endDate } = parseStartEndDateFromEvent(e.event);
        if (!startDate) return;

        const { startTime, endTime } = parseStartEndTimeFromEvent(e.event);
        const note = await froca.getNote(e.event.extendedProps.noteId);
        if (!note) return;
        changeEvent(note, { startDate, endDate, startTime, endTime, componentId });
    }, [ componentId ]);

    /**
     * A tap or click on the grid itself. In a calendar root that opens or creates the day's note,
     * which is what a day means there. Elsewhere it is the phone's way of making an event: a touch
     * drag asks for a long press before it selects anything (`selectLongPressDelay`), so a tap
     * selects no range and nothing would open at all — the tap stands for a draft instead, which
     * costs nothing if it was a mistake.
     */
    const onDateClick = useCallback(async (e: DateClickArg) => {
        if (isCalendarRoot) {
            const eventNote = await date_notes.getDayNote(e.dateStr, note.noteId);
            if (eventNote) {
                appContext.triggerCommand("openInPopup", { noteIdOrPath: eventNote.noteId });
            }
            return;
        }

        const draft = draftFromDateClick(e, slotDuration);
        if (draft) onDraft(draft, null);
    }, [ note, isCalendarRoot, onDraft, slotDuration ]);

    return {
        select: onCalendarSelection,
        eventChange: onEventChange,
        // A desktop leaves this alone where there are events to make: a click there already
        // selects the range it fell in, and answering the tap as well would raise two ghosts.
        dateClick: isCalendarRoot || (isMobile() && isEditable) ? onDateClick : undefined,
        editable: isEditable,
        selectable: isEditable
    };
}

/**
 * The draft a tap stands for, a tap naming a moment where a drag names a range: the whole of a day
 * where the view deals in days, and the slot it landed in where the view deals in hours.
 *
 * One slot rather than any length of our own, because that is what a click makes of a moment on a
 * desktop — a click selects the slot it fell in, `selectMinDistance` being 0 — and a tap and a
 * click are the same wish. An hour, which this used to give, was an hour whichever way the grid was
 * divided, and a tap between two slots then made an event starting at the quarter or half hour and
 * running an hour from there.
 */
function draftFromDateClick(e: DateClickArg, slotDuration: string): EventDraft | null {
    const startDate = formatDateToLocalISO(e.date);
    if (!startDate) return null;

    if (e.allDay) {
        return { startDate };
    }

    const slotSeconds = parseDurationSeconds(slotDuration) ?? 0;
    const end = new Date(e.date.getTime() + slotSeconds * 1000);
    const endDate = formatDateToLocalISO(end);
    return {
        startDate,
        // Only where the slot runs into the next day; a single day says itself with the start.
        endDate: endDate !== startDate ? endDate : undefined,
        startTime: formatTimeToLocalISO(e.date),
        endTime: formatTimeToLocalISO(end)
    };
}

function useEventDisplayCustomization(parentNote: FNote, componentId: string | undefined,
    /** Puts away whatever surface stands over the calendar, answering whether there was one. */
    dismissSurface: () => boolean) {
    const eventDidMount = useCallback((e: EventMountArg) => {
        const { iconClass, promotedAttributes } = e.event.extendedProps;

        // The chip is tagged with its note, which is how the event popover finds the chip to
        // stand beside — FullCalendar redraws chips at will, so an element held onto would go
        // stale (see eventAnchorRect in EventPopover).
        if (e.event.extendedProps.noteId) {
            e.el.dataset.eventNoteId = String(e.event.extendedProps.noteId);
        }

        // Prepend the icon to the title, if any.
        if (iconClass) {
            let titleContainer: HTMLElement | null = null;
            switch (e.view.type) {
                case "timeGridDay":
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
                const icon = /*html*/`<span class="${escapeHtml(iconClass)}"></span> `;
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
                case "timeGridDay":
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
            // A surface standing open is what the press is for. A menu raised over it would cover
            // the very event it belongs to — the surface is drawn beside that chip — and offer a
            // second, smaller way to do what the surface already offers in full. So the press puts
            // the surface away and stops there; a second one raises the menu over a clear grid.
            //
            // Said here rather than left to the popover's own outside-press dismissal, which spares
            // a press on a chip: that exemption is for a press that switches the surface to another
            // event (see keepOpenSelector), and a right-click asks for no such thing.
            if (dismissSurface()) {
                contextMenuEvent.preventDefault();
                return;
            }

            const note = await froca.getNote(e.event.extendedProps.noteId);
            if (!note) return;

            openCalendarContextMenu(contextMenuEvent, note, parentNote, componentId);
        }

        // A long press raises it on a phone, as a right-click does on a desktop; the tap itself now
        // belongs to the event sheet, which offers what the menu offers and more (see onEventClick).
        e.el.addEventListener("contextmenu", onContextMenu);
    }, [ dismissSurface ]);
    return { eventDidMount };
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
