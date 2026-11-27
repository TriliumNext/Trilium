import type { TransientNotification, TriliumNotification } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const opened = vi.hoisted(() => ({ result: true, runNotificationAction: vi.fn() }));

vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));
// The real i18n is not initialized under test; the stub renders the components that it wires in.
vi.mock("react-i18next", () => ({
    Trans: ({ i18nKey, components }: {
        i18nKey: string; components: Record<string, preact.VNode>
    }) => (
        <span data-i18n-key={i18nKey}>{Object.values(components)}</span>
    )
}));
vi.mock("../../services/notification_display", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../services/notification_display")>(),
    runNotificationAction: opened.runNotificationAction
}));

import contextMenu, { type MenuCommandItem } from "../../menus/context_menu";
import notificationStore from "../../services/notifications";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import NotificationCard, { TransientNotificationCard } from "./NotificationCard";

const NOW_MS = Date.UTC(2026, 10, 27, 10, 5, 0);

function makeNotification(overrides: Partial<TriliumNotification> = {}): TriliumNotification {
    return {
        notificationId: "cardHash0000000000001",
        id: "card",
        raisedAt: "2026-11-27 10:00:00.000Z",
        updatedAt: "2026-11-27 10:00:00.000Z",
        revision: "r",
        category: "general",
        type: "standard",
        attentionLevel: "medium",
        state: "pending",
        producer: "trilium:test",
        title: "Backup finished",
        ...overrides
    };
}

async function renderCard(notification: TriliumNotification, onOpened = vi.fn()) {
    let container: HTMLElement | undefined;
    await act(async () => {
        container = renderInto(
            <NotificationCard notification={notification} nowMs={NOW_MS} onOpened={onOpened} />);
    });
    const card = container?.querySelector<HTMLElement>(".notification-card");
    if (!card) {
        throw new Error("The card was not rendered");
    }
    return card;
}

beforeEach(() => {
    opened.result = true;
    opened.runNotificationAction.mockReset();
    opened.runNotificationAction.mockImplementation(async () => opened.result);
});

afterEach(() => {
    notificationStore.actionHandlers.value = new Map();
    vi.restoreAllMocks();
});

function buttonsOf(card: HTMLElement) {
    return [ ...card.querySelectorAll<HTMLButtonElement>(".notification-card-actions button") ];
}

/** Opens the card's context menu, and gives the items that it would show. */
function openMenu(card: HTMLElement) {
    const show = vi.spyOn(contextMenu, "show").mockResolvedValue();
    card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    return (show.mock.lastCall?.[0].items ?? []) as MenuCommandItem<never>[];
}

