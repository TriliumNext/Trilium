import type { NotificationMarkKind } from "@triliumnext/commons";
import { beforeAll, describe, expect, it } from "vitest";

import { hashedBlobId } from "../utils/index.js";
import {
    AHEAD_TOLERANCE_MS,
    checkChannelRecordRow,
    checkInput,
    checkMarkRow,
    checkNotificationRow,
    checkPatch,
    checkPrivateTextRow,
    checkRefs,
    checkSyncedChange,
    classifyRaise,
    CONTENT_MAX_BYTES,
    describeRow,
    formatTimeKey,
    formatUtcDateTime,
    getDefaultRaisedAtMs,
    getKeyRange,
    getLastCountedKey,
    getLinkNoteId,
    getMarkId,
    getMarkIds,
    getNotificationId,
    getOwnerNotificationId,
    getReferencedNoteId,
    getRewriteDateMs,
    getTimeOfNotificationId,
    type HistoryEntry,
    isDatedAhead,
    isNotificationEntityName,
    isNotificationId,
    makeTextPrivate,
    NotificationError,
    parseContent,
    parsePrivateContent,
    parseUtcDateTime,
    pickTrimmed,
    PRIVATE_CONTENT_MAX_BYTES,
    resolveView,
    type ViewRow
} from "./model.js";

const NOW = Date.UTC(2026, 10, 27, 12, 0, 0, 0);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const AT = formatUtcDateTime(NOW);
const BELL = String.fromCharCode(7);
/** The key of `spec:id` at `NOW`. Hashing needs the crypto provider, which the suite sets up. */
let KEY: string;

beforeAll(() => {
    KEY = getNotificationId("spec:id", NOW);
});

/** A stored row of `notifications` that passes every check. */
function notificationRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        notificationId: KEY,
        id: "spec:id",
        raisedAt: AT,
        tag: null,
        noteId: null,
        category: "general",
        type: "standard",
        attentionLevel: "low",
        isSensitive: 0,
        producer: "client",
        content: JSON.stringify({ v: 1, title: "Title" }),
        utcDateCreated: AT,
        utcDateModified: AT,
        ...overrides
    };
}

describe("keys", () => {
    it("builds a key from 12 characters of the hash of the ID and the time in base 36", () => {
        expect(KEY).toBe(hashedBlobId("spec:id").substring(0, 12)
            + NOW.toString(36).padStart(9, "0"));
        expect(KEY).toHaveLength(21);
        expect(isNotificationId(KEY)).toBe(true);
        expect(getTimeOfNotificationId(KEY)).toBe(NOW);
        expect(getOwnerNotificationId(getMarkId(KEY, "read"))).toBe(KEY);

        // The generations of an ID share the hash and sort by time.
        const later = getNotificationId("spec:id", NOW + 1);
        expect(later.substring(0, 12)).toBe(KEY.substring(0, 12));
        expect(later > KEY).toBe(true);
        expect(formatTimeKey(35)).toBe("00000000z");

        const [ first, last ] = getKeyRange("spec:id");
        expect(first < KEY && KEY < last).toBe(true);
        expect(getLastCountedKey(KEY, NOW)).toBe(getNotificationId("spec:id", NOW + HOUR));
    });

    it("gives every runtime the same key for the same event", () => {
        // Computed with node:crypto: SHA-512 of the ID, as `hashedBlobId()` writes it.
        expect(getNotificationId("trilium:reminder:abcd", NOW)).toBe("97aVWaIBxF940mwyxitc0");
    });

    it("names a mark by its notification and the letter of its kind", () => {
        expect(getMarkIds(KEY)).toEqual([ `${KEY}s`, `${KEY}r`, `${KEY}x` ]);
    });

    it("refuses what is not a key", () => {
        for (const value of [ 12, `${KEY}s`, KEY.substring(1), `${KEY.substring(0, 20)}Z` ]) {
            expect(isNotificationId(value), String(value)).toBe(false);
        }
    });
});

