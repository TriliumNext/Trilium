import "./CalendarWidget.css";

import type { RefObject } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import FNote from "../../entities/fnote";
import date_notes from "../../services/date_notes";
import { type Dayjs, dayjs } from "../../services/dayjs";
import { t } from "../../services/i18n";
import search from "../../services/search";
import server from "../../services/server";
import toast from "../../services/toast";
import ActionButton from "../react/ActionButton";
import type { DropdownHandle } from "../react/Dropdown";
import FormDropdownList from "../react/FormDropdownList";
import FormTextBox from "../react/FormTextBox";
import Calendar, { CalendarArgs } from "./Calendar";

export const MONTHS = [
    t("calendar.january"),
    t("calendar.february"),
    t("calendar.march"),
    t("calendar.april"),
    t("calendar.may"),
    t("calendar.june"),
    t("calendar.july"),
    t("calendar.august"),
    t("calendar.september"),
    t("calendar.october"),
    t("calendar.november"),
    t("calendar.december")
];

/**
 * The content of the calendar launcher's dropdown, which `CalendarWidget` imports once the dropdown is
 * first shown. Each time `shownCount` grows, it goes back to the month of the active note's date.
 */
export default function CalendarDropdown({ shownCount, dropdownRef }: {
    shownCount: number;
    dropdownRef: RefObject<DropdownHandle | null>;
}) {
    const [ calendarArgs, setCalendarArgs ] = useState<Pick<CalendarArgs, "activeDate" | "todaysDate">>();
    const [ date, setDate ] = useState<Dayjs>();
    const [ enableWeekNotes, setEnableWeekNotes ] = useState(false);
    const [ weekNotes, setWeekNotes ] = useState<string[]>([]);
    const calendarRootRef = useRef<FNote | undefined>(undefined);

    async function checkEnableWeekNotes() {
        if (!calendarRootRef.current) {
            const notes = await search.searchForNotes("#calendarRoot");
            if (!notes.length) return;
            calendarRootRef.current = notes[0];
        }

        if (!calendarRootRef.current) return;

        const enableWeekNotes = calendarRootRef.current.hasLabel("enableWeekNote");
        setEnableWeekNotes(enableWeekNotes);

        if (enableWeekNotes) {
            server.get<string[]>(`attribute-values/weekNote`).then(setWeekNotes);
        }
    }

    // Before the paint, so the dropdown never shows without its dates.
    useLayoutEffect(() => {
        const dateNote = appContext.tabManager.getActiveContextNote()?.getOwnedLabelValue("dateNote");
        const activeDate = dateNote ? dayjs(`${dateNote}T12:00:00`) : null;
        const todaysDate = dayjs();
        setCalendarArgs({
            activeDate,
            todaysDate
        });
        setDate(dayjs(activeDate || todaysDate).startOf("month"));
        // Non-critical.
        checkEnableWeekNotes().catch(() => {});
    }, [ shownCount ]);

    if (!calendarArgs || !date) {
        return null;
    }

    return (
        <div className="calendar-dropdown-widget">
            <CalendarHeader date={date} setDate={setDate} />
            <Calendar
                date={date}
                onDateClicked={async (date, e) => {
                    const note = await date_notes.getDayNote(date);
                    if (note) {
                        appContext.tabManager.getActiveContext()?.setNote(note.noteId);
                        dropdownRef.current?.hide();
                    } else {
                        toast.showError(t("calendar.cannot_find_day_note"));
                    }
                    e.stopPropagation();
                }}
                onWeekClicked={enableWeekNotes ? async (week, e) => {
                    const note = await date_notes.getWeekNote(week);
                    if (note) {
                        appContext.tabManager.getActiveContext()?.setNote(note.noteId);
                        dropdownRef.current?.hide();
                    } else {
                        toast.showError(t("calendar.cannot_find_week_note"));
                    }
                    e.stopPropagation();
                } : undefined}
                weekNotes={weekNotes}
                {...calendarArgs}
            />
        </div>
    );
}

interface CalendarHeaderProps {
    date: Dayjs;
    setDate(date: Dayjs): void;
}

function CalendarHeader(props: CalendarHeaderProps) {
    return (
        <div className="calendar-header">
            <CalendarMonthSelector {...props} />
            <CalendarYearSelector {...props} />
        </div>
    )
}

function CalendarMonthSelector({ date, setDate }: CalendarHeaderProps) {
    const months = useMemo(() => (
        Array.from(MONTHS.entries().map(([ index, text ]) => ({
            index: index.toString(), text
        })))
    ), []);

    return (
        <div className="calendar-month-selector">
            <AdjustDateButton date={date} setDate={setDate} direction="prev" unit="month" />
            <FormDropdownList
                values={months} currentValue={date.month().toString()}
                keyProperty="index" titleProperty="text"
                onChange={(index) => setDate(date.set("month", parseInt(index, 10)))}
                buttonProps={{ "data-calendar-input": "month" }}
            />
            <AdjustDateButton date={date} setDate={setDate} direction="next" unit="month" />
        </div>
    );
}

function CalendarYearSelector({ date, setDate }: CalendarHeaderProps) {
    return (
        <div className="calendar-year-selector">
            <AdjustDateButton date={date} setDate={setDate} direction="prev" unit="year" />
            <FormTextBox
                type="number"
                min="1900" max="2999" step="1"
                currentValue={date.year().toString()}
                onChange={(newValue) => {
                    const year = parseInt(newValue, 10);
                    if (!Number.isNaN(year)) {
                        setDate(date.set("year", year));
                    }
                }}
                data-calendar-input="year"
            />
            <AdjustDateButton date={date} setDate={setDate} direction="next" unit="year" />
        </div>
    )
}

export function AdjustDateButton({ date, setDate, unit, direction }: CalendarHeaderProps & {
    direction: "prev" | "next",
    unit: "month" | "year"
}) {
    return (
        <ActionButton
            icon={direction === "prev" ? "bx bx-chevron-left" : "bx bx-chevron-right" }
            className="calendar-btn tn-tool-button"
            noIconActionClass
            text=""
            onClick={(e) => {
                e.stopPropagation();
                const newDate = direction === "prev" ? date.subtract(1, unit) : date.add(1, unit);
                setDate(newDate);
            }}
        />
    )
}
