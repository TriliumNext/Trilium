import "./TabHistoryNavigationButtons.css";

import { useEffect, useMemo, useState } from "preact/hooks";

import { t } from "../services/i18n";
import { dynamicRequire, isElectron } from "../services/utils";
import { handleHistoryContextMenu } from "./launch_bar/HistoryNavigation";
import ActionButton from "./react/ActionButton";
import { useLauncherVisibility } from "./react/hooks";

export default function TabHistoryNavigationButtons() {
    const webContents = useMemo(() => isElectron() ? dynamicRequire("@electron/remote").getCurrentWebContents() : undefined, []);
    const onContextMenu = webContents ? handleHistoryContextMenu(webContents) : undefined;
    const { canGoBack, canGoForward } = useBackForwardState(webContents);
    const legacyBackVisible = useLauncherVisibility("_lbBackInHistory");
    const legacyForwardVisible = useLauncherVisibility("_lbForwardInHistory");

    return (
        <div className="tab-history-navigation-buttons">
            {!legacyBackVisible && <ActionButton
                icon="bx bx-left-arrow-alt"
                text={t("tab_history_navigation_buttons.go-back")}
                triggerCommand="backInNoteHistory"
                onContextMenu={onContextMenu}
                disabled={!canGoBack}
            />}
            {!legacyForwardVisible && <ActionButton
                icon="bx bx-right-arrow-alt"
                text={t("tab_history_navigation_buttons.go-forward")}
                triggerCommand="forwardInNoteHistory"
                onContextMenu={onContextMenu}
                disabled={!canGoForward}
            />}
        </div>
    );
}

function useBackForwardState(webContents: Electron.WebContents | undefined) {
    const [ canGoBack, setCanGoBack ] = useState(webContents?.navigationHistory.canGoBack());
    const [ canGoForward, setCanGoForward ] = useState(webContents?.navigationHistory.canGoForward());

    useEffect(() => {
        if (!webContents) return;

        const updateNavigationState = () => {
            setCanGoBack(webContents.navigationHistory.canGoBack());
            setCanGoForward(webContents.navigationHistory.canGoForward());
        };

        webContents.on("did-navigate", updateNavigationState);
        webContents.on("did-navigate-in-page", updateNavigationState);

        return () => {
            webContents.removeListener("did-navigate", updateNavigationState);
            webContents.removeListener("did-navigate-in-page", updateNavigationState);
        };
    }, [ webContents ]);

    if (!webContents) {
        return { canGoBack: true, canGoForward: true };
    }

    return { canGoBack, canGoForward };
}