describe("dates", () => {
    it("reads the form that Trilium stores, and nothing else", () => {
        expect(parseUtcDateTime(AT)).toBe(NOW);
        expect(parseUtcDateTime("1970-01-01 00:00:00.000Z")).toBe(0);
        for (const value of [
            undefined, NOW, "2026-11-27T12:00:00.000Z", "2026-11-27 12:00:00Z",
            "2026-02-30 12:00:00.000Z", "2026-13-01 12:00:00.000Z", "1969-12-31 23:59:59.999Z",
            "9999-12-31 23:59:59.999Z"
        ]) {
            expect(parseUtcDateTime(value), String(value)).toBeNull();
        }
    });

    it("counts a time more than an hour ahead as dated ahead", () => {
        expect(isDatedAhead(NOW + AHEAD_TOLERANCE_MS, NOW)).toBe(false);
        expect(isDatedAhead(NOW + AHEAD_TOLERANCE_MS + 1, NOW)).toBe(true);
    });

    it("dates a rewrite after the stored version", () => {
        expect(getRewriteDateMs(NOW, NOW - DAY)).toBe(NOW);
        expect(getRewriteDateMs(NOW, NOW + DAY)).toBe(NOW + DAY + 1);
    });

    it("raises without a time after the newest known generation, but one dated ahead", () => {
        expect(getDefaultRaisedAtMs(NOW, [])).toBe(NOW);
        expect(getDefaultRaisedAtMs(NOW, [ NOW - DAY ])).toBe(NOW);
        expect(getDefaultRaisedAtMs(NOW, [ NOW + 10, NOW + 5 ])).toBe(NOW + 11);
        expect(getDefaultRaisedAtMs(NOW, [ NOW + 2 * DAY ])).toBe(NOW);
    });
});

describe("classifyRaise", () => {
    const facts = (overrides: Partial<Parameters<typeof classifyRaise>[0]>) => ({
        isCategoryOff: false,
        raisedAtMs: NOW,
        nowMs: NOW,
        storedTimes: [],
        erasedTimes: [],
        ...overrides
    });

    it.each([
        [ "a category that is off", { isCategoryOff: true, storedTimes: [ NOW ] }, "categoryOff" ],
        [ "the same generation, stored", { storedTimes: [ NOW - DAY, NOW ] }, "stored" ],
        [ "the same generation, erased", { erasedTimes: [ NOW ] }, "erased" ],
        [ "a newer generation, erased", { erasedTimes: [ NOW + 1 ] }, "erased" ],
        [ "a newer generation, stored", { storedTimes: [ NOW + 1 ] }, "late" ],
        [ "only older generations", { storedTimes: [ NOW - 1 ], erasedTimes: [ NOW - 2 ] }, "new" ],
        [ "an erasure dated ahead", { erasedTimes: [ NOW + 2 * DAY ] }, "new" ],
        [ "a generation dated ahead", { storedTimes: [ NOW + 2 * DAY ] }, "new" ]
    ] as const)("decides %s", (_label, overrides, outcome) => {
        expect(classifyRaise(facts(overrides as never))).toBe(outcome);
    });
});

