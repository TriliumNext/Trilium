import type { NotificationCounts, TriliumNotification } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));
vi.mock("react-i18next", () => ({
    Trans: ({ i18nKey, components }: {
        i18nKey: string; components: Record<string, preact.VNode>
    }) => (
        <span data-i18n-key={i18nKey}>{Object.values(components)}</span>
    )
}));

import notificationStore from "../../services/notifications";
import options from "../../services/options";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import NotificationPanel, { SeenTracker } from "./NotificationPanel";

/** A fake of the browser's observer, which a spec tells the cards that are in view. */
class FakeIntersectionObserver {

    static current: FakeIntersectionObserver | null = null;
    readonly observed = new Set<Element>();

    constructor(
        private readonly callback: IntersectionObserverCallback,
        readonly options: IntersectionObserverInit
    ) {
        FakeIntersectionObserver.current = this;
    }

    observe(element: Element) {
        this.observed.add(element);
    }

    disconnect() {
        this.observed.clear();
    }

    /** Reports the observed cards with these notification IDs as fully in view. */
    show(...notificationIds: string[]) {
        const entries = [ ...this.observed ]
            .filter((element) => notificationIds.includes(
                (element as HTMLElement).dataset.notificationId ?? ""))
            .map((target) => ({
                target, isIntersecting: true, intersectionRatio: 1,
                intersectionRect: { height: 100 }, rootBounds: { height: 400 }
            }) as unknown as IntersectionObserverEntry);
        this.callback(entries, this as unknown as IntersectionObserver);
    }

}

function makeNotifications(count: number, overrides: Partial<TriliumNotification> = {}) {
    return Array.from({ length: count }, (_, index): TriliumNotification => ({
        notificationId: `panelHash000${index.toString(36).padStart(9, "0")}`,
        id: `panel-${index}`,
        raisedAt: "2026-11-27 10:00:00.000Z",
        updatedAt: "2026-11-27 10:00:00.000Z",
        revision: "r",
        category: "general",
        type: "standard",
        attentionLevel: "medium",
        state: "read",
        producer: "trilium:test",
        title: `Notification ${index}`,
        ...overrides
    }));
}

function counts(overrides: Partial<NotificationCounts> = {}): NotificationCounts {
    return { total: 0, pending: 0, unread: 0, live: 0, dailyBudgetReached: [], ...overrides };
}

function setStore(notifications: TriliumNotification[], isLoaded = true, storeCounts = counts()) {
    notificationStore.notifications.value = notifications;
    notificationStore.isLoaded.value = isLoaded;
    notificationStore.counts.value = storeCounts;
}

async function renderPanel() {
    let container: HTMLElement | undefined;
    await act(async () => {
        container = renderInto(<NotificationPanel dropdownRef={{ current: null }} />);
    });
    if (!container) {
        throw new Error("The panel was not rendered");
    }
    return container;
}

beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(notificationStore, "whenLoaded").mockResolvedValue();
});

