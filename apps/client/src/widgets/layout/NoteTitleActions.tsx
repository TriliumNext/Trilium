import "./NoteTitleActions.css";

import { EditedNotesResponse } from "@triliumnext/commons";
import { useEffect, useState } from "preact/hooks";

import NoteContext from "../../components/note_context";
import FNote from "../../entities/fnote";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import server from "../../services/server";
import { checkFullHeight, getExtendedWidgetType } from "../NoteDetail";
import { usePromotedAttributeData } from "../promoted_attribute_cells";
import Collapsible, { ExternallyControlledCollapsible } from "../react/Collapsible";
import { useTriliumEvent } from "../react/hooks/events";
import { useNoteLabel, useNoteProperty } from "../react/hooks/note";
import { useTriliumOption, useTriliumOptionBool } from "../react/hooks/options";
import { useNoteContext } from "../react/hooks/note_context";
import { WithLazyModule } from "../react/LazyComponent";
import { NewNoteLink } from "../react/NoteLink";
import PinnedAttachments from "./PinnedAttachments";

const loadSearchDefinition = () => import("../search/SearchDefinition");
const loadNoteTypeSwitcher = () => import("./NoteTypeSwitcher");
const loadPromotedAttributes = () => import("../PromotedAttributes");

export default function NoteTitleActions() {
    const { note, ntxId, componentId, noteContext, viewScope } = useNoteContext();
    const noteType = useNoteProperty(note, "type");
    const isDefaultView = !viewScope?.viewMode || viewScope.viewMode === "default";
    const [ noteTitleStyle ] = useTriliumOption("noteTitleStyle");

    return (
        <div className="title-actions">
            <PromotedAttributes note={note} componentId={componentId} noteContext={noteContext} />
            {noteType === "search" && <SearchProperties note={note} ntxId={ntxId} />}
            {isDefaultView && note && <PinnedAttachments note={note} />}
            <EditedNotes />
            {isDefaultView && noteTitleStyle !== "compact" && noteType === "text" && (
                <WithLazyModule load={loadNoteTypeSwitcher}>
                    {({ default: NoteTypeSwitcher }) => <NoteTypeSwitcher note={note} />}
                </WithLazyModule>
            )}
        </div>
    );
}

function SearchProperties({ note, ntxId }: { note: FNote | null | undefined, ntxId: string | null | undefined }) {
    return (note &&
        <Collapsible
            title={t("search_definition.search_parameters")}
            initiallyExpanded={note.isInHiddenSubtree()} // not saved searches
        >
            <WithLazyModule load={loadSearchDefinition}>
                {({ default: SearchDefinition }) => <SearchDefinition note={note} ntxId={ntxId} />}
            </WithLazyModule>
        </Collapsible>
    );
}

function PromotedAttributes({ note, componentId, noteContext }: {
    note: FNote | null | undefined,
    componentId: string,
    noteContext: NoteContext | undefined
}) {
    const [ cells, setCells ] = usePromotedAttributeData(note, componentId, noteContext);
    const [ expanded, setExpanded ] = useState(false);

    useEffect(() => {
        getExtendedWidgetType(note, noteContext).then(extendedNoteType => {
            const fullHeight = checkFullHeight(noteContext, extendedNoteType);
            setExpanded(!fullHeight);
        });
    }, [ note, noteContext ]);

    // Keyboard shortcut.
    useTriliumEvent("toggleRibbonTabPromotedAttributes", ({ ntxId }) => {
        if (!noteContext || ntxId !== noteContext.ntxId) return;
        setExpanded(!expanded);
    });

    if (!cells?.length) return false;
    return (note && (
        <ExternallyControlledCollapsible
            key={note.noteId}
            title={t("note_title.promoted_attributes")}
            expanded={expanded} setExpanded={setExpanded}
        >
            <WithLazyModule load={loadPromotedAttributes}>
                {({ PromotedAttributesContent }) => (
                    <PromotedAttributesContent note={note} componentId={componentId} cells={cells} setCells={setCells} />
                )}
            </WithLazyModule>
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

function useEditedNotes(note: FNote) {
    const [ editedNotes, setEditedNotes ] = useState<EditedNotesResponse>();

    useEffect(() => {
        server.get<EditedNotesResponse>(`edited-notes/${note.getLabelValue("dateNote")}`).then(async editedNotes => {
            editedNotes = editedNotes.filter((n) => n.noteId !== note.noteId);
            const noteIds = editedNotes.flatMap((n) => n.noteId);
            await froca.getNotes(noteIds, true); // preload all at once
            setEditedNotes(editedNotes);
        });
    }, [ note ]);

    return editedNotes;
}
//#endregion