describe("resolveView", () => {
    const key = (id: string, timeMs: number) => getNotificationId(id, timeMs);
    const row = (id: string, timeMs: number) => ({
        notificationId: key(id, timeMs), id, noteId: null, isSensitive: false,
        content: JSON.stringify({ v: 1, title: "Plain" })
    });

    it("shows the newest generation of each ID that is neither ahead nor covered", () => {
        const rows = [
            row("a", NOW - 2), row("a", NOW), row("a", NOW + 2 * DAY),
            row("b", NOW - 1), row("b", NOW - 3),
            row("c", NOW - 5),
            row("d", NOW - 1)
        ];
        const covered = new Set([ key("c", NOW - 5) ]);
        const marks = new Map([ [ key("a", NOW), [ "seen" as const ] ] ]);

        const view = resolveView(rows, {
            nowMs: NOW,
            getMarkKinds: (notificationId) => marks.get(notificationId) ?? [],
            isCovered: (notificationId) => covered.has(notificationId),
            isNoteSensitive: () => false
        });

        // `b` and `d` share a time, so the order falls to their keys.
        const [ first, second ] = [ key("b", NOW - 1), key("d", NOW - 1) ].sort().reverse();
        const shown = view.map(({ row: { notificationId }, state }) => [ notificationId, state ]);
        expect(shown).toEqual([
            [ key("a", NOW), "seen" ],
            [ first, "pending" ],
            [ second, "pending" ]
        ]);
    });
});

describe("pickTrimmed", () => {
    const entry = (index: number, overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
        notificationId: `n${String(index).padStart(3, "0")}`,
        type: "standard",
        attentionLevel: "low",
        raisedAtMs: NOW - DAY * 2 - index,
        state: "pending",
        ...overrides
    });

    it("keeps the limit of standard notifications, trimming read, then seen, then pending", () => {
        const entries = [
            entry(1), entry(2, { state: "seen" }), entry(3, { state: "read" }),
            entry(4, { state: "read" }), entry(5, { type: "persistent" })
        ];

        expect(pickTrimmed(entries, NOW, 4)).toEqual([]);
        expect(pickTrimmed(entries, NOW, 2)).toEqual([ "n004", "n003" ]);
        expect(pickTrimmed(entries, NOW, 1)).toEqual([ "n004", "n003", "n002" ]);
        expect(pickTrimmed(entries.map((each) => ({ ...each, state: "pending" })), NOW, 3))
            .toEqual([ "n004" ]);
    });

    it("trims no young high notification, and breaks a tie of times by the key", () => {
        const entries = [
            entry(1, { attentionLevel: "high", raisedAtMs: NOW - DAY + 1 }),
            entry(2, { attentionLevel: "high", raisedAtMs: NOW - DAY }),
            entry(3, { raisedAtMs: NOW - DAY }),
            entry(3, { raisedAtMs: NOW - DAY })
        ];

        expect(pickTrimmed(entries, NOW, 0)).toEqual([ "n002", "n003", "n003" ]);
    });
});

describe("links and the referenced note", () => {
    it.each([
        [ "#root/abcd", "abcd" ],
        [ "#abcd", "abcd" ],
        [ "#root/abcd?block=a1:b2&viewMode=source", "abcd" ],
        [ "#root/abcd?searchTerms=a%2Cb&splits=root%2Fefgh", "abcd" ]
    ])("takes %s", (link, noteId) => {
        expect(getLinkNoteId(link)).toBe(noteId);
    });

    it.each([
        "root/abcd", "#", "#root/abc", "#root//abcd", "#root/abcd?", "#root/abcd?script=1",
        "#root/abcd?block", "#root/abcd?block=<x>", "#root/abcd?block=a&"
    ])("refuses %s", (link) => {
        expect(getLinkNoteId(link)).toBeNull();
    });

    it("refers to the note of noteId, or else to the note of the link", () => {
        const withLink = JSON.stringify({ v: 1, link: "#root/abcd" });
        expect(getReferencedNoteId("efgh", withLink)).toBe("efgh");
        expect(getReferencedNoteId(null, withLink)).toBe("abcd");
        expect(getReferencedNoteId(null, JSON.stringify({ v: 1 }))).toBeNull();
        expect(getReferencedNoteId(null, "not json")).toBeNull();
    });
});

