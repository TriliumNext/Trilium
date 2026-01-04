import "./NoteBadges.css";

import { clsx } from "clsx";

import { copyTextWithToast } from "../../services/clipboard_ext";
import { t } from "../../services/i18n";
import { goToLinkExt } from "../../services/link";
import { Badge, BadgeWithDropdown } from "../react/Badge";
import { FormDropdownDivider, FormListItem } from "../react/FormList";
import { useGetContextData, useIsNoteReadOnly, useNoteContext, useNoteLabel, useNoteLabelBoolean } from "../react/hooks";
import { useShareState } from "../ribbon/BasicPropertiesTab";
import { useShareInfo } from "../shared_info";

export default function NoteBadges() {
    return (
        <div className="note-badges">
            <SaveStatusBadge />
            <ReadOnlyBadge />
            <ShareBadge />
            <ClippedNoteBadge />
            <ExecuteBadge />
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

function ShareBadge() {
    const { note } = useNoteContext();
    const [ , switchShareState ] = useShareState(note);
    const { isSharedExternally, linkHref } = useShareInfo(note);

    return (linkHref &&
        <BadgeWithDropdown
            icon={isSharedExternally ? "bx bx-world" : "bx bx-share-alt"}
            text={isSharedExternally ? t("breadcrumb_badges.shared_publicly") : t("breadcrumb_badges.shared_locally")}
            className="share-badge"
        >
            <FormListItem
                icon="bx bx-copy"
                onClick={() => copyTextWithToast(linkHref)}
            >{t("breadcrumb_badges.shared_copy_to_clipboard")}</FormListItem>
            <FormListItem
                icon="bx bx-link-external"
                onClick={(e) => goToLinkExt(e, linkHref)}
            >{t("breadcrumb_badges.shared_open_in_browser")}</FormListItem>
            <FormDropdownDivider />
            <FormListItem
                icon="bx bx-unlink"
                onClick={() => switchShareState(false)}
            >{t("breadcrumb_badges.shared_unshare")}</FormListItem>
        </BadgeWithDropdown>
    );
}

function ClippedNoteBadge() {
    const { note } = useNoteContext();
    const [ pageUrl ] = useNoteLabel(note, "pageUrl");

    return (pageUrl &&
        <Badge
            className="clipped-note-badge"
            icon="bx bx-globe"
            text={t("breadcrumb_badges.clipped_note")}
            tooltip={t("breadcrumb_badges.clipped_note_description", { url: pageUrl })}
            href={pageUrl}
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

export function SaveStatusBadge() {
    const saveState = useGetContextData("saveState");
    if (!saveState) return;

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

    const { icon, title, tooltip } = stateConfig[saveState.state];

    return (
        <Badge
            className={clsx("save-status-badge", saveState.state)}
            icon={icon}
            text={title}
            tooltip={tooltip}
        />
    );
}
