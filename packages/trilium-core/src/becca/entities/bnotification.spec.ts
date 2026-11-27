import type { NotificationRow } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { getContext } from "../../services/context.js";
import { getSql } from "../../services/sql/index.js";
import becca from "../becca.js";
import BNotification from "./bnotification.js";

const AT = "2026-11-27 12:00:00.000Z";

function row(overrides: Partial<NotificationRow> = {}): NotificationRow {
    return {
        notificationId: "bnotificationSpec000001",
        id: "spec:bnotification",
        raisedAt: AT,
        tag: null,
        noteId: null,
        category: "general",
        type: "standard",
        attentionLevel: "low",
        isSensitive: false,
        producer: "client",
        content: JSON.stringify({ v: 1, title: "Title" }),
        utcDateCreated: AT,
        utcDateModified: AT,
        ...overrides
    };
}

describe("BNotification", () => {
    it("names its table and key, and leaves the dates out of its hash", () => {
        expect(BNotification.entityName).toBe("notifications");
        expect(BNotification.primaryKeyName).toBe("notificationId");
        expect(BNotification.hashedProperties).not.toContain("utcDateModified");

        const later = "2026-11-28 12:00:00.000Z";
        const hash = new BNotification(row()).generateHash();
        expect(new BNotification(row({ utcDateCreated: later, utcDateModified: later }))
            .generateHash()).toBe(hash);
        expect(new BNotification(row({ content: "{}" })).generateHash()).not.toBe(hash);
    });

    it("takes a row as the database stores it, and registers in becca", () => {
        expect(new BNotification().notificationId).toBeUndefined();

        const notification = new BNotification({
            ...row(), isSensitive: 1 as unknown as boolean
        });

        expect(notification.isSensitive).toBe(true);
        expect(becca.notifications[notification.notificationId]).toBe(notification);
        expect(notification.getPojo()).toEqual({ ...row(), isSensitive: true });
    });

    it("saves its row with the flag as a number, and its entity change at its date", () => {
        const notification = getContext().init(() =>
            new BNotification(row({ notificationId: "bnotificationSpec000002", isSensitive: true }))
                .save());

        expect(getSql().getValue("SELECT isSensitive FROM notifications WHERE notificationId = ?",
            [ notification.notificationId ])).toBe(1);
        expect(getSql().getRow(/*sql*/`SELECT hash, utcDateChanged, isSynced FROM entity_changes
            WHERE entityName = 'notifications' AND entityId = ?`, [ notification.notificationId ]))
            .toEqual({ hash: notification.generateHash(), utcDateChanged: AT, isSynced: 1 });
    });
});
