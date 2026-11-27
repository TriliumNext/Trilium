/**
 * @module
 *
 * The rules that a card of the panel and a toast share: which text, icon and actions a notification
 * shows, and what a click on it or on one of its actions does.
 */
import type {
    NotificationAction, NotificationActionHandler, NotificationActionResult, NotificationCategory,
    NotificationPatch, TransientNotification, TransientNotificationHandle, TriliumNotification
} from "@triliumnext/commons";
import {
    BUILT_IN_NOTIFICATION_PREFIX, isBuiltInNotificationProducer
} from "@triliumnext/commons/src/lib/notifications.js";

import appContext from "../components/app_context.js";
import { t } from "./i18n.js";
import { parseNavigationStateFromUrl } from "./navigation_state.js";
import notificationStore, { NotificationRequestError } from "./notifications.js";
import protectedSessionHolder from "./protected_session_holder.js";
import toastService from "./toast.js";

/** What a card or a toast shows: a stored notification or a transient one. */
export type ShownNotification = TriliumNotification | TransientNotification;

const CATEGORY_ICONS: Record<NotificationCategory, string> = {
    general: "bx bx-bell",
    reminder: "bx bx-alarm",
    softwareUpdate: "bx bx-download"
};
/** The bidirectional formatting characters, which a card and a toast show as code points. */
const BIDI_CONTROLS = /[\u{61C}\u{200E}\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}]/gu;
/** The notifications whose hidden actions were explained on the console. */
const explainedNotifications = new Set<string>();

/** The note that a notification refers to: its `noteId`, or the note of its link. */
export function getReferencedNoteId(notification: ShownNotification) {
    if (notification.noteId) {
        return notification.noteId;
    }
    const link = getLink(notification);
    return link ? parseNavigationStateFromUrl(link).noteId ?? null : null;
}

/**
 * The title and the description that a card or a toast shows. A sensitive notification shows its
 * private text while its backend has a protected session open, and its public text otherwise.
 *
 * @param noteTitle the title of the note that the notification refers to, from froca.
 */
