import "./NotificationBell.css";

import clsx from "clsx";
import { useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import { Badge } from "../react/Badge";
import { type DropdownHandle, DropdownPanel } from "../react/Dropdown";
import { useNotificationCount, useTransientNotifications } from "../react/hooks/notifications";
import { useTriliumOptionBool } from "../react/hooks/options";
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
    const { pending, unread } = useNotificationCount();
    const isActive = useTransientNotifications().length > 0;
    const [ isSilent ] = useTriliumOptionBool("notificationsSilent");
    const dropdownRef = useRef<DropdownHandle>(null);
    const [ panel, setPanel ] = useState<Awaited<ReturnType<typeof loadPanel>>>();
    const label = pending > 0
        ? t("notifications.bell-label-pending", { count: pending })
        : t("notifications.title");

    return (
        <DropdownPanel
            className="notification-bell"
            buttonClassName={clsx(
                "toggle-button notification-bell-button bx",
                isSilent ? "bx-bell-off" : "bx-bell",
                isActive && "is-active"
            )}
            dropdownContainerClassName="notification-panel"
            iconAction
            noSelectButtonStyle
            hideToggleArrow
            title={label}
            placement="bottom-end"
            autoClose="outside"
            keepOpenSelector="#context-menu-container"
            text={<>
                <BellMark pending={pending} unread={unread} />
                {isActive && <span className="notification-bell-activity" />}
            </>}
            onShown={() => void loadPanel().then(setPanel)}
            ready={!!panel}
            dropdownRef={dropdownRef}
            buttonProps={{ ...PRELOAD_PANEL_PROPS, "aria-label": label }}
        >
            {panel && <panel.default dropdownRef={dropdownRef} />}
        </DropdownPanel>
    );
}

/** The count of pending notifications, or a dot while only unread ones remain. */
function BellMark({ pending, unread }: { pending: number; unread: number }) {
    if (pending > 0) {
        const text = pending > MAX_SHOWN_COUNT ? `${MAX_SHOWN_COUNT}+` : String(pending);
        return <Badge className="notification-bell-count" text={text} />;
    }
    return unread > 0 ? <span className="notification-bell-dot" /> : null;
}
