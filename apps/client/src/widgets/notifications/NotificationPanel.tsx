import "./NotificationPanel.css";

import type { NotificationCounts, TriliumNotification } from "@triliumnext/commons";
import { NOTIFICATION_LIVE_LIMIT } from "@triliumnext/commons/src/lib/notifications.js";
import { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Trans } from "react-i18next";

import { t } from "../../services/i18n";
import notificationStore from "../../services/notifications";
import ActionButton from "../react/ActionButton";
import Alert from "../react/Alert";
import Button from "../react/Button";
import type { DropdownHandle } from "../react/Dropdown";
import FormToggle from "../react/FormToggle";
import { useNotifications, useTransientNotifications } from "../react/hooks/notifications";
import { useTriliumOptionBool } from "../react/hooks/options";
import LoadingSpinner from "../react/LoadingSpinner";
import NoItems from "../react/NoItems";
import NoteLink from "../react/NoteLink";
import NotificationCard, { TransientNotificationCard } from "./NotificationCard";

/** The cards drawn at first, and added by each click on "Show more". */
const CARDS_PER_STEP = 50;
/** The relative times of the cards are drawn again this often. */
const TIME_TICK_MS = 60_000;
/** A card counts as seen once it has been in view this long. */
const SEEN_AFTER_MS = 1000;
const SEEN_CHECK_INTERVAL_MS = 250;
const VISIBILITY_THRESHOLDS = Array.from({ length: 11 }, (_, index) => index / 10);
const SCRIPT_PRODUCER_PREFIX = "script:";

interface NotificationPanelProps {
    /** The dropdown of the panel, which closes once a card has opened its note. */
    dropdownRef: RefObject<DropdownHandle | null>;
}

/**
 * The panel of the bell: "Mark all as read", "Clear all" and "Silent", the notices of the limits,
 * the transient notifications pinned above the list, and the cards, newest first, 50 at a time.
 */
export default function NotificationPanel({ dropdownRef }: NotificationPanelProps) {
    const { notifications, counts, isLoaded } = useNotifications();
    const transients = useTransientNotifications();
    const [ shownCount, setShownCount ] = useState(CARDS_PER_STEP);
    const listRef = useRef<HTMLDivElement>(null);
    useTimeTick(TIME_TICK_MS);
    useSeenTracking(listRef, notifications);
    // A load that failed is tried again when the panel opens.
    useEffect(() => void notificationStore.whenLoaded(), []);

    const nowMs = Date.now();
    return (
        <div className="notification-panel-content">
            <PanelHeader notifications={notifications} />
            {counts && <PanelNotices counts={counts} />}
            {transients.length > 0 && (
                <div className="notification-panel-transients">
                    {transients.map((transient) => (
                        <TransientNotificationCard key={transient.id} notification={transient} />
                    ))}
                </div>
            )}
            <div ref={listRef} className="notification-panel-list">
                {notifications.slice(0, shownCount).map((notification) => (
                    <NotificationCard
                        key={notification.notificationId}
                        notification={notification}
                        nowMs={nowMs}
                        onOpened={() => dropdownRef.current?.hide()}
                    />
                ))}
                {notifications.length > shownCount && (
                    <Button
                        className="notification-panel-more"
                        text={t("notifications.show-more")}
                        onClick={() => setShownCount((count) => count + CARDS_PER_STEP)}
                    />
                )}
                {notifications.length === 0 && !isLoaded && (
                    <div className="notification-panel-loading"><LoadingSpinner /></div>
                )}
                {notifications.length === 0 && isLoaded && transients.length === 0 && (
                    <NoItems icon="bx bx-bell" text={t("notifications.empty")} size="small" />
                )}
            </div>
        </div>
    );
}

function PanelHeader({ notifications }: { notifications: readonly TriliumNotification[] }) {
    const [ isSilent, setIsSilent ] = useTriliumOptionBool("notificationsSilent");
    const hasUnread = notifications.some(({ state }) => state !== "read");
    const hasStandard = notifications.some(({ type }) => type === "standard");

    return (
        <div className="notification-panel-header">
            <span className="notification-panel-title">{t("notifications.title")}</span>
            <FormToggle
                currentValue={isSilent}
                onChange={(value) => void setIsSilent(value)}
                switchOnName={t("notifications.silent")}
                switchOffName={t("notifications.silent")}
                switchOnTooltip={t("notifications.silent-on-tooltip")}
                switchOffTooltip={t("notifications.silent-off-tooltip")}
            />
            <ActionButton
                icon="bx bx-check-double"
                text={t("notifications.mark-all-read")}
                disabled={!hasUnread}
                onClick={() => void notificationStore.markAllAsRead()}
            />
            <ActionButton
                icon="bx bx-trash"
                text={t("notifications.clear-all")}
                disabled={!hasStandard}
                onClick={() => void notificationStore.clearAll()}
            />
        </div>
    );
}

/** Shows when this instance takes no new notifications, and whose it drops for the day. */
function PanelNotices({ counts }: { counts: NotificationCounts }) {
    const isFull = counts.live >= NOTIFICATION_LIVE_LIMIT;
    if (!isFull && counts.dailyBudgetReached.length === 0) {
        return null;
    }

    return (
        <div className="notification-panel-notices">
            {isFull && <Alert type="warning">{t("notifications.limit-reached")}</Alert>}
            {counts.dailyBudgetReached.map((producer) => (
                <Alert key={producer} type="warning">
                    {producer.startsWith(SCRIPT_PRODUCER_PREFIX)
                        ? <Trans
                            i18nKey="notifications.daily-budget-script"
                            components={{
                                script: <NoteLink
                                    notePath={producer.substring(SCRIPT_PRODUCER_PREFIX.length)}
                                    noPreview
                                /> as React.ReactElement
                            }}
                        />
                        : t("notifications.daily-budget-client")}
                </Alert>
            ))}
        </div>
    );
}

