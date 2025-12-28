import clsx from "clsx";

import { t } from "../../services/i18n";
import ActionButton from "../react/ActionButton";
import { useTriliumOptionBool } from "../react/hooks";

export default function RightPaneToggle() {
    const [ rightPaneVisible, setRightPaneVisible ] = useTriliumOptionBool("rightPaneVisible");

    return (
        <ActionButton
            className={clsx(
                `toggle-button right-pane-toggle-button bx-flip-horizontal`,
                rightPaneVisible ? "action-collapse" : "action-expand"
            )}
            text={t("right_pane.toggle")}
            icon="bx bx-sidebar"
            onClick={() => setRightPaneVisible(!rightPaneVisible)}
        />
    );
}
