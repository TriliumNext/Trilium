import "./NoteBadges.css";

import { isOfficeMimeType, safeHostname } from "@triliumnext/commons";
import { clsx } from "clsx";
import { useCallback, useEffect, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import type { SaveState } from "../../components/note_context";
import FNote from "../../entities/fnote";
import attributes from "../../services/attributes";
import branches from "../../services/branches";
import { copyTextWithToast } from "../../services/clipboard_ext";
import dialog from "../../services/dialog";
import { t } from "../../services/i18n";
import { goToLinkExt } from "../../services/link";
import server from "../../services/server";
import {
    buildShareLink, getShareId, getShareScope, type ShareScope
} from "../../services/share_link";
import sync from "../../services/sync";
import { isElectron, isMobileApp, isStandalone } from "../../services/utils";
import { Badge, BadgeWithDropdown } from "../react/Badge";
import { FormDropdownDivider, FormListItem, FormListToggleableItem } from "../react/FormList";
import {
    useGetContextDataFrom, useIsNoteReadOnly, useNoteContext, useNoteLabel, useNoteLabelBoolean, useNoteLabelByName, useNoteProperty,
    useTriliumEvent, useTriliumOption
} from "../react/hooks";
import Icon from "../react/Icon";
import { ActiveContentBadges } from "./ActiveContentBadges";
import { SnippetBadge } from "./SnippetBadge";

export default function NoteBadges() {
    return (
        <div className="note-badges">
            <SaveStatusBadge />
            <ReadOnlyBadge />
            <OfficePreviewBadge />
            <ShareBadge />
            <ClippedNoteBadge />
            <ExecuteBadge />
            <SnippetBadge />
            <TemplateBadge />
            <ActiveContentBadges />
        </div>
    );
}

export function ReadOnlyBadge() {
    const { note, noteContext } = useNoteContext();
    const { isReadOnly, isLocked, enableEditing, temporarilyEditable } = useIsNoteReadOnly(note, noteContext);
    const isExplicitReadOnly = note?.isLabelTruthy("readOnly");

    if (isLocked) {
        return <Badge
            icon="bx bx-lock-alt"
            text={t("breadcrumb_badges.read_only_locked")}
            tooltip={t("breadcrumb_badges.read_only_locked_description")}
            className="read-only-badge"
        />;
    } else if (temporarilyEditable) {
        return <Badge
            icon="bx bx-lock-open-alt"
            text={t("breadcrumb_badges.read_only_temporarily_disabled")}
            tooltip={t("breadcrumb_badges.read_only_temporarily_disabled_description")}
            className="temporarily-editable-badge"
            onClick={() => enableEditing(false)}
        />;
    } else if (isReadOnly) {
        return <Badge
            icon="bx bx-lock-alt"
            text={isExplicitReadOnly ? t("breadcrumb_badges.read_only_explicit") : t("breadcrumb_badges.read_only_auto")}
            tooltip={isExplicitReadOnly ? t("breadcrumb_badges.read_only_explicit_description") : t("breadcrumb_badges.read_only_auto_description")}
            className="read-only-badge"
            onClick={() => enableEditing()}
        />;
    }
}

/**
 * Marks a file note that `OfficePreview` renders as HTML (DOCX/XLSX/PPTX, ODT/ODS/ODP, RTF and
 * EPUB). The preview is a rendering of the document, not an editor, so the badge tells the reader
 * why nothing can be typed into it. Unlike `ReadOnlyBadge` there is nothing to unlock.
 */
export function OfficePreviewBadge() {
    const { note, viewScope } = useNoteContext();
    const type = useNoteProperty(note, "type");
    const mime = useNoteProperty(note, "mime");

    const isPreviewShown = !viewScope?.viewMode || viewScope.viewMode === "default";
    if (type !== "file" || !isOfficeMimeType(mime) || !isPreviewShown) {
        return;
    }

    return (
        <Badge
            className="office-preview-badge"
            icon="bx bx-show"
            text={t("breadcrumb_badges.office_preview")}
            tooltip={t("breadcrumb_badges.office_preview_description")}
        />
    );
}

function ShareBadge() {
    const { note } = useNoteContext();
    const [ , switchShareState ] = useShareState(note);
    const { scope, linkHref } = useShareInfo(note);
    const shareEdit = useShareEditState(note);
    const badge = SHARE_BADGES[scope];

    return (linkHref &&
        <BadgeWithDropdown
            icon={shareEdit.canEdit ? "bx bx-group" : badge.icon}
            text={t(badge.text)}
            tooltip={badge.tooltip && t(badge.tooltip, { format: t("export.format_share_name") })}
            className="share-badge"
        >
            {scope !== "export-only" && <>
                <FormListItem
                    icon="bx bx-copy"
                    onClick={() => copyTextWithToast(linkHref)}
                >{t("breadcrumb_badges.shared_copy_to_clipboard")}</FormListItem>
                <FormListItem
                    icon="bx bx-link-external"
                    onClick={(e) => goToLinkExt(e, linkHref)}
                >{t("breadcrumb_badges.shared_open_in_browser")}</FormListItem>
                <FormDropdownDivider />
            </>}
            {note && (scope === "public" || scope === "local") && <>
                <FormListToggleableItem
                    icon="bx bx-group"
                    title={t("breadcrumb_badges.shared_guests_can_edit")}
                    helpTooltip={t("breadcrumb_badges.shared_guests_can_edit_description")}
                    currentValue={shareEdit.canEdit}
                    onChange={(enabled) =>
                        toggleShareEdit(note, enabled, shareEdit.reopensFromParent)}
                />
                {shareEdit.canEdit && <>
                    <FormListToggleableItem
                        icon="bx bx-paperclip"
                        title={t("breadcrumb_badges.shared_allow_attachments")}
                        helpTooltip={t("breadcrumb_badges.shared_allow_attachments_description")}
                        currentValue={shareEdit.attachments}
                        onChange={async (attachments) => {
                            await setShareEdit(note, { enabled: true, attachments });
                        }}
                    />
                    <FormListItem
                        icon="bx bx-key"
                        onClick={() => appContext.triggerCommand("showShareEditDialog", { note })}
                    >{shareEdit.needsPassword
                        ? t("breadcrumb_badges.shared_change_password")
                        : t("breadcrumb_badges.shared_set_password")}</FormListItem>
                </>}
                <FormDropdownDivider />
            </>}
            <FormListItem
                icon="bx bx-unlink"
                onClick={() => switchShareState(false)}
            >{t("breadcrumb_badges.shared_unshare")}</FormListItem>
        </BadgeWithDropdown>
    );
}

/**
 * Whether guests of the note's shared page can edit it, read from the labels the host set, and
 * whether the note closes a branch below an ancestor whose editing it can go back to.
 */
export function useShareEditState(note: FNote | null | undefined) {
    const [ canEdit ] = useNoteLabelBoolean(note, "shareEdit");
    const [ attachments ] = useNoteLabelBoolean(note, "shareAttachments");
    const [ passwordHash ] = useNoteLabel(note, "shareEditPassword");
    const reopensFromParent = !canEdit && note?.getOwnedLabelValue("shareEdit") === "false"
        && note.getParentNotes().some((parent) => parent.isLabelTruthy("shareEdit"));
    return { canEdit, attachments, needsPassword: !!passwordHash, reopensFromParent };
}

/**
 * Turns guest editing of `note` on or off from the Shared badge's menu. A branch closed below an
 * editable ancestor goes back to the ancestor's editing; any other note opens the dialog.
 */
export async function toggleShareEdit(note: FNote, enabled: boolean, reopensFromParent: boolean) {
    if (!enabled) {
        await setShareEdit(note, { enabled: false });
    } else if (reopensFromParent) {
        await setShareEdit(note, { enabled: true });
    } else {
        await appContext.triggerCommand("showShareEditDialog", { note });
    }
}

async function setShareEdit(note: FNote, settings: { enabled: boolean; attachments?: boolean }) {
    await server.put(`notes/${note.noteId}/share-edit`, settings);
}

const SHARE_BADGES: Record<ShareScope, { icon: string; text: string; tooltip?: string }> = {
    public: { icon: "bx bx-world", text: "breadcrumb_badges.shared_publicly" },
    local: { icon: "bx bx-share-alt", text: "breadcrumb_badges.shared_locally" },
    preview: {
        icon: "bx bx-show",
        text: "breadcrumb_badges.shared_preview",
        tooltip: "breadcrumb_badges.shared_preview_description"
    },
    "export-only": {
        icon: "bx bx-export",
        text: "breadcrumb_badges.shared_export_only",
        tooltip: "breadcrumb_badges.shared_export_only_description"
    }
};

export function ClippedNoteBadge() {
    const { note } = useNoteContext();
    const isHelpNote = !!note?.noteId.startsWith("_help");
    const [ url ] = useNoteLabel(note, isHelpNote ? "docUrl" : "pageUrl");
    const [ description ] = useNoteLabel(note, "pageDescription");
    const [ author ] = useNoteLabel(note, "pageAuthor");
    const [ published ] = useNoteLabel(note, "publishedDate");
    const [ modified ] = useNoteLabel(note, "modifiedDate");

    if (!url) return;

    if (isHelpNote) {
        return (
            <Badge
                className="doc-url-badge"
                icon="bx bx-file-find"
                text={t("breadcrumb_badges.doc_url")}
                tooltip={t("breadcrumb_badges.doc_url_description")}
                href={url}
            />
        );
    }

    const fields = [
        { icon: "bx bx-user", label: t("breadcrumb_badges.clipped_note_author"), value: author },
        { icon: "bx bx-calendar", label: t("breadcrumb_badges.clipped_note_published"), value: published },
        { icon: "bx bx-history", label: t("breadcrumb_badges.clipped_note_modified"), value: modified }
    ].filter((field) => field.value);

    if (!description && !fields.length) {
        return (
            <Badge
                className="clipped-note-badge"
                icon="bx bx-globe"
                text={t("breadcrumb_badges.clipped_note")}
                tooltip={t("breadcrumb_badges.clipped_note_description", { url })}
                href={url}
            />
        );
    }

    return (
        <BadgeWithDropdown
            panel
            className="clipped-note-badge"
            icon="bx bx-globe"
            text={t("breadcrumb_badges.clipped_note")}
            tooltip={t("breadcrumb_badges.clipped_note_details")}
            dropdownProps={{ dropdownContainerClassName: "clipped-note-details-panel" }}
        >
            <div className="clipped-note-details">
                <div className="clipped-note-source">
                    <Icon icon="bx bx-globe" />
                    <a className="tn-link external" href={url} target="_blank" rel="noopener noreferrer">
                        {safeHostname(url)}
                    </a>
                </div>
                {description && <p className="clipped-note-description pre-wrap-text">{description}</p>}
                {fields.length > 0 && (
                    <dl className="clipped-note-fields">
                        {fields.map((field) => (
                            <div key={field.icon}>
                                <dt><Icon icon={field.icon} />{field.label}</dt>
                                <dd>{field.value}</dd>
                            </div>
                        ))}
                    </dl>
                )}
            </div>
        </BadgeWithDropdown>
    );
}

export function ExecuteBadge() {
    const { note, ntxId, parentComponent } = useNoteContext();
    const isScript = note?.isTriliumScript();
    const isSql = note?.isTriliumSqlite();
    const isExecutable = isScript || isSql;
    const [ executeDescription ] = useNoteLabel(note, "executeDescription");
    const [ executeButton ] = useNoteLabelBoolean(note, "executeButton");
    const [ executeTitle ] = useNoteLabel(note, "executeTitle");
    // `#executeButton` is typed as a flag, but the User Guide documents its value as the button's title.
    const [ executeButtonValue ] = useNoteLabelByName(note, "executeButton");
    const title = executeTitle || (executeButtonValue !== "true" && executeButtonValue !== "false" && executeButtonValue);

    return (note && isExecutable && (executeDescription || executeButton) &&
        <Badge
            className="execute-badge"
            icon="bx bx-play"
            text={title || (isScript ? t("breadcrumb_badges.execute_script") : t("breadcrumb_badges.execute_sql"))}
            tooltip={executeDescription || (isScript ? t("breadcrumb_badges.execute_script_description") : t("breadcrumb_badges.execute_sql_description"))}
            onClick={() => parentComponent.triggerCommand("runActiveNote", { ntxId })}
        />
    );
}

/**
 * Marks a template, whose attributes every note created from it inherits. Its dropdown switches it
 * between `#template` and `#workspaceTemplate`; the latter only for a template inside a workspace.
 */
export function TemplateBadge() {
    const { note, parentComponent } = useNoteContext();
    const [ isTemplate ] = useNoteLabelBoolean(note, "template");
    const [ isWorkspaceTemplate ] = useNoteLabelBoolean(note, "workspaceTemplate");
    if (!note || (!isTemplate && !isWorkspaceTemplate)) return;

    const isInWorkspace = hasWorkspaceAncestor(note);

    async function switchScope(toWorkspace: boolean) {
        if (!note) return;
        const [ added, removed ] = toWorkspace ? [ "workspaceTemplate", "template" ] : [ "template", "workspaceTemplate" ];
        // The new label goes on first, so the note never stops being a template in between.
        await attributes.setBooleanWithInheritance(note, added, true);
        await attributes.setBooleanWithInheritance(note, removed, false);
    }

    return (
        <BadgeWithDropdown
            className="template-badge"
            icon="bx bx-copy-alt"
            text={isTemplate ? t("breadcrumb_badges.template") : t("breadcrumb_badges.workspace_template")}
            tooltip={t("breadcrumb_badges.template_description")}
            dropdownProps={{ mobileBottomSheet: true }}
        >
            <FormListItem
                icon="bx bx-globe"
                checkable checked={isTemplate}
                onClick={() => !isTemplate && switchScope(false)}
            >{t("breadcrumb_badges.template_scope_global")}</FormListItem>
            <FormListItem
                icon="bx bx-door-open"
                checkable checked={!isTemplate}
                disabled={!isInWorkspace}
                disabledTooltip={t("breadcrumb_badges.template_scope_workspace_unavailable")}
                onClick={() => isTemplate && switchScope(true)}
            >{t("breadcrumb_badges.template_scope_workspace")}</FormListItem>
            <FormDropdownDivider />
            <FormListItem
                icon="bx bx-cog"
                onClick={() => parentComponent?.triggerEvent("showTemplateProperties", { noteId: note.noteId })}
            >{t("breadcrumb_badges.template_properties")}</FormListItem>
        </BadgeWithDropdown>
    );
}

function hasWorkspaceAncestor(note: FNote, visited = new Set<string>()): boolean {
    for (const parent of note.getParentNotes()) {
        if (visited.has(parent.noteId)) continue;
        visited.add(parent.noteId);
        if (parent.hasOwnedLabel("workspace") || hasWorkspaceAncestor(parent, visited)) return true;
    }
    return false;
}

const SAVE_STATE_DEBOUNCE_MS = 200;

export function SaveStatusBadge() {
    const { noteContext} = useNoteContext();
    const saveState = useGetContextDataFrom(noteContext, "saveState");

    return <SaveStateBadge state={saveState?.state} />;
}

/** The badge of `state`, which follows a change of the state once it lasts a moment. */
export function SaveStateBadge({ state }: { state: SaveState | undefined }) {
    const [debouncedState, setDebouncedState] = useState(state);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedState(state), SAVE_STATE_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [state]);

    if (!debouncedState) return;

    const stateConfig = {
        saved: {
            icon: "bx bx-check",
            title: t("breadcrumb_badges.save_status_saved"),
            tooltip: undefined
        },
        saving: {
            icon: "bx bx-loader bx-spin",
            title: t("breadcrumb_badges.save_status_saving"),
            tooltip: t("breadcrumb_badges.save_status_saving_tooltip")
        },
        unsaved: {
            icon: "bx bx-pencil",
            title: t("breadcrumb_badges.save_status_unsaved"),
            tooltip: t("breadcrumb_badges.save_status_unsaved_tooltip")
        },
        error: {
            icon: "bx bxs-error",
            title: t("breadcrumb_badges.save_status_error"),
            tooltip: t("breadcrumb_badges.save_status_error_tooltip")
        }
    };

    const { icon, title, tooltip } = stateConfig[debouncedState];

    return (
        <Badge
            className={clsx("save-status-badge", debouncedState)}
            icon={icon}
            text={title}
            tooltip={tooltip}
        />
    );
}

