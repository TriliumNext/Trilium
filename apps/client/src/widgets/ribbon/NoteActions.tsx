import { ConvertToAttachmentResponse } from "@triliumnext/commons";
import { Dropdown as BootstrapDropdown } from "bootstrap";
import { RefObject } from "preact";
import { useContext, useEffect, useRef } from "preact/hooks";

import appContext, { CommandNames } from "../../components/app_context";
import Component from "../../components/component";
import NoteContext from "../../components/note_context";
import FNote from "../../entities/fnote";
import branches from "../../services/branches";
import dialog from "../../services/dialog";
import { isExperimentalFeatureEnabled } from "../../services/experimental_features";
import { t } from "../../services/i18n";
import protected_session from "../../services/protected_session";
import server from "../../services/server";
import toast from "../../services/toast";
import { isElectron as getIsElectron, isMac as getIsMac } from "../../services/utils";
import ws from "../../services/ws";
import ClosePaneButton from "../buttons/close_pane_button";
import CreatePaneButton from "../buttons/create_pane_button";
import MovePaneButton from "../buttons/move_pane_button";
import ActionButton from "../react/ActionButton";
import Dropdown from "../react/Dropdown";
import { FormDropdownDivider, FormDropdownSubmenu, FormListHeader, FormListItem, FormListToggleableItem } from "../react/FormList";
import { useIsNoteReadOnly, useNoteContext, useNoteLabel, useNoteLabelBoolean, useNoteProperty, useTriliumEvent, useTriliumOption } from "../react/hooks";
import { ParentComponent } from "../react/react_utils";
import { NoteTypeDropdownContent, useNoteBookmarkState, useShareState } from "./BasicPropertiesTab";
import NoteActionsCustom from "./NoteActionsCustom";

const isNewLayout = isExperimentalFeatureEnabled("new-layout");

export default function NoteActions() {
    const { note, ntxId, noteContext } = useNoteContext();
    return (
        <div className="ribbon-button-container" style={{ contain: "none" }}>
            {isNewLayout && (
                <>
                    {note && ntxId && noteContext && <NoteActionsCustom note={note} ntxId={ntxId} noteContext={noteContext} />}
                    <MovePaneButton direction="left" />
                    <MovePaneButton direction="right" />
                    <ClosePaneButton />
                    <CreatePaneButton />
                </>
            )}
            {note && !isNewLayout && <RevisionsButton note={note} />}
            {note && note.type !== "launcher" && <NoteContextMenu note={note as FNote} noteContext={noteContext} />}
        </div>
    );
}

function RevisionsButton({ note }: { note: FNote }) {
    const isEnabled = !["launcher", "doc"].includes(note?.type ?? "");

    return (isEnabled &&
        <ActionButton
            icon="bx bx-history"
            text={t("revisions_button.note_revisions")}
            triggerCommand="showRevisions"
            titlePosition="bottom"
        />
    );
}

type ItemToFocus = "basic-properties";

