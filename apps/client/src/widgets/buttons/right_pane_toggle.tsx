import clsx from "clsx";

import { t } from "../../services/i18n";
import options from "../../services/options";
import ActionButton from "../react/ActionButton";
import { useState, useCallback } from "preact/hooks";
import { useTriliumEvent } from "../react/hooks";

export default function RightPaneToggle() {
    const [ rightPaneVisible, setRightPaneVisible ] = useState(options.is("rightPaneVisible"));

    useTriliumEvent("toggleRightPane", useCallback(() => {
        setRightPaneVisible(current => !current);
    }, []));

    return (
        <ActionButton
            className={clsx(
                `toggle-button right-pane-toggle-button bx-flip-horizontal`,
                rightPaneVisible ? "action-collapse" : "action-expand"
            )}
            text={t("right_pane.toggle")}
            icon="bx bx-sidebar"
            triggerCommand="toggleRightPane"
        />
    );
}
