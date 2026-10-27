import "./NoteActions.css";

import { ConvertToAttachmentResponse, ToggleInParentResponse } from "@triliumnext/commons";
import { ComponentChildren, RefObject } from "preact";
import { useCallback, useContext, useEffect, useRef, useState } from "preact/hooks";

import appContext, { CommandNames } from "../../components/app_context";
import Component from "../../components/component";
import NoteContext from "../../components/note_context";
import FNote from "../../entities/fnote";
import type { MenuCommandItem } from "../../menus/context_menu";
import branches from "../../services/branches";
import dialog from "../../services/dialog";
import { t } from "../../services/i18n";
import protected_session from "../../services/protected_session";
import server from "../../services/server";
import toast from "../../services/toast";
import { isElectron as getIsElectron, isMac as getIsMac, isMobile as getIsMobile } from "../../services/utils";
import ws from "../../services/ws";
import ClosePaneButton from "../buttons/close_pane_button";
import CreatePaneButton from "../buttons/create_pane_button";
import MovePaneButton from "../buttons/move_pane_button";
import { resolveViewType } from "../collections/interface";
import { showImageCompressionDialog } from "../dialogs/image_compression/image_compression_dialog";
import { isAlwaysFullWidthByType } from "../note_wrapper";
import Dropdown, { type DropdownHandle } from "../react/Dropdown";
import { FormDropdownDivider, FormDropdownSubmenu, FormListHeader, FormListItem, FormListToggleableItem } from "../react/FormList";
import { useEffectiveReadOnly, useIsNoteReadOnly, useNoteContext, useNoteLabel, useNoteLabelBoolean, useNoteLabelOptionalBool, useNoteProperty, useNoteRelation, useSyncedRef, useTriliumEvent, useTriliumOption } from "../react/hooks";
import { MenuItemRows } from "../react/Menu";
import { ParentComponent, POPUP_EDITOR_NTX_ID, useCommandTrigger } from "../react/react_utils";
import { getWordWrapMenu } from "./code_menus";
import NoteActionsCustom from "./NoteActionsCustom";
import { useShareState } from "./NoteBadges";
import { NoteTypeDropdownContent } from "./NoteTypeSwitcher";

export default function NoteActions({ paneButtons = true }: {
    /** Whether to show the buttons that move, close and create splits, which only a split has. */
    paneButtons?: boolean;
}) {
    const { note, ntxId, noteContext } = useNoteContext();
    return (
        <div className="note-actions-bar" style={{ contain: "none" }}>
            {note && ntxId && noteContext && <NoteActionsCustom note={note} ntxId={ntxId} noteContext={noteContext} />}
            {paneButtons && <>
                <MovePaneButton direction="left" />
                <MovePaneButton direction="right" />
                <ClosePaneButton />
                <CreatePaneButton />
            </>}
            {note && note.type !== "launcher" && <NoteContextMenu note={note as FNote} noteContext={noteContext} />}
        </div>
    );
}

type ItemToFocus = "basic-properties";

