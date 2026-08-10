import { t } from "../../services/i18n";
// The list itself is shared with the floating backlinks button and the mobile menu; only the framing
// differs here. The status bar's badge has no list of its own — it opens this one.
import { BacklinksList } from "../FloatingButtonsDefinitions";
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
            grow
        >
            {note && (
                // The classes the shared list's card styling hangs off (see ../Backlinks.css).
                <div class="tn-backlinks-widget">
                    <ul class="backlinks-items">
                        <BacklinksList note={note} />
                    </ul>
                </div>
            )}
        </RightPanelWidget>
    );
}
