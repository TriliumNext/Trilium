import cls from '../../services/cls.js';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { dateNoteLabelKeywordToDateFilter } from "./edited-notes.js";

// test date setup
// client: UTC+1
// server: UTC
// day/month/year is changed when server converts a client date to to UTC
const clientDate =           "2025-01-01 00:11:11.000+0100";
const serverDate =           "2024-12-31 23:11:11.000Z";

// expected values - from client's point of view
const expectedToday =        "2025-01-01";
const expectedTodayMinus1 =  "2024-12-31";
const expectedTodayPlus1  =  "2025-01-02";
const expectedMonth =        "2025-01";
const expectedMonthMinus2  = "2024-11";
const expectedYear =         "2025";
const expectedYearMinus1 =   "2024";

function keywordResolvesToDate(dateStrOrKeyword: string, expectedDate: string) {
   cls.init(() => {
        cls.set("localNowDateTime", clientDate);
        const dateFilter = dateNoteLabelKeywordToDateFilter(dateStrOrKeyword);
        expect(dateFilter.date).toBe(expectedDate);
    });
}

function keywordDoesNotResolve(dateStrOrKeyword: string) {
   cls.init(() => {
        cls.set("localNowDateTime", clientDate);
        const dateFilter = dateNoteLabelKeywordToDateFilter(dateStrOrKeyword);
        expect(dateFilter.date).toBe(null);
    });
}

describe("edited-notes::dateNoteLabelKeywordToDateFilter", () => {
    beforeEach(() => {
        vi.stubEnv('TZ', 'UTC');
        vi.useFakeTimers();
        vi.setSystemTime(new Date(serverDate));
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        // Restore real timers after each test
        vi.useRealTimers();
    });

    it("resolves 'TODAY' to today's date", () => {
        keywordResolvesToDate("TODAY", expectedToday);
    });

    it("resolves 'TODAY+1' to tomorrow's date", () => {
        keywordResolvesToDate("TODAY+1", expectedTodayPlus1);
    });

    it("resolves 'MONTH' to current month", () => {
        keywordResolvesToDate("MONTH", expectedMonth);
    });

    it("resolves 'YEAR' to current year", () => {
        keywordResolvesToDate("YEAR", expectedYear);
    });

    it("resolves 'TODAY-1' to yesterday's date", () => {
        keywordResolvesToDate("TODAY-1", expectedTodayMinus1);
    });

    it("resolves 'MONTH-2' to 2 months ago", () => {
        keywordResolvesToDate("MONTH-2", expectedMonthMinus2);
    });

    it("resolves 'YEAR-1' to last year", () => {
        keywordResolvesToDate("YEAR-1", expectedYearMinus1);
    });

    it("returns original string for day", () => {
        keywordResolvesToDate("2020-12-31", "2020-12-31");
    });

    it("returns original string for month", () => {
        keywordResolvesToDate("2020-12", "2020-12");
    });

    it("returns original string for partial month", () => {
        keywordResolvesToDate("2020-1", "2020-1");
    });

    it("returns original string for partial month with trailing dash", () => {
        keywordResolvesToDate("2020-", "2020-");
    });

    it("returns original string for year", () => {
        keywordResolvesToDate("2020", "2020");
    });

    it("returns original string for potentially partial day", () => {
        keywordResolvesToDate("2020-12-1", "2020-12-1");
    });

    it("returns null for partial year", () => {
        keywordDoesNotResolve("202");
    });

    it("returns null for arbitrary string", () => {
        keywordDoesNotResolve("FOO");
    });

    it("returns null for missing delta", () => {
        keywordDoesNotResolve("TODAY-");
    });

    it("resolves 'today' (lowercase) to today's date", () => {
        keywordResolvesToDate("today", expectedToday);
    });

});
