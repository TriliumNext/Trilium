import { NoteType } from "@triliumnext/commons";
import { useContext, useEffect, useRef, useState } from "preact/hooks";

import Component from "../../components/component";
import NoteContext from "../../components/note_context";
import FNote from "../../entities/fnote";
import { t } from "../../services/i18n";
import { getHelpUrlForNote } from "../../services/in_app_help";
import { downloadFileNote, openNoteExternally } from "../../services/open";
import { openInAppHelpFromUrl } from "../../services/utils";
import { ViewTypeOptions } from "../collections/interface";
import { buildSaveSqlToNoteHandler } from "../FloatingButtonsDefinitions";
import ActionButton from "../react/ActionButton";
import { FormFileUploadActionButton } from "../react/FormFileUpload";
import { useNoteLabel, useNoteLabelBoolean, useNoteProperty, useTriliumEvent, useTriliumEvents, useTriliumOption } from "../react/hooks";
import { ParentComponent } from "../react/react_utils";
import { buildUploadNewFileRevisionListener } from "./FilePropertiesTab";
import { buildUploadNewImageRevisionListener } from "./ImagePropertiesTab";

interface NoteActionsCustomProps {
    note: FNote;
    ntxId: string;
    noteContext: NoteContext;
}

interface NoteActionsCustomInnerProps extends NoteActionsCustomProps {
    noteMime: string;
    noteType: NoteType;
    isReadOnly: boolean;
    isDefaultViewMode: boolean;
    parentComponent: Component;
    viewType: ViewTypeOptions | null | undefined;
}

/**
 * Part of {@link NoteActions} on the new layout, but are rendered with a slight spacing
 * from the rest of the note items and the buttons differ based on the note type.
 */
export default function NoteActionsCustom(props: NoteActionsCustomProps) {
    const { note } = props;
    const containerRef = useRef<HTMLDivElement>(null);
    const noteType = useNoteProperty(note, "type");
    const noteMime = useNoteProperty(note, "mime");
    const [ viewType ] = useNoteLabel(note, "viewType");
    const parentComponent = useContext(ParentComponent);
    const [ isReadOnly ] = useNoteLabelBoolean(note, "readOnly");
    const innerProps: NoteActionsCustomInnerProps | false = !!noteType && noteMime !== undefined && !!parentComponent && {
        ...props,
        noteType,
        noteMime,
        viewType: viewType as ViewTypeOptions | null | undefined,
        isDefaultViewMode: props.noteContext.viewScope?.viewMode === "default",
        parentComponent,
        isReadOnly
    };

    useTriliumEvents([ "toggleRibbonTabFileProperties", "toggleRibbonTabImageProperties" ], () => {
        (containerRef.current?.firstElementChild as HTMLElement)?.focus();
    });

    return (innerProps &&
        <div
            ref={containerRef}
            className="note-actions-custom"
        >
            <AddChildButton {...innerProps} />
            <RunActiveNoteButton {...innerProps } />
            <OpenTriliumApiDocsButton {...innerProps} />
            <SwitchSplitOrientationButton {...innerProps} />
            <ToggleReadOnlyButton {...innerProps} />
            <SaveToNoteButton {...innerProps} />
            <RefreshButton {...innerProps} />
            <CopyReferenceToClipboardButton {...innerProps} />
            <InAppHelpButton {...innerProps} />
            <NoteActionsCustomInner {...innerProps} />
        </div>
    );
}

//#region Note type mappings
function NoteActionsCustomInner(props: NoteActionsCustomInnerProps) {
    switch (props.note.type) {
        case "file":
            return <FileActions {...props} />;
        case "image":
            return <ImageActions {...props} />;
        default:
            return null;
    }
}

function FileActions(props: NoteActionsCustomInnerProps) {
    return (
        <>
            <UploadNewRevisionButton {...props} onChange={buildUploadNewFileRevisionListener(props.note)} />
            <OpenExternallyButton {...props} />
            <DownloadFileButton {...props} />
        </>
    );
}

function ImageActions(props: NoteActionsCustomInnerProps) {
    return (
        <>
            <UploadNewRevisionButton {...props} onChange={buildUploadNewImageRevisionListener(props.note)} />
            <OpenExternallyButton {...props} />
            <DownloadFileButton {...props} />
        </>
    );
}
//#endregion

//#region Shared buttons
function UploadNewRevisionButton({ note, onChange }: NoteActionsCustomInnerProps & {
    onChange: (files: FileList | null) => void;
}) {
    return (
        <FormFileUploadActionButton
            icon="bx bx-folder-open"
            text={t("image_properties.upload_new_revision")}
            disabled={!note.isContentAvailable()}
            onChange={onChange}
        />
    );
}

function OpenExternallyButton({ note, noteMime }: NoteActionsCustomInnerProps) {
    return (
        <ActionButton
            icon="bx bx-link-external"
            text={t("file_properties.open")}
            disabled={note.isProtected}
            onClick={() => openNoteExternally(note.noteId, noteMime)}
        />
    );
}

function DownloadFileButton({ note, parentComponent, ntxId }: NoteActionsCustomInnerProps) {
    return (
        <ActionButton
            icon="bx bx-download"
            text={t("file_properties.download")}
            disabled={!note.isContentAvailable()}
            onClick={() => downloadFileNote(note, parentComponent, ntxId)}
        />
    );
}

