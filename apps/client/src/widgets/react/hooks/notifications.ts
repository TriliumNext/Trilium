/**
 * @module
 *
 * Hooks over the notification store. A component that calls one renders again when the store
 * changes, since it reads the store's signals while it renders.
 */
import notificationStore from "../../../services/notifications";

/** The notifications of the view, newest first, with the counts of the last load. */
export function useNotifications() {
    return {
        notifications: notificationStore.notifications.value,
        counts: notificationStore.counts.value,
        isLoaded: notificationStore.isLoaded.value
    };
}

/** What the bell shows: the number of pending notifications, and of unread ones. */
export function useNotificationCount() {
    return {
        pending: notificationStore.pendingCount.value,
        unread: notificationStore.unreadCount.value
    };
}