export function NoteContextMenu({ note, noteContext, leadingViewActions = [], trailingViewActions = [], itemsAtStart, noteSettingsItems, itemsNearNoteSettings, dropdownRef: externalDropdownRef }: {
    note: FNote,
    noteContext?: NoteContext,
    /** Tiles placed before the note's own in the strip of tiles. */
    leadingViewActions?: MenuCommandItem<CommandNames>[];
    /** Tiles placed after the note's own in the strip of tiles. */
    trailingViewActions?: MenuCommandItem<CommandNames>[];
    itemsAtStart?: ComponentChildren;
    /** Rows placed among the note settings, after the note type and its editability. */
    noteSettingsItems?: ComponentChildren;
    /** Rows that join the group of the note's properties. */
    itemsNearNoteSettings?: ComponentChildren;
    dropdownRef?: RefObject<DropdownHandle | null>;
}) {
    const dropdownRef = useSyncedRef<DropdownHandle>(externalDropdownRef, null);
    const parentComponent = useContext(ParentComponent);
    const noteType = useNoteProperty(note, "type") ?? "";
    const [viewType] = useNoteLabel(note, "viewType");
    const [renderNote] = useNoteRelation(note, "renderNote");
    const canBeConvertedToAttachment = note?.isEligibleForConversionToAttachment();
    const isSourceView = noteContext?.viewScope?.viewMode === "source";
    const isSearchable = isSourceView
        || ["text", "code", "book", "mindMap", "doc", "spreadsheet"].includes(noteType)
        || (noteType === "file" && note.mime === "application/pdf")
        || (note.noteId === "_backendLog");
    const isInOptionsOrHelp = note?.noteId.startsWith("_options") || note?.noteId.startsWith("_help");
    const isExportableToImage = ["mermaid", "mindMap"].includes(noteType);
    const isExportableToXlsx = noteType === "spreadsheet";
    const isContentAvailable = note.isContentAvailable();
    const isPrintable = isContentAvailable && (
        ["text", "code", "spreadsheet", "llmChat"].includes(noteType) ||
        (noteType === "render" && !!renderNote) ||
        (noteType === "book" && ["presentation", "list", "table"].includes(viewType ?? "")) ||
        (noteType === "search" && ["list", "searchPreview"].includes(resolveViewType(note, viewType) ?? "")) ||
        (noteType === "file" && note.mime === "application/pdf")
    );
    const isElectron = getIsElectron();
    const isMac = getIsMac();
    const isMobile = getIsMobile();
    const hasSource = ["text", "code", "relationMap", "mermaid", "canvas", "mindMap", "spreadsheet", "llmChat"].includes(noteType) || note.isSvg();
    const isSearchOrBook = ["search", "book"].includes(noteType);
    const isBoard = noteType === "book" && viewType === "board";
    const isGeoMap = noteType === "book" && viewType === "geoMap";
    const isTable = noteType === "book" && viewType === "table";
    // A calendar root makes day notes rather than events, so it has no templates to configure.
    const isEventCalendar = noteType === "book" && viewType === "calendar"
        && !note.hasLabel("calendarRoot") && !note.hasLabel("workspaceCalendarRoot");
    const isHelpPage = note.noteId.startsWith("_help");
    const [syncServerHost] = useTriliumOption("syncServerHost");
    const { isReadOnly, isLocked, enableEditing } = useIsNoteReadOnly(note, noteContext);
    const isViewReadOnly = useEffectiveReadOnly(note, noteContext);
    // The views other than the board open their properties dialog only while they are editable.
    const hasCollectionProperties = isBoard
        || (!isViewReadOnly && (isEventCalendar || isGeoMap || isTable));
    const isNormalViewMode = noteContext?.viewScope?.viewMode === "default";
    const hasBasicProperties = isNormalViewMode && !isHelpPage;
    // The note map and a converted attachment open in the tab behind the quick edit popup.
    const isInPopup = !!noteContext?.ntxId?.startsWith(POPUP_EDITOR_NTX_ID);
    const itemToFocusRef = useRef<ItemToFocus>(null);
    const showRevisions = useCommandTrigger("showRevisions");
    const searchInNote = useCommandTrigger("findInText");
    const showAttachments = useCommandTrigger("showAttachments");
    const showNoteMap = useCommandTrigger("toggleRibbonTabNoteMap");
    const findAction: MenuCommandItem<CommandNames>[] = [ {
        title: t("note_actions.search_in_note_short"), tooltip: t("note_actions.search_in_note"),
        uiIcon: "bx bx-file-find", keyboardShortcut: "findInText" as const, enabled: isSearchable,
        handler: () => searchInNote?.()
    } ];
    // The mobile menu lists the attachments in a row of its own, beside the attributes.
    const attachmentsAction: MenuCommandItem<CommandNames>[] = isMobile ? [] : [ {
        title: t("note_actions.note_attachments_short"), tooltip: t("note_actions.note_attachments"),
        uiIcon: "bx bx-paperclip", enabled: !isInOptionsOrHelp,
        handler: () => showAttachments?.()
    } ];
    const noteMapAction: MenuCommandItem<CommandNames>[] = isInPopup ? [] : [ {
        title: t("note_actions.note_map"),
        uiIcon: "bx bxs-network-chart", keyboardShortcut: "toggleRibbonTabNoteMap" as const, enabled: !isInOptionsOrHelp,
        handler: () => showNoteMap?.()
    } ];
    /** The actions that look into the note, drawn as a strip of tiles at the top of the menu. */
    const viewActions: MenuCommandItem<CommandNames>[] = [
        ...leadingViewActions,
        // A phone's thumb reaches the right end most easily, so Find goes nearer it.
        ...(isMobile ? [ ...noteMapAction, ...findAction ] : [ ...findAction, ...attachmentsAction, ...noteMapAction ]),
        ...trailingViewActions
    ];
    const viewStrip = viewActions.length > 0 && <>
        <MenuItemRows items={viewActions.length > 1
            ? [ { kind: "actions", items: viewActions, className: "note-actions-strip tn-menu-actions-cards" } ]
            // One action, as in the quick edit popup on mobile, is too few for a strip, so it is a row under its full name.
            : viewActions.map((item) => ({ ...item, title: item.tooltip ?? item.title }))} />
        {(!isMobile || viewActions.length === 1) && <FormDropdownDivider />}
    </>;
    // Keyboard shortcuts.
    useTriliumEvent("toggleRibbonTabBasicProperties", ({ ntxId }) => {
        if (!noteContext || ntxId !== noteContext.ntxId) return;
        itemToFocusRef.current = "basic-properties";
        dropdownRef.current?.toggle();
    });

    return (
        <>
            <Dropdown
                dropdownRef={dropdownRef}
                buttonClassName="bx bx-dots-horizontal-rounded"
                className="note-actions"
                mobileBottomSheet
                hideToggleArrow
                noSelectButtonStyle
                iconAction
                onHidden={() => itemToFocusRef.current = null }
            >
                {isMobile && viewStrip}

                {(note.type === "code" || note.noteId === "_backendLog") && <CodeProperties note={note} />}

                {isReadOnly && !isLocked && <>
                    <CommandItem icon="bx bx-pencil" text={t("read-only-info.edit-note")}
                        command={() => enableEditing()} />
                    <FormDropdownDivider />
                </>}

                {itemsAtStart}

                {!isMobile && viewStrip}

                {hasBasicProperties && <NoteBasicProperties note={note} focus={itemToFocusRef} isInPopup={isInPopup} settingsItems={noteSettingsItems} />}
                {itemsNearNoteSettings}
                {(hasBasicProperties || itemsNearNoteSettings) && <FormDropdownDivider />}

                <CommandItem icon="bx bx-import" text={t("note_actions.import_files")}
                    disabled={isInOptionsOrHelp || note.type === "search"}
                    command={() => parentComponent?.triggerCommand("showImportDialog", { noteId: note.noteId })} />
                <CommandItem icon="bx bx-export" text={t("note_actions.export_note")}
                    disabled={note.noteId.startsWith("_options") || note.noteId === "_backendLog"}
                    command={() => noteContext?.notePath && parentComponent?.triggerCommand("showExportDialog", {
                        notePath: noteContext.notePath,
                        defaultType: "single"
                    })} />
                {isExportableToImage && isNormalViewMode && isContentAvailable && <ExportAsImage ntxId={noteContext.ntxId} parentComponent={parentComponent} />}
                {isExportableToXlsx && isNormalViewMode && isContentAvailable && (
                    <>
                        <FormListItem
                            icon="bx bxs-spreadsheet"
                            onClick={() => parentComponent?.triggerEvent("exportXlsx", { ntxId: noteContext.ntxId })}
                        >{t("spreadsheet.export-xlsx")}</FormListItem>
                        <FormListItem
                            icon="bx bxs-spreadsheet"
                            onClick={() => parentComponent?.triggerEvent("exportCsv", { ntxId: noteContext.ntxId })}
                        >{t("spreadsheet.export-csv")}</FormListItem>
                    </>
                )}
                <CommandItem command="printActiveNote" icon="bx bx-printer" disabled={!isPrintable}
                    text={t("note_actions.print_or_export_to_pdf")}
                />

                <FormDropdownDivider />

                {/* A split row's own action runs only on the desktop, so a phone's page lists it too. */}
                <FormDropdownSubmenu icon="bx bx-history" title={t("note_actions.view_revisions")}
                    onDropdownToggleClicked={() => {
                        dropdownRef.current?.hide();
                        showRevisions?.();
                    }}
                >
                    {isMobile && <CommandItem command="showRevisions" icon="bx bx-history" text={t("note_actions.view_revisions")} />}
                    <CommandItem command="forceSaveRevision" icon="bx bx-save" disabled={isInOptionsOrHelp} text={t("note_actions.save_revision")} />
                    <CommandItem command="saveNamedRevision" icon="bx bx-purchase-tag" disabled={isInOptionsOrHelp} text={t("note_actions.save_named_revision")} />
                </FormDropdownSubmenu>
                {canBeConvertedToAttachment && !isInPopup && <ConvertToAttachment note={note} />}
                {note.type === "render" && <CommandItem command="renderActiveNote" icon="bx bx-extension" text={t("note_actions.re_render_note")}
                />}

                {hasCollectionProperties && <CommandItem icon="bx bx-cog"
                    text={isBoard ? t("board_view.properties")
                        : isGeoMap ? t("geo-map.properties")
                        : isTable ? t("table_view.properties") : t("calendar_view.properties")}
                    command={() => parentComponent?.triggerEvent("showCollectionProperties", { ntxId: noteContext?.ntxId })} />}

                <FormDropdownSubmenu icon="bx bx-wrench" title={t("note_actions.advanced")}>
                    <CommandItem command="openNoteExternally" icon="bx bx-file-find" disabled={isSearchOrBook || !isElectron} text={t("note_actions.open_note_externally")} title={t("note_actions.open_note_externally_title")} />
                    <CommandItem command="openNoteCustom" icon="bx bx-customize" disabled={isSearchOrBook || isMac || !isElectron} text={t("note_actions.open_note_custom")} />
                    <CommandItem command="showNoteSource" icon="bx bx-code" disabled={!hasSource} text={t("note_actions.note_source")} />
                    {(note.type === "text" || note.isMarkdown()) && isContentAvailable && !isInOptionsOrHelp &&
                        <ConvertNoteFormat note={note} />}
                    {/* Always the note-level dialog, an image note included: it has children of its
                        own, and reaching them is what makes this "images" and not "image". */}
                    <CommandItem icon="bx bx-collapse-alt" text={t("compress-images-menu")}
                        disabled={isInOptionsOrHelp || !isContentAvailable}
                        command={() => void showImageCompressionDialog({ type: "note", noteId: note.noteId })} />
                    <CommandItem command="showNoteOCRText" icon="bx bx-text" disabled={!["image", "file"].includes(noteType) || !isContentAvailable} text={t("note_actions.view_ocr_text")} />
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
        </>
    );
}