afterEach(() => {
    setStore([], false, counts());
    notificationStore.transients.value = [];
    notificationStore.actionHandlers.value = new Map();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("NotificationPanel", () => {
    it("draws 50 cards at a time, down to the last one", async () => {
        setStore(makeNotifications(120));
        const panel = await renderPanel();
        const cards = () => panel.querySelectorAll(".notification-card");
        const showMore = () => panel.querySelector<HTMLButtonElement>(".notification-panel-more");

        expect(cards()).toHaveLength(50);
        await act(async () => showMore()?.click());
        expect(cards()).toHaveLength(100);
        await act(async () => showMore()?.click());
        expect(cards()).toHaveLength(120);
        expect(showMore()).toBeNull();
        // Opening the panel tries a load that failed again.
        expect(notificationStore.whenLoaded).toHaveBeenCalled();
    });

    it("resolves the oldest of 101 persistent notifications through its action", async () => {
        const action = { id: "resolve", caption: "Resolve" };
        const persistent = makeNotifications(101,
            { type: "persistent", handler: "spec:resolve", actions: [ action ] });
        setStore(persistent);
        const dismiss = vi.spyOn(notificationStore, "dismiss").mockResolvedValue();
        notificationStore.registerActionHandler("spec:resolve", () => ({ dismiss: true }));
        const panel = await renderPanel();
        for (let click = 0; click < 2; click++) {
            await act(async () => panel.querySelector<HTMLButtonElement>(
                ".notification-panel-more")?.click());
        }

        const oldest = persistent[100];
        const card = panel.querySelector(`[data-notification-id="${oldest.notificationId}"]`);
        const button = card?.querySelector<HTMLButtonElement>(".notification-card-actions button");
        expect(button?.textContent?.trim()).toBe("Resolve");
        await act(async () => button?.click());
        await vi.waitFor(() => expect(dismiss)
            .toHaveBeenCalledExactlyOnceWith({ id: oldest.id, raisedAt: oldest.raisedAt }));
    });

    it("pins the transient notifications above the cards", async () => {
        notificationStore.transients.value = [ {
            id: "spec-transient", type: "transient", producer: "trilium:test",
            createdAt: "2026-11-27 10:00:00.000Z", title: "Importing", progress: 0.5
        } ];
        setStore(makeNotifications(1));
        const panel = await renderPanel();
        const pinned = panel.querySelector(".notification-panel-transients");
        const list = panel.querySelector(".notification-panel-list");
        expect(pinned?.querySelector(".notification-card.is-transient .notification-card-title")
            ?.textContent).toBe("Importing");
        expect(list?.querySelector(".is-transient")).toBeNull();
        expect(list && pinned?.compareDocumentPosition(list))
            .toBe(Node.DOCUMENT_POSITION_FOLLOWING);

        // An operation alone is no empty panel.
        setStore([]);
        const alone = await renderPanel();
        expect(alone.querySelector(".notification-panel-transients")).not.toBeNull();
        expect(alone.querySelector(".no-items")).toBeNull();
    });

    it("says that it holds none once loaded, and shows a spinner until then", async () => {
        setStore([], false);
        const loading = await renderPanel();
        expect(loading.querySelector(".notification-panel-loading .bx-spin")).not.toBeNull();
        expect(loading.querySelector(".no-items")).toBeNull();

        setStore([], true);
        const empty = await renderPanel();
        expect(empty.querySelector(".no-items")?.textContent).toBe("notifications.empty");
    });

    it("marks all as read, clears all, and turns the sound and the toasts off", async () => {
        const markAllAsRead = vi.spyOn(notificationStore, "markAllAsRead").mockResolvedValue();
        const clearAll = vi.spyOn(notificationStore, "clearAll").mockResolvedValue();
        const save = vi.spyOn(options, "save").mockResolvedValue();
        setStore([ ...makeNotifications(1, { state: "seen" }) ]);
        const panel = await renderPanel();
        const [ markAll, clear ] = panel.querySelectorAll<HTMLButtonElement>(
            ".notification-panel-header button.icon-action");

        expect(markAll.className).toContain("bx-check-double");
        await act(async () => markAll.click());
        await act(async () => clear.click());
        expect(markAllAsRead).toHaveBeenCalledOnce();
        expect(clearAll).toHaveBeenCalledOnce();

        const toggle = panel.querySelector<HTMLInputElement>(".notification-panel-header input");
        await act(async () => {
            toggle?.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(save).toHaveBeenCalledWith("notificationsSilent", "true");
    });

    it("disables the actions that have nothing to act on", async () => {
        setStore(makeNotifications(2, { type: "persistent" }));
        const panel = await renderPanel();
        const [ markAll, clear ] = panel.querySelectorAll<HTMLButtonElement>(
            ".notification-panel-header button.icon-action");
        expect(markAll.disabled).toBe(true);
        expect(clear.disabled).toBe(true);
    });

    it("says when the device takes no new ones, and which producers are dropped", async () => {
        const script = buildNote({ title: "Flooding script" });
        setStore(makeNotifications(1), true, counts({
            live: 1000, dailyBudgetReached: [ `script:${script.noteId}`, "client" ]
        }));
        const panel = await renderPanel();
        const notices = [ ...panel.querySelectorAll(".notification-panel-notices .alert") ];

        expect(notices).toHaveLength(3);
        expect(notices[0].textContent).toBe("notifications.limit-reached");
        expect(notices[1].querySelector("[data-i18n-key]")?.getAttribute("data-i18n-key"))
            .toBe("notifications.daily-budget-script");
        await vi.waitFor(() => expect(notices[1].querySelector("a")?.textContent)
            .toContain("Flooding script"));
        expect(notices[2].textContent).toBe("notifications.daily-budget-client");

        setStore(makeNotifications(1), true, counts({ live: 999 }));
        const calm = await renderPanel();
        expect(calm.querySelector(".notification-panel-notices")).toBeNull();
    });

    it("marks the pending cards seen that stay in view for a second", async () => {
        vi.useFakeTimers();
        const markSeen = vi.spyOn(notificationStore, "markSeen").mockImplementation(() => {});
        const notifications = [
            ...makeNotifications(3, { state: "pending" }),
            ...makeNotifications(1)
                .map((read) => ({ ...read, notificationId: "panelHashRead00000001" }))
        ];
        setStore(notifications);
        await renderPanel();
        const observer = FakeIntersectionObserver.current;
        const [ first, second ] = notifications;

        // Only the pending cards are watched, in the list that scrolls.
        expect(observer?.observed.size).toBe(3);
        expect((observer?.options.root as HTMLElement).classList)
            .toContain("notification-panel-list");

        observer?.show(first.notificationId, second.notificationId);
        await vi.advanceTimersByTimeAsync(750);
        expect(markSeen).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(500);
        expect(markSeen).toHaveBeenCalledOnce();
        expect(markSeen).toHaveBeenCalledWith([ first, second ]);
    });
});

describe("SeenTracker", () => {
    it("reports a card after a second in view while the page has the user's attention", () => {
        const onSeen = vi.fn();
        const tracker = new SeenTracker(onSeen, true);

        tracker.setInView("a", true, 0);
        tracker.setInView("b", true, 0);
        tracker.setInView("b", false, 500);
        // A second report of a card in view keeps its first time.
        tracker.setInView("a", true, 900);
        tracker.check(999);
        expect(onSeen).not.toHaveBeenCalled();
        tracker.check(1000);
        expect(onSeen).toHaveBeenCalledWith([ "a" ]);

        // A reported card is not reported again.
        tracker.check(5000);
        expect(onSeen).toHaveBeenCalledOnce();
    });

    it("counts again once the page has the focus back, and forgets other cards", () => {
        const onSeen = vi.fn();
        const tracker = new SeenTracker(onSeen, false);

        tracker.setInView("a", true, 0);
        tracker.setInView("b", true, 0);
        tracker.check(2000);
        expect(onSeen).not.toHaveBeenCalled();

        tracker.setAttentive(true, 2000);
        tracker.setAttentive(true, 2500);
        tracker.setAttentive(false, 2900);
        // Nothing counts while the page is hidden or without the focus.
        tracker.check(3500);
        tracker.setAttentive(true, 3600);
        tracker.check(4599);
        expect(onSeen).not.toHaveBeenCalled();

        tracker.retain(new Set([ "a" ]));
        tracker.check(4600);
        expect(onSeen).toHaveBeenCalledWith([ "a" ]);
    });
});
