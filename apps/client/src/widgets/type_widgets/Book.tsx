import "./Book.css";

import { useEffect, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import { ViewTypeOptions } from "../collections/interface";
import CollectionProperties from "../note_bars/CollectionProperties";
import { useNoteLabelWithDefault, useTriliumEvent } from "../react/hooks";
import NoItems from "../react/NoItems";
import { TypeWidgetProps } from "./type_widget";

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
                <>
                    <CollectionProperties note={note} />

                    <NoItems icon="bx bx-collection" text={t("book.no_children_help")} />
                </>
            )}
        </>
    );
}
