import "../launch_bar/CalendarWidget.css";
import "./DatePicker.css";

import { dayjs, type Dayjs, getWeekStartDate } from "@triliumnext/commons";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import Calendar from "../launch_bar/Calendar";
import { AdjustDateButton, MONTHS } from "../launch_bar/CalendarWidget";
import Button from "./Button";
import { useTriliumOptionInt } from "./hooks";
import { isRightToLeft } from "./menu_context";

export interface DatePickerProps {
    /** The date shown as picked, as `YYYY-MM-DD`, or `undefined` for none. */
    value: string | undefined;
    /** Receives the date picked, as `YYYY-MM-DD`. */
    onChange(date: string): void;
    /** Adds a Clear button, which calls this. */
    onClear?(): void;
}

const DATE_FORMAT = "YYYY-MM-DD";

/**
 * A date picker: a month grid, opening on the month of {@link DatePickerProps.value} with that day
 * marked, above buttons for today, tomorrow and the first day of next week.
 *
 * From the keyboard, Left and Right move across the buttons and Up enters the grid. In the grid,
 * the arrows move by day and week, Page Up and Page Down by month, Home and End to the ends of
 * the week, Enter or Space picks the day, and Down from the last week returns to the buttons.
 * Inside a `Menu`, the grid keeps Up and Down and the buttons keep Up through `data-menu-keys`,
 * and a click on a button or a day closes the menu, as a click on a custom row's control does.
 */
