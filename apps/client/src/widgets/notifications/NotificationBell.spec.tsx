import type { NotificationCounts, TriliumNotification } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

const launcherMenu = vi.hoisted(() => ({ show: vi.fn() }));

vi.mock("../../services/i18n", () => ({
    t: (key: string, values?: { count?: number }) =>
        (values?.count === undefined ? key : `${key}:${values.count}`)
}));
vi.mock("./NotificationPanel", () => ({
    default: () => <div className="notification-panel-content">Panel</div>
}));
vi.mock("../../menus/launcher_button_context_menu", () => ({
    showLauncherContextMenu: launcherMenu.show
}));

import notificationStore from "../../services/notifications";
import options from "../../services/options";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { LaunchBarContext } from "../launch_bar/launch_bar_widgets";
import NotificationBell, { NotificationLauncher } from "./NotificationBell";

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
    notificationStore.transients.value = [];
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

    it("turns a ring while an operation with a transient notification runs", async () => {
        const bell = await renderBell();
        expect(bell.querySelector(".notification-bell-activity")).toBeNull();

        await act(async () => {
            notificationStore.transients.value = [ {
                id: "spec-transient", type: "transient", producer: "client",
                createdAt: "2026-11-27 10:00:00.000Z", title: "Importing"
            } ];
        });
        expect(bell.classList).toContain("is-active");
        expect(bell.querySelector(".notification-bell-activity")).not.toBeNull();
    });

    it("stays open while the context menu of a card is used", async () => {
        const bell = await renderBell();
        await act(async () => bell.click());
        await vi.waitFor(() => expect(
            document.querySelector(".notification-panel .notification-panel-content")
        ).not.toBeNull());
        const menu = document.createElement("div");
        menu.id = "context-menu-container";
        document.body.append(menu);
        try {
            await act(async () => {
                menu.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
            });
            expect(bell.getAttribute("aria-expanded")).toBe("true");

            // The menu takes Escape first, and the panel stays.
            document.body.classList.add("context-menu-shown");
            await act(async () => {
                menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            });
            expect(bell.getAttribute("aria-expanded")).toBe("true");
            document.body.classList.remove("context-menu-shown");

            await act(async () => {
                document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
            });
            expect(bell.getAttribute("aria-expanded")).toBe("false");
        } finally {
            menu.remove();
            document.body.classList.remove("context-menu-shown");
        }
    });
});

describe("NotificationLauncher", () => {
    async function renderLauncher() {
        const launcherNote = buildNote({
            id: "_lbMobileNotifications",
            title: "Notifications",
            type: "launcher",
            "#launcherType": "builtinWidget",
            "#builtinWidget": "notifications"
        });
        let container: HTMLElement | undefined;
        await act(async () => {
            container = renderInto(
                <LaunchBarContext.Provider value={{ isHorizontalLayout: true }}>
                    <NotificationLauncher launcherNote={launcherNote} />
                </LaunchBarContext.Provider>
            );
        });
        const button = container?.querySelector<HTMLButtonElement>(
            ".right-dropdown-widget > button.right-dropdown-button.launcher-button"
        );
        if (!button) {
            throw new Error("The launcher was not rendered");
        }
        return button;
    }

    it("shows the bell's state over its icon, and offers the launch bar's menu", async () => {
        notificationStore.isLoaded.value = true;
        notificationStore.notifications.value = withStates("pending", "seen");
        const launcher = await renderLauncher();

        const glyph = launcher.querySelector(".notification-bell-glyph");
        expect(glyph?.querySelector(".tn-icon.bx-bell")).toBeInstanceOf(HTMLElement);
        expect(glyph?.querySelector(".notification-bell-count")?.textContent).toBe("1");
        expect(launcher.getAttribute("aria-label")).toBe("notifications.bell-label-pending:1");

        const contextMenu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        await act(async () => {
            launcher.dispatchEvent(contextMenu);
        });
        await vi.waitFor(() => expect(launcherMenu.show).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ noteId: "_lbMobileNotifications" }),
            contextMenu,
            expect.anything()
        ));

        options.set("notificationsSilent", "true");
        const silent = await renderLauncher();
        expect(silent.querySelector(".notification-bell-glyph .tn-icon.bx-bell-off"))
            .toBeInstanceOf(HTMLElement);
        expect(silent.querySelector(".bx-bell")).toBeNull();
    });

    it("opens the panel in a popup that a phone's stylesheet pins above the bar", async () => {
        const launcher = await renderLauncher();
        await act(async () => launcher.click());

        const popup = ".tn-dropdown-portal.right-dropdown-widget > .notification-panel";
        await vi.waitFor(() => expect(
            document.querySelector(`${popup} .notification-panel-content`)
        ).not.toBeNull());
        expect(launcher.getAttribute("aria-expanded")).toBe("true");
    });
});
