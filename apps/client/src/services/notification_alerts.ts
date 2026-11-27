/**
 * @module
 *
 * The alert of a notification: a toast in every tab of this backend, and the sound in the one tab
 * of this browser profile that claims the alert. Loaded on the first alert.
 */
import { effect } from "@preact/signals";
import type { TriliumNotification } from "@triliumnext/commons";

import soundUrl from "../assets/notification-sound.mp3?url";
import froca from "./froca.js";
import {
    getActionCaption, getNotificationIcon, getNotificationText, getReferencedNoteId,
    getShownActions, isClickable, markBidiControls, runNotificationAction
} from "./notification_display.js";
import notificationStore from "./notifications.js";
import options from "./options.js";
import toastService from "./toast.js";

/** How long an alert waits for its notification to reach the store. */
const NOTIFICATION_WAIT_MS = 5000;
/** How long a tab waits before it claims an alert, by its state: a focused tab claims first. */
const CLAIM_WAIT_MS: Record<TabState, number> = { focused: 0, visible: 150, hidden: 300 };
/** A random part of the wait, so that two tabs in the same state rarely claim at once. */
const CLAIM_JITTER_MS = 40;
/** A claim is kept as long as the backend alerts for a generation. */
const CLAIM_MEMORY_MS = 10 * 60 * 1000;
const MEDIUM_TOAST_TIMEOUT_MS = 10_000;
/** The toasts of notifications shown at once; a new one closes the oldest. */
const TOAST_LIMIT = 3;
/** The sound plays at most once in this time, for alerts that come together. */
const SOUND_INTERVAL_MS = 2000;

export type TabState = "focused" | "visible" | "hidden";

/** What the claims need of a `BroadcastChannel`. */
export interface ClaimChannel {
    postMessage(message: unknown): void;
    addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

/** Shows the toast of a notification, and plays the sound in the tab that claims the alert. */
export async function showAlert(notificationId: string) {
    const notification = await notificationStore.waitFor(notificationId, NOTIFICATION_WAIT_MS);
    if (!notification || notification.state !== "pending" || options.is("notificationsSilent")) {
        return;
    }

    await showToast(notification);
    claims ??= new AlertClaims(openClaimChannel());
    if (await claims.claim(notificationId)) {
        playSound();
    }
}

/**
 * Shares out the alerts among the tabs of a browser profile. Each tab waits by its state, then
 * claims the alert unless another tab has claimed it. The claim is a best effort: two tabs that
 * claim at the same moment both play the sound.
 */
export class AlertClaims {

    private readonly claimed = new Map<string, number>();

    constructor(
        private readonly channel: ClaimChannel | null,
        private readonly getState: () => TabState = getTabState
    ) {
        channel?.addEventListener("message", ({ data }) => {
            if (isClaimMessage(data)) {
                this.claimed.set(data.notificationId, Date.now());
            }
        });
    }

