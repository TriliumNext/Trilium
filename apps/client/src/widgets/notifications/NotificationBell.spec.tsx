import type { NotificationCounts, TriliumNotification } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/i18n", () => ({
    t: (key: string, values?: { count?: number }) =>
        (values?.count === undefined ? key : `${key}:${values.count}`)
}));
vi.mock("./NotificationPanel", () => ({
    default: () => <div className="notification-panel-content">Panel</div>
}));

import notificationStore from "../../services/notifications";
import options from "../../services/options";
import { renderInto } from "../../test/render";
import NotificationBell from "./NotificationBell";

function withStates(...states: TriliumNotification["state"][]) {
    return states.map((state, index): TriliumNotification => ({
        notificationId: `bellHash0000${index.toString(36).padStart(9, "0")}`,
        id: `bell-${index}`,
        raisedAt: "2026-11-27 10:00:00.000Z",
        updatedAt: "2026-11-27 10:00:00.000Z",
        revision: "r",
        category: "general",
        type: "standard",
        attentionLevel: "medium",
        state,
        producer: "trilium:test"
    }));
}

async function renderBell() {
    let container: HTMLElement | undefined;
    await act(async () => {
        container = renderInto(<NotificationBell />);
    });
    const button = container?.querySelector<HTMLButtonElement>("button.notification-bell-button");
    if (!button) {
        throw new Error("The bell was not rendered");
    }
    return button;
}

afterEach(() => {
    notificationStore.notifications.value = [];
    notificationStore.isLoaded.value = false;
    notificationStore.counts.value = null;
    options.set("notificationsSilent", "false");
});

describe("NotificationBell", () => {
    it("counts pending notifications, and shows a dot while only unread ones remain", async () => {
        notificationStore.isLoaded.value = true;
        notificationStore.notifications.value = withStates("pending", "pending", "seen", "read");
        const bell = await renderBell();

        expect(bell.querySelector(".notification-bell-count")?.textContent).toBe("2");
        expect(bell.querySelector(".notification-bell-dot")).toBeNull();
        expect(bell.getAttribute("aria-label")).toBe("notifications.bell-label-pending:2");

        await act(async () => {
            notificationStore.notifications.value = withStates("seen", "read");
        });
        expect(bell.querySelector(".notification-bell-count")).toBeNull();
        expect(bell.querySelector(".notification-bell-dot")).not.toBeNull();
        expect(bell.getAttribute("aria-label")).toBe("notifications.title");

        await act(async () => {
            notificationStore.notifications.value = withStates("read");
        });
        expect(bell.querySelector(".notification-bell-dot")).toBeNull();
    });

    it("counts from the first page until the load is done, and caps the number", async () => {
        const counts: NotificationCounts = {
            total: 1200, pending: 150, unread: 400, live: 1200, dailyBudgetReached: []
        };
        notificationStore.counts.value = counts;
        const bell = await renderBell();

        expect(bell.querySelector(".notification-bell-count")?.textContent).toBe("99+");
    });

    it("shows a bell that is off on a silent device", async () => {
        const bell = await renderBell();
        expect(bell.classList).toContain("bx-bell");

        options.set("notificationsSilent", "true");
        const silent = await renderBell();
        expect(silent.classList).toContain("bx-bell-off");
        expect(silent.classList).not.toContain("bx-bell");
    });

    it("loads the panel when it first opens", async () => {
        const bell = await renderBell();
        await act(async () => bell.click());

        await vi.waitFor(() => expect(
            document.querySelector(".notification-panel .notification-panel-content")
        ).not.toBeNull());
        expect(bell.getAttribute("aria-expanded")).toBe("true");
    });
});
