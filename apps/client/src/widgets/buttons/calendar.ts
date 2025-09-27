import { t } from "../../services/i18n.js";
import dateNoteService from "../../services/date_notes.js";
import server from "../../services/server.js";
import appContext from "../../components/app_context.js";
import RightDropdownButtonWidget from "./right_dropdown_button.js";
import toastService from "../../services/toast.js";
import options from "../../services/options.js";
import { Dropdown } from "bootstrap";
import type { EventData } from "../../components/app_context.js";
import dayjs, { Dayjs } from "dayjs";
import utc from "dayjs/plugin/utc.js";
import isSameOrAfter from "dayjs/plugin/isSameOrAfter.js";
import "../../stylesheets/calendar.css";
import type { AttributeRow } from "@triliumnext/commons";

dayjs.extend(utc);
dayjs.extend(isSameOrAfter);

const MONTHS = [
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

const DROPDOWN_TPL = `
<div class="calendar-dropdown-widget">
    <style>
        .calendar-dropdown-widget {
            width: 400px;
        }
    </style>

    <div class="calendar-header">
        <div class="calendar-month-selector">
            <button class="calendar-btn tn-tool-button bx bx-chevron-left" data-calendar-toggle="previous"></button>

            <button class="btn dropdown-toggle select-button" type="button"
                data-bs-toggle="dropdown" data-bs-auto-close="true"
                aria-expanded="false"
                data-calendar-input="month"></button>
            <ul class="dropdown-menu" data-calendar-input="month-list">
                ${Object.entries(MONTHS)
        .map(([i, month]) => `<li><button class="dropdown-item" data-value=${i}>${month}</button></li>`)
        .join("")}
            </ul>

            <button class="calendar-btn tn-tool-button bx bx-chevron-right" data-calendar-toggle="next"></button>
        </div>

        <div class="calendar-year-selector">
            <button class="calendar-btn tn-tool-button bx bx-chevron-left" data-calendar-toggle="previousYear"></button>

            <input type="number" min="1900" max="2999" step="1" data-calendar-input="year" />

            <button class="calendar-btn tn-tool-button bx bx-chevron-right" data-calendar-toggle="nextYear"></button>
        </div>
    </div>

    <div class="calendar-week"></div>
    <div class="calendar-body" data-calendar-area="month"></div>
</div>`;

const DAYS_OF_WEEK = [t("calendar.sun"), t("calendar.mon"), t("calendar.tue"), t("calendar.wed"), t("calendar.thu"), t("calendar.fri"), t("calendar.sat")];

interface DateNotesForMonth {
    [date: string]: string;
}

interface WeekCalculationOptions {
    firstWeekType: number;
    minDaysInFirstWeek: number;
}

export default class CalendarWidget extends RightDropdownButtonWidget {
    private $month!: JQuery<HTMLElement>;
    private $weekHeader!: JQuery<HTMLElement>;
    private $monthSelect!: JQuery<HTMLElement>;
    private $yearSelect!: JQuery<HTMLElement>;
    private $next!: JQuery<HTMLElement>;
    private $previous!: JQuery<HTMLElement>;
    private $nextYear!: JQuery<HTMLElement>;
    private $previousYear!: JQuery<HTMLElement>;
    private monthDropdown!: Dropdown;
    private firstDayOfWeek!: number;
    private weekCalculationOptions!: WeekCalculationOptions;
    private activeDate: Dayjs | null = null;
    private todaysDate!: Dayjs;
    private date!: Dayjs;
    private weekNoteEnable: boolean = false;
    private weekNotes: string[] = [];

    constructor(title: string = "", icon: string = "") {
        super(title, icon, DROPDOWN_TPL);
    }

    doRender() {
        super.doRender();

        this.$month = this.$dropdownContent.find('[data-calendar-area="month"]');
        this.$weekHeader = this.$dropdownContent.find(".calendar-week");

        this.manageFirstDayOfWeek();
        this.initWeekCalculation();

        // Month navigation
        this.$monthSelect = this.$dropdownContent.find('[data-calendar-input="month"]');
        this.$monthSelect.on("show.bs.dropdown", (e) => {
            // Don't trigger dropdownShown() at widget level when the month selection dropdown is shown, since it would cause a redundant refresh.
            e.stopPropagation();
        });
        this.monthDropdown = Dropdown.getOrCreateInstance(this.$monthSelect[0]);
        this.$dropdownContent.find('[data-calendar-input="month-list"] button').on("click", (e) => {
            const target = e.target as HTMLElement;
            const value = target.dataset.value;
            if (value) {
                this.date = this.date.month(parseInt(value));
                this.createMonth();
            }
        });
        this.$next = this.$dropdownContent.find('[data-calendar-toggle="next"]');
        this.$next.on("click", () => {
            this.date = this.date.add(1, 'month');
            this.createMonth();
        });
        this.$previous = this.$dropdownContent.find('[data-calendar-toggle="previous"]');
        this.$previous.on("click", () => {
            this.date = this.date.subtract(1, 'month');
            this.createMonth();
        });

        // Year navigation
        this.$yearSelect = this.$dropdownContent.find('[data-calendar-input="year"]');
        this.$yearSelect.on("input", (e) => {
            const target = e.target as HTMLInputElement;
            this.date = this.date.year(parseInt(target.value));
            this.createMonth();
        });
        this.$nextYear = this.$dropdownContent.find('[data-calendar-toggle="nextYear"]');
        this.$nextYear.on("click", () => {
            this.date = this.date.add(1, 'year');
            this.createMonth();
        });
        this.$previousYear = this.$dropdownContent.find('[data-calendar-toggle="previousYear"]');
        this.$previousYear.on("click", () => {
            this.date = this.date.subtract(1, 'year');
            this.createMonth();
        });

        this.$dropdownContent.on("click", ".calendar-date", async (ev) => {
            const date = $(ev.target).closest(".calendar-date").attr("data-calendar-date");

            if (date) {
                const note = await dateNoteService.getDayNote(date);

                if (note) {
                    appContext.tabManager.getActiveContext()?.setNote(note.noteId);
                    this.dropdown?.hide();
                } else {
                    toastService.showError(t("calendar.cannot_find_day_note"));
                }
            }

            ev.stopPropagation();
        });

        this.$dropdownContent.on("click", ".calendar-week-number", async (ev) => {
            if (!this.weekNoteEnable) {
                return;
            }

            const week = $(ev.target).closest(".calendar-week-number").attr("data-calendar-week-number");

            if (week) {
                const note = await dateNoteService.getWeekNote(week);

                if (note) {
                    appContext.tabManager.getActiveContext()?.setNote(note.noteId);
                    this.dropdown?.hide();
                } else {
                    toastService.showError(t("calendar.cannot_find_week_note"));
                }
            }

            ev.stopPropagation();
        });

        // Handle click events for the entire calendar widget
        this.$dropdownContent.on("click", (e) => {
            const $target = $(e.target);

            // Keep dropdown open when clicking on month select button or year selector area
            if ($target.closest('.btn.dropdown-toggle.select-button').length ||
                $target.closest('.calendar-year-selector').length) {
                e.stopPropagation();
                return;
            }

            // Hide dropdown for all other cases
            this.monthDropdown.hide();
            // Prevent dismissing the calendar popup by clicking on an empty space inside it.
            e.stopPropagation();
        });
    }

    private async getWeekNoteEnable() {
        const noteId = await server.get<string[]>(`search/${encodeURIComponent('#calendarRoot')}`);
        if (noteId.length === 0) {
            this.weekNoteEnable = false;
            return;
        }
        const noteAttributes = await server.get<AttributeRow[]>(`notes/${noteId}/attributes`);

        for (const attribute of noteAttributes) {
            if (attribute.name === 'enableWeekNote') {
                this.weekNoteEnable = true;
                return
            }
        }
        this.weekNoteEnable = false;
    }

    manageFirstDayOfWeek() {
        this.firstDayOfWeek = options.getInt("firstDayOfWeek") || 0;

        // Generate the list of days of the week taking into consideration the user's selected first day of week.
        let localeDaysOfWeek = [...DAYS_OF_WEEK];
        const daysToBeAddedAtEnd = localeDaysOfWeek.splice(0, this.firstDayOfWeek);
        localeDaysOfWeek = ['', ...localeDaysOfWeek, ...daysToBeAddedAtEnd];
        this.$weekHeader.html(localeDaysOfWeek.map((el) => `<span>${el}</span>`).join(''));
    }

    initWeekCalculation() {
        this.weekCalculationOptions = {
            firstWeekType: options.getInt("firstWeekOfYear") || 0,
            minDaysInFirstWeek: options.getInt("minDaysInFirstWeek") || 4
        };
    }

    getWeekNumber(date: Dayjs): number {
        const year = date.year();
        const dayOfWeek = (day: number) => (day - this.firstDayOfWeek + 7) % 7;

        // Get first day of the year and adjust to first week start
        const jan1 = date.clone().year(year).month(0).date(1);
        const jan1Weekday = jan1.day();
        const dayOffset = dayOfWeek(jan1Weekday);
        let firstWeekStart = jan1.clone().subtract(dayOffset, 'day');

        // Adjust based on week rule
        switch (this.weekCalculationOptions.firstWeekType) {
            case 1: { // ISO 8601: first week contains Thursday
                const thursday = firstWeekStart.clone().add(3, 'day'); // Monday + 3 = Thursday
                if (thursday.year() < year) {
                    firstWeekStart = firstWeekStart.add(7, 'day');
                }
                break;
            }
            case 2: { // minDaysInFirstWeek rule
                const daysInFirstWeek = 7 - dayOffset;
                if (daysInFirstWeek < this.weekCalculationOptions.minDaysInFirstWeek) {
                    firstWeekStart = firstWeekStart.add(7, 'day');
                }
                break;
            }
            // default case 0: week containing Jan 1 → already handled
        }

        const diffDays = date.startOf('day').diff(firstWeekStart.startOf('day'), 'day');
        const weekNumber = Math.floor(diffDays / 7) + 1;

        // Handle case when date is before first week start → belongs to last week of previous year
        if (weekNumber <= 0) {
            return this.getWeekNumber(date.subtract(1, 'day'));
        }

        // Handle case when date belongs to first week of next year
        const nextYear = year + 1;
        const jan1Next = date.clone().year(nextYear).month(0).date(1);
        const jan1WeekdayNext = jan1Next.day();
        const offsetNext = dayOfWeek(jan1WeekdayNext);
        let nextYearWeekStart = jan1Next.clone().subtract(offsetNext, 'day');

        switch (this.weekCalculationOptions.firstWeekType) {
            case 1: {
                const thursday = nextYearWeekStart.clone().add(3, 'day');
                if (thursday.year() < nextYear) {
                    nextYearWeekStart = nextYearWeekStart.add(7, 'day');
                }
                break;
            }
            case 2: {
                const daysInFirstWeek = 7 - offsetNext;
                if (daysInFirstWeek < this.weekCalculationOptions.minDaysInFirstWeek) {
                    nextYearWeekStart = nextYearWeekStart.add(7, 'day');
                }
                break;
            }
        }

        if (date.isSameOrAfter(nextYearWeekStart)) {
            return 1;
        }

        return weekNumber;
    }

    async dropdownShown() {
        await this.getWeekNoteEnable();
        this.weekNotes = await server.get<string[]>(`attribute-values/weekNote`);
        this.init(appContext.tabManager.getActiveContextNote()?.getOwnedLabelValue("dateNote") ?? null);
    }

    init(activeDate: string | null) {
        // attaching time fixes local timezone handling
        this.activeDate = activeDate ? dayjs(`${activeDate}T12:00:00`) : null;
        this.todaysDate = dayjs();
        this.date = dayjs(this.activeDate || this.todaysDate).startOf('month');

        this.createMonth();
    }

    createDay(dateNotesForMonth: DateNotesForMonth, num: number) {
        const $newDay = $("<a>").addClass("calendar-date").attr("data-calendar-date", this.date.local().format('YYYY-MM-DD'));
        const $date = $("<span>").html(String(num));

        const dateNoteId = dateNotesForMonth[this.date.local().format('YYYY-MM-DD')];

        if (dateNoteId) {
            $newDay.addClass("calendar-date-exists");
            $newDay.attr("data-href", `#root/${dateNoteId}`);
        }

        if (this.date.isSame(this.activeDate, 'day')) {
            $newDay.addClass("calendar-date-active");
        }

        if (this.date.isSame(this.todaysDate, 'day')) {
            $newDay.addClass("calendar-date-today");
        }

        $newDay.append($date);
        return $newDay;
    }

    createWeekNumber(weekNumber: number) {
        const weekNoteId = this.date.local().format('YYYY-') + 'W' + String(weekNumber).padStart(2, '0');

        let $newWeekNumber;
        if (this.weekNoteEnable) {
            // Utilize the hover effect of calendar-date
            $newWeekNumber = $("<a>").addClass("calendar-date");

            if (this.weekNotes.includes(weekNoteId)) {
                $newWeekNumber.addClass("calendar-date-exists");
                $newWeekNumber.attr("data-href", `#root/${weekNoteId}`);
            }

        } else {
            $newWeekNumber = $("<span>").addClass("calendar-week-number-disabled");
        }
        $newWeekNumber.addClass("calendar-week-number").attr("data-calendar-week-number", weekNoteId);
        $newWeekNumber.append($("<span>").html(String(weekNumber)));

        return $newWeekNumber;
    }

    private getPrevMonthDays(firstDayOfWeek: number): { weekNumber: number, dates: Dayjs[] } {
        const prevMonthLastDay = this.date.subtract(1, 'month').endOf('month');
        const daysToAdd = (firstDayOfWeek - this.firstDayOfWeek + 7) % 7;
        const dates: Dayjs[] = [];

        const firstDay = this.date.startOf('month');
        const weekNumber = this.getWeekNumber(firstDay);

        // Get dates from previous month
        for (let i = daysToAdd - 1; i >= 0; i--) {
            dates.push(prevMonthLastDay.subtract(i, 'day'));
        }

        return { weekNumber, dates };
    }

    private getNextMonthDays(lastDayOfWeek: number): Dayjs[] {
        const nextMonthFirstDay = this.date.add(1, 'month').startOf('month');
        const dates: Dayjs[] = [];

        const lastDayOfUserWeek = (this.firstDayOfWeek + 6) % 7;
        const daysToAdd = (lastDayOfUserWeek - lastDayOfWeek + 7) % 7;

        // Get dates from next month
        for (let i = 0; i < daysToAdd; i++) {
            dates.push(nextMonthFirstDay.add(i, 'day'));
        }

        return dates;
    }

    async createMonth() {
        const month = this.date.format('YYYY-MM');
        const dateNotesForMonth: DateNotesForMonth = await server.get(`special-notes/notes-for-month/${month}`);

        this.$month.empty();

        const firstDay = this.date.startOf('month');
        const firstDayOfWeek = firstDay.day();

        // Add dates from previous month
        if (firstDayOfWeek !== this.firstDayOfWeek) {
            const { weekNumber, dates } = this.getPrevMonthDays(firstDayOfWeek);

            const prevMonth = this.date.subtract(1, 'month').format('YYYY-MM');
            const dateNotesForPrevMonth: DateNotesForMonth = await server.get(`special-notes/notes-for-month/${prevMonth}`);

            const $weekNumber = this.createWeekNumber(weekNumber);
            this.$month.append($weekNumber);

            dates.forEach(date => {
                const tempDate = this.date;
                this.date = date;
                const $day = this.createDay(dateNotesForPrevMonth, date.date());
                $day.addClass('calendar-date-prev-month');
                this.$month.append($day);
                this.date = tempDate;
            });
        }

        const currentMonth = this.date.month();

        while (this.date.month() === currentMonth) {
            const weekNumber = this.getWeekNumber(this.date);

            // Add week number if it's first day of week
            if (this.date.day() === this.firstDayOfWeek) {
                const $weekNumber = this.createWeekNumber(weekNumber);
                this.$month.append($weekNumber);
            }

            const $day = this.createDay(dateNotesForMonth, this.date.date());
            this.$month.append($day);

            this.date = this.date.add(1, 'day');
        }
        // while loop trips over and day is at 30/31, bring it back
        this.date = this.date.startOf('month').subtract(1, 'month');

        // Add dates from next month
        const lastDayOfMonth = this.date.endOf('month');
        const lastDayOfWeek = lastDayOfMonth.day();
        const lastDayOfUserWeek = (this.firstDayOfWeek + 6) % 7;
        if (lastDayOfWeek !== lastDayOfUserWeek) {
            const dates = this.getNextMonthDays(lastDayOfWeek);

            const nextMonth = this.date.add(1, 'month').format('YYYY-MM');
            const dateNotesForNextMonth: DateNotesForMonth = await server.get(`special-notes/notes-for-month/${nextMonth}`);

            dates.forEach(date => {
                const tempDate = this.date;
                this.date = date;
                const $day = this.createDay(dateNotesForNextMonth, date.date());
                $day.addClass('calendar-date-next-month');
                this.$month.append($day);
                this.date = tempDate;
            });
        }

        this.$monthSelect.text(MONTHS[this.date.month()]);
        this.$yearSelect.val(this.date.year());
    }

    async entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        if (!loadResults.getOptionNames().includes("firstDayOfWeek") &&
            !loadResults.getOptionNames().includes("firstWeekOfYear") &&
            !loadResults.getOptionNames().includes("minDaysInFirstWeek")) {
            return;
        }

        this.manageFirstDayOfWeek();
        this.initWeekCalculation();
        this.createMonth();
    }
}
