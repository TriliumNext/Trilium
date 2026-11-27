import "./NotificationCard.css";

import type { TransientNotification, TriliumNotification } from "@triliumnext/commons";
import { isBuiltInNotificationProducer } from "@triliumnext/commons/src/lib/notifications.js";
import clsx from "clsx";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Trans } from "react-i18next";

import contextMenu, { type MenuItem } from "../../menus/context_menu";
import { dayjs } from "../../services/dayjs";
import { t } from "../../services/i18n";
import {
    getActionCaption, getNotificationIcon, getNotificationText, getReferencedNoteId,
    getRunnableHandler, getShownActions, isClickable, markBidiControls, runNotificationAction,
    type ShownNotification
} from "../../services/notification_display";
import notificationStore from "../../services/notifications";
import { formatDateTime } from "../../utils/formatters";
import ActionButton from "../react/ActionButton";
import Button from "../react/Button";
import { useNote, useNoteProperty } from "../react/hooks/note";
import Icon from "../react/Icon";
import NoteLink from "../react/NoteLink";
import ProgressBar from "../react/ProgressBar";

const SCRIPT_PRODUCER_PREFIX = "script:";

interface NotificationCardProps {
    notification: TriliumNotification;
    /** The time that the relative time of the card counts from. */
    nowMs: number;
    /** Called after a click on the card opened its link or its note. */
    onOpened?: () => void;
}

/**
 * One notification of the panel: its icon, title, time, description and progress, its actions,
 * the source of one that is not built in, and the dot of an unread one, which marks it read. Its
 * context menu removes a standard notification, or dismisses a persistent one anyway, which the
 * card asks to confirm. A persistent one without a handler on this client offers that at once.
 */
export default function NotificationCard({ notification, nowMs, onOpened }: NotificationCardProps) {
    const [ isConfirmingDismissal, setConfirmingDismissal ] = useState(false);
    const isWithoutHandler = notification.type === "persistent"
        && !getRunnableHandler(notification);

    return (
        <div
            className={clsx(
                "notification-card", `is-${notification.state}`,
                `attention-${notification.attentionLevel}`
            )}
            data-notification-id={notification.notificationId}
            onContextMenu={(e) => openCardMenu(e, notification,
                () => setConfirmingDismissal(true))}
        >
            <CardMain
                notification={notification}
                time={<RaisedAt raisedAt={notification.raisedAt} nowMs={nowMs} />}
                onOpened={onOpened}
            >
                {isConfirmingDismissal
                    ? <DismissalConfirmation
                        onConfirm={() => void notificationStore.dismissAnyway(notification)}
                        onCancel={() => setConfirmingDismissal(false)}
                    />
                    : isWithoutHandler && (
                        <Button
                            className="notification-card-dismiss-anyway"
                            text={t("notifications.dismiss-anyway")}
                            kind="lowProfile"
                            size="small"
                            onClick={() => setConfirmingDismissal(true)}
                        />
                    )}
            </CardMain>
            <ReadDot notification={notification} />
        </div>
    );
}

/** A transient notification, pinned above the cards: an operation that is still running. */
export function TransientNotificationCard({ notification }: {
    notification: TransientNotification;
}) {
    return (
        <div className="notification-card is-transient" data-transient-id={notification.id}>
            <CardMain notification={notification} />
            <span className="notification-read-dot-slot" />
        </div>
    );
}

interface CardMainProps {
    notification: ShownNotification;
    time?: ComponentChildren;
    onOpened?: () => void;
    /** Shown after the actions. */
    children?: ComponentChildren;
}

/** What a stored and a transient card share: a click on it runs its handler or opens its place. */
function CardMain({ notification, time, onOpened, children }: CardMainProps) {
    const note = useNote(getReferencedNoteId(notification), true);
    const noteTitle = useNoteProperty(note, "title");
    const { title, description } = getNotificationText(notification, noteTitle);
    const canClick = isClickable(notification);

    async function click(e: Event) {
        // Leaves a click on a link, a button or the confirmation inside the card to that element.
        if ((e.target as Element | null)?.closest("a, button, .notification-card-confirmation")) {
            return;
        }
        e.preventDefault();
        if (await runNotificationAction(notification, null)) {
            onOpened?.();
        }
    }

    return (
        <div
            className={clsx("notification-card-main", canClick && "is-clickable")}
            role={canClick ? "button" : undefined}
            tabIndex={canClick ? 0 : undefined}
            onClick={canClick ? click : undefined}
            onKeyDown={canClick ? (e) => {
                if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                    void click(e);
                }
            } : undefined}
        >
            <Icon className="notification-card-icon" icon={getNotificationIcon(notification)} />
            <div className="notification-card-body">
                <div className="notification-card-heading">
                    <span className="notification-card-title">{markBidiControls(title)}</span>
                    {time}
                </div>
                {description && (
                    <div className="notification-card-description">
                        {markBidiControls(description)}
                    </div>
                )}
                <NotificationProgress notification={notification} />
                <NotificationActions notification={notification}>{children}</NotificationActions>
                <NotificationSource producer={notification.producer} />
            </div>
        </div>
    );
}

