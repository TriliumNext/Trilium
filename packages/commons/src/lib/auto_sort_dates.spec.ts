import { describe, expect, it } from "vitest";

import { createDateParser } from "./auto_sort_dates.js";

const HOUR = 3600;
const MINUTE = 60;

describe("createDateParser", () => {
    describe("parseTime", () => {
        const { parseTime } = createDateParser("en", []);

        it("reads 24-hour times", () => {
            expect(parseTime("15:02")).toBe(15 * HOUR + 2 * MINUTE);
            expect(parseTime("9:05")).toBe(9 * HOUR + 5 * MINUTE);
            expect(parseTime("09:05")).toBe(9 * HOUR + 5 * MINUTE);
            expect(parseTime("15:02:38")).toBe(15 * HOUR + 2 * MINUTE + 38);
            expect(parseTime("15:02:38.250")).toBe(15 * HOUR + 2 * MINUTE + 38.25);
            expect(parseTime("0:00")).toBe(0);
            expect(parseTime("23:59:59")).toBe(24 * HOUR - 1);
        });

        it("reads 12-hour times with AM or PM", () => {
            expect(parseTime("3:02 PM")).toBe(15 * HOUR + 2 * MINUTE);
            expect(parseTime("3:02 pm")).toBe(15 * HOUR + 2 * MINUTE);
            expect(parseTime("3:02PM")).toBe(15 * HOUR + 2 * MINUTE);
            expect(parseTime("3:02 p.m.")).toBe(15 * HOUR + 2 * MINUTE);
            expect(parseTime("11:59 a. m.")).toBe(11 * HOUR + 59 * MINUTE);
            expect(parseTime("12:00 AM")).toBe(0);
            expect(parseTime("12:00 PM")).toBe(12 * HOUR);
            expect(parseTime("12:30:15 am")).toBe(30 * MINUTE + 15);
        });

        it("reads the AM and PM names of the locale", () => {
            expect(createDateParser("ko", []).parseTime("3:02 오후")).toBe(15 * HOUR + 2 * MINUTE);
            expect(createDateParser("ja", []).parseTime("3:02 午前")).toBe(3 * HOUR + 2 * MINUTE);
            expect(createDateParser("ro", []).parseTime("3:02 p.m.")).toBe(15 * HOUR + 2 * MINUTE);
        });

        it("rejects anything but a whole and valid time", () => {
            const invalid = [
                "", "24:00", "12:60", "12:30:60", "13:00 PM", "0:30 AM", "15:2", "1502", "15.02",
                "15:02 later", "at 15:02", "15:02+03:00", "15:02:38.5", "3:02 XM"
            ];
            for (const text of invalid) {
                expect(parseTime(text), text).toBeNull();
            }
        });
    });

    describe("parseDate", () => {
        const { parseDate } = createDateParser("en", []);

        it("reads ISO dates, with or without a time and an offset", () => {
            expect(parseDate("2026-09-30")).toBe(Date.UTC(2026, 8, 30));
            expect(parseDate("2026-9-3")).toBe(Date.UTC(2026, 8, 3));
            expect(parseDate("2026-09-30 15:02")).toBe(Date.UTC(2026, 8, 30, 15, 2));
            expect(parseDate("2026-09-30T15:02:38")).toBe(Date.UTC(2026, 8, 30, 15, 2, 38));
            expect(parseDate("2026-09-30T15:02:38.500Z")).toBe(Date.UTC(2026, 8, 30, 15, 2, 38, 500));
            expect(parseDate("2026-09-30t15:02:38z")).toBe(Date.UTC(2026, 8, 30, 15, 2, 38));
            expect(parseDate("2026-09-30T15:02:38+03:00")).toBe(Date.UTC(2026, 8, 30, 12, 2, 38));
            expect(parseDate("2026-09-30T15:02-0530")).toBe(Date.UTC(2026, 8, 30, 20, 32));
            expect(parseDate("2026-09-30 15:02 +03")).toBe(Date.UTC(2026, 8, 30, 12, 2));
            expect(parseDate("2026-09-30 3:02 PM")).toBe(Date.UTC(2026, 8, 30, 15, 2));
        });

        it("keeps years below 100 as written", () => {
            const isoOf = (text: string) => {
                const time = parseDate(text);
                return time === null ? null : new Date(time).toISOString();
            };
            expect(isoOf("0044-03-15")).toBe("0044-03-15T00:00:00.000Z");
            expect(isoOf("0099-09-30T15:02+03:00")).toBe("0099-09-30T12:02:00.000Z");
            expect(isoOf("15 March 0044")).toBe("0044-03-15T00:00:00.000Z");
            expect(isoOf("0000-02-29")).toBe("0000-02-29T00:00:00.000Z");
            expect(isoOf("0001-02-29")).toBeNull();
        });

        it("reads written dates with English names", () => {
            const expected = Date.UTC(2026, 8, 30);
            const texts = [
                "30 September 2026", "30 september 2026", "30 SEPTEMBER 2026", "30 Sep 2026",
                "30 Sep. 2026", "Wednesday, 30 September 2026", "Wed, 30 Sep 2026",
                "September 30, 2026", "Wednesday, September 30, 2026", "30  September   2026"
            ];
            for (const text of texts) {
                expect(parseDate(text), text).toBe(expected);
            }
            expect(parseDate("30 September 2026 15:02")).toBe(Date.UTC(2026, 8, 30, 15, 2));
            expect(parseDate("Wednesday, 30 September 2026, 3:02 PM"))
                .toBe(Date.UTC(2026, 8, 30, 15, 2));
        });

        it("reads the dates of the locale, as Intl writes them", () => {
            const expected = Date.UTC(2026, 8, 30);
            const cases: [string, string][] = [
                ["en", "9/30/2026"],
                ["en-GB", "30/09/2026"],
                ["en-GB", "30 Sept 2026"],
                ["de", "30.09.2026"],
                ["de", "30. September 2026"],
                ["de", "Mittwoch, 30. September 2026"],
                ["fr", "30 sept. 2026"],
                ["fr", "mercredi 30 septembre 2026"],
                ["ro", "miercuri, 30 septembrie 2026"],
                ["ru", "30 сентября 2026 г."],
                ["ru", "30 сентябрь 2026"],
                ["es", "30 de septiembre de 2026"],
                ["ja", "2026年9月30日"],
                ["ja", "2026/9/30"],
                ["ko", "2026. 9. 30."],
                ["ar", "30/9/2026"],
                ["th", "30/9/2026"]
            ];
            for (const [locale, text] of cases) {
                expect(createDateParser(locale, []).parseDate(text), `${locale}: ${text}`)
                    .toBe(expected);
            }
        });

        it("matches English names in any locale", () => {
            expect(createDateParser("de", []).parseDate("30 Oct 2026")).toBe(Date.UTC(2026, 9, 30));
            expect(createDateParser("de", []).parseDate("30 Okt. 2026")).toBe(Date.UTC(2026, 9, 30));
        });

        it("reads the day-first dotted form in every locale", () => {
            expect(parseDate("30.09.2026")).toBe(Date.UTC(2026, 8, 30));
            expect(parseDate("1.2.2026")).toBe(Date.UTC(2026, 1, 1));
        });

        it("rejects anything but a whole and valid date", () => {
            const invalid = [
                "", "2026", "2026-09", "2026-02-30", "2026-13-01", "2026-00-10", "31 April 2026",
                "30 Foo 2026", "2026-09-30 at noon", "2026-09-30 25:00", "2026-09-30 15:02 later",
                "9/30/26", "30/09/2026", "Item 3", "15:02", "30 September", "September 2026"
            ];
            for (const text of invalid) {
                expect(parseDate(text), text).toBeNull();
            }
        });
    });

    describe("extra formats", () => {
        const { parseDate } = createDateParser("en", [
            "DD|MM|YYYY",
            "[Week] DD-MM-YY",
            "YYYY.MM.DD hh:mm",
            "YYYYMMDD Z",
            "Do MMMM YYYY",
            "",
            "HH:mm [h]",
            "[unclosed"
        ]);

        it("reads dates in Day.js formats", () => {
            expect(parseDate("30|09|2026")).toBe(Date.UTC(2026, 8, 30));
            expect(parseDate("30|09|2026 15:02")).toBe(Date.UTC(2026, 8, 30, 15, 2));
            expect(parseDate("Week 30-09-26")).toBe(Date.UTC(2026, 8, 30));
            expect(parseDate("Week 30-09-75")).toBe(Date.UTC(1975, 8, 30));
            expect(parseDate("20260930 +0100")).toBe(Date.UTC(2026, 8, 29, 23));
        });

        it("reads a 12-hour time without AM or PM as written", () => {
            expect(parseDate("2026.09.30 03:15")).toBe(Date.UTC(2026, 8, 30, 3, 15));
            expect(parseDate("2026.09.30 00:15")).toBeNull();
        });

        it("skips formats that are unsupported, empty or have no date", () => {
            expect(parseDate("30th September 2026")).toBeNull();
            expect(parseDate("15:02 h")).toBeNull();
            expect(parseDate("[unclosed")).toBeNull();
        });

        it("does not change the formats of other parsers", () => {
            expect(createDateParser("en", []).parseDate("30|09|2026")).toBeNull();
        });
    });

    it("reads the runtime locale when none is given", () => {
        const parser = createDateParser(undefined, []);
        expect(parser.parseDate("2026-09-30")).toBe(Date.UTC(2026, 8, 30));
        expect(parser.parseTime("15:02")).toBe(15 * HOUR + 2 * MINUTE);
    });
});
