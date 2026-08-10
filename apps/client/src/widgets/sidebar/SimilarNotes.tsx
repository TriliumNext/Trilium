import "./SimilarNotes.css";

import { t } from "../../services/i18n";
import { useActiveNoteContext } from "../react/hooks";
// The list itself is shared with the ribbon's similar notes tab and the mobile note menu; only the
// framing differs here. The status bar has no panel of its own for them — it opens this one.
import SimilarNotesTab from "../ribbon/SimilarNotesTab";
import RightPanelWidget from "./RightPanelWidget";
import SidebarHelp from "./SidebarHelp";

export default function SimilarNotes() {
    const { note } = useActiveNoteContext();

    return (
        <RightPanelWidget
            id="similarNotes"
            title={t("similar_notes.title")}
            buttons={<SidebarHelp section="similarNotes" />}
        >
            {note && <SimilarNotesTab note={note} />}
        </RightPanelWidget>
    );
}
