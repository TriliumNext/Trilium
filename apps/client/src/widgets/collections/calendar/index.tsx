// FullCalendar v7 ships no bundled CSS of its own — the skeleton and the chosen theme have to be
// pulled in by hand. The theme's own palette is deliberately not among them: palette.css states
// the same variables in terms of Trilium's, which is the whole of the theming (see there).
// Imported ahead of index.css so our own rules still come last.
import "fullcalendar/skeleton.css";
import "fullcalendar/themes/forma/theme.css";

import "./palette.css";
import "./index.css";

import { DISPLAYABLE_LOCALE_IDS } from "@triliumnext/commons";
import clsx from "clsx";
import { Calendar as FullCalendar, DateClickInfo, DateSelectInfo, EventChangeInfo, EventClickInfo, EventDisplayInfo, EventSourceFuncInfo, LocaleInput, MountInfo, PluginInput } from "fullcalendar";
import { RefObject } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import FNote from "../../../entities/fnote";
import contextMenu from "../../../menus/context_menu";
import date_notes from "../../../services/date_notes";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import note_tooltip from "../../../services/note_tooltip";
import { isMobile } from "../../../services/utils";
import CollectionProperties from "../../note_bars/CollectionProperties";
import ActionButton from "../../react/ActionButton";
import Button, { ButtonGroup } from "../../react/Button";
import Dropdown from "../../react/Dropdown";
import { FormListItem } from "../../react/FormList";
import { useNoteLabel, useNoteLabelBoolean, useSpacedUpdate, useTriliumEvent, useTriliumOption, useTriliumOptionInt } from "../../react/hooks";
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
    de: () => import("fullcalendar/locales/de"),
    es: () => import("fullcalendar/locales/es"),
    fr: () => import("fullcalendar/locales/fr"),
    it: () => import("fullcalendar/locales/it"),
    hi: () => import("fullcalendar/locales/hi"),
    id: () => import("fullcalendar/locales/id"),
    ga: null,
    cn: () => import("fullcalendar/locales/zh-cn"),
    cs: () => import("fullcalendar/locales/cs"),
    tw: () => import("fullcalendar/locales/zh-tw"),
    ro: () => import("fullcalendar/locales/ro"),
    ru: () => import("fullcalendar/locales/ru"),
    ja: () => import("fullcalendar/locales/ja"),
    ko: () => import("fullcalendar/locales/ko"),
    pt: () => import("fullcalendar/locales/pt"),
    pl: () => import("fullcalendar/locales/pl"),
    "pt_br": () => import("fullcalendar/locales/pt-br"),
    tr: () => import("fullcalendar/locales/tr"),
    uk: () => import("fullcalendar/locales/uk"),
    en: null,
    "en-GB": () => import("fullcalendar/locales/en-gb"),
    "en_rtl": null,
    ar: () => import("fullcalendar/locales/ar")
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
    // FullCalendar v7 sizes itself from its own ResizeObserver; the v6 `updateSize()` nudge this
    // used to need is gone along with the method.
    const isCalendarRoot = (calendarRoot || workspaceCalendarRoot);
    const isEditable = !isCalendarRoot;
    // Worked out once and handed to both the grid and the tap that makes an event of one of its
    // slots (see draftFromDateClick), so that the two cannot come to disagree on a slot's length.
    const effectiveSlotDuration = isValidDuration(slotDuration) ? slotDuration : DEFAULT_SLOT_DURATION;
    const eventBuilder = useMemo(() => {
        if (!isCalendarRoot) {
            return async () => await buildEvents(noteIds);
        }
        return async (e: EventSourceFuncInfo) => await buildEventsForCalendar(note, e);
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

    const { eventContent, eventDidMount } = useEventDisplayCustomization(note, parentComponent?.componentId, dismissSurface);
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
    const onEventClick = useCallback((e: EventClickInfo) => {
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
                slotHeaderInterval={isValidDuration(slotLabelInterval) ? slotLabelInterval : DEFAULT_SLOT_LABEL_INTERVAL}
                height="100%"
                nowIndicator
                borderless
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
                // Named by us so the ghost can find the shading it stands beside, v7 drawing it
                // under a hashed class otherwise (see ghostAnchorRect in GhostPopover). The look
                // is Forma's own, which is one declaration off the palette.
                highlightClass="calendar-highlight"
                eventClick={onEventClick}
                // The event the popover stands for is marked as such, and asks for no hover
                // preview while it does: the popover beside it already says everything the
                // preview would, at full length and editable, and the two are drawn beside the
                // same chip. The geo map's marker previews keep clear of its detail pane the same
                // way (see Tooltips there).
                eventClass={(arg) => clsx(
                    // What the chip's own colouring hangs off, Forma's single-accent chip not
                    // being able to say Trilium's pair of a dark bar over a flat body (see
                    // index.css).
                    "calendar-event",
                    selection && "noteId" in selection && arg.event.extendedProps.noteId === selection.noteId
                        && "calendar-event-selected no-tooltip-preview"
                )}
                eventContent={eventContent}
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
    const [ plugins, setPlugins ] = useState<PluginInput[]>();

    useEffect(() => {
        async function loadPlugins() {
            const plugins: PluginInput[] = [];
            // v7 pulled the theme out of core and made it a plugin; without one the calendar draws
            // with no styling at all.
            plugins.push((await import("fullcalendar/themes/forma")).default);
            plugins.push((await import("fullcalendar/daygrid")).default);
            plugins.push((await import("fullcalendar/timegrid")).default);
            plugins.push((await import("fullcalendar/list")).default);
            plugins.push((await import("fullcalendar/multimonth")).default);
            plugins.push((await import("@fullcalendar/rrule")).default);
            if (isEditable || isCalendarRoot) {
                plugins.push((await import("fullcalendar/interaction")).default);
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
    const onCalendarSelection = useCallback((e: DateSelectInfo) => {
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

    const onEventChange = useCallback(async (e: EventChangeInfo) => {
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
    const onDateClick = useCallback(async (e: DateClickInfo) => {
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
function draftFromDateClick(e: DateClickInfo, slotDuration: string): EventDraft | null {
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
    /**
     * The chip's own content, drawn so the note's icon can lead its title.
     *
     * Rendered rather than reached for after the fact, which is how the icon used to be put there:
     * v7 names its elements with hashed classes, so there is no `.fc-event-title` left to find. The
     * theme hands out the very classes its time and title would have worn, so what is drawn here is
     * Forma's chip with an icon in it rather than something of ours standing in for one.
     */
    const eventContent = useCallback((e: EventDisplayInfo) => {
        const { iconClass, promotedAttributes } = e.event.extendedProps;

        return (
            <>
                {e.timeText && <div className={e.timeClass}>{e.timeText}</div>}
                <div className={e.titleClass}>
                    {iconClass && <span className={`calendar-event-icon ${iconClass}`} />}
                    {e.event.title}
                </div>
                {!!promotedAttributes?.length && hasRoomForAttributes(e) && (
                    <div className="calendar-event-attributes">
                        {(promotedAttributes as Array<[string, string]>).map(([name, value], i) => (
                            <div className="promoted-attribute" key={`${name}-${i}`}>
                                <span className="promoted-attribute-name">{name}</span>
                                {": "}
                                <span className="promoted-attribute-value">{value}</span>
                            </div>
                        ))}
                    </div>
                )}
            </>
        );
    }, []);

    const eventDidMount = useCallback((e: MountInfo<EventDisplayInfo>) => {
        // The chip is tagged with its note, which is how the event popover finds the chip to
        // stand beside — FullCalendar redraws chips at will, so an element held onto would go
        // stale (see eventAnchorRect in EventPopover).
        if (e.event.extendedProps.noteId) {
            e.el.dataset.eventNoteId = String(e.event.extendedProps.noteId);
        }

        // Disable the default context menu.
        e.el.dataset.noContextMenu = "true";

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
    return { eventContent, eventDidMount };
}

/**
 * Whether a chip has the room to say anything beyond its title.
 *
 * Only a timed event on a time grid stacks its content, and only where it is tall enough to. A row
 * event — a month cell's chip, an all-day band — is one centred line however wide it gets, so
 * attributes put there crowd the title along it rather than fall beneath it.
 */
function hasRoomForAttributes(e: EventDisplayInfo) {
    return e.view.type.startsWith("timeGrid") && !e.event.allDay && !e.isShort;
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