function CodeProperties({ note }: { note: FNote }) {
    const [ wrapLines, setWrapLines ] = useNoteLabelOptionalBool(note, "wrapLines");

    return (
        <>
            <MenuItemRows items={[ getWordWrapMenu(wrapLines, setWrapLines) ]} />
            <FormDropdownDivider />
        </>
    );
}

function NoteBasicProperties({ note, focus, isInPopup, settingsItems }: {
    note: FNote;
    settingsItems?: ComponentChildren;
    focus: RefObject<ItemToFocus | null>;
    /** Whether the menu is in the quick edit popup, whose width the full content width label does not change. */
    isInPopup: boolean;
}) {
    const itemToFocusRef = useRef<HTMLLIElement>(null);
    const [ isBookmarked, setIsBookmarked ] = useNoteBookmarkState(note);
    const [ isShared, switchShareState ] = useShareState(note);
    const [ isTemplate, setIsTemplate ] = useNoteLabelBoolean(note, "template");
    const [ isFullContentWidth, setIsFullContentWidth ] = useNoteLabelBoolean(note, "fullContentWidth");
    const isProtected = useNoteProperty(note, "isProtected");

    useEffect(() => {
        if (focus.current === "basic-properties") {
            itemToFocusRef.current?.focus();
        }
    }, [ focus ]);

    const isMobile = getIsMobile();
    const settings = <>
        <NoteTypeDropdown note={note} />
        {!isMobile && <EditabilityDropdown note={note} />}
        {settingsItems}

        <FormListToggleableItem
            icon="bx bx-copy-alt"
            title={t("template_switch.template")}
            currentValue={isTemplate} onChange={setIsTemplate}
            helpPage="KC1HB96bqqHX"
            disabled={note?.noteId.startsWith("_options")}
        />
        {!isAlwaysFullWidthByType(note) && !isInPopup &&
            <FormListToggleableItem
                icon="bx bx-expand-horizontal"
                title={t("full_content_width_switch.title")}
                currentValue={isFullContentWidth} onChange={setIsFullContentWidth}
            />
        }
        {isMobile && <>
            <FormDropdownDivider />
            <FormListHeader text={t("basic_properties.editable")} />
            <EditabilityOptions note={note} />
        </>}
    </>;

    const shared = <FormListToggleableItem
        icon="bx bx-share-alt"
        title={t("shared_switch.shared")}
        currentValue={isShared} onChange={switchShareState}
        helpPage="R9pX4DGra2Vt"
        disabled={["root", "_share", "_hidden"].includes(note?.noteId ?? "") || note?.noteId.startsWith("_options")}
        itemRef={itemToFocusRef}
    />;
    const protect = <FormListToggleableItem
        icon="bx bx-lock-alt"
        title={t("protect_note.toggle-on")}
        currentValue={!!isProtected} onChange={shouldProtect => protected_session.protectNote(note.noteId, shouldProtect, false)}
    />;
    const bookmark = <FormListToggleableItem
        icon="bx bx-bookmark"
        title={t("bookmark_switch.bookmark")}
        currentValue={isBookmarked} onChange={setIsBookmarked}
        disabled={["root", "_hidden"].includes(note?.noteId ?? "")}
    />;

    if (isMobile) {
        return <>
            {protect}
            <FormDropdownSubmenu icon="bx bx-slider-alt" title={t("note_actions.note_settings")}>
                {shared}
                {bookmark}
                <FormDropdownDivider />
                {settings}
            </FormDropdownSubmenu>
        </>;
    }

    return <>
        {shared}
        {protect}
        {bookmark}
        <FormDropdownDivider />
        {settings}
    </>;
}

