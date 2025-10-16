import { t } from "../../services/i18n";
import Alert from "../react/Alert";
import { useNoteLabel, useTriliumEvent } from "../react/hooks";
import RawHtml from "../react/RawHtml";
import { TypeWidgetProps } from "./type_widget";
import "./Book.css";
import { useEffect, useState } from "preact/hooks";

const VIEW_TYPES = [ "list", "grid" ];

export default function Book({ note }: TypeWidgetProps) {
    const [ viewType ] = useNoteLabel(note, "viewType");
    const [ shouldDisplayNoChildrenWarning, setShouldDisplayNoChildrenWarning ] = useState(false);

    function refresh() {
        setShouldDisplayNoChildrenWarning(!note.hasChildren() && VIEW_TYPES.includes(viewType ?? ""));
    }

    useEffect(refresh, [ note ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getBranchRows().some(branchRow => branchRow.parentNoteId === note.noteId)) {
            refresh();
        }
    });

    return (
        <>
            {shouldDisplayNoChildrenWarning && (
                <Alert type="warning" className="note-detail-book-empty-help">
                    <RawHtml html={t("book.no_children_help")} />
                </Alert>
            )}
        </>
    )
}
