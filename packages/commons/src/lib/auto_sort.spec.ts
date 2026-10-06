import { describe, expect, it } from "vitest";

import { autoSort, type AutoSortOptions, classifyAutoSortValue } from "./auto_sort.js";

function sort(values: string[], options?: AutoSortOptions) {
    return autoSort(values, (value) => value, options);
}

function numberOf(text: string, locale = "en"): number | null {
    const value = classifyAutoSortValue(text, { locale });
    return value.kind === "number" ? value.key : null;
}

describe("classifyAutoSortValue", () => {
    it("detects each kind and its key", () => {
        expect(classifyAutoSortValue("15:02")).toEqual({ kind: "time", key: 54120, text: "15:02" });
        expect(classifyAutoSortValue("2026-09-30"))
            .toEqual({ kind: "date", key: Date.UTC(2026, 8, 30), text: "2026-09-30" });
        expect(classifyAutoSortValue("12 apples"))
            .toEqual({ kind: "number", key: 12, text: "12 apples" });
        expect(classifyAutoSortValue("Item 3")).toEqual({ kind: "text", key: 0, text: "Item 3" });
        expect(classifyAutoSortValue("")).toEqual({ kind: "empty", key: 0, text: "" });
    });

    it("trims the text and treats blank text as empty", () => {
        expect(classifyAutoSortValue("  \tabc \n")).toMatchObject({ kind: "text", text: "abc" });
        expect(classifyAutoSortValue(" 15:02 ")).toMatchObject({ kind: "time", text: "15:02" });
        for (const blank of ["   ", "\t\t", " ", " \n "]) {
            expect(classifyAutoSortValue(blank).kind, JSON.stringify(blank)).toBe("empty");
        }
    });

    it("detects the documented date and time forms", () => {
        const dates = [
            "2026-09-30 15:02", "2026-09-30", "30 September 2026", "Wednesday, 30 September 2026",
            "2026-09-30T15:02:38+03:00"
        ];
        for (const text of dates) {
            expect(classifyAutoSortValue(text, { locale: "en" }).kind, text).toBe("date");
        }
        expect(classifyAutoSortValue("15:02").kind).toBe("time");
        expect(classifyAutoSortValue("3:02 PM").kind).toBe("time");
    });

    it("recognizes extra date formats", () => {
        expect(classifyAutoSortValue("30|09|2026").kind).toBe("number");
        expect(classifyAutoSortValue("30|09|2026", { dateFormats: ["DD|MM|YYYY"] }).kind)
            .toBe("date");
    });
});

describe("numbers", () => {
    it("reads the leading number and ignores what follows", () => {
        expect(numberOf("24.5m")).toBe(24.5);
        expect(numberOf("21 RON")).toBe(21);
        expect(numberOf("12%")).toBe(12);
        expect(numberOf("3 apples")).toBe(3);
        expect(numberOf("1e5")).toBe(1);
        expect(numberOf("1.5.")).toBe(1.5);
        expect(numberOf("007")).toBe(7);
    });

    it("skips a currency symbol before the number", () => {
        expect(numberOf("$ 12.04")).toBe(12.04);
        expect(numberOf("$12")).toBe(12);
        expect(numberOf("€12,50")).toBe(12.5);
        expect(numberOf("£ 1,234.56")).toBe(1234.56);
        expect(numberOf("¥1000")).toBe(1000);
        expect(numberOf("₹ 5")).toBe(5);
        expect(numberOf("-$12")).toBe(-12);
        expect(numberOf("$-12")).toBe(-12);
        expect(numberOf("$ -12")).toBe(-12);
    });

    it("reads the sign", () => {
        expect(numberOf("-5")).toBe(-5);
        expect(numberOf("−5")).toBe(-5);
        expect(numberOf("+5")).toBe(5);
        expect(numberOf("-0.5")).toBe(-0.5);
    });

    it("treats text that does not start with a number as text", () => {
        for (const text of ["RON 21", "US$ 5", "Item 3", ".5", "#5", "(5)", "- 5", "+-5", "-$-5"]) {
            expect(numberOf(text), text).toBeNull();
        }
    });

    it("reads grouping and decimal marks", () => {
        const cases: [string, number][] = [
            ["1,234.5", 1234.5],
            ["1,234,567", 1234567],
            ["1,234", 1234],
            ["1.234", 1.234],
            ["1,5", 1.5],
            ["12.04", 12.04],
            ["1.234,5", 1234.5],
            ["1.234.567,89", 1234567.89],
            ["1 234", 1234],
            ["1 234,5", 1234.5],
            ["5 000 000", 5000000],
            ["1 234", 1234],
            ["1 234,5", 1234.5],
            ["1'234.5", 1234.5],
            ["1’234", 1234]
        ];
        for (const [text, expected] of cases) {
            expect(numberOf(text), text).toBe(expected);
        }
    });

    it("reads a single mark before three digits as the locale does", () => {
        expect(numberOf("1.234", "de")).toBe(1234);
        expect(numberOf("1,234", "de")).toBe(1.234);
        expect(numberOf("1.5", "de")).toBe(1.5);
        expect(numberOf("1,5", "de")).toBe(1.5);
        expect(numberOf("1.234,5", "de")).toBe(1234.5);
        expect(numberOf("1,234.5", "de")).toBe(1234.5);
        expect(numberOf("1,234", "ro")).toBe(1.234);
        expect(numberOf("1,234", "fr")).toBe(1.234);
    });

    it("treats malformed digit runs as text", () => {
        const malformed = ["1.2.3", "192.168.1.1", "1,234.567.8", "1,2.5", "1,5 000", "1,23,456"];
        for (const text of malformed) {
            expect(classifyAutoSortValue(text, { locale: "en" }).kind, text).toBe("text");
        }
    });

    it("joins digits across a space only before exactly three digits", () => {
        expect(numberOf("10 20 30")).toBe(10);
        expect(numberOf("12 34")).toBe(12);
        expect(numberOf("2026 12345")).toBe(2026);
    });
});