function EditabilityDropdown({ note }: { note: FNote }) {
    return (
        <FormDropdownSubmenu title={t("basic_properties.editable")} icon="bx bx-edit-alt">
            <EditabilityOptions note={note} />
        </FormDropdownSubmenu>
    );
}

function EditabilityOptions({ note }: { note: FNote }) {
    const [ readOnly, setReadOnly ] = useNoteLabelBoolean(note, "readOnly");
    const [ autoReadOnlyDisabled, setAutoReadOnlyDisabled ] = useNoteLabelBoolean(note, "autoReadOnlyDisabled");

    function setState(readOnly: boolean, autoReadOnlyDisabled: boolean) {
        setReadOnly(readOnly);
        setAutoReadOnlyDisabled(autoReadOnlyDisabled);
    }

    return <>
        <FormListItem checked={!readOnly && !autoReadOnlyDisabled} onClick={() => setState(false, false)} description={t("editability_select.note_is_editable")}>{t("editability_select.auto")}</FormListItem>
        <FormListItem checked={readOnly && !autoReadOnlyDisabled} onClick={() => setState(true, false)} description={t("editability_select.note_is_read_only")}>{t("editability_select.read_only")}</FormListItem>
        <FormListItem checked={!readOnly && autoReadOnlyDisabled} onClick={() => setState(false, true)} description={t("editability_select.note_is_always_editable")}>{t("editability_select.always_editable")}</FormListItem>
    </>;
}

