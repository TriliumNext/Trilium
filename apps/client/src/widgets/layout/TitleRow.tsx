import "./TitleRow.css";

import clsx from "clsx";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

import froca from "../../services/froca";
import { t } from "../../services/i18n";
import NoteIcon from "../note_icon";
import NoteTitleWidget from "../note_title";
import { useTriliumEvent } from "../react/hooks/events";
import { useNoteContext } from "../react/hooks/note_context";
import Icon from "../react/Icon";
import NoteBadges from "./NoteBadges";
import { VimTitleStatus } from "./VimStatus";


/**
 * What heads a note shown outside a split of its own: icon, title and badges, each editable in place
 * and each reading the note out of the surrounding note context rather than being handed one.
 *
 * Shared by the quick editor and the geo map's marker pane, so a rename from either saves the same
 * way — through the title widget.
 */
export default function TitleRow({ compact, start }: {
    /** Standing in a narrow header rather than at the head of a split (see TitleRow.css). */
    compact?: boolean;
    /** Shown before the icon, such as the back button of the quick editor. */
    start?: ComponentChildren;
} = {}) {
    const { viewScope } = useNoteContext();
    const className = clsx("title-row", compact && "tn-title-row-compact");

    if (viewScope?.attachmentId) {
        return (
            <AttachmentTitleRow
                className={className}
                attachmentId={viewScope.attachmentId}
                start={start}
            />
        );
    }

    return (
        <div className={className}>
            {start}
            <NoteIcon />
            <NoteTitleWidget />
            <VimTitleStatus />
            <NoteBadges />
        </div>
    );
}

/**
 * The header shown when an attachment is displayed instead of a note. Attachments are not editable
 * in place, so the title is plain read-only text, prefixed to make clear that what is displayed is
 * an attachment of the note and not the note itself.
 */
function AttachmentTitleRow({ className, attachmentId, start }: {
    className: string;
    attachmentId: string;
    start?: ComponentChildren;
}) {
    const [ title, setTitle ] = useState<string>();

    function refresh() {
        froca.getAttachment(attachmentId).then(attachment => setTitle(attachment?.title));
    }

    useEffect(refresh, [ attachmentId ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttachmentRows().some(row => row.attachmentId === attachmentId)) {
            refresh();
        }
    });

    return (
        <div className={clsx(className, "attachment-title-row")}>
            {start}
            <Icon icon="bx bx-paperclip" />
            <span className="attachment-title">{t("popup-editor.attachment_title", { title })}</span>
        </div>
    );
}
