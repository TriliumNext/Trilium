import { dayjs } from "@triliumnext/commons";
import { describe, expect, it, vi } from 'vitest';

import type BNote from "../becca/entities/bnote.js";
import dateNotesService from "./date_notes.js";

// Mock becca_loader
vi.mock("../becca/becca_loader.js", () => ({
    default: {
        load: vi.fn(),
        loaded: Promise.resolve()
    }
}));

// Mock SQL init
vi.mock("../services/sql.js", () => ({
    default: {
        dbReady: Promise.resolve(),
        transactional: vi.fn((callback) => callback())
    }
}));

// Mock options so week settings fall back to their defaults (ISO weekdays, first week
// contains Jan 1) without needing a database.
vi.mock("./options.js", () => ({
    default: {
        getOptionOrNull: () => null
    }
}));


// Mock BNote
const mockRootNote = {
    getOwnedLabelValue: (key: string) => {
        const patterns: Record<string, string> = {
            "yearPattern": "{year}",
            "quarterPattern": "Quarter {quarterNumber}",
            "monthPattern": "{monthNumberPadded} - {month}",
            "weekPattern": "Week {weekNumber}",
            "datePattern": "{dateNumberPadded} - {weekDay}"
        };
        return patterns[key] || null;
    }
} as unknown as BNote;

describe("date_notes", () => {
    describe("getJournalNoteTitle", () => {
        const testDate = dayjs("2025-03-15"); // Saturday

        it("should generate year note title", async () => {
            const title = await dateNotesService.getJournalNoteTitle(mockRootNote, "year", testDate, 2025);
            expect(title).toBe("2025");
        });

        it("should generate quarter note title", async () => {
            const title = await dateNotesService.getJournalNoteTitle(mockRootNote, "quarter", testDate, 1);
            expect(title).toBe("Quarter 1");
        });

        it("should generate month note title", async () => {
            const title = await dateNotesService.getJournalNoteTitle(mockRootNote, "month", testDate, 3);
            expect(title).toBe("03 - March");
        });

        it("should generate week note title", async () => {
            const title = await dateNotesService.getJournalNoteTitle(mockRootNote, "week", testDate, 11);
            expect(title).toBe("Week 11");
        });

        it("should generate day note title", async () => {
            const title = await dateNotesService.getJournalNoteTitle(mockRootNote, "day", testDate, 15);
            expect(title).toBe("15 - Saturday");
        });

        it("should respect custom patterns", async () => {
            const customRootNote = {
                getOwnedLabelValue: (key: string) => {
                    const patterns: Record<string, string> = {
                        "yearPattern": "{year}",
                        "quarterPattern": "{quarterNumber} {shortQuarter}",
                        "monthPattern": "{isoMonth} {monthNumber} {monthNumberPadded} {month} {shortMonth3} {shortMonth4}",
                        "weekPattern": "{weekNumber} {weekNumberPadded} {shortWeek} {shortWeek3}",
                        "datePattern": "{isoDate} {dateNumber} {dateNumberPadded} {ordinal} {weekDay} {weekDay3} {weekDay2}"
                    };
                    return patterns[key] || null;
                }
            } as unknown as BNote;

            const testDate = dayjs("2025-03-01"); // Saturday

            const yearTitle = await dateNotesService.getJournalNoteTitle(customRootNote, "year", testDate, 2025);
            expect(yearTitle).toBe("2025");

            const quarterTitle = await dateNotesService.getJournalNoteTitle(customRootNote, "quarter", testDate, 1);
            expect(quarterTitle).toBe("1 Q1");

            const monthTitle = await dateNotesService.getJournalNoteTitle(customRootNote, "month", testDate, 3);
            expect(monthTitle).toBe("2025-03 3 03 March Mar Marc");

            const weekTitle = await dateNotesService.getJournalNoteTitle(customRootNote, "week", testDate, 9);
            expect(weekTitle).toBe("9 09 W9 W09");

            const dayTitle = await dateNotesService.getJournalNoteTitle(customRootNote, "day", testDate, 1);
            expect(dayTitle).toBe("2025-03-01 1 01 1st Saturday Sat Sa");
        });

        it("should fill placeholders of other time units from the date, not the note's own number (#9565)", () => {
            const customRootNote = {
                getOwnedLabelValue: (key: string) => {
                    const patterns: Record<string, string> = {
                        // exact pattern from the issue report
                        "datePattern": "{dateNumber}.{monthNumber}. - {weekDay} ({shortWeek})",
                        "weekPattern": "Week {weekNumber} of {monthNumber}/{year}",
                        "monthPattern": "{monthNumber} in Q{quarterNumber} {year}"
                    };
                    return patterns[key] || null;
                }
            } as unknown as BNote;

            // day note on 2026-04-25 (Saturday, ISO week 17): month/week placeholders
            // must not be filled with the day number
            const dayTitle = dateNotesService.getJournalNoteTitle(
                customRootNote, "day", dayjs("2026-04-25"), 25
            );
            expect(dayTitle).toBe("25.4. - Saturday (W17)");

            // week note: month placeholder must not be filled with the week number
            const weekTitle = dateNotesService.getJournalNoteTitle(
                customRootNote, "week", dayjs("2026-04-20"), 17
            );
            expect(weekTitle).toBe("Week 17 of 4/2026");

            // month note: quarter placeholder must not be filled with the month number
            const monthTitle = dateNotesService.getJournalNoteTitle(
                customRootNote, "month", dayjs("2026-04-01"), 4
            );
            expect(monthTitle).toBe("4 in Q2 2026");
        });

        it("should keep the caller-provided week number authoritative for cross-year weeks", () => {
            const customRootNote = {
                getOwnedLabelValue: (key: string) =>
                    key === "weekPattern" ? "{year}-W{weekNumberPadded}" : null
            } as unknown as BNote;

            // week 1 of 2027 starting in December 2026: the caller passes the resolved
            // week number and week year, which must win over anything derived from the date
            const weekTitle = dateNotesService.getJournalNoteTitle(
                customRootNote, "week", dayjs("2026-12-28"), 1, 2027
            );
            expect(weekTitle).toBe("2027-W01");
        });
    });
});
