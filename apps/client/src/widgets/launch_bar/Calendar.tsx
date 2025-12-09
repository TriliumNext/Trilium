import { useTriliumOptionInt } from "../react/hooks";
import clsx from "clsx";
import server from "../../services/server";
import { TargetedMouseEvent, VNode } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Dayjs } from "@triliumnext/commons";
import { t } from "../../services/i18n";

interface DateNotesForMonth {
    [date: string]: string;
}

const DAYS_OF_WEEK = [
    t("calendar.sun"),
    t("calendar.mon"),
    t("calendar.tue"),
    t("calendar.wed"),
    t("calendar.thu"),
    t("calendar.fri"),
    t("calendar.sat")
];

interface DateRangeInfo {
    weekNumbers: number[];
    dates: Dayjs[];
}

export interface CalendarArgs {
    date: Dayjs;
    todaysDate: Dayjs;
    activeDate: Dayjs | null;
    onDateClicked(date: string, e: TargetedMouseEvent<HTMLAnchorElement>): void;
    onWeekClicked?: (week: string, e: TargetedMouseEvent<HTMLAnchorElement>) => void;
    weekNotes: string[];
}

export default function Calendar(args: CalendarArgs) {
    const [ rawFirstDayOfWeek ] = useTriliumOptionInt("firstDayOfWeek");
    const firstDayOfWeekISO = (rawFirstDayOfWeek === 0 ? 7 : rawFirstDayOfWeek);

    const date = args.date;
    const firstDay = date.startOf('month');
    const firstDayISO = firstDay.isoWeekday();
    const monthInfo = getMonthInformation(date, firstDayISO, firstDayOfWeekISO);

    return (
        <>
            <CalendarWeekHeader rawFirstDayOfWeek={rawFirstDayOfWeek} />
            <div className="calendar-body" data-calendar-area="month">
                {firstDayISO !== firstDayOfWeekISO && <PreviousMonthDays info={monthInfo.prevMonth} {...args} />}
                <CurrentMonthDays firstDayOfWeekISO={firstDayOfWeekISO} {...args} />
                <NextMonthDays dates={monthInfo.nextMonth.dates} {...args} />
            </div>
        </>
    )
}

function CalendarWeekHeader({ rawFirstDayOfWeek }: { rawFirstDayOfWeek: number }) {
    let localeDaysOfWeek = [...DAYS_OF_WEEK];
    const shifted = localeDaysOfWeek.splice(0, rawFirstDayOfWeek);
    localeDaysOfWeek = ['', ...localeDaysOfWeek, ...shifted];

    return (
        <div className="calendar-week">
            {localeDaysOfWeek.map(dayOfWeek => <span key={dayOfWeek}>{dayOfWeek}</span>)}
        </div>
    )
}

function PreviousMonthDays({ date, info: { dates, weekNumbers }, ...args }: { date: Dayjs, info: DateRangeInfo } & CalendarArgs) {
    const prevMonth = date.subtract(1, 'month').format('YYYY-MM');
    const [ dateNotesForPrevMonth, setDateNotesForPrevMonth ] = useState<DateNotesForMonth>();

    useEffect(() => {
        server.get<DateNotesForMonth>(`special-notes/notes-for-month/${prevMonth}`).then(setDateNotesForPrevMonth);
    }, [ date ]);

    return (
        <>
            <CalendarWeek date={date} weekNumber={weekNumbers[0]} {...args} />
            {dates.map(date => <CalendarDay key={date.toISOString()} date={date} dateNotesForMonth={dateNotesForPrevMonth} className="calendar-date-prev-month" {...args} />)}
        </>
    )
}

function CurrentMonthDays({ date, firstDayOfWeekISO, ...args }: { date: Dayjs, firstDayOfWeekISO: number } & CalendarArgs) {
    let dateCursor = date;
    const currentMonth = date.month();
    const items: VNode[] = [];
    const curMonthString = date.format('YYYY-MM');
    const [ dateNotesForCurMonth, setDateNotesForCurMonth ] = useState<DateNotesForMonth>();

    useEffect(() => {
        server.get<DateNotesForMonth>(`special-notes/notes-for-month/${curMonthString}`).then(setDateNotesForCurMonth);
    }, [ date ]);

    while (dateCursor.month() === currentMonth) {
        const weekNumber = getWeekNumber(dateCursor, firstDayOfWeekISO);
        if (dateCursor.isoWeekday() === firstDayOfWeekISO) {
            items.push(<CalendarWeek key={`${dateCursor.year()}-W${weekNumber}`} date={dateCursor} weekNumber={weekNumber} {...args}/>)
        }

        items.push(<CalendarDay key={dateCursor.toISOString()} date={dateCursor} dateNotesForMonth={dateNotesForCurMonth} {...args} />)
        dateCursor = dateCursor.add(1, "day");
    }

    return items;
}

