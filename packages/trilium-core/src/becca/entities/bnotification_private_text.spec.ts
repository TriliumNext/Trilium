import { describe, expect, it } from "vitest";

import { getContext } from "../../services/context.js";
import { getSql } from "../../services/sql/index.js";
import becca from "../becca.js";
import BNotificationPrivateText from "./bnotification_private_text.js";

const AT = "2026-11-27 12:00:00.000Z";
const ROW = {
    notificationId: "bnotificationSpec00002",
    content: JSON.stringify({ v: 1, title: "AAAA" }),
    utcDateCreated: AT,
    utcDateModified: AT
};

describe("BNotificationPrivateText", () => {
    it("names its table and key, and leaves the dates out of its hash", () => {
        expect(BNotificationPrivateText.entityName).toBe("notification_private_texts");
        expect(BNotificationPrivateText.primaryKeyName).toBe("notificationId");
        const later = "2026-11-28 12:00:00.000Z";
        expect(new BNotificationPrivateText({ ...ROW, utcDateModified: later }).generateHash())
            .toBe(new BNotificationPrivateText(ROW).generateHash());
        expect(new BNotificationPrivateText().notificationId).toBeUndefined();
    });

    it("registers in becca and saves its row", () => {
        const privateText = getContext().init(() => new BNotificationPrivateText(ROW).save());

        expect(becca.notificationPrivateTexts[ROW.notificationId]).toBe(privateText);
        expect(privateText.getPojo()).toEqual(ROW);
        expect(getSql().getRow("SELECT * FROM notification_private_texts WHERE notificationId = ?",
            [ ROW.notificationId ])).toEqual(ROW);
    });
});
