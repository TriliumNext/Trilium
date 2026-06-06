import { describe, expect, it } from "vitest";
import { dayjs } from "./dayjs.js";
import {
    DEFAULT_WEEK_SETTINGS,
    getFirstDayOfWeek1,
    getWeekInfo,
    getWeekStartDate,
    getWeekString,
    parseWeekString,
    WeekSettings
} from "./week_utils.js";

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


            it("2026-02-01 (Sunday) should be 2026-W05 (still in week 5)", () => {
                // Feb 1, 2026 is Sunday - with Monday as first day, this is the last day of week 5
                // Week 5 starts on 2026-01-26 (Mon) and ends on 2026-02-01 (Sun)
                const result = getWeekInfo(dayjs("2026-02-01"), settings);
                expect(result.weekYear).toBe(2026);
                expect(result.weekNumber).toBe(5);
            });

            it("2026-02-02 (Monday) should be 2026-W06 (start of week 6)", () => {
                // Feb 2, 2026 is Monday - start of week 6
                const result = getWeekInfo(dayjs("2026-02-02"), settings);
                expect(result.weekYear).toBe(2026);
                expect(result.weekNumber).toBe(6);
            });
        });

        describe("with firstDayOfWeek=7 (Sunday as first day)", () => {
            const settings: WeekSettings = {
                firstDayOfWeek: 7,  // Sunday
                firstWeekOfYear: 0,
                minDaysInFirstWeek: 4
            };

            it("2026-02-01 (Sunday) should be 2026-W06 (start of new week)", () => {
                // Feb 1, 2026 is Sunday - should be the START of week 6, not end of week 5
                const result = getWeekInfo(dayjs("2026-02-01"), settings);
                expect(result.weekYear).toBe(2026);
                expect(result.weekNumber).toBe(6);
            });

            it("2026-01-31 (Saturday) should be 2026-W05 (last day of week 5)", () => {
                // Jan 31, 2026 is Saturday - should be the last day of week 5
                const result = getWeekInfo(dayjs("2026-01-31"), settings);
                expect(result.weekYear).toBe(2026);
                expect(result.weekNumber).toBe(5);
            });

            it("2026-01-25 (Sunday) should be 2026-W05 (start of week 5)", () => {
                // Jan 25, 2026 is Sunday - week 5 starts here
                const result = getWeekInfo(dayjs("2026-01-25"), settings);
                expect(result.weekYear).toBe(2026);
                expect(result.weekNumber).toBe(5);
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

    describe("getFirstDayOfWeek1 (additional branches)", () => {
        it("with firstWeekOfYear=1 (ISO 8601) for 2026, week 1 starts 2025-12-29", () => {
            const settings: WeekSettings = {
                firstDayOfWeek: 1,
                firstWeekOfYear: 1,
                minDaysInFirstWeek: 4
            };
            // 2026-01-04 is Sunday (isoWeekday 7); week containing it starts 2025-12-29 (Mon)
            const result = getFirstDayOfWeek1(2026, settings);
            expect(result.format("YYYY-MM-DD")).toBe("2025-12-29");
        });

        describe("with firstWeekOfYear=2 (minimum days in first week)", () => {
            // 2026-01-01 is Thursday (isoWeekday 4), firstDayOfWeek=1
            // daysToSubtract = (4-1+7)%7 = 3, so daysInFirstWeek = 7-3 = 4
            it("returns the week containing Jan 1 when daysInFirstWeek >= minDaysInFirstWeek", () => {
                const settings: WeekSettings = {
                    firstDayOfWeek: 1,
                    firstWeekOfYear: 2,
                    minDaysInFirstWeek: 4
                };
                // 4 days >= 4 minimum -> week containing Jan 1 starts 2025-12-29
                const result = getFirstDayOfWeek1(2026, settings);
                expect(result.format("YYYY-MM-DD")).toBe("2025-12-29");
            });

            it("returns the next week when daysInFirstWeek < minDaysInFirstWeek", () => {
                const settings: WeekSettings = {
                    firstDayOfWeek: 1,
                    firstWeekOfYear: 2,
                    minDaysInFirstWeek: 5
                };
                // 4 days < 5 minimum -> add one week -> starts 2026-01-05
                const result = getFirstDayOfWeek1(2026, settings);
                expect(result.format("YYYY-MM-DD")).toBe("2026-01-05");
            });
        });
    });

    describe("getWeekInfo (year-boundary branches)", () => {
        const settings: WeekSettings = {
            firstDayOfWeek: 1,
            firstWeekOfYear: 1, // ISO 8601
            minDaysInFirstWeek: 4
        };

        it("early-January date belonging to previous year's last week (weekStart isBefore week1 -> year--)", () => {
            // 2023-01-01 is Sunday; its week starts 2022-12-26, which is before
            // ISO week 1 of 2023 (2023-01-02). It belongs to 2022-W52.
            const result = getWeekInfo(dayjs("2023-01-01"), settings);
            expect(result.weekYear).toBe(2022);
            expect(result.weekNumber).toBe(52);
        });

        it("late-December date belonging to next year's week 1 (!isBefore nextYearFirstDayOfWeek1 -> year++)", () => {
            // ISO week 1 of 2026 starts 2025-12-29 (Mon). 2025-12-31 is in that week,
            // so it belongs to 2026-W01 even though its calendar year is 2025.
            const result = getWeekInfo(dayjs("2025-12-31"), settings);
            expect(result.weekYear).toBe(2026);
            expect(result.weekNumber).toBe(1);
        });
    });

    describe("getWeekStartDate", () => {
        it("returns the Monday of the week for firstDayOfWeek=1", () => {
            // 2026-01-15 is Thursday (isoWeekday 4); the Monday of that week is 2026-01-12
            const result = getWeekStartDate(dayjs("2026-01-15"), 1);
            expect(result.format("YYYY-MM-DD")).toBe("2026-01-12");
        });

        it("returns the Sunday of the week for firstDayOfWeek=7", () => {
            // With Sunday as first day, the week containing 2026-01-15 (Thu) starts 2026-01-11
            const result = getWeekStartDate(dayjs("2026-01-15"), 7);
            expect(result.format("YYYY-MM-DD")).toBe("2026-01-11");
        });

        it("defaults firstDayOfWeek to 1 (Monday) when omitted", () => {
            const result = getWeekStartDate(dayjs("2026-01-15"));
            expect(result.format("YYYY-MM-DD")).toBe("2026-01-12");
        });

        it("truncates the time to the start of the day", () => {
            const result = getWeekStartDate(dayjs("2026-01-15T13:45:30"), 1);
            expect(result.format("YYYY-MM-DD HH:mm:ss")).toBe("2026-01-12 00:00:00");
        });
    });

    describe("parseWeekString", () => {
        it("parses '2026-W01' to the start of week 1 under default settings", () => {
            // Under DEFAULT_WEEK_SETTINGS, week 1 of 2026 starts 2025-12-29
            const result = parseWeekString("2026-W01", DEFAULT_WEEK_SETTINGS);
            expect(result.format("YYYY-MM-DD")).toBe("2025-12-29");
        });

        it("uses default settings when none are provided", () => {
            const result = parseWeekString("2026-W01");
            expect(result.format("YYYY-MM-DD")).toBe("2025-12-29");
        });

        it("parses later week numbers relative to week 1", () => {
            // Week 2 is one week after week 1 (2025-12-29) -> 2026-01-05
            const result = parseWeekString("2026-W02", DEFAULT_WEEK_SETTINGS);
            expect(result.format("YYYY-MM-DD")).toBe("2026-01-05");
        });

        it("trims surrounding whitespace before parsing", () => {
            const result = parseWeekString("  2026-W01  ", DEFAULT_WEEK_SETTINGS);
            expect(result.format("YYYY-MM-DD")).toBe("2025-12-29");
        });

        it("round-trips with getWeekString and aligns with getWeekStartDate", () => {
            const date = dayjs("2026-03-18");
            const weekStr = getWeekString(date, DEFAULT_WEEK_SETTINGS);
            expect(weekStr).toBe("2026-W12");

            const parsed = parseWeekString(weekStr, DEFAULT_WEEK_SETTINGS);
            const weekStart = getWeekStartDate(date, DEFAULT_WEEK_SETTINGS.firstDayOfWeek);

            expect(parsed.format("YYYY-MM-DD")).toBe("2026-03-16");
            expect(parsed.format("YYYY-MM-DD")).toBe(weekStart.format("YYYY-MM-DD"));
        });
    });
});