//#region Floating buttons
function CopyReferenceToClipboardButton({ ntxId, noteType, parentComponent }: NoteActionsCustomInnerProps) {
    return (["mermaid", "canvas", "mindMap", "image"].includes(noteType) &&
        <ActionButton
            text={t("image_properties.copy_reference_to_clipboard")}
            icon="bx bx-copy"
            onClick={() => parentComponent?.triggerEvent("copyImageReferenceToClipboard", { ntxId })}
        />
    );
}

function RefreshButton({ note, noteType, isDefaultViewMode, parentComponent, noteContext }: NoteActionsCustomInnerProps) {
    const isEnabled = (note.noteId === "_backendLog" || noteType === "render") && isDefaultViewMode;

    return (isEnabled &&
        <ActionButton
            text={t("backend_log.refresh")}
            icon="bx bx-refresh"
            onClick={() => parentComponent.triggerEvent("refreshData", { ntxId: noteContext.ntxId })}
        />
    );
}

function SwitchSplitOrientationButton({ note, isReadOnly, isDefaultViewMode }: NoteActionsCustomInnerProps) {
    const isShown = note.type === "mermaid" && note.isContentAvailable() && isDefaultViewMode;
    const [ splitEditorOrientation, setSplitEditorOrientation ] = useTriliumOption("splitEditorOrientation");
    const upcomingOrientation = splitEditorOrientation === "horizontal" ? "vertical" : "horizontal";

    return isShown && <ActionButton
        text={upcomingOrientation === "vertical" ? t("switch_layout_button.title_vertical") : t("switch_layout_button.title_horizontal")}
        icon={upcomingOrientation === "vertical" ? "bx bxs-dock-bottom" : "bx bxs-dock-left"}
        onClick={() => setSplitEditorOrientation(upcomingOrientation)}
        disabled={isReadOnly}
    />;
}

function ToggleReadOnlyButton({ note, viewType, isDefaultViewMode }: NoteActionsCustomInnerProps) {
    const [ isReadOnly, setReadOnly ] = useNoteLabelBoolean(note, "readOnly");
    const isEnabled = ([ "mermaid", "mindMap", "canvas" ].includes(note.type) || viewType === "geoMap")
            && note.isContentAvailable() && isDefaultViewMode;

    return isEnabled && <ActionButton
        text={isReadOnly ? t("toggle_read_only_button.unlock-editing") : t("toggle_read_only_button.lock-editing")}
        icon={isReadOnly ? "bx bx-lock-open-alt" : "bx bx-lock-alt"}
        onClick={() => setReadOnly(!isReadOnly)}
    />;
}

function RunActiveNoteButton({ noteMime }: NoteActionsCustomInnerProps) {
    const isEnabled = noteMime.startsWith("application/javascript") || noteMime === "text/x-sqlite;schema=trilium";
    return isEnabled && <ActionButton
        icon="bx bx-play"
        text={t("code_buttons.execute_button_title")}
        triggerCommand="runActiveNote"
    />;
}

function SaveToNoteButton({ note, noteMime }: NoteActionsCustomInnerProps) {
    const [ isEnabled, setIsEnabled ] = useState(false);

    function refresh() {
        setIsEnabled(noteMime === "text/x-sqlite;schema=trilium" && note.isHiddenCompletely());
    }

    useEffect(refresh, [ note, noteMime ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getBranchRows().find(b => b.noteId === note.noteId)) {
            refresh();
        }
    });

    return isEnabled && <ActionButton
        icon="bx bx-save"
        text={t("code_buttons.save_to_note_button_title")}
        onClick={buildSaveSqlToNoteHandler(note)}
    />;
}

function OpenTriliumApiDocsButton({ noteMime }: NoteActionsCustomInnerProps) {
    const isEnabled = noteMime.startsWith("application/javascript;env=");
    return isEnabled && <ActionButton
        icon="bx bx-help-circle"
        text={t("code_buttons.trilium_api_docs_button_title")}
        onClick={() => openInAppHelpFromUrl(noteMime.endsWith("frontend") ? "Q2z6av6JZVWm" : "MEtfsqa5VwNi")}
    />;
}

function InAppHelpButton({ note, noteType }: NoteActionsCustomInnerProps) {
    const helpUrl = getHelpUrlForNote(note);
    const isEnabled = !!helpUrl && (noteType !== "book");

    return isEnabled && (
        <ActionButton
            icon="bx bx-help-circle"
            text={t("help-button.title")}
            onClick={() => helpUrl && openInAppHelpFromUrl(helpUrl)}
        />
    );
}

function AddChildButton({ parentComponent, noteType, viewType, ntxId, isReadOnly }: NoteActionsCustomInnerProps) {
    if (noteType === "book" && viewType === "geoMap") {
        return <ActionButton
            icon="bx bx-plus-circle"
            text={t("geo-map.create-child-note-title")}
            onClick={() => parentComponent.triggerEvent("geoMapCreateChildNote", { ntxId })}
            disabled={isReadOnly}
        />;
    } else if (noteType === "relationMap") {
        return <ActionButton
            icon="bx bx-folder-plus"
            text={t("relation_map_buttons.create_child_note_title")}
            onClick={() => parentComponent.triggerEvent("relationMapCreateChildNote", { ntxId })}
            disabled={isReadOnly}
        />;
    }
}
//#endregion
