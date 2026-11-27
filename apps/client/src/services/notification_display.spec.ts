import type {
    NotificationActionResult, TransientNotification, TransientNotificationHandle,
    TriliumNotification
} from "@triliumnext/commons";
import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ isAvailable: false }));

vi.mock("./protected_session_holder.js", () => ({
    default: { isProtectedSessionAvailable: () => session.isAvailable }
}));
vi.mock("./i18n.js", () => ({ t: (key: string) => key }));

import appContext from "../components/app_context.js";
import {
    getNotificationIcon, getNotificationText, getReferencedNoteId, getShownActions, hasPlaceToOpen,
    markBidiControls, openNotification, runNotificationAction
} from "./notification_display.js";
import notificationStore, { NotificationRequestError } from "./notifications.js";
import toastService from "./toast.js";

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
    notificationStore.actionHandlers.value = new Map();
    vi.restoreAllMocks();
});

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

describe("runNotificationAction", () => {
    const action = { id: "done", caption: "Done" };

    /** Registers a handler that answers with the results given, in order. */
    function registerResults(results: unknown[]) {
        const handler = vi.fn(() => results.shift() as NotificationActionResult);
        notificationStore.registerActionHandler("spec:handler", handler);
        return handler;
    }

    it("applies each result of a handler to the generation that it was given", async () => {
        const markRead = vi.spyOn(notificationStore, "markRead").mockImplementation(() => {});
        const dismiss = vi.spyOn(notificationStore, "dismiss").mockResolvedValue();
        const update = vi.spyOn(notificationStore, "update")
            .mockImplementation(async (target) => target as TriliumNotification);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const results: unknown[] = [];
        const handler = registerResults(results);
        const standard = makeNotification("a", {
            handler: "spec:handler", actions: [ action ], link: "#root/noteAbc1"
        });
        stubTabs(null);

        // Nothing marks a standard notification read, and a handler leaves the link closed.
        expect(await runNotificationAction(standard, null)).toBe(false);
        expect(handler).toHaveBeenCalledWith({ action: null, notification: standard });
        expect(markRead).toHaveBeenCalledWith([ standard ]);
        expect(appContext.tabManager.openTabWithNoteWithHoisting).not.toHaveBeenCalled();
        markRead.mockClear();
        await runNotificationAction({ ...standard, type: "persistent" }, action);
        expect(markRead).not.toHaveBeenCalled();

        results.push({ dismiss: true });
        await runNotificationAction(standard, action);
        expect(dismiss).toHaveBeenCalledWith({ id: "a", raisedAt: standard.raisedAt });

        results.push({ update: { title: "Done" } });
        await runNotificationAction(standard, action);
        expect(update).toHaveBeenCalledWith(standard, { title: "Done" });
        expect(warn).not.toHaveBeenCalled();

        // An update that comes back as null changed while the handler ran, and is dropped.
        update.mockResolvedValue(null);
        results.push({ update: { title: "Late" } });
        await runNotificationAction(standard, action);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("was dropped"));

        // `null`, which the first design read as a dismissal, and `{ dismiss: false }` ask nothing.
        dismiss.mockClear();
        results.push(null, { dismiss: false });
        await runNotificationAction(standard, action);
        await runNotificationAction(standard, action);
        expect(dismiss).not.toHaveBeenCalled();
    });

    it("keeps the notification when its handler throws, or its result is refused", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const showError = vi.spyOn(toastService, "showError").mockImplementation(() => {});
        const dismiss = vi.spyOn(notificationStore, "dismiss");
        const failure = new Error("Broken script");
        notificationStore.registerActionHandler("spec:handler", async () => {
            throw failure;
        });
        const notification = makeNotification("a", { handler: "spec:handler" });

        expect(await runNotificationAction(notification, action)).toBe(false);
        expect(error).toHaveBeenCalledWith(failure);
        expect(showError).toHaveBeenCalledWith("notifications.handler-failed");
        expect(dismiss).not.toHaveBeenCalled();

        dismiss.mockRejectedValue(new NotificationRequestError("invalid-input"));
        registerResults([ { dismiss: true } ]);
        await runNotificationAction(notification, action);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("refused: invalid-input"));
        expect(showError).toHaveBeenCalledTimes(2);
    });

    it("opens the place without a handler, and runs no built-in handler of another producer",
        async () => {
            const markRead = vi.spyOn(notificationStore, "markRead").mockImplementation(() => {});
            const builtIn = vi.fn();
            notificationStore.registerActionHandler("trilium:spec", builtIn);
            const tabs = stubTabs(null);

            const unregistered = makeNotification("a", {
                handler: "spec:missing", link: "#root/noteAbc1"
            });
            expect(await runNotificationAction(unregistered, null)).toBe(true);
            expect(tabs.tabManager.openTabWithNoteWithHoisting).toHaveBeenCalledOnce();
            expect(await runNotificationAction(unregistered, action)).toBe(false);
            expect(tabs.tabManager.openTabWithNoteWithHoisting).toHaveBeenCalledOnce();

            const foreign = makeNotification("trilium:update", {
                handler: "trilium:spec", producer: "script:abc"
            });
            await runNotificationAction(foreign, action);
            await runNotificationAction({ ...foreign, id: "spec:update", producer: "trilium:x" },
                action);
            expect(builtIn).not.toHaveBeenCalled();
            await runNotificationAction({ ...foreign, producer: "trilium:spec" }, action);
            expect(builtIn).toHaveBeenCalledOnce();
            expect(markRead).toHaveBeenCalledTimes(2);
        });

    it("changes a transient notification only through the handle of its own client", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const markRead = vi.spyOn(notificationStore, "markRead");
        const handle = {
            id: "own", setTitle: vi.fn(), setProgress: vi.fn(), setActions: vi.fn(),
            dismiss: vi.fn()
        } as unknown as TransientNotificationHandle;
        vi.spyOn(notificationStore, "getOwnTransient")
            .mockImplementation((id) => (id === "own" ? handle : undefined));
        registerResults([
            undefined, { update: { title: "Paused", progress: 0.5 } }, { dismiss: true },
            { dismiss: true }
        ]);
        const own: TransientNotification = {
            id: "own", type: "transient", producer: "client",
            createdAt: "2026-11-27 10:00:00.000Z", title: "Import", handler: "spec:handler"
        };

        await runNotificationAction(own, action);
        expect(markRead).not.toHaveBeenCalled();
        await runNotificationAction(own, action);
        expect(handle.setTitle).toHaveBeenCalledWith("Paused");
        expect(handle.setProgress).toHaveBeenCalledWith(0.5);
        expect(handle.setActions).not.toHaveBeenCalled();
        await runNotificationAction(own, action);
        expect(handle.dismiss).toHaveBeenCalledOnce();

        await runNotificationAction({ ...own, id: "other" }, action);
        expect(handle.dismiss).toHaveBeenCalledOnce();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("another client"));
    });
});

describe("getShownActions", () => {
    it("hides actions without a handler that runs here, and says why once", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const actions = [ { id: "go", caption: "Go" } ];
        const withoutHandler = makeNotification("no-handler", { actions });
        expect(getShownActions(withoutHandler)).toEqual([]);
        expect(getShownActions(withoutHandler)).toEqual([]);
        expect(warn).toHaveBeenCalledExactlyOnceWith("Notification actions are available only "
            + "when the \"handler\" property is specified");

        const unregistered = makeNotification("unregistered", { actions, handler: "spec:x" });
        expect(getShownActions(unregistered)).toEqual([]);
        expect(warn).toHaveBeenLastCalledWith("Notification action handler spec:x not registered");
        // A built-in handler named by another producer gets no explanation.
        getShownActions(makeNotification("foreign", { actions, handler: "trilium:x" }));
        expect(warn).toHaveBeenCalledTimes(2);

        notificationStore.registerActionHandler("spec:x", () => {});
        expect(getShownActions(unregistered)).toBe(actions);
        expect(getShownActions(makeNotification("none"))).toEqual([]);
    });
});