function NoteContextMenu({ note, noteContext }: { note: FNote, noteContext?: NoteContext }) {
    const dropdownRef = useRef<BootstrapDropdown>(null);
    const parentComponent = useContext(ParentComponent);
    const noteType = useNoteProperty(note, "type") ?? "";
    const [viewType] = useNoteLabel(note, "viewType");
    const canBeConvertedToAttachment = note?.isEligibleForConversionToAttachment();
    const isSearchable = ["text", "code", "book", "mindMap", "doc"].includes(noteType);
    const isInOptionsOrHelp = note?.noteId.startsWith("_options") || note?.noteId.startsWith("_help");
    const isExportableToImage = ["mermaid", "mindMap"].includes(noteType);
    const isContentAvailable = note.isContentAvailable();
    const isPrintable = isContentAvailable && (
        ["text", "code"].includes(noteType) ||
        (noteType === "book" && ["presentation", "list", "table"].includes(viewType ?? ""))
    );
    const isElectron = getIsElectron();
    const isMac = getIsMac();
    const hasSource = ["text", "code", "relationMap", "mermaid", "canvas", "mindMap", "aiChat"].includes(noteType);
    const isSearchOrBook = ["search", "book"].includes(noteType);
    const isHelpPage = note.noteId.startsWith("_help");
    const [syncServerHost] = useTriliumOption("syncServerHost");
    const { isReadOnly, enableEditing } = useIsNoteReadOnly(note, noteContext);
    const isNormalViewMode = noteContext?.viewScope?.viewMode === "default";
    const itemToFocusRef = useRef<ItemToFocus>(null);

    // Keyboard shortcuts.
    useTriliumEvent("toggleRibbonTabBasicProperties", () => {
        if (!isNewLayout) return;
        itemToFocusRef.current = "basic-properties";
        dropdownRef.current?.toggle();
    });

    return (
        <Dropdown
            dropdownRef={dropdownRef}
            buttonClassName={ isNewLayout ? "bx bx-dots-horizontal-rounded" : "bx bx-dots-vertical-rounded" }
            className="note-actions"
            hideToggleArrow
            noSelectButtonStyle
            noDropdownListStyle
            iconAction
            onHidden={() => itemToFocusRef.current = null }
        >

            {isReadOnly && <>
                <CommandItem icon="bx bx-pencil" text={t("read-only-info.edit-note")}
                    command={() => enableEditing()} />
                <FormDropdownDivider />
            </>}

            <CommandItem command="findInText" icon="bx bx-search" disabled={!isSearchable} text={t("note_actions.search_in_note")} />
            <CommandItem command="showAttachments" icon="bx bx-paperclip" disabled={isInOptionsOrHelp} text={t("note_actions.note_attachments")} />
            {isNewLayout && <CommandItem command="toggleRibbonTabNoteMap" icon="bx bxs-network-chart" disabled={isInOptionsOrHelp} text={t("note_actions.note_map")} />}

            <FormDropdownDivider />

            {isNewLayout && isNormalViewMode && !isHelpPage && <>
                <NoteBasicProperties note={note} focus={itemToFocusRef} />
                <FormDropdownDivider />
            </>}

            <CommandItem icon="bx bx-import" text={t("note_actions.import_files")}
                disabled={isInOptionsOrHelp || note.type === "search"}
                command={() => parentComponent?.triggerCommand("showImportDialog", { noteId: note.noteId })} />
            <CommandItem icon="bx bx-export" text={t("note_actions.export_note")}
                disabled={isInOptionsOrHelp || note.noteId === "_backendLog"}
                command={() => noteContext?.notePath && parentComponent?.triggerCommand("showExportDialog", {
                    notePath: noteContext.notePath,
                    defaultType: "single"
                })} />
            {isElectron && <CommandItem command="exportAsPdf" icon="bx bxs-file-pdf" disabled={!isPrintable} text={t("note_actions.print_pdf")} />}
            {isExportableToImage && isNormalViewMode && isContentAvailable && <ExportAsImage ntxId={noteContext.ntxId} parentComponent={parentComponent} />}
            <CommandItem command="printActiveNote" icon="bx bx-printer" disabled={!isPrintable} text={t("note_actions.print_note")} />

            <FormDropdownDivider />

            <CommandItem command="showRevisions" icon="bx bx-history" text={t("note_actions.view_revisions")} />
            <CommandItem command="forceSaveRevision" icon="bx bx-save" disabled={isInOptionsOrHelp} text={t("note_actions.save_revision")} />

            <FormDropdownDivider />

            {canBeConvertedToAttachment && <ConvertToAttachment note={note} />}
            {note.type === "render" && <CommandItem command="renderActiveNote" icon="bx bx-extension" text={t("note_actions.re_render_note")}
            />}

            <FormDropdownSubmenu icon="bx bx-wrench" title={t("note_actions.advanced")} dropStart>
                <CommandItem command="openNoteExternally" icon="bx bx-file-find" disabled={isSearchOrBook || !isElectron} text={t("note_actions.open_note_externally")} title={t("note_actions.open_note_externally_title")} />
                <CommandItem command="openNoteCustom" icon="bx bx-customize" disabled={isSearchOrBook || isMac || !isElectron} text={t("note_actions.open_note_custom")} />
                <CommandItem command="showNoteSource" icon="bx bx-code" disabled={!hasSource} text={t("note_actions.note_source")} />
                {(syncServerHost && isElectron) &&
                    <CommandItem command="openNoteOnServer" icon="bx bx-world" disabled={!syncServerHost} text={t("note_actions.open_note_on_server")} />
                }

                {glob.isDev && <DevelopmentActions note={note} noteContext={noteContext} />}
            </FormDropdownSubmenu>

            <FormDropdownDivider />

            <CommandItem icon="bx bx-trash destructive-action-icon" text={t("note_actions.delete_note")} destructive
                disabled={isInOptionsOrHelp}
                command={() => branches.deleteNotes([note.getParentBranches()[0].branchId])}
            />
        </Dropdown>
    );
}

