import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import dayjs from "dayjs";
import { resolveDateParams } from "./edited-notes.js";

function resolveAsDate(dateStr: string) {
    return resolveDateParams(dateStr).date;
}

describe("edited-notes::resolveAsDate", () => {
    beforeEach(() => {
        // Set a fixed date and time before each test
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2012-11-10T23:22:21Z')); // NOTE!!: Date wrap in my timezone
    });

    afterEach(() => {
        // Restore real timers after each test
        vi.useRealTimers();
    });


    it("resolves 'TODAY' to today's date", () => {
        const expectedDate = dayjs().format("YYYY-MM-DD");
        const resolvedDate = resolveAsDate("TODAY");
        expect(resolvedDate).toBe(expectedDate);
    });

    it("resolves 'MONTH' to current month", () => {
        const expectedMonth = dayjs().format("YYYY-MM");
        const resolvedMonth = resolveAsDate("MONTH");
        expect(resolvedMonth).toBe(expectedMonth);
    });

    it("resolves 'YEAR' to current year", () => {
        const expectedYear = dayjs().format("YYYY");
        const resolvedYear = resolveAsDate("YEAR");
        expect(resolvedYear).toBe(expectedYear);
    });

    it("resolves 'TODAY-1' to yesterday's date", () => {
        const expectedDate = dayjs().subtract(1, "day").format("YYYY-MM-DD");
        const resolvedDate = resolveAsDate("TODAY-1");
        expect(resolvedDate).toBe(expectedDate);
    });

    it("resolves 'MONTH-2' to 2 months ago", () => {
        const expectedMonth = dayjs().subtract(2, "month").format("YYYY-MM");
        const resolvedMonth = resolveAsDate("MONTH-2");
        expect(resolvedMonth).toBe(expectedMonth);
    });

    it("resolves 'YEAR+1' to next year", () => {
        const expectedYear = dayjs().add(1, "year").format("YYYY");
        const resolvedYear = resolveAsDate("YEAR+1");
        expect(resolvedYear).toBe(expectedYear);
    });

    it("returns original string for unrecognized keyword", () => {
        const unrecognizedString = "NOT_A_DYNAMIC_DATE";
        const resolvedString = resolveAsDate(unrecognizedString);
        expect(resolvedString).toBe(unrecognizedString);
    });

    it("returns original string for partially recognized keyword", () => {
        const partialString = "TODAY-";
        const resolvedString = resolveAsDate(partialString);
        expect(resolvedString).toBe(partialString);
    });

    it("resolves 'today' (lowercase) to today's date", () => {
        const expectedDate = dayjs().format("YYYY-MM-DD");
        const resolvedDate = resolveAsDate("today");
        expect(resolvedDate).toBe(expectedDate);
    });

});
