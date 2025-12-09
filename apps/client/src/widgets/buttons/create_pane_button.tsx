import { useContext } from "preact/hooks";
import { t } from "../../services/i18n.js";
import ActionButton from "../react/ActionButton.jsx";
import { ParentComponent } from "../react/react_utils.jsx";
import BasicWidget from "../basic_widget.js";

export default function CreatePaneButton() {
    const widget = useContext(ParentComponent) as BasicWidget | undefined;

    return (
        <ActionButton
            icon="bx bx-dock-right"
            text={t("create_pane_button.create_new_split")}
            onClick={(e) => {
                widget?.triggerCommand("openNewNoteSplit", { ntxId: widget.getClosestNtxId() });
                e.stopPropagation();
            }}
        />
    )
}

