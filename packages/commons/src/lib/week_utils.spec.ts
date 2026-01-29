import { describe, expect, it } from "vitest";
import { dayjs } from "./dayjs.js";
import { getWeekInfo, getFirstDayOfWeek1, getWeekString, WeekSettings, DEFAULT_WEEK_SETTINGS } from "./week_utils.js";

describe("week_utils", () => {
    describe("getWeekInfo", () => {
        describe("with firstWeekOfYear=0 (first week contains first day of year)", () => {
            const settings: WeekSettings = {
                firstDayOfWeek: 1,
                firstWeekOfYear: 0,
                minDaysInFirstWeek: 4
            };

            it("2025-12-29 should be 2026-W01 (cross-year week)", () => {
                // 2026-01-01 is Thursday, so the week containing it starts on 2025-12-29 (Monday)
                // This week should be 2026-W01 because it contains 2026-01-01
                const result = getWeekInfo(dayjs("2025-12-29"), settings);
                expect(result.weekYear).toBe(2026);
                expect(result.weekNumber).toBe(1);
            });

            it("2026-01-01 should be 2026-W01", () => {
                const result = getWeekInfo(dayjs("2026-01-01"), settings);
                expect(result.weekYear).toBe(2026);
                expect(result.weekNumber).toBe(1);
            });

            it("2025-12-28 should be 2025-W52", () => {
                // 2025-12-28 is Sunday, which is the last day of the week starting 2025-12-22
                const result = getWeekInfo(dayjs("2025-12-28"), settings);
                expect(result.weekYear).toBe(2025);
                expect(result.weekNumber).toBe(52);
            });

            it("2026-01-05 should be 2026-W02", () => {
                // 2026-01-05 is Monday, start of second week
                const result = getWeekInfo(dayjs("2026-01-05"), settings);
                expect(result.weekYear).toBe(2026);
                expect(result.weekNumber).toBe(2);
            });
        });

        describe("with firstWeekOfYear=1 (ISO standard, first week contains first Thursday)", () => {
            const settings: WeekSettings = {
                firstDayOfWeek: 1,
                firstWeekOfYear: 1,
                minDaysInFirstWeek: 4
            };

            it("2023-01-01 should be 2022-W52 (Jan 1 is Sunday)", () => {
                // 2023-01-01 is Sunday, so the week starts on 2022-12-26
                // Since this week doesn't contain Jan 4, it's 2022-W52
                const result = getWeekInfo(dayjs("2023-01-01"), settings);
                expect(result.weekYear).toBe(2022);
                expect(result.weekNumber).toBe(52);
            });

            it("2023-01-02 should be 2023-W01 (first Monday)", () => {
                const result = getWeekInfo(dayjs("2023-01-02"), settings);
                expect(result.weekYear).toBe(2023);
                expect(result.weekNumber).toBe(1);
            });
        });

        describe("with firstWeekOfYear=2 (minimum days in first week)", () => {
            // 2026-01-01 is Thursday
            // The week containing Jan 1 starts on 2025-12-29 (Monday)
            // This week has 4 days in 2026 (Thu, Fri, Sat, Sun = Jan 1-4)

            describe("with minDaysInFirstWeek=1", () => {
                const settings: WeekSettings = {
                    firstDayOfWeek: 1,
                    firstWeekOfYear: 2,
                    minDaysInFirstWeek: 1
                };

                it("2025-12-29 should be 2026-W01 (4 days >= 1 minimum)", () => {
                    // Week has 4 days in 2026, which is >= 1
                    const result = getWeekInfo(dayjs("2025-12-29"), settings);
                    expect(result.weekYear).toBe(2026);
                    expect(result.weekNumber).toBe(1);
                });

                it("2026-01-01 should be 2026-W01", () => {
                    const result = getWeekInfo(dayjs("2026-01-01"), settings);
                    expect(result.weekYear).toBe(2026);
                    expect(result.weekNumber).toBe(1);
                });
            });

            describe("with minDaysInFirstWeek=7", () => {
                const settings: WeekSettings = {
                    firstDayOfWeek: 1,
                    firstWeekOfYear: 2,
                    minDaysInFirstWeek: 7
                };

                it("2025-12-29 should be 2025-W52 (4 days < 7 minimum, so this is last week of 2025)", () => {
                    // Week has only 4 days in 2026, which is < 7
                    // So this week belongs to 2025
                    const result = getWeekInfo(dayjs("2025-12-29"), settings);
                    expect(result.weekYear).toBe(2025);
                    expect(result.weekNumber).toBe(52);
                });

                it("2026-01-01 should be 2025-W52 (still last week of 2025)", () => {
                    const result = getWeekInfo(dayjs("2026-01-01"), settings);
                    expect(result.weekYear).toBe(2025);
                    expect(result.weekNumber).toBe(52);
                });

                it("2026-01-05 should be 2026-W01 (first full week of 2026)", () => {
                    // 2026-01-05 is Monday, start of the first full week
                    const result = getWeekInfo(dayjs("2026-01-05"), settings);
                    expect(result.weekYear).toBe(2026);
                    expect(result.weekNumber).toBe(1);
                });
            });
        });
    });

    describe("getFirstDayOfWeek1", () => {
        it("with firstWeekOfYear=0, returns the first day of the week containing Jan 1", () => {
            const settings: WeekSettings = {
                firstDayOfWeek: 1,
                firstWeekOfYear: 0,
                minDaysInFirstWeek: 4
            };
            // 2026-01-01 is Thursday, so week starts on 2025-12-29
            const result = getFirstDayOfWeek1(2026, settings);
            expect(result.format("YYYY-MM-DD")).toBe("2025-12-29");
        });

        it("with firstWeekOfYear=1, returns the first day of the week containing Jan 4", () => {
            const settings: WeekSettings = {
                firstDayOfWeek: 1,
                firstWeekOfYear: 1,
                minDaysInFirstWeek: 4
            };
            // 2023-01-04 is Wednesday, so week starts on 2023-01-02
            const result = getFirstDayOfWeek1(2023, settings);
            expect(result.format("YYYY-MM-DD")).toBe("2023-01-02");
        });
    });

    describe("getWeekString", () => {
        it("generates correct week string for cross-year week", () => {
            const settings: WeekSettings = {
                firstDayOfWeek: 1,
                firstWeekOfYear: 0,
                minDaysInFirstWeek: 4
            };
            expect(getWeekString(dayjs("2025-12-29"), settings)).toBe("2026-W01");
        });

        it("generates correct week string with padded week number", () => {
            const settings: WeekSettings = {
                firstDayOfWeek: 1,
                firstWeekOfYear: 0,
                minDaysInFirstWeek: 4
            };
            expect(getWeekString(dayjs("2026-01-05"), settings)).toBe("2026-W02");
        });
    });
});
