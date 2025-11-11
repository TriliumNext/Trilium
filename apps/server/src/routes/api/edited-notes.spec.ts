import cls from '../../services/cls.js';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { resolveDateParams } from "./edited-notes.js";

// test date setup
// client: UTC+1
// server: UTC
// day/month/year is changed when server converts a client date to to UTC
const clientDate =           "2025-01-01 00:11:11.000+0100";
const serverDate =           "2024-12-31 23:11:11.000Z";

// expected values - from client's point of view
const expectedToday =        "2025-01-01";
const expectedTodayMinus1 =  "2024-12-31";
const expectedMonth =        "2025-01";
const expectedMonthMinus2  = "2024-11";
const expectedYear =         "2025";
const expectedYearMinus1 =   "2024";

function runTest(dateStrToResolve: string, expectedDate: string) {
   cls.init(() => {
        cls.set("localNowDateTime", clientDate);
        const resolvedDate = resolveDateParams(dateStrToResolve).date;
        expect(resolvedDate).toBe(expectedDate);
    });
}

describe("edited-notes::resolveDateParams", () => {
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
        runTest("TODAY", expectedToday);
    });

    it("resolves 'MONTH' to current month", () => {
        runTest("MONTH", expectedMonth);
    });

    it("resolves 'YEAR' to current year", () => {
        runTest("YEAR", expectedYear);
    });

    it("resolves 'TODAY-1' to yesterday's date", () => {
        runTest("TODAY-1", expectedTodayMinus1);
    });

    it("resolves 'MONTH-2' to 2 months ago", () => {
        runTest("MONTH-2", expectedMonthMinus2);
    });

    it("resolves 'YEAR-1' to last year", () => {
        runTest("YEAR-1", expectedYearMinus1);
    });

    it("returns original string for unrecognized keyword", () => {
        runTest("FOO", "FOO");
    });

    it("returns original string for partially recognized keyword", () => {
        runTest("TODAY-", "TODAY-");
    });

    it("resolves 'today' (lowercase) to today's date", () => {
        runTest("today", expectedToday);
    });

});
