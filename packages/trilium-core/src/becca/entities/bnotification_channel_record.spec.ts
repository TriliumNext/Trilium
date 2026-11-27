import { describe, expect, it } from "vitest";

import { getContext } from "../../services/context.js";
import { getSql } from "../../services/sql/index.js";
import becca from "../becca.js";
import becca_loader from "../becca_loader.js";
import BNotificationChannelRecord from "./bnotification_channel_record.js";

const AT = "2026-11-27 12:00:00.000Z";
const ROW = {
    recordId: "channelRecordSpec1",
    channelId: "channelSpec1",
    kind: "activation" as const,
    content: JSON.stringify({ activationId: "a1" }),
    utcDateCreated: AT,
    utcDateModified: AT
};

describe("BNotificationChannelRecord", () => {
    it("names its table and key, and leaves the dates out of its hash", () => {
        expect(BNotificationChannelRecord.entityName).toBe("notification_channel_records");
        expect(BNotificationChannelRecord.primaryKeyName).toBe("recordId");
        const later = "2026-11-28 12:00:00.000Z";
        expect(new BNotificationChannelRecord({ ...ROW, utcDateModified: later }).generateHash())
            .toBe(new BNotificationChannelRecord(ROW).generateHash());
        expect(new BNotificationChannelRecord().recordId).toBeUndefined();
    });

    it("registers in becca and saves its row, which becca loads again", () => {
        const record = getContext().init(() => new BNotificationChannelRecord(ROW).save());

        expect(becca.notificationChannelRecords[ROW.recordId]).toBe(record);
        expect(record.getPojo()).toEqual(ROW);
        expect(getSql().getRow("SELECT * FROM notification_channel_records WHERE recordId = ?",
            [ ROW.recordId ])).toEqual(ROW);

        getContext().init(() => becca_loader.load());
        expect(becca.notificationChannelRecords[ROW.recordId]).not.toBe(record);
        expect(becca.notificationChannelRecords[ROW.recordId].getPojo()).toEqual(ROW);
    });
});
