import "./NoteActionsCustom.css";

import { NoteType, SaveSqlConsoleResponse } from "@triliumnext/commons";
import { useContext, useEffect, useRef, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import Component from "../../components/component";
import NoteContext from "../../components/note_context";
import FNote from "../../entities/fnote";
import { t } from "../../services/i18n";
import { copyImageReferenceToClipboard } from "../../services/image";
import { getHelpUrlForNote } from "../../services/in_app_help";
import { downloadFileNote, openNoteExternally } from "../../services/open";
import server from "../../services/server";
import toast from "../../services/toast";
import tree from "../../services/tree";
import { clearBrowserCache, createImageSrcUrl, isMobile, openInAppHelpFromUrl } from "../../services/utils";
import { ViewTypeOptions } from "../collections/interface";
import { showImageCompressionDialog } from "../dialogs/image_compression/image_compression_dialog";
import ActionButton, { ActionButtonProps } from "../react/ActionButton";
import { ButtonGroup } from "../react/Button";
import { FormFileUploadActionButton, FormFileUploadFormListItem, FormFileUploadProps } from "../react/FormFileUpload";
import { FormListItem } from "../react/FormList";
import { useEffectiveReadOnly, useNoteLabel, useNoteLabelBoolean, useNoteProperty, useTriliumEvent, useTriliumEvents, useTriliumOption } from "../react/hooks";
import { isSplitEditorForcedReadOnly, resolveDisplayMode } from "../type_widgets/helpers/split_editor_mode";
import { ParentComponent } from "../react/react_utils";

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

const cachedIsMobile = isMobile();

/**
 * Part of {@link NoteActions}, but are rendered with a slight spacing
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
            <RunActiveNoteButton {...innerProps } />
            <SwitchSplitOrientationButton {...innerProps} />
            <DisplayModeSwitcher {...innerProps} />
            <SaveToNoteButton {...innerProps} />
            <RefreshButton {...innerProps} />
            {innerProps.note.noteId === "_backendLog" && <DownloadFileButton {...innerProps} />}
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
            <CompressImageButton {...props} />
        </>
    );
}

function buildUploadNewImageRevisionListener(note: FNote) {
    return async (files: FileList | null) => {
        if (!files) return;
        const fileToUpload = files[0]; // copy to allow reset below

        const result = await server.upload(`images/${note.noteId}`, fileToUpload);

        if (result.uploaded) {
            toast.showMessage(t("image_properties.upload_success"));
            await clearBrowserCache();
        } else {
            toast.showError(t("image_properties.upload_failed", { message: result.message }));
        }
    };
}

function buildUploadNewFileRevisionListener(note: FNote) {
    return (fileToUpload: FileList | null) => {
        if (!fileToUpload) {
            return;
        }

        server.upload(`notes/${note.noteId}/file`, fileToUpload[0]).then((result) => {
            if (result.uploaded) {
                toast.showMessage(t("file_properties.upload_success"));
            } else {
                toast.showError(t("file_properties.upload_failed"));
            }
        });
    };
}
//#endregion

//#region Shared buttons
function UploadNewRevisionButton({ note, onChange }: NoteActionsCustomInnerProps & {
    onChange: (files: FileList | null) => void;
}) {
    return (
        <NoteActionWithFileUpload
            icon="bx bx-folder-open"
            text={t("image_properties.upload_new_revision")}
            disabled={!note.isContentAvailable()}
            onChange={onChange}
        />
    );
}

function OpenExternallyButton({ note, noteMime }: NoteActionsCustomInnerProps) {
    return (!cachedIsMobile &&
        <NoteAction
            icon="bx bx-link-external"
            text={t("file_properties.open")}
            disabled={note.isProtected}
            onClick={() => openNoteExternally(note.noteId, noteMime)}
        />
    );
}

/**
 * Shrinks the picture being looked at, and only it — the mime is what tells the dialog it is aimed
 * at one image rather than at everything a note holds.
 */
function CompressImageButton({ note, noteMime }: NoteActionsCustomInnerProps) {
    return (
        <NoteAction
            icon="bx bx-collapse-alt"
            text={t("compress-image")}
            disabled={!note.isContentAvailable()}
            onClick={() => void showImageCompressionDialog({ type: "note", noteId: note.noteId, mime: noteMime })}
        />
    );
}

function DownloadFileButton({ note, parentComponent, ntxId }: NoteActionsCustomInnerProps) {
    return (
        <NoteAction
            icon="bx bx-download"
            text={t("file_properties.download")}
            disabled={!note.isContentAvailable()}
            onClick={() => downloadFileNote(note, parentComponent, ntxId)}
        />
    );
}

//#region Floating buttons
function CopyReferenceToClipboardButton({ note, noteType }: NoteActionsCustomInnerProps) {
    const hiddenImageCopyRef = useRef<HTMLDivElement>(null);
    const isEnabled = ["mermaid", "canvas", "mindMap", "image"].includes(noteType);

    return isEnabled && (
        <>
            <NoteAction
                text={t("image_properties.copy_reference_to_clipboard")}
                icon="bx bx-copy"
                onClick={() => {
                    if (!hiddenImageCopyRef.current) return;
                    const imageEl = document.createElement("img");
                    imageEl.src = createImageSrcUrl(note);
                    hiddenImageCopyRef.current.replaceChildren(imageEl);
                    copyImageReferenceToClipboard($(hiddenImageCopyRef.current));
                    hiddenImageCopyRef.current.removeChild(imageEl);
                }}
            />
            <div ref={hiddenImageCopyRef} style={{ position: "absolute" }} />
        </>
    );
}

function RefreshButton({ note, noteType, isDefaultViewMode, parentComponent, noteContext }: NoteActionsCustomInnerProps) {
    const isEnabled = (note.noteId === "_backendLog" || noteType === "render") && isDefaultViewMode;

    return (isEnabled &&
        <NoteAction
            text={t("backend_log.refresh")}
            icon="bx bx-refresh"
            onClick={() => parentComponent.triggerEvent("refreshData", { ntxId: noteContext.ntxId })}
        />
    );
}

function SwitchSplitOrientationButton({ note, isReadOnly, isDefaultViewMode }: NoteActionsCustomInnerProps) {
    const isShown = note.type === "mermaid" && !cachedIsMobile && note.isContentAvailable() && isDefaultViewMode;
    const [ displayMode ] = useNoteLabel(note, "displayMode");
    const [ splitEditorOrientation, setSplitEditorOrientation ] = useTriliumOption("splitEditorOrientation");
    const upcomingOrientation = splitEditorOrientation === "horizontal" ? "vertical" : "horizontal";
    const effectiveMode = displayMode === "source" || displayMode === "split" || displayMode === "preview"
        ? displayMode
        : isReadOnly ? "preview" : "split";

    return isShown && <NoteAction
        text={upcomingOrientation === "vertical" ? t("switch_layout_button.title_vertical") : t("switch_layout_button.title_horizontal")}
        icon={upcomingOrientation === "vertical" ? "bx bxs-dock-bottom" : "bx bxs-dock-left"}
        onClick={() => setSplitEditorOrientation(upcomingOrientation)}
        disabled={effectiveMode !== "split"}
    />;
}

function DisplayModeSwitcher({ note, noteContext, isDefaultViewMode }: NoteActionsCustomInnerProps) {
    const [ displayMode, setDisplayMode ] = useNoteLabel(note, "displayMode");
    const readOnly = useEffectiveReadOnly(note, noteContext);
    const isEnabled = (note.isMarkdown() || note.type === "mermaid" || note.isIconPack()) && note.isContentAvailable() && isDefaultViewMode;
    if (!isEnabled) return null;

    // Mirror SplitEditor's mode resolution so the active button matches the actual pane.
    const mode = resolveDisplayMode(displayMode, readOnly || isSplitEditorForcedReadOnly(note));
    const buttons: Array<{ value: "source" | "split" | "preview"; icon: string; text: string }> = [
        { value: "source", icon: "bx bx-code", text: t("display_mode.source") },
        { value: "split", icon: "bx bxs-dock-left", text: t("display_mode.split") },
        { value: "preview", icon: "bx bx-show", text: t("display_mode.preview") }
    ];

    if (cachedIsMobile) {
        return (
            <div className="note-actions-custom-display-mode">
                {buttons.map(({ value, icon, text }) => (
                    <NoteAction
                        key={value}
                        icon={icon}
                        text={text}
                        active={mode === value}
                        onClick={() => setDisplayMode(value)}
                    />
                ))}
            </div>
        );
    }

    return (
        <>
            <div className="note-actions-custom-spacer" />
            <ButtonGroup size="sm">
                {buttons.map(({ value, icon, text }) => (
                    <NoteAction
                        key={value}
                        icon={icon}
                        text={text}
                        active={mode === value}
                        onClick={() => setDisplayMode(value)}
                    />
                ))}
            </ButtonGroup>
            <div className="note-actions-custom-spacer" />
        </>
    );
}

function RunActiveNoteButton({ noteMime }: NoteActionsCustomInnerProps) {
    const isEnabled = noteMime.startsWith("application/javascript") || noteMime === "text/x-sqlite;schema=trilium";
    return isEnabled && <NoteAction
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

    return isEnabled && <NoteAction
        icon="bx bx-save"
        text={t("code_buttons.save_to_note_button_title")}
        onClick={buildSaveSqlToNoteHandler(note)}
    />;
}

function buildSaveSqlToNoteHandler(note: FNote) {
    return async (e: MouseEvent) => {
        e.preventDefault();
        const { notePath } = await server.post<SaveSqlConsoleResponse>("special-notes/save-sql-console", { sqlConsoleNoteId: note.noteId });
        if (notePath) {
            toast.showMessage(t("code_buttons.sql_console_saved_message", { "note_path": await tree.getNotePathTitle(notePath) }));
            // TODO: This hangs the navigation, for some reason.
            //await ws.waitForMaxKnownEntityChangeId();
            await appContext.tabManager.getActiveContext()?.setNote(notePath);
        }
    };
}

function InAppHelpButton({ note }: NoteActionsCustomInnerProps) {
    const helpUrl = getHelpUrlForNote(note);
    const isEnabled = !!helpUrl;

    return isEnabled && (
        <NoteAction
            icon="bx bx-help-circle"
            text={t("help-button.title")}
            onClick={() => helpUrl && openInAppHelpFromUrl(helpUrl)}
        />
    );
}

//#endregion

function NoteAction({ text, active, ...props }: Pick<ActionButtonProps, "text" | "icon" | "disabled" | "triggerCommand" | "active"> & {
    onClick?: ((e: MouseEvent) => void) | undefined;
}) {
    return (cachedIsMobile
        ? <FormListItem {...props}>{text}</FormListItem>
        : <ActionButton text={text} active={active} {...props} />
    );
}

function NoteActionWithFileUpload({ text, ...props }: Pick<ActionButtonProps, "text" | "icon" | "disabled" | "triggerCommand"> & Pick<FormFileUploadProps, "onChange">) {
    return (cachedIsMobile
        ? <FormFileUploadFormListItem {...props}>{text}</FormFileUploadFormListItem>
        : <FormFileUploadActionButton text={text} {...props} />
    );
}
