import { t } from "../../services/i18n";
import Alert from "../react/Alert";
import { useNoteLabelWithDefault, useTriliumEvent } from "../react/hooks";
import RawHtml from "../react/RawHtml";
import { TypeWidgetProps } from "./type_widget";
import "./Book.css";
import { useEffect, useState } from "preact/hooks";
import { ViewTypeOptions } from "../collections/interface";

const VIEW_TYPES: ViewTypeOptions[] = [ "list", "grid", "presentation" ];

export default function Book({ note }: TypeWidgetProps) {
    const [ viewType ] = useNoteLabelWithDefault(note, "viewType", "grid");
    const [ shouldDisplayNoChildrenWarning, setShouldDisplayNoChildrenWarning ] = useState(false);

    function refresh() {
        setShouldDisplayNoChildrenWarning(!note.hasChildren() && VIEW_TYPES.includes(viewType as ViewTypeOptions));
    }

    useEffect(refresh, [ note, viewType ]);
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