function RaisedAt({ raisedAt, nowMs }: { raisedAt: string; nowMs: number }) {
    const date = new Date(raisedAt.replace(" ", "T"));
    // A raise dated after `nowMs` by a backend clock that runs ahead shows as just now.
    const fromMs = Math.max(nowMs, date.getTime());
    return (
        <span className="notification-card-time" title={formatDateTime(date)}>
            {dayjs(date).from(fromMs)}
        </span>
    );
}

/** A bar for a progress from 0 to 1, or a moving one for a negative progress. */
function NotificationProgress({ notification }: { notification: ShownNotification }) {
    const { progress, progressLabel } = notification;
    if (progress === undefined) {
        return null;
    }

    return (
        <div className="notification-card-progress">
            <ProgressBar
                className={clsx(progress < 0 && "is-indeterminate")}
                value={Math.max(0, progress)}
                max={1}
            />
            {progressLabel && <span>{markBidiControls(progressLabel)}</span>}
        </div>
    );
}

/** The buttons of the actions that a handler on this client runs, and what the card adds. */
function NotificationActions({ notification, children }: {
    notification: ShownNotification;
    children?: ComponentChildren;
}) {
    const actions = getShownActions(notification);
    if (actions.length === 0 && !children) {
        return null;
    }

    return (
        <div className="notification-card-actions">
            {actions.map((action, index) => (
                <Button
                    key={action.id}
                    text={markBidiControls(getActionCaption(action, index))}
                    icon={action.icon}
                    size="small"
                    onClick={() => void runNotificationAction(notification, action)}
                />
            ))}
            {children}
        </div>
    );
}

/** Names what raised a notification that is not built in: a script note, or a client. */
function NotificationSource({ producer }: { producer: string }) {
    if (isBuiltInNotificationProducer(producer)) {
        return null;
    }

    return (
        <div className="notification-card-source">
            {producer.startsWith(SCRIPT_PRODUCER_PREFIX)
                ? <Trans
                    i18nKey="notifications.source-script"
                    components={{
                        script: <NoteLink
                            notePath={producer.substring(SCRIPT_PRODUCER_PREFIX.length)}
                            noPreview
                        /> as React.ReactElement
                    }}
                />
                : t("notifications.source-client")}
        </div>
    );
}

/** The dot of an unread notification: a check on hover, focus or press, which marks it read. */
function ReadDot({ notification }: { notification: TriliumNotification }) {
    if (notification.state === "read") {
        return <span className="notification-read-dot-slot" />;
    }

    return (
        <ActionButton
            className="notification-read-dot"
            icon="bx bx-check"
            text={t("notifications.mark-read")}
            titlePosition="left"
            onClick={() => notificationStore.markRead([ notification ])}
        />
    );
}

/** Asks before a persistent notification is dismissed without its handler. */
function DismissalConfirmation({ onConfirm, onCancel }: {
    onConfirm: () => void;
    onCancel: () => void;
}) {
    return (
        <div className="notification-card-confirmation" role="group">
            <span>{t("notifications.dismiss-anyway-confirm")}</span>
            <Button
                text={t("notifications.dismiss")} size="small" kind="primary" onClick={onConfirm}
            />
            <Button text={t("confirm.cancel")} size="small" onClick={onCancel} />
        </div>
    );
}

/** "Remove" for a standard notification, "Dismiss anyway" for a persistent one. */
function openCardMenu(
    e: MouseEvent,
    notification: TriliumNotification,
    confirmDismissal: () => void
) {
    e.preventDefault();
    e.stopPropagation();

    const item: MenuItem<never> = notification.type === "persistent"
        ? {
            title: t("notifications.dismiss-anyway"),
            uiIcon: "bx bx-x-circle",
            handler: confirmDismissal
        }
        : {
            title: t("notifications.remove"),
            uiIcon: "bx bx-trash",
            handler: () => void notificationStore.remove(notification)
        };
    contextMenu.show({
        x: e.pageX,
        y: e.pageY,
        items: [ item ],
        selectMenuItemHandler: () => {}
    });
}