describe("parseContent", () => {
    it("reads every field, and leaves out the ones it does not know", () => {
        const content = {
            v: 1,
            title: "Title",
            description: "Two\nlines",
            icon: "bx bx-bell",
            link: "#root/abcd",
            progress: -1,
            progressLabel: "Half",
            actions: [
                { id: "open", caption: "Open", icon: "bx bx-link", other: 1 },
                { id: "a", caption: "" }
            ],
            handler: "myscript:demo",
            fromALaterVersion: true
        };

        expect(parseContent(JSON.stringify(content))).toEqual({
            v: 1,
            title: "Title",
            description: "Two\nlines",
            icon: "bx bx-bell",
            link: "#root/abcd",
            progress: -1,
            progressLabel: "Half",
            actions: [
                { id: "open", caption: "Open", icon: "bx bx-link" },
                { id: "a", caption: "" }
            ],
            handler: "myscript:demo"
        });
        expect(parseContent(JSON.stringify({ v: 1 }))).toEqual({ v: 1 });
    });

    it("refuses what is not an object of version 1", () => {
        for (const content of [ "{", "[1]", "null", JSON.stringify({ v: 2 }) ]) {
            expect(parseContent(content), content).toBeNull();
        }
    });

    it.each([
        [ "a title with a line feed", { title: "a\nb" } ],
        [ "a description with a control character", { description: `a${BELL}` } ],
        [ "an icon of other characters", { icon: "bx;" } ],
        [ "a link that is not a hash", { link: "https://x" } ],
        [ "a link that is not text", { link: 5 } ],
        [ "a progress above 1", { progress: 1.5 } ],
        [ "a progress that is not a number", { progress: "0.5" } ],
        [ "a label with a control character", { progressLabel: BELL } ],
        [ "actions that are not a list", { actions: {} } ],
        [ "six actions", { actions: Array(6).fill({ id: "a", caption: "A" }) } ],
        [ "an action that is not an object", { actions: [ "a" ] } ],
        [ "an action without an ID", { actions: [ { caption: "A" } ] } ],
        [ "an action caption that is not text", { actions: [ { id: "a", caption: 1 } ] } ],
        [ "an action icon with a bracket", { actions: [ { id: "a", caption: "A", icon: "<" } ] } ],
        [ "a handler with a space", { handler: "my handler" } ],
        [ "content over 8 KiB", { title: "x".repeat(CONTENT_MAX_BYTES) } ]
    ])("refuses %s", (_label, fields) => {
        expect(parseContent(JSON.stringify({ v: 1, ...fields }))).toBeNull();
    });

    it("measures the size in bytes", () => {
        const fits = JSON.stringify({ v: 1, title: "" }).length;
        const title = "\u{E9}".repeat((CONTENT_MAX_BYTES - fits) / 2);
        expect(parseContent(JSON.stringify({ v: 1, title }))).not.toBeNull();
        expect(parseContent(JSON.stringify({ v: 1, title: `${title}x` }))).toBeNull();
    });
});

describe("parsePrivateContent", () => {
    it("reads sealed fields in base64, and nothing else", () => {
        expect(parsePrivateContent(JSON.stringify({ v: 1, title: "AAAA", description: "QUJD" })))
            .toEqual({ v: 1, title: "AAAA", description: "QUJD" });
        expect(parsePrivateContent(JSON.stringify({ v: 1 }))).toEqual({ v: 1 });
        for (const content of [
            "{", JSON.stringify({ v: 2 }), JSON.stringify({ v: 1, title: "not base64!" }),
            JSON.stringify({ v: 1, description: "" }),
            JSON.stringify({ v: 1, title: "A".repeat(PRIVATE_CONTENT_MAX_BYTES) })
        ]) {
            expect(parsePrivateContent(content), content.substring(0, 40)).toBeNull();
        }
    });
});

