import { useCallback } from "preact/hooks";

import appContext from "../../components/app_context";
import { t } from "../../services/i18n";
import { LaunchBarActionButton, LauncherNoteProps } from "./launch_bar_widgets";

/**
 * Launcher button to open the sidebar on the chat.
 * The chat is one of the sidebar's tabs, available for non-chat notes.
 */
export default function SidebarChatButton({ launcherNote }: LauncherNoteProps) {
    const handleClick = useCallback(() => {
        // Opens the right pane on the chat tab, or closes it if the chat is what it is already showing.
        appContext.triggerEvent("selectRightPaneTab", { tabId: "chat" });
    }, []);

    return (
        <LaunchBarActionButton
            launcherNote={launcherNote}
            icon="bx bx-message-square-dots"
            text={t("sidebar_chat.launcher_title")}
            onClick={handleClick}
        />
    );
}
