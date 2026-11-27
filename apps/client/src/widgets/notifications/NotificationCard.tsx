import "./NotificationCard.css";

import type { TriliumNotification } from "@triliumnext/commons";
import { isBuiltInNotificationProducer } from "@triliumnext/commons/src/lib/notifications.js";
import clsx from "clsx";
import { Trans } from "react-i18next";

import { dayjs } from "../../services/dayjs";
import { t } from "../../services/i18n";
import {
    getNotificationIcon, getNotificationText, getReferencedNoteId, hasPlaceToOpen,
    markBidiControls, openNotification
} from "../../services/notification_display";
import notificationStore from "../../services/notifications";
import { formatDateTime } from "../../utils/formatters";
import ActionButton from "../react/ActionButton";
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
 * One notification of the panel: its icon, title, time, description and progress, the source of
 * one that is not built in, and the dot of an unread one, which marks it read.
 */
export default function NotificationCard({ notification, nowMs, onOpened }: NotificationCardProps) {
    const note = useNote(getReferencedNoteId(notification), true);
    const noteTitle = useNoteProperty(note, "title");
    const { title, description } = getNotificationText(notification, noteTitle);
    const canOpen = hasPlaceToOpen(notification);

    async function open(e: Event) {
        // Leaves a click on a link or a button inside the card to that element.
        if ((e.target as Element | null)?.closest("a, button")) {
            return;
        }
        e.preventDefault();
        if (await openNotification(notification)) {
            onOpened?.();
        }
    }

    return (
        <div
            className={clsx(
                "notification-card", `is-${notification.state}`,
                `attention-${notification.attentionLevel}`
            )}
            data-notification-id={notification.notificationId}
        >
            <div
                className={clsx("notification-card-main", canOpen && "is-clickable")}
                role={canOpen ? "button" : undefined}
                tabIndex={canOpen ? 0 : undefined}
                onClick={canOpen ? open : undefined}
                onKeyDown={canOpen ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        void open(e);
                    }
                } : undefined}
            >
                <Icon className="notification-card-icon" icon={getNotificationIcon(notification)} />
                <div className="notification-card-body">
                    <div className="notification-card-heading">
                        <span className="notification-card-title">{markBidiControls(title)}</span>
                        <RaisedAt raisedAt={notification.raisedAt} nowMs={nowMs} />
                    </div>
                    {description && (
                        <div className="notification-card-description">
                            {markBidiControls(description)}
                        </div>
                    )}
                    <NotificationProgress notification={notification} />
                    <NotificationSource producer={notification.producer} />
                </div>
            </div>
            <ReadDot notification={notification} />
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
function NotificationProgress({ notification }: { notification: TriliumNotification }) {
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
