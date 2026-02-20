import { t } from "../../services/i18n";
import ActionButton from "../react/ActionButton";
import { useNoteContext } from "../react/hooks";

export default function ToggleSidebarButton() {
    const { noteContext, parentComponent } = useNoteContext();

    return (
        <div style={{ contain: "none", minWidth: 8 }}>
            { noteContext?.isMainContext() && <ActionButton
                icon="bx bx-sidebar"
                text={t("note_tree.toggle-sidebar")}
                onClick={(e) => {
                    // Remove focus to prevent tooltip showing on top of the sidebar.
                    (e.currentTarget as HTMLButtonElement).blur();

                    parentComponent?.triggerCommand("setActiveScreen", {
                        screen: "tree"
                    });
                }}
            />}
        </div>
    );
}