describe("checkNotificationRow", () => {
    it("takes a row of every kind of value", () => {
        expect(checkNotificationRow(notificationRow())).toBeNull();
        expect(checkNotificationRow(notificationRow({
            tag: "trilium:reminder:abcd",
            noteId: "abcd",
            category: "reminder",
            type: "persistent",
            attentionLevel: "high",
            isSensitive: 1,
            producer: "script:abcd",
            content: JSON.stringify({ v: 1, link: "#root/abcd?block=x" })
        }))).toBeNull();
        expect(checkNotificationRow(notificationRow({
            noteId: "abcd", content: JSON.stringify({ v: 1, title: "No link" })
        }))).toBeNull();
    });

    it("refuses what is not a row, and a row with other columns", () => {
        const withoutTag = notificationRow();
        delete withoutTag.tag;
        for (const row of [ null, [], withoutTag, notificationRow({ isDeleted: 0 }) ]) {
            expect(checkNotificationRow(row), JSON.stringify(row)).toBe("invalid-row");
        }
    });

    it.each([
        [ "an ID with a space", { id: "spec id" } ],
        [ "an ID of 101 characters", { id: "x".repeat(101) } ],
        [ "a time in another form", { raisedAt: "2026-11-27T12:00:00.000Z" } ],
        [ "a tag that is not text", { tag: 5 } ],
        [ "a note ID with a dot", { noteId: "ab.cd" } ],
        [ "an unknown category", { category: "other" } ],
        [ "an unknown type", { type: "transient" } ],
        [ "an unknown level", { attentionLevel: "urgent" } ],
        [ "a flag that is not 0 or 1", { isSensitive: true } ],
        [ "a producer that is not text", { producer: null } ],
        [ "content that is not text", { content: {} } ],
        [ "a creation date in another form", { utcDateCreated: "now" } ],
        [ "a modification date in another form", { utcDateModified: "now" } ]
    ])("refuses %s", (_label, overrides) => {
        expect(checkNotificationRow(notificationRow(overrides))).toBe("invalid-row");
    });

    it("refuses a key that is not computed from the ID and the time", () => {
        expect(checkNotificationRow(notificationRow({ id: "spec:other" }))).toBe("invalid-key");
        expect(checkNotificationRow(notificationRow({ raisedAt: formatUtcDateTime(NOW + 1) })))
            .toBe("invalid-key");
    });

    it("refuses content that fails its checks, and a link into another note than noteId", () => {
        expect(checkNotificationRow(notificationRow({ content: "{}" }))).toBe("invalid-content");
        expect(checkNotificationRow(notificationRow({
            noteId: "abcd", content: JSON.stringify({ v: 1, link: "#root/efgh" })
        }))).toBe("invalid-content");
    });
});

