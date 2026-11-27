/**
 * @module
 *
 * The rules that a card of the panel and a toast share: which text and icon a notification shows,
 * and what a click on it opens.
 */
import type { NotificationCategory, TriliumNotification } from "@triliumnext/commons";

import appContext from "../components/app_context.js";
import { t } from "./i18n.js";
import { parseNavigationStateFromUrl } from "./navigation_state.js";
import notificationStore from "./notifications.js";
import protectedSessionHolder from "./protected_session_holder.js";

const CATEGORY_ICONS: Record<NotificationCategory, string> = {
    general: "bx bx-bell",
    reminder: "bx bx-alarm",
    softwareUpdate: "bx bx-download"
};
/** The bidirectional formatting characters, which a card and a toast show as code points. */
const BIDI_CONTROLS = /[\u{61C}\u{200E}\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}]/gu;

/** The note that a notification refers to: its `noteId`, or the note of its link. */
export function getReferencedNoteId(notification: TriliumNotification) {
    if (notification.noteId) {
        return notification.noteId;
    }
    return notification.link ? parseNavigationStateFromUrl(notification.link).noteId ?? null : null;
}

/**
 * The title and the description that a card or a toast shows. A sensitive notification shows its
 * private text while its backend has a protected session open, and its public text otherwise.
 *
 * @param noteTitle the title of the note that the notification refers to, from froca.
 */
export function getNotificationText(
    notification: TriliumNotification,
    noteTitle: string | undefined
): { title: string; description?: string } {
    const { title, description, protectedTitle, protectedDescription } = notification;
    const genericTitle = getCategoryTitle(notification.category);
    if (!notification.sensitive) {
        return { title: title || noteTitle || genericTitle, description };
    }
    if (protectedTitle !== undefined || protectedDescription !== undefined) {
        return {
            title: protectedTitle || noteTitle || title || genericTitle,
            description: protectedDescription
        };
    }
    if (protectedSessionHolder.isProtectedSessionAvailable()) {
        return { title: noteTitle || title || genericTitle, description };
    }
    return {
        title: title || genericTitle,
        description: description || t("notifications.enter-protected-session")
    };
}

/** The icon of a notification: its own, or the one of its category. */
export function getNotificationIcon(notification: TriliumNotification) {
    return notification.icon ?? CATEGORY_ICONS[notification.category] ?? CATEGORY_ICONS.general;
}

function getCategoryTitle(category: NotificationCategory) {
    switch (category) {
        case "reminder":
            return t("notifications.category-title.reminder");
        case "softwareUpdate":
            return t("notifications.category-title.softwareUpdate");
        default:
            return t("notifications.category-title.general");
    }
}

/** Replaces each bidi formatting character with its code point, which removes its effect. */
export function markBidiControls(text: string) {
    return text.replace(BIDI_CONTROLS, (control) =>
        `[U+${control.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}]`);
}

/** Whether a click on the notification opens something: its link or its note. */
export function hasPlaceToOpen(notification: TriliumNotification) {
    return !!(notification.link || notification.noteId);
}

/**
 * The default action of a notification: opens its link, or its note, in a tab that already shows
 * the note or else in a new one, and marks it read.
 *
 * @returns whether the notification had a place to open.
 */
export async function openNotification(notification: TriliumNotification) {
    const { link } = notification;
    const { notePath, noteId, viewScope } = link
        ? parseNavigationStateFromUrl(link)
        : { notePath: notification.noteId, noteId: notification.noteId, viewScope: undefined };
    if (!notePath || !noteId) {
        return false;
    }

    notificationStore.markRead([ notification ]);
    const { tabManager } = appContext;
    const shown = tabManager.getNoteContexts().find((context) => context.note?.noteId === noteId);
    if (shown) {
        await tabManager.activateNoteContext(shown.ntxId);
        // Sets the note again for a link with parameters, such as a block, to show its place.
        if (link?.includes("?")) {
            await shown.setNote(notePath, { viewScope });
        }
    } else {
        await tabManager.openTabWithNoteWithHoisting(notePath, { activate: true, viewScope });
    }
    return true;
}
