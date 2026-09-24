import "./NoteBadges.css";

import { isOfficeMimeType } from "@triliumnext/commons";
import { clsx } from "clsx";
import { useEffect, useState } from "preact/hooks";

import { copyTextWithToast } from "../../services/clipboard_ext";
import { t } from "../../services/i18n";
import { goToLinkExt } from "../../services/link";
import { Badge, BadgeWithDropdown } from "../react/Badge";
import { FormDropdownDivider, FormListItem } from "../react/FormList";
import { useGetContextDataFrom, useIsNoteReadOnly, useNoteContext, useNoteLabel, useNoteLabelBoolean, useNoteProperty } from "../react/hooks";
import { useShareState } from "../ribbon/BasicPropertiesTab";
import { type ShareScope, useShareInfo } from "../shared_info";
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
            <ActiveContentBadges />
        </div>
    );
}

function ReadOnlyBadge() {
    const { note, noteContext } = useNoteContext();
    const { isReadOnly, enableEditing, temporarilyEditable } = useIsNoteReadOnly(note, noteContext);
    const isExplicitReadOnly = note?.isLabelTruthy("readOnly");

    if (temporarilyEditable) {
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
    const badge = SHARE_BADGES[scope];

    return (linkHref &&
        <BadgeWithDropdown
            icon={badge.icon}
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
            <FormListItem
                icon="bx bx-unlink"
                onClick={() => switchShareState(false)}
            >{t("breadcrumb_badges.shared_unshare")}</FormListItem>
        </BadgeWithDropdown>
    );
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

function ClippedNoteBadge() {
    const { note } = useNoteContext();
    const isHelpNote = !!note?.noteId.startsWith("_help");
    const [ url ] = useNoteLabel(note, isHelpNote ? "docUrl" : "pageUrl");

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

function ExecuteBadge() {
    const { note, parentComponent } = useNoteContext();
    const isScript = note?.isTriliumScript();
    const isSql = note?.isTriliumSqlite();
    const isExecutable = isScript || isSql;
    const [ executeDescription ] = useNoteLabel(note, "executeDescription");
    const [ executeButton ] = useNoteLabelBoolean(note, "executeButton");

    return (note && isExecutable && (executeDescription || executeButton) &&
        <Badge
            className="execute-badge"
            icon="bx bx-play"
            text={isScript ? t("breadcrumb_badges.execute_script") : t("breadcrumb_badges.execute_sql")}
            tooltip={executeDescription || (isScript ? t("breadcrumb_badges.execute_script_description") : t("breadcrumb_badges.execute_sql_description"))}
            onClick={() => parentComponent.triggerCommand("runActiveNote")}
        />
    );
}

const SAVE_STATE_DEBOUNCE_MS = 200;

export function SaveStatusBadge() {
    const { noteContext} = useNoteContext();
    const saveState = useGetContextDataFrom(noteContext, "saveState");
    const [debouncedState, setDebouncedState] = useState(saveState);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedState(saveState), SAVE_STATE_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [saveState]);

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

    const { icon, title, tooltip } = stateConfig[debouncedState.state];

    return (
        <Badge
            className={clsx("save-status-badge", debouncedState.state)}
            icon={icon}
            text={title}
            tooltip={tooltip}
        />
    );
}
