import { useCallback } from "preact/hooks";

import appContext from "../../components/app_context";
import { t } from "../../services/i18n";
import { LaunchBarActionButton } from "./launch_bar_widgets";

/**
 * Launcher button to open the sidebar (which contains the chat).
 * The chat widget is always visible in the sidebar for non-chat notes.
 */
export default function SidebarChatButton() {
    const handleClick = useCallback(() => {
        // Open right pane if hidden, or toggle it if visible
        appContext.triggerEvent("toggleRightPane", {});
    }, []);

    return (
        <LaunchBarActionButton
            icon="bx bx-message-square-dots"
            text={t("sidebar_chat.launcher_title")}
            onClick={handleClick}
        />
    );
}