    /** Resolves to whether this tab claimed the alert of the notification. */
    async claim(notificationId: string) {
        const state = this.getState();
        const jitterMs = state === "focused" ? 0 : Math.random() * CLAIM_JITTER_MS;
        await new Promise((resolve) => setTimeout(resolve, CLAIM_WAIT_MS[state] + jitterMs));

        const nowMs = Date.now();
        for (const [ claimedId, timeMs ] of this.claimed) {
            if (nowMs - timeMs > CLAIM_MEMORY_MS) {
                this.claimed.delete(claimedId);
            }
        }
        if (this.claimed.has(notificationId)) {
            return false;
        }

        this.claimed.set(notificationId, nowMs);
        this.channel?.postMessage({ type: "claim", notificationId });
        return true;
    }

}

let claims: AlertClaims | null = null;
/** The copy of each notification that its toast shows, by `notificationId`, oldest first. */
const shownToasts = new Map<string, TriliumNotification>();
let audio: HTMLAudioElement | null = null;
let lastSoundMs = -Infinity;

// Updates the toast of a notification that changed, and closes it once the notification is read
// or dismissed, here or elsewhere.
effect(() => {
    const unread = new Map(notificationStore.notifications.value
        .filter(({ state }) => state !== "read")
        .map((notification) => [ notification.notificationId, notification ]));
    for (const [ notificationId, shown ] of [ ...shownToasts ]) {
        const current = unread.get(notificationId);
        if (!current) {
            toastService.closePersistent(toastIdOf(notificationId));
        } else if (current !== shown) {
            renderToast(current);
        }
    }
});
unlockSoundOnFirstGesture();

async function showToast(notification: TriliumNotification) {
    const noteId = getReferencedNoteId(notification);
    if (noteId) {
        // Loads the note into froca, where `renderToast()` reads its title.
        await froca.getNote(noteId, true);
    }
    // The store's copy can change during the lookup.
    const current = notificationStore.notifications.value
        .find(({ notificationId }) => notificationId === notification.notificationId);
    if (current?.state !== "pending") {
        return;
    }

    renderToast(current);
    const excess = Math.max(0, shownToasts.size - TOAST_LIMIT);
    for (const oldest of [ ...shownToasts.keys() ].slice(0, excess)) {
        toastService.closePersistent(toastIdOf(oldest));
    }
}

/** Shows the toast of a notification, or updates the one shown, from this copy of it. */
function renderToast(notification: TriliumNotification) {
    const { notificationId } = notification;
    const noteId = getReferencedNoteId(notification);
    const noteTitle = noteId ? froca.getNoteFromCache(noteId)?.title : undefined;
    const { title, description } = getNotificationText(notification, noteTitle);
    const actions = getShownActions(notification);

    shownToasts.set(notificationId, notification);
    toastService.showPersistent({
        id: toastIdOf(notificationId),
        icon: getNotificationIcon(notification),
        title: description ? markBidiControls(title) : undefined,
        message: markBidiControls(description ?? title),
        timeout: notification.attentionLevel === "high" ? undefined : MEDIUM_TOAST_TIMEOUT_MS,
        onClick: isClickable(notification) ? ({ dismissToast }) => {
            dismissToast();
            void runNotificationAction(notification, null);
        } : undefined,
        buttons: actions.length > 0 ? actions.map((action, index) => ({
            text: markBidiControls(getActionCaption(action, index)),
            onClick: ({ dismissToast }) => {
                dismissToast();
                void runNotificationAction(notification, action);
            }
        })) : undefined,
        onDismiss: () => notificationStore.markSeen([ notification ]),
        onRemove: () => shownToasts.delete(notificationId)
    });
}

function playSound() {
    const nowMs = Date.now();
    if (nowMs - lastSoundMs < SOUND_INTERVAL_MS) {
        return;
    }

    lastSoundMs = nowMs;
    const sound = getAudio();
    sound.currentTime = 0;
    // A browser refuses to play before the first pointer or key event of the tab.
    sound.play().catch(() => {});
}

function getAudio() {
    audio ??= new Audio(soundUrl);
    return audio;
}

/** Calls `load()` in the first pointer or key event: Safari plays a sound only after one. */
function unlockSoundOnFirstGesture() {
    const unlock = () => {
        document.removeEventListener("pointerdown", unlock, true);
        document.removeEventListener("keydown", unlock, true);
        getAudio().load();
    };
    document.addEventListener("pointerdown", unlock, true);
    document.addEventListener("keydown", unlock, true);
}

/** The channel of the tabs of this database. Two databases behind one origin get two channels. */
function openClaimChannel(): ClaimChannel | null {
    const { documentIdHash } = window.glob;
    if (typeof BroadcastChannel !== "function" || !documentIdHash) {
        return null;
    }
    return new BroadcastChannel(`trilium-notification-alerts-${documentIdHash}`);
}

function getTabState(): TabState {
    if (document.hasFocus()) {
        return "focused";
    }
    return document.visibilityState === "visible" ? "visible" : "hidden";
}

function isClaimMessage(data: unknown): data is { type: "claim"; notificationId: string } {
    const message = data as { type?: unknown; notificationId?: unknown } | null;
    return message?.type === "claim" && typeof message.notificationId === "string";
}

function toastIdOf(notificationId: string) {
    return `notification-${notificationId}`;
}
