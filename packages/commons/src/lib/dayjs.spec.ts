/// <reference types="../../../../node_modules/dayjs/plugin/advancedFormat.d.ts" />
/// <reference types="../../../../node_modules/dayjs/plugin/duration.d.ts" />
/// <reference types="../../../../node_modules/dayjs/plugin/isBetween.d.ts" />
/// <reference types="../../../../node_modules/dayjs/plugin/isoWeek.d.ts" />
/// <reference types="../../../../node_modules/dayjs/plugin/isSameOrAfter.d.ts" />
/// <reference types="../../../../node_modules/dayjs/plugin/isSameOrBefore.d.ts" />
/// <reference types="../../../../node_modules/dayjs/plugin/quarterOfYear.d.ts" />
/// <reference types="../../../../node_modules/dayjs/plugin/utc.d.ts" />

import { LOCALES } from "./i18n.js";
import { DAYJS_LOADER, dayjs } from "./dayjs.js";
import { describe, expect, it } from "vitest";

describe("dayjs", () => {
    it("all dayjs locales are valid", async () => {
        for (const locale of LOCALES) {
            const dayjsLoader = DAYJS_LOADER[locale.id];
            expect(dayjsLoader, `Locale ${locale.id} missing.`).toBeDefined();

            await dayjsLoader();
        }
    });

    describe("Plugins", () => {
        it("advanced format is available", () => {
            expect(dayjs("2023-10-01").format("Q")).not.toBe("Q");
        });

        it("duration plugin is available", () => {
            const d = dayjs.duration({ hours: 2, minutes: 30 });
            expect(d.asMinutes()).toBe(150);
        });

        it("is-between is available", () => {
            expect(dayjs("2023-10-02").isBetween(dayjs("2023-10-01"), dayjs("2023-10-03"))).toBe(true);
        });

        it("iso-week is available", () => {
            // ISO week number: 2023-01-01 is ISO week 52 of previous year
            expect(dayjs("2023-01-01").isoWeek()).toBe(52);
        });

        it("is-same-or-before is available", () => {
            expect(dayjs("2023-10-01").isSameOrBefore(dayjs("2023-10-02"))).toBe(true);
        });

        it("is-same-or-after is available", () => {
            expect(dayjs("2023-10-02").isSameOrAfter(dayjs("2023-10-01"))).toBe(true);
        });

        it("quarter-year is available", () => {
            expect(dayjs("2023-05-15").quarter()).toBe(2);
        });

        it("utc is available", () => {
            const utcDate = dayjs("2023-10-01T12:00:00").utc();
            expect(utcDate.utcOffset()).toBe(0);
        });
    });
});