describe("the checks of marks, private texts and channel records", () => {
    const mark = (overrides: Record<string, unknown> = {}) => ({
        markId: `${KEY}r`, notificationId: KEY, kind: "read", utcDateCreated: AT, ...overrides
    });
    const privateText = (overrides: Record<string, unknown> = {}) => ({
        notificationId: KEY,
        content: JSON.stringify({ v: 1, title: "AAAA" }),
        utcDateCreated: AT,
        utcDateModified: AT,
        ...overrides
    });
    const channelRecord = (overrides: Record<string, unknown> = {}) => ({
        recordId: "recordId1",
        channelId: "channel_1",
        kind: "activation",
        content: JSON.stringify({ activationId: "a" }),
        utcDateCreated: AT,
        utcDateModified: AT,
        ...overrides
    });

    it("takes valid rows", () => {
        expect(checkMarkRow(mark())).toBeNull();
        expect(checkMarkRow(mark({ markId: `${KEY}x`, kind: "sensitive" }))).toBeNull();
        expect(checkPrivateTextRow(privateText())).toBeNull();
        expect(checkChannelRecordRow(channelRecord())).toBeNull();
    });

    it("refuses a mark whose letter does not fit its kind, and malformed marks", () => {
        expect(checkMarkRow(mark({ kind: "seen" }))).toBe("invalid-key");
        expect(checkMarkRow(mark({ markId: `${KEY}s` }))).toBe("invalid-key");
        for (const row of [
            "mark", mark({ extra: 1 }), mark({ notificationId: "short" }), mark({ kind: "hidden" }),
            mark({ utcDateCreated: null })
        ]) {
            expect(checkMarkRow(row), JSON.stringify(row)).toBe("invalid-row");
        }
    });

    it("refuses malformed private texts", () => {
        expect(checkPrivateTextRow(privateText({ content: JSON.stringify({ v: 1, title: "?" }) })))
            .toBe("invalid-content");
        for (const row of [
            undefined, privateText({ extra: 1 }), privateText({ notificationId: `${KEY}r` }),
            privateText({ content: 1 }), privateText({ utcDateModified: "" })
        ]) {
            expect(checkPrivateTextRow(row), JSON.stringify(row)).toBe("invalid-row");
        }
    });

    it("refuses malformed channel records", () => {
        expect(checkChannelRecordRow(channelRecord({ content: "[]" }))).toBe("invalid-content");
        expect(checkChannelRecordRow(channelRecord({ content: "x".repeat(40 * 1024) })))
            .toBe("invalid-content");
        for (const row of [
            [], channelRecord({ extra: 1 }), channelRecord({ recordId: "a b" }),
            channelRecord({ channelId: "" }), channelRecord({ kind: "unknown" }),
            channelRecord({ content: null }), channelRecord({ utcDateCreated: 1 })
        ]) {
            expect(checkChannelRecordRow(row), JSON.stringify(row)).toBe("invalid-row");
        }
    });
});

describe("checkSyncedChange", () => {
    it("knows the four tables of notifications that sync", () => {
        expect([
            "notifications", "notification_marks", "notification_private_texts",
            "notification_channel_records", "notification_deliveries", "notes"
        ].map(isNotificationEntityName)).toEqual([ true, true, true, true, false, false ]);
        expect(checkSyncedChange("notes", "abcd", false, {})).toBe("invalid-row");
    });

    it("takes the erasure of a notification only, by a valid key", () => {
        expect(checkSyncedChange("notifications", KEY, true, undefined)).toBeNull();
        expect(checkSyncedChange("notifications", "notAKey", true, undefined)).toBe("invalid-key");
        expect(checkSyncedChange("notification_marks", `${KEY}r`, true, undefined))
            .toBe("erasure-refused");
    });

    it("checks the row and its key against the change", () => {
        const row = notificationRow();
        expect(checkSyncedChange("notifications", KEY, false, row)).toBeNull();
        expect(checkSyncedChange("notifications", KEY, false, undefined)).toBe("missing-row");
        expect(checkSyncedChange("notifications", KEY, false, { ...row, id: 1 }))
            .toBe("invalid-row");
        const otherKey = getNotificationId("spec:id", NOW + 1);
        expect(checkSyncedChange("notifications", otherKey, false, row)).toBe("invalid-key");
    });
});

describe("NotificationError", () => {
    it("carries its code as its message", () => {
        const error = new NotificationError("raised-ahead");
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe("NotificationError");
        expect(error.code).toBe("raised-ahead");
        expect(error.message).toBe("raised-ahead");
    });
});