function NoteBasicProperties({ note, focus }: {
    note: FNote;
    focus: RefObject<ItemToFocus>;
}) {
    const itemToFocusRef = useRef<HTMLLIElement>(null);
    const [ isBookmarked, setIsBookmarked ] = useNoteBookmarkState(note);
    const [ isShared, switchShareState ] = useShareState(note);
    const [ isTemplate, setIsTemplate ] = useNoteLabelBoolean(note, "template");
    const isProtected = useNoteProperty(note, "isProtected");

    useEffect(() => {
        if (focus.current === "basic-properties") {
            itemToFocusRef.current?.focus();
        }
    }, [ focus ]);

    return <>
        <FormListToggleableItem
            icon="bx bx-share-alt"
            title={t("shared_switch.shared")}
            currentValue={isShared} onChange={switchShareState}
            helpPage="R9pX4DGra2Vt"
            disabled={["root", "_share", "_hidden"].includes(note?.noteId ?? "") || note?.noteId.startsWith("_options")}
            itemRef={itemToFocusRef}
        />
        <FormListToggleableItem
            icon="bx bx-lock-alt"
            title={t("protect_note.toggle-on")}
            currentValue={!!isProtected} onChange={shouldProtect => protected_session.protectNote(note.noteId, shouldProtect, false)}
        />
        <FormListToggleableItem
            icon="bx bx-bookmark"
            title={t("bookmark_switch.bookmark")}
            currentValue={isBookmarked} onChange={setIsBookmarked}
            disabled={["root", "_hidden"].includes(note?.noteId ?? "")}
        />

        <FormDropdownDivider />

        <NoteTypeDropdown note={note} />
        <EditabilityDropdown note={note} />

        <FormListToggleableItem
            icon="bx bx-copy-alt"
            title={t("template_switch.template")}
            currentValue={isTemplate} onChange={setIsTemplate}
            helpPage="KC1HB96bqqHX"
            disabled={note?.noteId.startsWith("_options")}
        />
    </>;
}

function EditabilityDropdown({ note }: { note: FNote }) {
    const [ readOnly, setReadOnly ] = useNoteLabelBoolean(note, "readOnly");
    const [ autoReadOnlyDisabled, setAutoReadOnlyDisabled ] = useNoteLabelBoolean(note, "autoReadOnlyDisabled");

    function setState(readOnly: boolean, autoReadOnlyDisabled: boolean) {
        setReadOnly(readOnly);
        setAutoReadOnlyDisabled(autoReadOnlyDisabled);
    }

    return (
        <FormDropdownSubmenu title={t("basic_properties.editable")} icon="bx bx-edit-alt" dropStart>
            <FormListItem checked={!readOnly && !autoReadOnlyDisabled} onClick={() => setState(false, false)} description={t("editability_select.note_is_editable")}>{t("editability_select.auto")}</FormListItem>
            <FormListItem checked={readOnly && !autoReadOnlyDisabled} onClick={() => setState(true, false)} description={t("editability_select.note_is_read_only")}>{t("editability_select.read_only")}</FormListItem>
            <FormListItem checked={!readOnly && autoReadOnlyDisabled} onClick={() => setState(false, true)} description={t("editability_select.note_is_always_editable")}>{t("editability_select.always_editable")}</FormListItem>
        </FormDropdownSubmenu>
    );
}

