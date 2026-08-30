import "./NotePaths.css";

import { useContext } from "preact/hooks";

import { t } from "../../services/i18n";
import ActionButton from "../react/ActionButton";
import { useActiveNoteContext } from "../react/hooks";
import { ParentComponent } from "../react/react_utils";
// The paths list is shared with the ribbon's note paths tab, the status bar's badge and the mobile
// note menu; only the framing differs here.
import { NotePathsWidget, useSortedNotePaths } from "../ribbon/NotePathsTab";
import RightPanelWidget from "./RightPanelWidget";
import SidebarHelp from "./SidebarHelp";

export default function NotePaths() {
    const { note, notePath, hoistedNoteId } = useActiveNoteContext();
    const sortedNotePaths = useSortedNotePaths(note, hoistedNoteId);
    const parentComponent = useContext(ParentComponent);

    return (
        <RightPanelWidget
            id="notePaths"
            title={t("note_paths.title")}
            // Cloning the note is what one does about its paths, so it sits where the card keeps what
            // one does — its header — rather than as a line of its own below the list. The icon is the
            // tree context menu's for the same action.
            buttons={<>
                <SidebarHelp section="notePaths" />
                <ActionButton
                    icon="bx bx-duplicate"
                    text={t("note_paths.clone_button")}
                    onClick={() => void parentComponent?.triggerCommand("cloneNoteIdsTo")}
                />
            </>}
        >
            <NotePathsWidget sortedNotePaths={sortedNotePaths} currentNotePath={notePath} cloneButton={false} />
        </RightPanelWidget>
    );
}
