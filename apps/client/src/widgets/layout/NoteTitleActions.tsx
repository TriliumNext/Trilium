import "./NoteTitleActions.css";

import clsx from "clsx";
import { useEffect, useState } from "preact/hooks";

import NoteContext from "../../components/note_context";
import FNote from "../../entities/fnote";
import { t } from "../../services/i18n";
import CollectionProperties from "../note_bars/CollectionProperties";
import { checkFullHeight, getExtendedWidgetType } from "../NoteDetail";
import { PromotedAttributesContent, usePromotedAttributeData } from "../PromotedAttributes";
import SimpleBadge from "../react/Badge";
import Collapsible, { ExternallyControlledCollapsible } from "../react/Collapsible";
import { useNoteContext, useNoteLabel, useNoteProperty, useTriliumEvent, useTriliumOptionBool } from "../react/hooks";
import NoteLink, { NewNoteLink } from "../react/NoteLink";
import { useEditedNotes } from "../ribbon/EditedNotesTab";
import SearchDefinitionTab from "../ribbon/SearchDefinitionTab";
import NoteTypeSwitcher from "./NoteTypeSwitcher";

export default function NoteTitleActions() {
    const { note, ntxId, componentId, noteContext } = useNoteContext();
    const isHiddenNote = note && note.noteId !== "_search" && note.noteId.startsWith("_");
    const noteType = useNoteProperty(note, "type");

    return (
        <div className="title-actions">
            <PromotedAttributes note={note} componentId={componentId} noteContext={noteContext} />
            {noteType === "search" && <SearchProperties note={note} ntxId={ntxId} />}
            {!isHiddenNote && note && noteType === "book" && <CollectionProperties note={note} />}
            <EditedNotes />
            <NoteTypeSwitcher />
        </div>
    );
}

function SearchProperties({ note, ntxId }: { note: FNote | null | undefined, ntxId: string | null | undefined }) {
    return (note &&
        <Collapsible
            title={t("search_definition.search_parameters")}
            initiallyExpanded={note.isInHiddenSubtree()} // not saved searches
        >
            <SearchDefinitionTab note={note} ntxId={ntxId} hidden={false} />
        </Collapsible>
    );
}

function PromotedAttributes({ note, componentId, noteContext }: {
    note: FNote | null | undefined,
    componentId: string,
    noteContext: NoteContext | undefined
}) {
    const [ cells, setCells ] = usePromotedAttributeData(note, componentId);
    const [ expanded, setExpanded ] = useState(false);

    useEffect(() => {
        getExtendedWidgetType(note, noteContext).then(extendedNoteType => {
            const fullHeight = checkFullHeight(noteContext, extendedNoteType);
            setExpanded(!fullHeight);
        });
    }, [ note, noteContext ]);

    // Keyboard shortcut.
    useTriliumEvent("toggleRibbonTabPromotedAttributes", () => setExpanded(!expanded));

    if (!cells?.length) return false;
    return (note && (
        <ExternallyControlledCollapsible
            key={note.noteId}
            title={t("note_title.promoted_attributes")}
            expanded={expanded} setExpanded={setExpanded}
        >
            <PromotedAttributesContent note={note} componentId={componentId} cells={cells} setCells={setCells} />
        </ExternallyControlledCollapsible>
    ));
}

//#region Edited Notes
function EditedNotes() {
    const { note } = useNoteContext();
    const [ dateNote ] = useNoteLabel(note, "dateNote");
    const [ editedNotesOpenInRibbon ] = useTriliumOptionBool("editedNotesOpenInRibbon");

    return (note && dateNote &&
        <Collapsible
            className="edited-notes"
            title={t("note_title.edited_notes")}
            initiallyExpanded={editedNotesOpenInRibbon}
        >
            <EditedNotesContent note={note} />
        </Collapsible>
    );
}

function EditedNotesContent({ note }: { note: FNote }) {
    const editedNotes = useEditedNotes(note);

    return (editedNotes !== undefined &&
        (editedNotes.length > 0 ? editedNotes?.map(editedNote => (
            <NewNoteLink
                className="badge"
                notePath={editedNote.noteId}
                showNoteIcon
            />
        )) : (
            <div className="no-edited-notes-found">{t("edited_notes.no_edited_notes_found")}</div>
        )));
}
//#endregion
