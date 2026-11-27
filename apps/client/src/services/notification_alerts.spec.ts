import type { TriliumNotification } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ToastOptionsWithRequiredId } from "./toast.js";

/** A toast store that runs `onRemove` as the real one does. */
const toasts = vi.hoisted(() => {
    const shown = new Map<string, { onRemove?: () => void }>();
    return {
        shown,
        showPersistent: vi.fn((toast: { id: string; onRemove?: () => void }) => {
            shown.set(toast.id, toast);
        }),
        closePersistent: vi.fn((id: string) => {
            const toast = shown.get(id);
            shown.delete(id);
            toast?.onRemove?.();
        })
    };
});
const actions = vi.hoisted(() => ({ runNotificationAction: vi.fn(async () => true) }));

vi.mock("./toast.js", () => ({ default: toasts }));
vi.mock("./i18n.js", () => ({ t: (key: string) => key }));
vi.mock("./notification_display.js", async (importOriginal) => ({
    ...await importOriginal<typeof import("./notification_display.js")>(),
    runNotificationAction: actions.runNotificationAction
}));

import { buildNote } from "../test/easy-froca.js";
import froca from "./froca.js";
import { AlertClaims, type ClaimChannel, showAlert, type TabState } from "./notification_alerts.js";
import notificationStore from "./notifications.js";
import options from "./options.js";

class FakeAudio {

    static instances: FakeAudio[] = [];
    currentTime = 5;
    readonly play = vi.fn(async () => {});
    readonly load = vi.fn();

    constructor(readonly src: string) {
        FakeAudio.instances.push(this);
    }

}

/** Channels of tabs that hear each other's messages, as a `BroadcastChannel` does. */
function connectTabs(count: number) {
    const channels = Array.from({ length: count }, () => {
        const listeners: ((event: MessageEvent) => void)[] = [];
        const channel: ClaimChannel & { listeners: typeof listeners } = {
            listeners,
            postMessage(message: unknown) {
                for (const other of channels) {
                    if (other !== channel) {
                        for (const listener of other.listeners) {
                            listener({ data: message } as MessageEvent);
                        }
                    }
                }
            },
            addEventListener(_type, listener) {
                listeners.push(listener);
            }
        };
        return channel;
    });
    return channels;
}

let counter = 0;

