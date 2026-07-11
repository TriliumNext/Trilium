import "./TabHistoryNavigationButtons.css";

import type { ElectronApi } from "@triliumnext/commons";
import { useEffect, useState } from "preact/hooks";

import { t } from "../services/i18n";
import { isElectron } from "../services/utils";
import { handleHistoryContextMenu } from "./launch_bar/HistoryNavigation";
import ActionButton from "./react/ActionButton";
import { useLauncherVisibility } from "./react/hooks";

export default function TabHistoryNavigationButtons() {
    const hasApi = isElectron() && window.electronApi;
    const onContextMenu = hasApi ? handleHistoryContextMenu() : undefined;
    const { canGoBack, canGoForward } = useBackForwardState(hasApi);
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

function useBackForwardState(hasApi: boolean | ElectronApi | undefined) {
    const [ canGoBack, setCanGoBack ] = useState(() => hasApi ? window.electronApi?.navigation.navigationCanGoBack() ?? true : true);
    const [ canGoForward, setCanGoForward ] = useState(() => hasApi ? window.electronApi?.navigation.navigationCanGoForward() ?? true : true);

    useEffect(() => {
        const api = window.electronApi?.navigation;
        if (!api) return;
        const updateNavigationState = () => {
            setCanGoBack(api.navigationCanGoBack());
            setCanGoForward(api.navigationCanGoForward());
        };

        api.onDidNavigate(updateNavigationState);
        api.onDidNavigateInPage(updateNavigationState);

        return () => {
            api.removeDidNavigateListeners();
        };
    }, [hasApi]);

    return { canGoBack, canGoForward };
}