describe("NotificationCard", () => {
    it("shows the icon, the title, the time and the description with its line breaks", async () => {
        const card = await renderCard(makeNotification({
            description: "First line\nsecond line", attentionLevel: "high", icon: "bx bx-check"
        }));

        expect(card.classList).toContain("is-pending");
        expect(card.classList).toContain("attention-high");
        expect(card.dataset.notificationId).toBe("cardHash0000000000001");
        expect(card.querySelector(".notification-card-icon")?.className).toContain("bx-check");
        expect(card.querySelector(".notification-card-title")?.textContent).toBe("Backup finished");
        expect(card.querySelector(".notification-card-description")?.textContent)
            .toBe("First line\nsecond line");
        const time = card.querySelector(".notification-card-time");
        expect(time?.textContent).toBe("5 minutes ago");
        expect(time?.getAttribute("title")).toBeTruthy();
        // A notification that is not built in names where it came from.
        expect(card.querySelector(".notification-card-source")).toBeNull();
    });

    it("shows the title of its note when it has none, and marks bidi characters", async () => {
        const note = buildNote({ title: "Dentist" });
        const card = await renderCard(makeNotification({
            title: undefined, noteId: note.noteId, description: "Due \u{202E}today"
        }));
        await vi.waitFor(() => expect(card.querySelector(".notification-card-title")?.textContent)
            .toBe("Dentist"));
        expect(card.querySelector(".notification-card-description")?.textContent)
            .toBe("Due [U+202E]today");
    });

    it("opens its place on a click, and its dot marks it read", async () => {
        const markRead = vi.spyOn(notificationStore, "markRead").mockImplementation(() => {});
        const onOpened = vi.fn();
        const note = buildNote({ title: "Linked" });
        const notification = makeNotification({ link: `#root/${note.noteId}` });
        const card = await renderCard(notification, onOpened);
        const main = card.querySelector<HTMLElement>(".notification-card-main");
        expect(main?.getAttribute("role")).toBe("button");

        await act(async () => main?.click());
        expect(opened.runNotificationAction).toHaveBeenCalledWith(notification, null);
        expect(onOpened).toHaveBeenCalledOnce();

        await act(async () => {
            main?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        });
        expect(opened.runNotificationAction).toHaveBeenCalledTimes(2);

        // A card whose place cannot be opened keeps the panel open.
        opened.result = false;
        await act(async () => main?.click());
        expect(onOpened).toHaveBeenCalledTimes(2);

        const dot = card.querySelector<HTMLButtonElement>("button.notification-read-dot");
        expect(dot?.className).toContain("bx-check");
        await act(async () => dot?.click());
        expect(markRead).toHaveBeenCalledWith([ notification ]);
        expect(opened.runNotificationAction).toHaveBeenCalledTimes(3);
        markRead.mockRestore();
    });

    it("has no click and no dot when it has no place and is read", async () => {
        const card = await renderCard(makeNotification({ state: "read" }));
        const main = card.querySelector<HTMLElement>(".notification-card-main");

        expect(main?.getAttribute("role")).toBeNull();
        expect(main?.classList).not.toContain("is-clickable");
        await act(async () => main?.click());
        expect(opened.runNotificationAction).not.toHaveBeenCalled();
        expect(card.querySelector(".notification-read-dot")).toBeNull();
        expect(card.querySelector(".notification-read-dot-slot")).not.toBeNull();
    });

    it("names a script or a client that raised it", async () => {
        const script = buildNote({ title: "My reminder script" });
        const fromScript = await renderCard(
            makeNotification({ producer: `script:${script.noteId}` }));
        const source = fromScript.querySelector(".notification-card-source [data-i18n-key]");
        expect(source?.getAttribute("data-i18n-key")).toBe("notifications.source-script");
        await vi.waitFor(() => expect(source?.querySelector("a")?.textContent)
            .toContain("My reminder script"));

        const fromClient = await renderCard(makeNotification({ producer: "client" }));
        expect(fromClient.querySelector(".notification-card-source")?.textContent)
            .toBe("notifications.source-client");
    });

    it("shows a progress bar, which moves without end for a negative progress", async () => {
        const half = await renderCard(makeNotification({ progress: 0.5, progressLabel: "Half" }));
        const bar = half.querySelector(".tn-progress-bar");
        expect(bar?.getAttribute("aria-valuenow")).toBe("0.5");
        expect(bar?.classList).not.toContain("is-indeterminate");
        expect(half.querySelector(".notification-card-progress span")?.textContent).toBe("Half");

        const unknown = await renderCard(makeNotification({ progress: -1 }));
        expect(unknown.querySelector(".tn-progress-bar")?.classList).toContain("is-indeterminate");

        const none = await renderCard(makeNotification());
        expect(none.querySelector(".notification-card-progress")).toBeNull();
    });

    it("shows its actions once a handler on this client registers, and runs them", async () => {
        const actions = [ { id: "snooze", caption: "Snooze", icon: "bx bx-time" },
            { id: "done", caption: "" } ];
        const notification = makeNotification({ actions, handler: "spec:card" });
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const card = await renderCard(notification);
        expect(buttonsOf(card)).toEqual([]);
        expect(card.querySelector(".notification-card-main")?.getAttribute("role")).toBeNull();

        await act(async () => notificationStore.registerActionHandler("spec:card", () => {}));
        const buttons = buttonsOf(card);
        expect(buttons.map((button) => button.textContent?.trim()))
            .toEqual([ "Snooze", "notifications.action-generic" ]);
        // A handler makes the card itself clickable, for its default action.
        expect(card.querySelector(".notification-card-main")?.getAttribute("role")).toBe("button");
        await act(async () => buttons[0].click());
        expect(opened.runNotificationAction).toHaveBeenCalledWith(notification, actions[0]);
        expect(opened.runNotificationAction).toHaveBeenCalledOnce();
    });

    it("shows no buttons of a built-in handler on a notification not built in", async () => {
        notificationStore.registerActionHandler("trilium:spec", () => {});
        const actions = [ { id: "install", caption: "Install" } ];
        const script = buildNote({ title: "Impostor" });
        const foreign = await renderCard(makeNotification({
            id: "trilium:update", producer: `script:${script.noteId}`, handler: "trilium:spec",
            actions
        }));
        expect(buttonsOf(foreign)).toEqual([]);
        expect(foreign.querySelector(".notification-card-main")?.getAttribute("role")).toBeNull();

        const own = await renderCard(makeNotification({
            id: "trilium:update", producer: "trilium:spec", handler: "trilium:spec", actions
        }));
        expect(buttonsOf(own).map((button) => button.textContent?.trim())).toEqual([ "Install" ]);
    });

    it("offers a persistent one without a handler to dismiss anyway, once confirmed", async () => {
        const dismissAnyway = vi.spyOn(notificationStore, "dismissAnyway").mockResolvedValue();
        const note = buildNote({ title: "Linked" });
        const notification = makeNotification({
            type: "persistent", handler: "spec:missing", link: `#root/${note.noteId}`
        });
        const card = await renderCard(notification);
        const offer = () => buttonsOf(card).find((button) =>
            button.textContent?.includes("notifications.dismiss-anyway"));

        await act(async () => offer()?.click());
        const confirmation = card.querySelector<HTMLElement>(".notification-card-confirmation");
        expect(confirmation?.textContent).toContain("notifications.dismiss-anyway-confirm");
        // A click on its text opens nothing.
        await act(async () => confirmation?.querySelector("span")?.click());
        expect(opened.runNotificationAction).not.toHaveBeenCalled();
        const cancel = card.querySelector<HTMLButtonElement>(
            ".notification-card-confirmation .btn-secondary");
        expect(cancel?.textContent).toContain("confirm.cancel");
        await act(async () => cancel?.click());
        expect(card.querySelector(".notification-card-confirmation")).toBeNull();
        expect(dismissAnyway).not.toHaveBeenCalled();

        await act(async () => offer()?.click());
        const dismiss = card.querySelector<HTMLButtonElement>(
            ".notification-card-confirmation .btn-primary");
        expect(dismiss?.textContent).toContain("notifications.dismiss");
        await act(async () => dismiss?.click());
        expect(dismissAnyway).toHaveBeenCalledWith(notification);

        // With its handler on this client, the offer stays in the context menu only.
        await act(async () => card.querySelector<HTMLButtonElement>(
            ".notification-card-confirmation .btn-secondary")?.click());
        await act(async () => notificationStore.registerActionHandler("spec:missing", () => {}));
        expect(offer()).toBeUndefined();
    });

    it("removes a standard one, and dismisses a persistent one anyway, from its menu", async () => {
        const remove = vi.spyOn(notificationStore, "remove").mockResolvedValue();
        const standard = makeNotification();
        const [ removeItem ] = openMenu(await renderCard(standard));
        expect(removeItem.title).toBe("notifications.remove");
        removeItem.handler?.(removeItem, new MouseEvent("click"));
        expect(remove).toHaveBeenCalledWith(standard);

        const persistent = await renderCard(makeNotification({ type: "persistent" }));
        const items = openMenu(persistent);
        expect(items.map(({ title }) => title)).toEqual([ "notifications.dismiss-anyway" ]);
        await act(async () => items[0].handler?.(items[0], new MouseEvent("click")));
        expect(persistent.querySelector(".notification-card-confirmation")).not.toBeNull();
    });
});

describe("TransientNotificationCard", () => {
    it("shows an operation with its progress, without a time or a dot", async () => {
        const transient: TransientNotification = {
            id: "spec-transient", type: "transient", producer: "client",
            createdAt: "2026-11-27 10:00:00.000Z", title: "Importing", progress: 0.25
        };
        let container: HTMLElement | undefined;
        await act(async () => {
            container = renderInto(<TransientNotificationCard notification={transient} />);
        });
        const card = container?.querySelector<HTMLElement>(".notification-card.is-transient");
        expect(card?.dataset.transientId).toBe("spec-transient");
        expect(card?.querySelector(".notification-card-title")?.textContent).toBe("Importing");
        expect(card?.querySelector(".tn-progress-bar")?.getAttribute("aria-valuenow"))
            .toBe("0.25");
        expect(card?.querySelector(".notification-card-time")).toBeNull();
        expect(card?.querySelector(".notification-read-dot")).toBeNull();
        // Raised by a client, so it names where it came from.
        expect(card?.querySelector(".notification-card-source")?.textContent)
            .toBe("notifications.source-client");
    });
});
