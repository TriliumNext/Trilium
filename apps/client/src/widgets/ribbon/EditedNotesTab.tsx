import { TabContext } from "./ribbon-interface";
import EditedNotes from "../../widgets/EditedNotes"

export default function EditedNotesTab({ note }: TabContext) {
    const dateNoteLabelValue = note?.getLabelValue("dateNote") || "";

    return (
        <div className="edited-notes-widget" style={{
            padding: "12px",
            maxHeight: "200px",
            width: "100%",
            overflow: "auto"
        }}>
        <EditedNotes noteId={note?.noteId} dateFilter={dateNoteLabelValue} />
        </div>
    )
}
