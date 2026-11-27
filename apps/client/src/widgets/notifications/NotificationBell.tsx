import "./NotificationBell.css";

import clsx from "clsx";
import { useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import { LaunchBarDropdownButton, type LauncherNoteProps } from "../launch_bar/launch_bar_widgets";
import { Badge } from "../react/Badge";
import { type DropdownHandle, DropdownPanel } from "../react/Dropdown";
import { useNotificationCount, useTransientNotifications } from "../react/hooks/notifications";
import { useTriliumOptionBool } from "../react/hooks/options";
import Icon from "../react/Icon";
import { preloadLazyModule } from "../react/LazyComponent";

const loadPanel = () => import("./NotificationPanel");
const preloadPanel = () => preloadLazyModule(loadPanel);
const PRELOAD_PANEL_PROPS = { onPointerEnter: preloadPanel, onFocus: preloadPanel };
/** A larger count shows as this number and a plus. */
const MAX_SHOWN_COUNT = 99;

/**
 * The bell of the tab bar. Its badge counts the pending notifications, a dot without a number shows
 * that unread ones remain, and a turning ring that operations with transient notifications run.
 * The panel loads when it first opens.
 */
export default function NotificationBell() {
    const bell = useBell();

    return (
        <DropdownPanel
            {...bell.dropdownProps}
            className="notification-bell"
            buttonClassName={clsx(
                "toggle-button notification-bell-button",
                bell.iconClass,
                bell.isActive && "is-active"
            )}
            iconAction
            noSelectButtonStyle
            hideToggleArrow
            placement="bottom-end"
            text={bell.marks}
        >
            {bell.panel}
        </DropdownPanel>
    );
}

/**
 * The bell as a launcher, for the launch bar of a phone, which has no tab bar. On a phone the panel
 * opens above the bar.
 */
export function NotificationLauncher({ launcherNote }: LauncherNoteProps) {
    const bell = useBell();

    return (
        <LaunchBarDropdownButton
            {...bell.dropdownProps}
            panel
            launcherNote={launcherNote}
            text={(
                <span className="notification-bell-glyph">
                    <Icon icon={bell.iconClass} />
                    {bell.marks}
                </span>
            )}
        >
            {bell.panel}
        </LaunchBarDropdownButton>
    );
}

/** The state that both bells show, and the props of the dropdown that opens their panel. */
function useBell() {
    const { pending, unread } = useNotificationCount();
    const isActive = useTransientNotifications().length > 0;
    const [ isSilent ] = useTriliumOptionBool("notificationsSilent");
    const dropdownRef = useRef<DropdownHandle>(null);
    const [ panel, setPanel ] = useState<Awaited<ReturnType<typeof loadPanel>>>();
    const label = pending > 0
        ? t("notifications.bell-label-pending", { count: pending })
        : t("notifications.title");

    return {
        iconClass: isSilent ? "bx bx-bell-off" : "bx bx-bell",
        isActive,
        marks: <>
            <BellMark pending={pending} unread={unread} />
            {isActive && <span className="notification-bell-activity" />}
        </>,
        panel: panel && <panel.default dropdownRef={dropdownRef} />,
        dropdownProps: {
            title: label,
            dropdownContainerClassName: "notification-panel",
            autoClose: "outside" as const,
            keepOpenSelector: "#context-menu-container",
            onShown: () => void loadPanel().then(setPanel),
            ready: !!panel,
            dropdownRef,
            buttonProps: { ...PRELOAD_PANEL_PROPS, "aria-label": label }
        }
    };
}

/** The count of pending notifications, or a dot while only unread ones remain. */
function BellMark({ pending, unread }: { pending: number; unread: number }) {
    if (pending > 0) {
        const text = pending > MAX_SHOWN_COUNT ? `${MAX_SHOWN_COUNT}+` : String(pending);
        return <Badge className="notification-bell-count" text={text} />;
    }
    return unread > 0 ? <span className="notification-bell-dot" /> : null;
}