export default function DatePicker({ value, onChange, onClear }: DatePickerProps) {
    const [ rawFirstDayOfWeek ] = useTriliumOptionInt("firstDayOfWeek");
    const firstDayOfWeek = Number.isNaN(rawFirstDayOfWeek) ? 1 : rawFirstDayOfWeek;
    const today = dayjs().startOf("day");
    const activeDate = parseDate(value);
    const [ focusDate, setFocusDate ] = useState(() => activeDate ?? today);
    const [ focusedPreset, setFocusedPreset ] = useState(0);
    /** Counts the keys that moved focus to a day, so each one focuses {@link focusDate} once rendered. */
    const [ dayFocusRequest, setDayFocusRequest ] = useState(0);
    const rootRef = useRef<HTMLDivElement>(null);

    const presets = [
        { title: t("date_picker.today"), date: today },
        { title: t("date_picker.tomorrow"), date: today.add(1, "day") },
        { title: t("date_picker.next-week"), date: startOfNextWeek(today, firstDayOfWeek) }
    ];
    const month = focusDate.startOf("month");

    useLayoutEffect(() => {
        if (!dayFocusRequest) return;
        rootRef.current?.querySelector<HTMLElement>(
            `[data-calendar-date="${focusDate.format(DATE_FORMAT)}"]`)?.focus();
    }, [ dayFocusRequest ]); // eslint-disable-line react-hooks/exhaustive-deps

    // Captured at the window, as `Menu` does: Bootstrap captures Up and Down at the document for
    // anything inside a `.dropdown-menu`, which a handler on the picker would see too late.
    const keyHandler = useRef(onKeyDown);
    keyHandler.current = onKeyDown;
    useLayoutEffect(() => {
        const listener = (e: KeyboardEvent) => keyHandler.current(e);
        window.addEventListener("keydown", listener, true);
        return () => window.removeEventListener("keydown", listener, true);
    }, []);

    function onKeyDown(e: KeyboardEvent) {
        const target = e.target instanceof Element ? e.target : null;
        if (!target || !rootRef.current?.contains(target)) return;
        if (target.closest(".date-picker-presets")) onPresetKeyDown(e);
        else if (target.closest(".date-picker-grid")) onGridKeyDown(e);
    }

    function focusDay(date: Dayjs) {
        setFocusDate(date);
        setDayFocusRequest((request) => request + 1);
    }

    function focusPreset(index: number) {
        setFocusedPreset(index);
        rootRef.current?.querySelectorAll<HTMLElement>(".date-picker-presets button")[index]?.focus();
    }

    function onPresetKeyDown(e: KeyboardEvent) {
        const count = presets.length + (onClear ? 1 : 0);
        const forward = isRightToLeft() ? "ArrowLeft" : "ArrowRight";
        const back = isRightToLeft() ? "ArrowRight" : "ArrowLeft";
        if (e.key === forward) focusPreset((focusedPreset + 1) % count);
        else if (e.key === back) focusPreset((focusedPreset - 1 + count) % count);
        else if (e.key === "ArrowUp") focusDay(focusDate);
        else return;
        e.preventDefault();
        e.stopPropagation();
    }

    function onGridKeyDown(e: KeyboardEvent) {
        const rtl = isRightToLeft();
        const gridEnd = getWeekStartDate(month.endOf("month"), isoWeekday(firstDayOfWeek)).add(6, "day");
        const weekStart = getWeekStartDate(focusDate, isoWeekday(firstDayOfWeek));
        switch (e.key) {
            case "ArrowLeft": focusDay(focusDate.add(rtl ? 1 : -1, "day")); break;
            case "ArrowRight": focusDay(focusDate.add(rtl ? -1 : 1, "day")); break;
            case "ArrowUp": focusDay(focusDate.subtract(7, "day")); break;
            case "ArrowDown":
                if (focusDate.add(7, "day").isAfter(gridEnd, "day")) focusPreset(focusedPreset);
                else focusDay(focusDate.add(7, "day"));
                break;
            case "PageUp": focusDay(focusDate.subtract(1, "month")); break;
            case "PageDown": focusDay(focusDate.add(1, "month")); break;
            case "Home": focusDay(weekStart); break;
            case "End": focusDay(weekStart.add(6, "day")); break;
            // A click, so that a menu the picker stands in closes as it does for a pointer.
            case "Enter":
            case " ":
                (e.target as HTMLElement).click();
                break;
            default: return;
        }
        e.preventDefault();
        e.stopPropagation();
    }

    return (
        <div ref={rootRef} className="calendar-dropdown-widget date-picker">
            <div className="calendar-header">
                <AdjustDateButton date={month} setDate={setFocusDate} direction="prev" unit="month" />
                <span className="date-picker-title">{MONTHS[month.month()]} {month.year()}</span>
                <AdjustDateButton date={month} setDate={setFocusDate} direction="next" unit="month" />
            </div>
            <div className="date-picker-grid" data-menu-keys="ArrowUp ArrowDown">
                <Calendar
                    date={month}
                    todaysDate={today}
                    activeDate={activeDate}
                    focusDate={focusDate}
                    weekNotes={[]}
                    markDayNotes={false}
                    onDateClicked={(date) => onChange(date)}
                />
            </div>
            <div className="date-picker-presets" role="group" data-menu-keys="ArrowUp">
                {presets.map(({ title, date }, index) => {
                    const pressed = !!activeDate?.isSame(date, "day");
                    return (
                        <Button
                            key={title} text={title} kind="lowProfile"
                            className={pressed ? "active" : undefined} aria-pressed={pressed}
                            tabIndex={index === focusedPreset ? 0 : -1}
                            onClick={() => onChange(date.format(DATE_FORMAT))}
                        />
                    );
                })}
                {onClear && (
                    <Button
                        text={t("date_picker.clear")} kind="lowProfile"
                        tabIndex={focusedPreset === presets.length ? 0 : -1}
                        onClick={onClear}
                    />
                )}
            </div>
        </div>
    );
}

function parseDate(value: string | undefined) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = dayjs(`${value}T00:00:00`);
    return date.isValid() ? date : null;
}

/** `firstDayOfWeek` (0 for Sunday) as an ISO weekday (7 for Sunday). */
function isoWeekday(firstDayOfWeek: number) {
    return firstDayOfWeek === 0 ? 7 : firstDayOfWeek;
}

function startOfNextWeek(today: Dayjs, firstDayOfWeek: number) {
    return getWeekStartDate(today, isoWeekday(firstDayOfWeek)).add(7, "day");
}
