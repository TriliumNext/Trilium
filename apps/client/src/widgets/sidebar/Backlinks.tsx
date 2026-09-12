import { t } from "../../services/i18n";
// The list itself is shared with the floating backlinks button, the status bar's badge and the mobile
// menu; only the framing differs here.
import { BacklinksWidget } from "../FloatingButtonsDefinitions";
import { useActiveNoteContext } from "../react/hooks";
import RightPanelWidget from "./RightPanelWidget";
import SidebarHelp from "./SidebarHelp";

export default function Backlinks() {
    const { note } = useActiveNoteContext();

    return (
        <RightPanelWidget
            id="backlinks"
            title={t("right_pane.backlinks")}
            buttons={<SidebarHelp section="backlinks" />}
        >
            {note && <BacklinksWidget note={note} />}
        </RightPanelWidget>
    );
}
