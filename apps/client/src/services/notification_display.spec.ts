import type { TriliumNotification } from "@triliumnext/commons";
import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ isAvailable: false }));

vi.mock("./protected_session_holder.js", () => ({
    default: { isProtectedSessionAvailable: () => session.isAvailable }
}));
vi.mock("./i18n.js", () => ({ t: (key: string) => key }));

import appContext from "../components/app_context.js";
import {
    getNotificationIcon, getNotificationText, getReferencedNoteId, hasPlaceToOpen,
    markBidiControls, openNotification
} from "./notification_display.js";
import notificationStore from "./notifications.js";

function makeNotification(
    id: string,
    overrides: Partial<TriliumNotification> = {}
): TriliumNotification {
    return {
        notificationId: `${id.padEnd(12, "x").slice(0, 12)}00000000a`,
        id,
        raisedAt: "2026-11-27 10:00:00.000Z",
        updatedAt: "2026-11-27 10:00:00.000Z",
        revision: "r1",
        category: "general",
        type: "standard",
        attentionLevel: "medium",
        state: "pending",
        producer: "trilium:test",
        title: `Title of ${id}`,
        ...overrides
    };
}

afterEach(() => {
    session.isAvailable = false;
    vi.restoreAllMocks();
});

describe("getNotificationText", () => {
    it("shows the title, the note's title or the generic title of the category", () => {
        expect(getNotificationText(makeNotification("a", { description: "D" }), "Note"))
            .toEqual({ title: "Title of a", description: "D" });
        expect(getNotificationText(makeNotification("a", { title: undefined }), "Note"))
            .toEqual({ title: "Note", description: undefined });
        expect(getNotificationText(
            makeNotification("a", { title: undefined, category: "reminder" }), undefined))
            .toEqual({ title: "notifications.category-title.reminder", description: undefined });
        expect(getNotificationText(
            makeNotification("a", { title: undefined, category: "softwareUpdate" }), undefined))
            .toMatchObject({ title: "notifications.category-title.softwareUpdate" });
    });

    it("shows the private text of a sensitive notification only while it has it", () => {
        const publicText = {
            title: "A note reminder is due", description: undefined, sensitive: true
        };
        const sensitive = makeNotification("s", publicText);

        expect(getNotificationText(sensitive, "Dentist")).toEqual({
            title: "A note reminder is due", description: "notifications.enter-protected-session"
        });
        expect(getNotificationText({ ...sensitive, title: undefined }, "Dentist"))
            .toMatchObject({ title: "notifications.category-title.general" });

        expect(getNotificationText({
            ...sensitive, protectedTitle: "Dentist at 10", protectedDescription: "Call first"
        }, "Dentist")).toEqual({ title: "Dentist at 10", description: "Call first" });
        expect(getNotificationText({ ...sensitive, protectedDescription: "Call first" }, "Dentist"))
            .toEqual({ title: "Dentist", description: "Call first" });

        session.isAvailable = true;
        expect(getNotificationText({ ...sensitive, description: "Public" }, "Dentist"))
            .toEqual({ title: "Dentist", description: "Public" });
    });

    it("takes the icon of the category, and opens only a link or a note", () => {
        expect(getNotificationIcon(makeNotification("a", { icon: "bx bx-star" })))
            .toBe("bx bx-star");
        expect(getNotificationIcon(makeNotification("a", { category: "softwareUpdate" })))
            .toBe("bx bx-download");
        expect(hasPlaceToOpen(makeNotification("a", { noteId: "noteAbc1" }))).toBe(true);
        expect(hasPlaceToOpen(makeNotification("a", { link: "#root/noteAbc1" }))).toBe(true);
        expect(hasPlaceToOpen(makeNotification("a"))).toBe(false);
    });

    it("marks bidirectional formatting characters as code points", () => {
        expect(markBidiControls("abc\u{202E}def\u{2066}g\u{200F}"))
            .toBe("abc[U+202E]def[U+2066]g[U+200F]");
        expect(markBidiControls("plain")).toBe("plain");
    });
});

describe("openNotification", () => {
    function stubTabs(shownNoteId: string | null) {
        const context = {
            ntxId: "tab1", note: { noteId: shownNoteId }, setNote: vi.fn(async () => {})
        };
        const tabManager = {
            getNoteContexts: vi.fn(() => [ context ]),
            activateNoteContext: vi.fn(async () => {}),
            openTabWithNoteWithHoisting: vi.fn(async () => {})
        };
        appContext.tabManager = tabManager as never;
        return { context, tabManager };
    }

    it("activates a tab that shows the note before it opens one, and marks it read", async () => {
        const markRead = vi.spyOn(notificationStore, "markRead").mockImplementation(() => {});
        const withLink = makeNotification("l", { link: "#root/noteAbc1?block=xyz" });

        const shown = stubTabs("noteAbc1");
        expect(await openNotification(withLink)).toBe(true);
        expect(shown.tabManager.activateNoteContext).toHaveBeenCalledWith("tab1");
        expect(shown.context.setNote).toHaveBeenCalledWith("root/noteAbc1",
            { viewScope: expect.objectContaining({ block: "xyz" }) });
        expect(markRead).toHaveBeenCalledWith([ withLink ]);

        const elsewhere = stubTabs("other");
        expect(await openNotification(makeNotification("n", { noteId: "noteAbc1" }))).toBe(true);
        expect(elsewhere.tabManager.openTabWithNoteWithHoisting)
            .toHaveBeenCalledWith("noteAbc1", { activate: true, viewScope: undefined });

        const plain = stubTabs("noteAbc1");
        await openNotification(makeNotification("p", { link: "#root/noteAbc1" }));
        expect(plain.context.setNote).not.toHaveBeenCalled();

        markRead.mockClear();
        expect(await openNotification(makeNotification("none"))).toBe(false);
        expect(markRead).not.toHaveBeenCalled();
    });

    it("names the note of the notification: its noteId, or the note of its link", () => {
        const withNote = makeNotification("a", { noteId: "noteAbc1" });
        const withLink = makeNotification("a", { link: "#root/parent1/noteXyz1?block=b" });
        expect(getReferencedNoteId(withNote)).toBe("noteAbc1");
        expect(getReferencedNoteId(withLink)).toBe("noteXyz1");
        expect(getReferencedNoteId(makeNotification("a"))).toBeNull();
    });
});