/** Draws the component again every `intervalMs`. */
function useTimeTick(intervalMs: number) {
    const [ , setTick ] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => setTick((tick) => tick + 1), intervalMs);
        return () => clearInterval(timer);
    }, [ intervalMs ]);
}

/** Marks the pending cards seen that {@link SeenTracker} reports, while the panel is open. */
function useSeenTracking(
    listRef: RefObject<HTMLElement | null>,
    notifications: readonly TriliumNotification[]
) {
    const watchRef = useRef<{ tracker: SeenTracker; observer: IntersectionObserver } | null>(null);
    const notificationsRef = useRef(notifications);
    notificationsRef.current = notifications;

    useEffect(() => {
        const list = listRef.current;
        if (!list) {
            return;
        }

        const tracker = new SeenTracker((notificationIds) => {
            const ids = new Set(notificationIds);
            notificationStore.markSeen(notificationsRef.current
                .filter(({ notificationId }) => ids.has(notificationId)));
        }, isPageAttentive());
        const observer = new IntersectionObserver((entries) => {
            const nowMs = Date.now();
            for (const entry of entries) {
                const { notificationId } = (entry.target as HTMLElement).dataset;
                if (notificationId) {
                    tracker.setInView(notificationId, isMostlyInView(entry), nowMs);
                }
            }
        }, { root: list, threshold: VISIBILITY_THRESHOLDS });
        const onAttentionChange = () => tracker.setAttentive(isPageAttentive(), Date.now());
        window.addEventListener("focus", onAttentionChange);
        window.addEventListener("blur", onAttentionChange);
        document.addEventListener("visibilitychange", onAttentionChange);
        const timer = setInterval(() => tracker.check(Date.now()), SEEN_CHECK_INTERVAL_MS);
        watchRef.current = { tracker, observer };

        return () => {
            watchRef.current = null;
            observer.disconnect();
            window.removeEventListener("focus", onAttentionChange);
            window.removeEventListener("blur", onAttentionChange);
            document.removeEventListener("visibilitychange", onAttentionChange);
            clearInterval(timer);
        };
    }, []);

    // After every render, watches the pending cards that are drawn.
    useEffect(() => {
        const watch = watchRef.current;
        const list = listRef.current;
        if (!watch || !list) {
            return;
        }

        watch.observer.disconnect();
        const pendingIds = new Set<string>();
        for (const card of list.querySelectorAll<HTMLElement>(".notification-card.is-pending")) {
            watch.observer.observe(card);
            pendingIds.add(card.dataset.notificationId ?? "");
        }
        watch.tracker.retain(pendingIds);
    });
}

/**
 * Counts a card as seen after it has been in view for a second while the page is visible and has
 * the focus: an `IntersectionObserver` alone reports a card in a background window as visible.
 */
export class SeenTracker {

    private readonly inView = new Set<string>();
    /** When each card in view began to count: since it came into view, or the page into focus. */
    private readonly countedSince = new Map<string, number>();

    constructor(
        private readonly onSeen: (notificationIds: string[]) => void,
        private isAttentive: boolean
    ) {}

    setInView(notificationId: string, isInView: boolean, nowMs: number) {
        if (!isInView) {
            this.inView.delete(notificationId);
            this.countedSince.delete(notificationId);
        } else if (!this.inView.has(notificationId)) {
            this.inView.add(notificationId);
            if (this.isAttentive) {
                this.countedSince.set(notificationId, nowMs);
            }
        }
    }

    /** Stops the count while the page is hidden or without the focus, and restarts it after. */
    setAttentive(isAttentive: boolean, nowMs: number) {
        if (isAttentive === this.isAttentive) {
            return;
        }

        this.isAttentive = isAttentive;
        this.countedSince.clear();
        if (isAttentive) {
            for (const notificationId of this.inView) {
                this.countedSince.set(notificationId, nowMs);
            }
        }
    }

    /** Forgets the cards that are no longer pending. */
    retain(notificationIds: Set<string>) {
        for (const notificationId of this.inView) {
            if (!notificationIds.has(notificationId)) {
                this.inView.delete(notificationId);
                this.countedSince.delete(notificationId);
            }
        }
    }

    /** Reports the cards that have counted for a second. */
    check(nowMs: number) {
        const seen: string[] = [];
        for (const [ notificationId, sinceMs ] of this.countedSince) {
            if (nowMs - sinceMs >= SEEN_AFTER_MS) {
                seen.push(notificationId);
                this.inView.delete(notificationId);
                this.countedSince.delete(notificationId);
            }
        }
        if (seen.length > 0) {
            this.onSeen(seen);
        }
    }

}

function isPageAttentive() {
    return document.visibilityState === "visible" && document.hasFocus();
}

/** Half of a card in view, or a card taller than the list that fills half of it. */
function isMostlyInView(entry: IntersectionObserverEntry) {
    if (!entry.isIntersecting) {
        return false;
    }
    const rootHeight = entry.rootBounds?.height ?? Infinity;
    return entry.intersectionRatio >= 0.5 || entry.intersectionRect.height >= rootHeight / 2;
}
