import type { TriliumNotification } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const opened = vi.hoisted(() => ({ result: true, openNotification: vi.fn() }));

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
    openNotification: opened.openNotification
}));

import notificationStore from "../../services/notifications";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import NotificationCard from "./NotificationCard";

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
    opened.openNotification.mockReset();
    opened.openNotification.mockImplementation(async () => opened.result);
});

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
        expect(opened.openNotification).toHaveBeenCalledWith(notification);
        expect(onOpened).toHaveBeenCalledOnce();

        await act(async () => {
            main?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        });
        expect(opened.openNotification).toHaveBeenCalledTimes(2);

        // A card whose place cannot be opened keeps the panel open.
        opened.result = false;
        await act(async () => main?.click());
        expect(onOpened).toHaveBeenCalledTimes(2);

        const dot = card.querySelector<HTMLButtonElement>("button.notification-read-dot");
        expect(dot?.className).toContain("bx-check");
        await act(async () => dot?.click());
        expect(markRead).toHaveBeenCalledWith([ notification ]);
        expect(opened.openNotification).toHaveBeenCalledTimes(3);
        markRead.mockRestore();
    });

    it("has no click and no dot when it has no place and is read", async () => {
        const card = await renderCard(makeNotification({ state: "read" }));
        const main = card.querySelector<HTMLElement>(".notification-card-main");

        expect(main?.getAttribute("role")).toBeNull();
        expect(main?.classList).not.toContain("is-clickable");
        await act(async () => main?.click());
        expect(opened.openNotification).not.toHaveBeenCalled();
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
});