function NoteTypeDropdown({ note }: { note: FNote }) {
    const currentNoteType = useNoteProperty(note, "type") ?? undefined;
    const currentNoteMime = useNoteProperty(note, "mime");

    return (
        <FormDropdownSubmenu title={t("basic_properties.note_type")} icon="bx bx-file" dropStart>
            <NoteTypeDropdownContent
                currentNoteType={currentNoteType}
                currentNoteMime={currentNoteMime}
                note={note}
                setModalShown={() => { /* no-op since no code notes are displayed here */ }}
                noCodeNotes
            />
        </FormDropdownSubmenu>
    );
}

function DevelopmentActions({ note, noteContext }: { note: FNote, noteContext?: NoteContext }) {
    return (
        <>
            <FormListHeader text="Development Actions" />
            <FormListItem
                icon="bx bx-printer"
                onClick={() => window.open(`/?print=#root/${note.noteId}`, "_blank")}
            >Open print page</FormListItem>
            <FormListItem
                icon="bx bx-error"
                disabled={note.type !== "text"}
                onClick={() => {
                    noteContext?.getTextEditor(editor => {
                        editor.editing.view.change(() => {
                            throw new Error("Editor crashed.");
                        });
                    });
                }}>Crash editor</FormListItem>
        </>
    );
}

function CommandItem({ icon, text, title, command, disabled }: { icon: string, text: string, title?: string, command: CommandNames | (() => void), disabled?: boolean, destructive?: boolean }) {
    return <FormListItem
        icon={icon}
        title={title}
        triggerCommand={typeof command === "string" ? command : undefined}
        onClick={typeof command === "function" ? command : undefined}
        disabled={disabled}
    >{text}</FormListItem>;
}

function ConvertToAttachment({ note }: { note: FNote }) {
    return (
        <FormListItem
            icon="bx bx-paperclip"
            onClick={async () => {
                if (!note || !(await dialog.confirm(t("note_actions.convert_into_attachment_prompt", { title: note.title })))) {
                    return;
                }

                const { attachment: newAttachment } = await server.post<ConvertToAttachmentResponse>(`notes/${note.noteId}/convert-to-attachment`);

                if (!newAttachment) {
                    toast.showMessage(t("note_actions.convert_into_attachment_failed", { title: note.title }));
                    return;
                }

                toast.showMessage(t("note_actions.convert_into_attachment_successful", { title: newAttachment.title }));
                await ws.waitForMaxKnownEntityChangeId();
                await appContext.tabManager.getActiveContext()?.setNote(newAttachment.ownerId, {
                    viewScope: {
                        viewMode: "attachments",
                        attachmentId: newAttachment.attachmentId
                    }
                });
            }}
        >{t("note_actions.convert_into_attachment")}</FormListItem>
    );
}

function ExportAsImage({ ntxId, parentComponent }: { ntxId: string | null | undefined, parentComponent: Component | null | undefined }) {
    return (
        <FormDropdownSubmenu
            icon="bx bxs-file-image"
            title={t("note_actions.export_as_image")}
            dropStart
        >
            <FormListItem
                icon="bx bxs-file-png"
                onClick={() => parentComponent?.triggerEvent("exportPng", { ntxId })}
            >{t("note_actions.export_as_image_png")}</FormListItem>

            <FormListItem
                icon="bx bx-shape-polygon"
                onClick={() => parentComponent?.triggerEvent("exportSvg", { ntxId })}
            >{t("note_actions.export_as_image_svg")}</FormListItem>
        </FormDropdownSubmenu>
    );
}
