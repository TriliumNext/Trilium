import { describe, expect, it } from "vitest";

import { getNotificationState, NOTIFICATION_MARK_KINDS } from "./notifications.js";

describe("getNotificationState", () => {
    it("gives the higher of the seen and read marks, whatever their order", () => {
        expect(getNotificationState([])).toBe("pending");
        expect(getNotificationState([ "sensitive" ])).toBe("pending");
        expect(getNotificationState([ "seen" ])).toBe("seen");
        expect(getNotificationState([ "seen", "sensitive" ])).toBe("seen");
        expect(getNotificationState([ "read" ])).toBe("read");
        expect(getNotificationState([ "seen", "read" ])).toBe("read");
        expect(getNotificationState([ "read", "seen" ])).toBe("read");
        expect(getNotificationState(new Set(NOTIFICATION_MARK_KINDS))).toBe("read");
    });
});