export function getNotificationText(
    notification: ShownNotification,
    noteTitle: string | undefined
): { title: string; description?: string } {
    const { title, description, protectedTitle, protectedDescription } = notification;
    const genericTitle = getCategoryTitle(getCategory(notification));
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
export function getNotificationIcon(notification: ShownNotification) {
    return notification.icon
        ?? CATEGORY_ICONS[getCategory(notification)]
        ?? CATEGORY_ICONS.general;
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
export function hasPlaceToOpen(notification: ShownNotification) {
    return !!(getLink(notification) || notification.noteId);
}

/** Whether a click on the notification does something: runs its handler or opens a place. */
export function isClickable(notification: ShownNotification) {
    return !!getRunnableHandler(notification) || hasPlaceToOpen(notification);
}

/**
 * The handler that runs the actions of a notification on this client. A notification names its own
 * handler, so a built-in handler runs only on a notification whose producer is built in and whose
 * ID carries the prefix.
 */
export function getRunnableHandler(
    notification: ShownNotification
): NotificationActionHandler | undefined {
    const { handler } = notification;
    if (!handler || isForeignBuiltInHandler(notification)) {
        return undefined;
    }
    return notificationStore.getActionHandler(handler);
}

/**
 * The actions that a card or a toast shows: none without a handler that runs on this client. For a
 * notification whose actions stay hidden, the console says why, once.
 */
export function getShownActions(notification: ShownNotification): NotificationAction[] {
    const { actions, handler } = notification;
    if (!actions?.length) {
        return [];
    }
    if (getRunnableHandler(notification)) {
        return actions;
    }

    if (!handler) {
        explainOnce(notification,
            "Notification actions are available only when the \"handler\" property is specified");
    } else if (!isForeignBuiltInHandler(notification)) {
        explainOnce(notification, `Notification action handler ${handler} not registered`);
    }
    return [];
}

/** The caption of an action button. A sensitive notification keeps no caption in public text. */
export function getActionCaption(action: NotificationAction, index: number) {
    return action.caption || t("notifications.action-generic", { number: index + 1 });
}

/**
 * Runs a click on a notification, with `action` set to `null`, or on one of its actions. A handler
 * that runs on this client gets the notification, and its result applies to that generation; an
 * exception keeps the notification and shows a toast. Without a handler, a click on the
 * notification opens its link or its note.
 *
 * @returns whether the click opened a place.
 */
export async function runNotificationAction(
    notification: ShownNotification,
    action: NotificationAction | null
): Promise<boolean> {
    const handler = getRunnableHandler(notification);
    if (!handler) {
        return action === null ? await openNotification(notification) : false;
    }

    let result: NotificationActionResult;
    try {
        result = await handler({ action, notification });
    } catch (e) {
        // A handler is a script, whose errors go to the console as any script's do.
        console.error(e);
        toastService.showError(t("notifications.handler-failed"));
        return false;
    }

    try {
        await applyResult(notification, result);
    } catch (e) {
        const code = e instanceof NotificationRequestError ? e.code : "internal";
        console.warn(`The result of a notification action handler was refused: ${code}`);
        toastService.showError(t("notifications.handler-failed"));
    }
    return false;
}

/**
 * The default action of a notification: opens its link, or its note, in a tab that already shows
 * the note or else in a new one, and marks a stored notification read.
 *
 * @returns whether the notification had a place to open.
 */
export async function openNotification(notification: ShownNotification) {
    const link = getLink(notification);
    const { notePath, noteId, viewScope } = link
        ? parseNavigationStateFromUrl(link)
        : { notePath: notification.noteId, noteId: notification.noteId, viewScope: undefined };
    if (!notePath || !noteId) {
        return false;
    }

    if (notification.type !== "transient") {
        notificationStore.markRead([ notification ]);
    }
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

/**
 * Applies what a handler asked for. Nothing marks a standard notification read; a dismissal and an
 * update name the generation that the handler was given, so a dismissal does nothing once the
 * notification was raised again, and an update is dropped once its content or private text changed.
 */
async function applyResult(notification: ShownNotification, result: NotificationActionResult) {
    const isDismissal = isResultObject(result) && "dismiss" in result && result.dismiss === true;
    const patch = isResultObject(result) && "update" in result && !isDismissal
        ? result.update
        : undefined;

    if (notification.type === "transient") {
        if (isDismissal || patch) {
            applyTransientResult(notification, isDismissal, patch);
        }
    } else if (isDismissal) {
        await notificationStore.dismiss({ id: notification.id, raisedAt: notification.raisedAt });
    } else if (patch) {
        if (!await notificationStore.update(notification, patch)) {
            console.warn("The result of a notification action handler was dropped: "
                + "the notification changed while the handler ran");
        }
    } else if (notification.type === "standard") {
        notificationStore.markRead([ notification ]);
    }
}

/** A handler changes a transient notification through the handle of the client that owns it. */
function applyTransientResult(
    notification: TransientNotification,
    isDismissal: boolean,
    patch: NotificationPatch | undefined
) {
    const handle = notificationStore.getOwnTransient(notification.id);
    if (!handle) {
        console.warn("The result of a notification action handler was dropped: "
            + "the transient notification belongs to another client");
    } else if (isDismissal) {
        handle.dismiss();
    } else if (patch) {
        applyPatchToHandle(handle, patch);
    }
}

function applyPatchToHandle(handle: TransientNotificationHandle, patch: NotificationPatch) {
    const { title, description, protectedTitle, protectedDescription, icon, progress } = patch;
    const { progressLabel, actions } = patch;
    if (title !== undefined) {
        handle.setTitle(title);
    }
    if (description !== undefined) {
        handle.setDescription(description);
    }
    if (protectedTitle !== undefined) {
        handle.setProtectedTitle(protectedTitle);
    }
    if (protectedDescription !== undefined) {
        handle.setProtectedDescription(protectedDescription);
    }
    if (icon !== undefined) {
        handle.setIcon(icon);
    }
    if (progress !== undefined) {
        handle.setProgress(progress);
    }
    if (progressLabel !== undefined) {
        handle.setProgressLabel(progressLabel);
    }
    if (actions !== undefined) {
        handle.setActions(actions);
    }
}

/** Whether the notification names a built-in handler without being a built-in notification. */
function isForeignBuiltInHandler(notification: ShownNotification) {
    return !!notification.handler?.startsWith(BUILT_IN_NOTIFICATION_PREFIX)
        && !(notification.id.startsWith(BUILT_IN_NOTIFICATION_PREFIX)
            && isBuiltInNotificationProducer(notification.producer));
}

function explainOnce(notification: ShownNotification, message: string) {
    const key = notification.type === "transient"
        ? `transient:${notification.id}`
        : notification.notificationId;
    if (!explainedNotifications.has(key)) {
        explainedNotifications.add(key);
        console.warn(message);
    }
}

function isResultObject(result: unknown): result is Exclude<NotificationActionResult, void> {
    return typeof result === "object" && result !== null;
}

function getLink(notification: ShownNotification) {
    return notification.type === "transient" ? undefined : notification.link;
}

function getCategory(notification: ShownNotification): NotificationCategory {
    return notification.type === "transient" ? "general" : notification.category;
}