function NoteTypeDropdown({ note }: { note: FNote }) {
    const currentNoteType = useNoteProperty(note, "type") ?? undefined;
    const currentNoteMime = useNoteProperty(note, "mime");

    return (
        <FormDropdownSubmenu title={t("basic_properties.note_type")} icon="bx bx-file">
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
                disabled={!note.isContentAvailable()}
                onClick={() => window.open(`/?print=#root/${note.noteId}`, "_blank")}
            >Open print page</FormListItem>
            <FormListItem
                icon="bx bx-error"
                disabled={note.type !== "text"}
                onClick={async () => {
                    const editor = await noteContext?.getTextEditor();
                    editor?.editing.view.change(() => {
                        throw new Error("Editor crashed.");
                    });
                }}>Crash editor</FormListItem>
        </>
    );
}

export function CommandItem({ icon, text, title, command, disabled }: { icon: string, text: string, title?: string, command: CommandNames | (() => void), disabled?: boolean, destructive?: boolean }) {
    const triggerOwnCommand = useCommandTrigger(typeof command === "string" ? command : undefined);
    return <FormListItem
        icon={icon}
        title={title}
        onClick={typeof command === "function" ? command : triggerOwnCommand}
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

function ConvertNoteFormat({ note }: { note: FNote }) {
    const isMarkdown = note.isMarkdown();

    return (
        <FormListItem
            icon="bx bxl-markdown"
            onClick={async () => {
                // Text → Markdown is lossy; Markdown → Text is not, so use the milder warning there.
                const warning = isMarkdown
                    ? t("note_actions.convert_format_warning")
                    : t("note_actions.convert_format_warning_risky");
                if (!(await dialog.confirm(warning))) {
                    return;
                }

                await server.post(`notes/${note.noteId}/convert-format`);
                await ws.waitForMaxKnownEntityChangeId();
                toast.showMessage(isMarkdown
                    ? t("note_actions.convert_to_text_successful")
                    : t("note_actions.convert_to_markdown_successful"));
            }}
        >{isMarkdown ? t("note_actions.convert_to_text") : t("note_actions.convert_to_markdown")}</FormListItem>
    );
}

function ExportAsImage({ ntxId, parentComponent }: { ntxId: string | null | undefined, parentComponent: Component | null | undefined }) {
    return (
        <FormDropdownSubmenu
            icon="bx bxs-file-image"
            title={t("note_actions.export_as_image")}
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

export function useNoteBookmarkState(note: FNote | null | undefined) {
    const [ isBookmarked, setIsBookmarked ] = useState<boolean>(false);
    const refreshState = useCallback(() => {
        const isBookmarked = note && !!note.getParentBranches().find((b) => b.parentNoteId === "_lbBookmarks");
        setIsBookmarked(!!isBookmarked);
    }, [ note ]);

    const changeHandler = useCallback(async (shouldBookmark: boolean) => {
        if (!note) return;
        const resp = await server.put<ToggleInParentResponse>(`notes/${note.noteId}/toggle-in-parent/_lbBookmarks/${shouldBookmark}`);

        if (!resp.success && "message" in resp) {
            toast.showError(resp.message);
        }
    }, [ note ]);

    useEffect(() => refreshState(), [ refreshState ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (note && loadResults.getBranchRows().find((b) => b.noteId === note.noteId)) {
            refreshState();
        }
    });
    return [ isBookmarked, changeHandler ] as const;
}