describe("checkInput", () => {
    const check = (input: unknown, isBuiltIn = false) => checkInput(input, isBuiltIn, NOW);
    const codeOf = (input: unknown, isBuiltIn = false) => {
        try {
            check(input, isBuiltIn);
            return null;
        } catch (e) {
            return e instanceof NotificationError ? e.code : "thrown";
        }
    };

    it("fills in the defaults and leaves empty text out", () => {
        expect(check({ title: "Title", description: "", progressLabel: "" })).toEqual({
            id: undefined,
            raisedAtMs: undefined,
            tag: null,
            noteId: null,
            category: "general",
            type: "standard",
            attentionLevel: "medium",
            content: { v: 1, title: "Title" },
            privateText: null,
            isNamedSensitive: false
        });
        expect(check({
            id: "spec:a", raisedAt: AT, noteId: "abcd1234", link: "#root/abcd1234?block=x1",
            tag: "spec:tag", category: "reminder", type: "persistent", attentionLevel: "high",
            protectedTitle: "Private", sensitive: false,
            actions: [ { id: "done", caption: "Done", icon: "bx bx-check", extra: 1 } ]
        })).toMatchObject({
            id: "spec:a", raisedAtMs: NOW, noteId: "abcd1234", tag: "spec:tag",
            category: "reminder", type: "persistent", attentionLevel: "high",
            content: {
                v: 1, link: "#root/abcd1234?block=x1",
                actions: [ { id: "done", caption: "Done", icon: "bx bx-check" } ]
            },
            privateText: { title: "Private" },
            isNamedSensitive: true
        });
        expect(check({ noteId: "abcd1234", sensitive: true }).isNamedSensitive).toBe(true);
    });

    it.each([
        [ "no object", "title", "invalid-input" ],
        [ "no title, note, link or private text", {}, "invalid-input" ],
        [ "a bell in a title", { title: `a${BELL}b` }, "invalid-input" ],
        [ "a line feed in a title", { title: "a\nb" }, "invalid-input" ],
        [ "a bell in a description", { title: "t", description: `a${BELL}b` }, "invalid-input" ],
        [ "a tab in a private description", { title: "t", protectedDescription: "a\tb" },
            "invalid-input" ],
        [ "an ID with a space", { title: "t", id: "a b" }, "invalid-input" ],
        [ "an ID of 101 characters", { title: "t", id: "a".repeat(101) }, "invalid-input" ],
        [ "an unknown category", { title: "t", category: "other" }, "invalid-input" ],
        [ "an icon with a quote", { title: "t", icon: "bx\"" }, "invalid-input" ],
        [ "an address as link", { title: "t", link: "https://example.com" }, "invalid-input" ],
        [ "a link with an unknown parameter", { title: "t", link: "#root?x=1" },
            "invalid-input" ],
        [ "a link into another note", { noteId: "abcd1234", link: "#root/efgh5678" },
            "invalid-input" ],
        [ "a progress over 1", { title: "t", progress: 1.5 }, "invalid-input" ],
        [ "six actions", { title: "t", actions: Array(6).fill({ id: "a", caption: "A" }) },
            "invalid-input" ],
        [ "a sensitive flag that is no boolean", { title: "t", sensitive: "yes" },
            "invalid-input" ],
        [ "a time in another form", { title: "t", raisedAt: "2026-11-27T12:00:00Z" },
            "invalid-input" ],
        [ "a time more than an hour ahead", { title: "t",
            raisedAt: formatUtcDateTime(NOW + AHEAD_TOLERANCE_MS + 1) }, "raised-ahead" ],
        [ "a built-in ID", { title: "t", id: "trilium:x" }, "reserved-name" ],
        [ "a built-in tag", { title: "t", tag: "trilium:x" }, "reserved-name" ],
        [ "a built-in handler", { title: "t", handler: "trilium:x" }, "reserved-name" ],
        [ "a content over 8 KiB", { title: "t", description: "d".repeat(CONTENT_MAX_BYTES) },
            "too-large" ],
        [ "a private text over 8 KiB", { protectedDescription: "d".repeat(CONTENT_MAX_BYTES) },
            "too-large" ]
    ] as const)("refuses %s", (_label, input, code) => {
        expect(codeOf(input)).toBe(code);
    });

    it("takes the reserved names from a built-in producer", () => {
        expect(codeOf({ title: "t", id: "trilium:x", tag: "trilium:y", handler: "trilium:z" },
            true)).toBeNull();
    });
});