function makeNotification(overrides: Partial<TriliumNotification> = {}): TriliumNotification {
    counter++;
    return {
        notificationId: `alertHash000${counter.toString(36).padStart(9, "0")}`,
        id: `alert-${counter}`,
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

/** The copy of a notification that the store holds once sync makes it sensitive. */
function asSensitive({ title: _title, description: _description, ...rest }: TriliumNotification) {
    return { ...rest, sensitive: true };
}

/** Shows the alert of `notification` in a focused tab, with the store holding it. */
async function alertOf(notification: TriliumNotification) {
    const others = notificationStore.notifications.value
        .filter(({ notificationId }) => notificationId !== notification.notificationId);
    notificationStore.notifications.value = [ notification, ...others ];
    vi.spyOn(notificationStore, "waitFor").mockResolvedValue(notification);
    await showAlert(notification.notificationId);
}

function lastToast() {
    return toasts.showPersistent.mock.lastCall?.[0] as ToastOptionsWithRequiredId | undefined;
}

beforeEach(() => {
    vi.stubGlobal("Audio", FakeAudio);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(options, "is").mockReturnValue(false);
    toasts.showPersistent.mockClear();
    toasts.closePersistent.mockClear();
    actions.runNotificationAction.mockClear();
});

afterEach(() => {
    for (const id of [ ...toasts.shown.keys() ]) {
        toasts.closePersistent(id);
    }
    notificationStore.notifications.value = [];
    notificationStore.actionHandlers.value = new Map();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("AlertClaims", () => {
    it("lets the tab that waits least claim, and the others hear its claim", async () => {
        vi.useFakeTimers();
        const [ focused, visible, hidden ] = connectTabs(3);
        const states: TabState[] = [ "focused", "visible", "hidden" ];
        const claims = [ focused, visible, hidden ]
            .map((channel, index) => new AlertClaims(channel, () => states[index]));

        const results = claims.map((claim) => claim.claim("n1"));
        await vi.advanceTimersByTimeAsync(400);
        expect(await Promise.all(results)).toEqual([ true, false, false ]);

        // Without a focused tab, the visible one claims before the hidden one.
        const second = [ claims[1].claim("n2"), claims[2].claim("n2") ];
        await vi.advanceTimersByTimeAsync(400);
        expect(await Promise.all(second)).toEqual([ true, false ]);

        // A claim already made, by this tab or another one, is not made again.
        const again = claims[0].claim("n1");
        await vi.advanceTimersByTimeAsync(0);
        expect(await again).toBe(false);
    });

    it("parts two hidden tabs by a random wait, and forgets a claim after 10 minutes", async () => {
        vi.useFakeTimers();
        const [ first, second ] = connectTabs(2);
        const early = new AlertClaims(first, () => "hidden");
        const late = new AlertClaims(second, () => "hidden");
        const random = vi.mocked(Math.random);

        random.mockReturnValueOnce(0.1).mockReturnValueOnce(0.9);
        const results = [ early.claim("n1"), late.claim("n1") ];
        await vi.advanceTimersByTimeAsync(400);
        expect(await Promise.all(results)).toEqual([ true, false ]);

        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
        const later = late.claim("n1");
        await vi.advanceTimersByTimeAsync(400);
        expect(await later).toBe(true);
    });

    it("claims every alert in a tab that has no channel", async () => {
        const claims = new AlertClaims(null, () => "focused");
        expect(await claims.claim("n1")).toBe(true);
        expect(await claims.claim("n1")).toBe(false);
    });
});

describe("showAlert", () => {
    it("unlocks the sound with a first pointer event, and plays it as it claims", async () => {
        document.dispatchEvent(new Event("pointerdown"));
        document.dispatchEvent(new Event("keydown"));
        expect(FakeAudio.instances).toHaveLength(1);
        const [ audio ] = FakeAudio.instances;
        expect(audio.load).toHaveBeenCalledOnce();
        expect(audio.src).toMatch(/notification-sound\.mp3/);

        vi.useFakeTimers();
        const alerting = alertOf(makeNotification());
        await vi.advanceTimersByTimeAsync(0);
        await alerting;
        expect(audio.play).toHaveBeenCalledOnce();
        expect(audio.currentTime).toBe(0);

        // Alerts that come together play the sound once.
        const together = alertOf(makeNotification());
        await vi.advanceTimersByTimeAsync(0);
        await together;
        expect(audio.play).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(2000);
        const later = alertOf(makeNotification());
        await vi.advanceTimersByTimeAsync(0);
        await later;
        expect(audio.play).toHaveBeenCalledTimes(2);
        expect(FakeAudio.instances).toHaveLength(1);
    });

    it("shows a toast that opens the notification and marks it seen when closed", async () => {
        buildNote({ id: "noteAbc1", title: "Linked note" });
        const markSeen = vi.spyOn(notificationStore, "markSeen").mockImplementation(() => {});
        const notification = makeNotification({
            description: "It took \u{202E}10 seconds", link: "#root/noteAbc1",
            attentionLevel: "high"
        });
        await alertOf(notification);

        const toast = lastToast();
        expect(toast).toMatchObject({
            id: `notification-${notification.notificationId}`,
            icon: "bx bx-bell",
            title: "Backup finished",
            message: "It took [U+202E]10 seconds",
            timeout: undefined
        });

        const dismissToast = vi.fn();
        toast?.onClick?.({ dismissToast });
        expect(dismissToast).toHaveBeenCalled();
        expect(actions.runNotificationAction).toHaveBeenCalledWith(notification, null);

        toast?.onDismiss?.();
        expect(markSeen).toHaveBeenCalledWith([ notification ]);

        // Without a description the title is the message; without a place there is no click.
        await alertOf(makeNotification({ category: "reminder", icon: undefined }));
        expect(lastToast()).toMatchObject({
            title: undefined, message: "Backup finished", icon: "bx bx-alarm", timeout: 10_000
        });
        expect(lastToast()?.onClick).toBeUndefined();
    });

    it("shows the buttons of the actions that a handler on this client runs", async () => {
        const buttons = [ { id: "snooze", caption: "Snooze" }, { id: "done", caption: "" } ];
        const withActions = makeNotification({ actions: buttons, handler: "spec:handler" });
        vi.spyOn(console, "warn").mockImplementation(() => {});
        await alertOf(withActions);
        expect(lastToast()?.buttons).toBeUndefined();
        // Without a place, a click on the toast has nothing to run either.
        expect(lastToast()?.onClick).toBeUndefined();

        notificationStore.registerActionHandler("spec:handler", () => {});
        await alertOf(withActions);
        const toast = lastToast();
        expect(toast?.buttons?.map(({ text }) => text))
            .toEqual([ "Snooze", "notifications.action-generic" ]);
        const dismissToast = vi.fn();
        toast?.buttons?.[1].onClick({ dismissToast });
        expect(dismissToast).toHaveBeenCalled();
        expect(actions.runNotificationAction).toHaveBeenCalledWith(withActions, buttons[1]);
        toast?.onClick?.({ dismissToast });
        expect(actions.runNotificationAction).toHaveBeenLastCalledWith(withActions, null);
    });

    it("shows nothing for a notification no longer pending, or on a silent device", async () => {
        await alertOf(makeNotification({ state: "seen" }));
        vi.spyOn(notificationStore, "waitFor").mockResolvedValue(null);
        await showAlert("missing");
        vi.mocked(options.is).mockReturnValue(true);
        await alertOf(makeNotification());

        expect(toasts.showPersistent).not.toHaveBeenCalled();
    });

    it("keeps three toasts, and closes one once its notification is read", async () => {
        const shown = Array.from({ length: 4 }, () => makeNotification());
        for (const notification of shown) {
            await alertOf(notification);
        }

        expect(toasts.closePersistent).toHaveBeenCalledOnce();
        expect(toasts.closePersistent)
            .toHaveBeenCalledWith(`notification-${shown[0].notificationId}`);

        notificationStore.notifications.value = [
            { ...shown[1], state: "read" }, shown[2], { ...shown[3], state: "seen" }
        ];
        expect([ ...toasts.shown.keys() ]).toEqual([
            `notification-${shown[2].notificationId}`, `notification-${shown[3].notificationId}`
        ]);
    });

    it("shows only the public text once the notification turns sensitive", async () => {
        const notification = makeNotification({
            description: "Call the bank", attentionLevel: "high"
        });
        await alertOf(notification);
        expect(lastToast()).toMatchObject({ title: "Backup finished", message: "Call the bank" });

        notificationStore.notifications.value = [ asSensitive(notification) ];
        expect(lastToast()).toMatchObject({
            id: `notification-${notification.notificationId}`,
            title: "notifications.category-title.general",
            message: "notifications.enter-protected-session"
        });
    });

    it("builds the toast from the copy that the store holds after the note lookup", async () => {
        const notification = makeNotification({ description: "Call the bank", noteId: "noteAbc2" });
        vi.spyOn(froca, "getNote").mockImplementation(async () => {
            notificationStore.notifications.value = [ asSensitive(notification) ];
            return null;
        });
        await alertOf(notification);

        const messages = toasts.showPersistent.mock.calls
            .map(([ toast ]) => (toast as ToastOptionsWithRequiredId).message);
        expect(messages).toEqual([ "notifications.enter-protected-session" ]);
    });
});
