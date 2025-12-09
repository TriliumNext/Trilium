import ActionButton from "../react/ActionButton";
import { t } from "../../services/i18n";
import { useNoteContext } from "../react/hooks";

export default function ToggleSidebarButton() {
    const { noteContext, parentComponent } = useNoteContext();

    return (
        <div style={{ contain: "none", minWidth: 8 }}>
            { noteContext?.isMainContext() && <ActionButton
                icon="bx bx-sidebar"
                text={t("note_tree.toggle-sidebar")}
                onClick={() => parentComponent?.triggerCommand("setActiveScreen", {
                    screen: "tree"
                })}
            />}
        </div>
    )
}