describe("autoSort", () => {
    const mixed = ["b", "", "10", "2026-09-30", "15:02", "a", "9", "2025-01-01", "08:00", " "];

    it("orders times, dates, numbers, text, then empty values", () => {
        expect(sort(mixed, { locale: "en" })).toEqual(
            ["08:00", "15:02", "2025-01-01", "2026-09-30", "9", "10", "a", "b", "", " "]);
    });

    it("reverses all but the empty values when descending", () => {
        expect(sort(mixed, { locale: "en", isDescending: true })).toEqual(
            ["b", "a", "10", "9", "2026-09-30", "2025-01-01", "15:02", "08:00", "", " "]);
    });

    it("sorts dates written in different forms by their instant", () => {
        expect(sort([
            "30 September 2026",
            "2026-09-30 13:00",
            "2026-09-29",
            "2026-09-30T15:02:38+03:00",
            "Wednesday, 1 January 2025"
        ], { locale: "en" })).toEqual([
            "Wednesday, 1 January 2025",
            "2026-09-29",
            "30 September 2026",
            "2026-09-30T15:02:38+03:00",
            "2026-09-30 13:00"
        ]);
    });

    it("sorts years below 100 before later years", () => {
        expect(sort(["1999-09-30", "0099-09-30", "1000-01-01"], { locale: "en" }))
            .toEqual(["0099-09-30", "1000-01-01", "1999-09-30"]);
    });

    it("sorts 12-hour and 24-hour times together", () => {
        expect(sort(["3:02 PM", "14:00", "9:30 AM", "12:00 AM"], { locale: "en" }))
            .toEqual(["12:00 AM", "9:30 AM", "14:00", "3:02 PM"]);
    });

    it("sorts numbers by value and equal numbers by text", () => {
        expect(sort(["$ 12.04", "100", "-3", "24.5m", "21 RON", "2"], { locale: "en" }))
            .toEqual(["-3", "2", "$ 12.04", "21 RON", "24.5m", "100"]);
        expect(sort(["24.5km", "24.5 m", "24.5"], { locale: "en" }))
            .toEqual(["24.5", "24.5 m", "24.5km"]);
    });

    it("sorts text with numeric collation in the locale", () => {
        expect(sort(["Item 10", "Item 9", "item 1"], { locale: "en" }))
            .toEqual(["item 1", "Item 9", "Item 10"]);
        expect(sort(["Äpple", "Zebra"], { locale: "en" })).toEqual(["Äpple", "Zebra"]);
        expect(sort(["Äpple", "Zebra"], { locale: "sv" })).toEqual(["Zebra", "Äpple"]);
    });

    it("ignores case but not accents in text, in both directions", () => {
        for (const isDescending of [false, true]) {
            const options = { locale: "en", isDescending };
            expect(sort(["Apple", "apple"], options)).toEqual(["Apple", "apple"]);
            expect(sort(["apple", "Apple"], options)).toEqual(["apple", "Apple"]);
            expect(sort(["5 Apples", "5 apples"], options)).toEqual(["5 Apples", "5 apples"]);
        }
        expect(sort(["á", "a", "b"], { locale: "en" })).toEqual(["a", "á", "b"]);
        expect(sort(["a", "á", "b"], { locale: "en", isDescending: true }))
            .toEqual(["b", "á", "a"]);
    });

    it("uses the decimal mark of the locale", () => {
        expect(sort(["1.500", "2"], { locale: "en" })).toEqual(["1.500", "2"]);
        expect(sort(["1.500", "2"], { locale: "de" })).toEqual(["2", "1.500"]);
    });

    it("keeps the order of equal values in both directions", () => {
        const items = [{ id: 1, text: "x" }, { id: 2, text: "x" }, { id: 3, text: "a" }];
        const ids = (options: AutoSortOptions) =>
            autoSort(items, (item) => item.text, options).map((item) => item.id);
        expect(ids({})).toEqual([3, 1, 2]);
        expect(ids({ isDescending: true })).toEqual([1, 2, 3]);
    });

    it("falls back to the text for keys beyond the number range", () => {
        const huge = `1${"0".repeat(400)}`;
        expect(sort([`${huge}b`, `${huge}a`, "5"])).toEqual(["5", `${huge}a`, `${huge}b`]);
    });

    it("accepts Trilium locale ids and survives invalid ones", () => {
        expect(classifyAutoSortValue("2026年9月30日", { locale: "cn" }).kind).toBe("date");
        expect(classifyAutoSortValue("30/09/2026", { locale: "pt_br" }).kind).toBe("date");
        expect(classifyAutoSortValue("9/30/2026", { locale: "en_rtl" }).kind).toBe("date");
        expect(classifyAutoSortValue("Item 3", { locale: "!!" }).kind).toBe("text");
        expect(classifyAutoSortValue("Item 3", { locale: "" }).kind).toBe("text");
    });

    it("returns a new array and leaves the input alone", () => {
        const values = ["b", "a"];
        const sorted = sort(values);
        expect(sorted).toEqual(["a", "b"]);
        expect(values).toEqual(["b", "a"]);
        expect(sort([])).toEqual([]);
    });
});