function NextMonthDays({ date, dates, ...args }: { date: Dayjs, dates: Dayjs[] } & CalendarArgs) {
    const nextMonth = date.add(1, 'month').format('YYYY-MM');
    const [ dateNotesForNextMonth, setDateNotesForNextMonth ] = useState<DateNotesForMonth>();

    useEffect(() => {
        server.get<DateNotesForMonth>(`special-notes/notes-for-month/${nextMonth}`).then(setDateNotesForNextMonth);
    }, [ date ]);

    return dates.map(date => (
        <CalendarDay key={date.toISOString()} date={date} dateNotesForMonth={dateNotesForNextMonth} className="calendar-date-next-month" {...args} />
    ));
}

function CalendarDay({ date, dateNotesForMonth, className, activeDate, todaysDate, onDateClicked }: { date: Dayjs, dateNotesForMonth?: DateNotesForMonth, className?: string } & CalendarArgs) {
    const dateString = date.local().format('YYYY-MM-DD');
    const dateNoteId = dateNotesForMonth?.[dateString];
    return (
        <a
            className={clsx("calendar-date", className,
                dateNoteId && "calendar-date-exists",
                date.isSame(activeDate, "day") && "calendar-date-active",
                date.isSame(todaysDate, "day") && "calendar-date-today"
            )}
            data-calendar-date={date.local().format("YYYY-MM-DD")}
            data-href={dateNoteId && `#root/${dateNoteId}`}
            onClick={(e) => onDateClicked(dateString, e)}
        >
            <span>
                {date.date()}
            </span>
        </a>
    );
}

function CalendarWeek({ date, weekNumber, weekNotes, onWeekClicked }: { weekNumber: number, weekNotes: string[] } & Pick<CalendarArgs, "date" | "onWeekClicked">) {
    const localDate = date.local();

    // Handle case where week is in between years.
    let year = localDate.year();
    if (localDate.month() === 11 && weekNumber === 1) year++;

    const weekString = `${year}-W${String(weekNumber).padStart(2, '0')}`;

    if (onWeekClicked) {
        return (
            <a
                className={clsx("calendar-week-number", "calendar-date",
                    weekNotes.includes(weekString) && "calendar-date-exists")}
                data-calendar-week-number={weekNumber}
                data-date={date.local().format("YYYY-MM-DD")}
                onClick={(e) => onWeekClicked(weekString, e)}
            >{weekNumber}</a>
        )
    }

    return (
        <span
            className="calendar-week-number calendar-week-number-disabled"
            data-calendar-week-number={weekNumber}
        >{weekNumber}</span>);
}

export function getMonthInformation(date: Dayjs, firstDayISO: number, firstDayOfWeekISO: number) {
    return {
        prevMonth: getPrevMonthDays(date, firstDayISO, firstDayOfWeekISO),
        nextMonth: getNextMonthDays(date, firstDayOfWeekISO)
    }
}

function getPrevMonthDays(date: Dayjs, firstDayISO: number, firstDayOfWeekISO: number): DateRangeInfo {
    const prevMonthLastDay = date.subtract(1, 'month').endOf('month');
    const daysToAdd = (firstDayISO - firstDayOfWeekISO + 7) % 7;
    const dates: Dayjs[] = [];

    const firstDay = date.startOf('month');
    const weekNumber = getWeekNumber(firstDay, firstDayOfWeekISO);

    // Get dates from previous month
    for (let i = daysToAdd - 1; i >= 0; i--) {
        dates.push(prevMonthLastDay.subtract(i, 'day'));
    }

    return { weekNumbers: [ weekNumber ], dates };
}

function getNextMonthDays(date: Dayjs, firstDayOfWeekISO: number): DateRangeInfo {
    const lastDayOfMonth = date.endOf('month');
    const lastDayISO = lastDayOfMonth.isoWeekday();
    const lastDayOfUserWeek = ((firstDayOfWeekISO + 6 - 1) % 7) + 1;
    const nextMonthFirstDay = date.add(1, 'month').startOf('month');
    const dates: Dayjs[] = [];

    if (lastDayISO !== lastDayOfUserWeek) {
        const daysToAdd = (lastDayOfUserWeek - lastDayISO + 7) % 7;

        for (let i = 0; i < daysToAdd; i++) {
            dates.push(nextMonthFirstDay.add(i, 'day'));
        }
    }
    return { weekNumbers: [], dates };
}

export function getWeekNumber(date: Dayjs, firstDayOfWeekISO: number): number {
    const weekStart = getWeekStartDate(date, firstDayOfWeekISO);
    return weekStart.isoWeek();
}

function getWeekStartDate(date: Dayjs, firstDayOfWeekISO: number): Dayjs {
    const currentISO = date.isoWeekday();
    const diff = (currentISO - firstDayOfWeekISO + 7) % 7;
    return date.clone().subtract(diff, "day").startOf("day");
}
