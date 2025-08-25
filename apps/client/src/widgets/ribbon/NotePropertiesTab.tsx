import { t } from "../../services/i18n";
import { useNoteLabel } from "../react/hooks";
import { TabContext } from "./ribbon-interface";

/**
 * TODO: figure out better name or conceptualize better.
 */
export default function NotePropertiesTab({ note }: TabContext) {
    const [ pageUrl ] = useNoteLabel(note, "pageUrl");

    return (
        <div className="note-properties-widget" style={{ padding: "12px", color: "var(--muted-text-color)" }}>
            { pageUrl && (
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t("note_properties.this_note_was_originally_taken_from")} <a href={pageUrl} class="page-url external">{pageUrl}</a>
                </div>
            )}
        </div>
    )
}