describe("checkPatch", () => {
    it("keeps the fields of a patch, an empty text included", () => {
        expect(checkPatch({ title: "", description: "New", sensitive: true, other: 1 }))
            .toEqual({ title: "", description: "New", sensitive: true });
        for (const patch of [ null, [], { title: "a\nb" }, { icon: "" }, { progress: 2 },
            { sensitive: 1 }, { actions: [ { caption: "No ID" } ] } ]) {
            expect(() => checkPatch(patch), JSON.stringify(patch)).toThrow(NotificationError);
        }
    });
});

describe("checkRefs", () => {
    it("takes at most 500 refs, each an ID and a time", () => {
        expect(checkRefs([ { id: "spec:a", raisedAt: AT } ]))
            .toEqual([ { id: "spec:a", raisedAtMs: NOW } ]);
        expect(checkRefs(Array(500).fill({ id: "a", raisedAt: AT }))).toHaveLength(500);
        for (const refs of [ null, {}, Array(501).fill({ id: "a", raisedAt: AT }),
            [ { id: "a b", raisedAt: AT } ], [ { id: "a", raisedAt: NOW } ], [ "a" ] ]) {
            expect(() => checkRefs(refs)).toThrow(NotificationError);
        }
    });
});

describe("makeTextPrivate", () => {
    it("takes out the title, the description, the progress label and the captions", () => {
        expect(makeTextPrivate({
            v: 1, title: "Title", description: "Description", icon: "bx bx-bell",
            link: "#root/abcd1234?searchTerms=private", progress: 0.5, progressLabel: "Half",
            actions: [
                { id: "a", caption: "Caption", icon: "bx bx-x" }, { id: "b", caption: "B" }
            ],
            handler: "spec:handler"
        })).toEqual({
            content: {
                v: 1, icon: "bx bx-bell", progress: 0.5, handler: "spec:handler",
                link: "#root/abcd1234",
                actions: [ { id: "a", caption: "", icon: "bx bx-x" }, { id: "b", caption: "" } ]
            },
            text: { title: "Title", description: "Description" }
        });
        expect(makeTextPrivate({ v: 1 })).toEqual({ content: { v: 1 }, text: {} });
    });
});

describe("describeRow", () => {
    const content = JSON.stringify({ v: 1, title: "Title", link: "#root/abcd1234?block=b1" });
    const row = (overrides: Partial<ViewRow> = {}): ViewRow => ({
        notificationId: KEY, id: "spec:id", noteId: null, isSensitive: false, content,
        ...overrides
    });
    const context = (markKinds: NotificationMarkKind[], sensitiveNotes: string[] = []) => ({
        nowMs: NOW,
        getMarkKinds: () => markKinds,
        isCovered: () => false,
        isNoteSensitive: (noteId: string) => sensitiveNotes.includes(noteId)
    });

    it("gives the text of a version while nothing makes it sensitive, or when flagged", () => {
        const plain = describeRow(row(), context([ "seen" ]));
        expect(plain).toMatchObject({ state: "seen", isSensitive: false });
        expect(plain.content.title).toBe("Title");

        for (const [ fact, markKinds, sensitiveNotes ] of [
            [ "the mark", [ "sensitive" ], [] ],
            [ "a protected note of the link", [], [ "abcd1234" ] ]
        ] as const) {
            const entry = describeRow(row(), context([ ...markKinds ], [ ...sensitiveNotes ]));
            expect(entry.isSensitive, fact).toBe(true);
            expect(entry.content, fact).toEqual({ v: 1, link: "#root/abcd1234" });
        }

        const flagged = describeRow(row({ isSensitive: true }), context([]));
        expect(flagged.isSensitive).toBe(true);
        expect(flagged.content.title).toBe("Title");
        expect(describeRow(row({ noteId: "efgh5678", content: JSON.stringify({ v: 1 }) }),
            context([], [ "efgh5678" ])).isSensitive).toBe(true);
        expect(describeRow(row({ content: "{" }), context([])).content).toEqual({ v: 1 });
    });
});