export function useShareState(note: FNote | null | undefined) {
    const [ isShared, setIsShared ] = useState(false);
    const refreshState = useCallback(() => {
        setIsShared(!!note?.hasAncestor("_share"));
    }, [ note ]);

    useEffect(() => refreshState(), [ refreshState ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (note && loadResults.getBranchRows().find((b) => b.noteId === note.noteId)) {
            refreshState();
        }
    });

    const switchShareState = useCallback(async (shouldShare: boolean) => {
        if (!note) return;

        if (shouldShare) {
            await branches.cloneNoteToParentNote(note.noteId, "_share");
        } else {
            if (note?.getParentBranches().length === 1 && !(await dialog.confirm(t("shared_switch.shared-branch")))) {
                return;
            }

            const shareBranch = note?.getParentBranches().find((b) => b.parentNoteId === "_share");
            if (!shareBranch?.branchId) return;
            await server.remove(`branches/${shareBranch.branchId}?taskId=no-progress-reporting`);
        }

        sync.syncNow(true);
    }, [ note ]);

    return [ isShared, switchShareState ] as const;
}

function useShareInfo(note: FNote | null | undefined) {
    const [ linkHref, setLinkHref ] = useState<string>();
    const [ syncServerHost ] = useTriliumOption("syncServerHost");

    function refresh() {
        if (!note) return;
        if (note.noteId === "_share" || !note?.hasAncestor("_share")) {
            setLinkHref(undefined);
            return;
        }

        setLinkHref(buildShareLink(getShareId(note), syncServerHost));
    }

    useEffect(refresh, [ note, syncServerHost ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttributeRows().find((attr) => attr.name?.startsWith("_share") && attributes.isAffecting(attr, note))) {
            refresh();
        } else if (loadResults.getBranchRows().find((branch) => branch.noteId === note?.noteId)) {
            refresh();
        }
    });

    return {
        linkHref,
        scope: getShareScope({
            isElectron: isElectron(),
            isStandalone: !!isStandalone,
            isMobileApp: isMobileApp(),
            syncServerHost
        })
    };
}
