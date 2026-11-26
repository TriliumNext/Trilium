import { describe, expect, it } from "vitest";

import { getContext } from "../../services/context.js";
import { getSql } from "../../services/sql/index.js";
import becca from "../becca.js";
import BNotificationMark from "./bnotification_mark.js";

const AT = "2026-11-27 12:00:00.000Z";
const ROW = {
    markId: "bnotificationSpec00001r",
    notificationId: "bnotificationSpec00001",
    kind: "read" as const,
    utcDateCreated: AT
};

describe("BNotificationMark", () => {
    it("names its table and key, and hashes the same mark alike whenever it was written", () => {
        expect(BNotificationMark.entityName).toBe("notification_marks");
        expect(BNotificationMark.primaryKeyName).toBe("markId");
        expect(new BNotificationMark({ ...ROW, utcDateCreated: "2026-11-28 12:00:00.000Z" })
            .generateHash()).toBe(new BNotificationMark(ROW).generateHash());
        expect(new BNotificationMark().markId).toBeUndefined();
    });

    it("registers in becca and saves its row, dated by its creation", () => {
        const mark = getContext().init(() => new BNotificationMark(ROW).save());

        expect(becca.notificationMarks[ROW.markId]).toBe(mark);
        expect(mark.getPojo()).toEqual(ROW);
        expect(getSql().getRow("SELECT * FROM notification_marks WHERE markId = ?", [ ROW.markId ]))
            .toEqual(ROW);
        expect(getSql().getValue(/*sql*/`SELECT utcDateChanged FROM entity_changes
            WHERE entityName = 'notification_marks' AND entityId = ?`, [ ROW.markId ])).toBe(AT);
    });
});
