import "./TitleRow.css";

import clsx from "clsx";
import { useEffect, useState } from "preact/hooks";

import { isExperimentalFeatureEnabled } from "../../services/experimental_features";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import NoteIcon from "../note_icon";
import NoteTitleWidget from "../note_title";
import { useNoteContext, useTriliumEvent } from "../react/hooks";
import Icon from "../react/Icon";
import NoteBadges from "./NoteBadges";

const isNewLayout = isExperimentalFeatureEnabled("new-layout");

/**
 * What heads a note shown outside a split of its own: icon, title and badges, each editable in place
 * and each reading the note out of the surrounding note context rather than being handed one.
 *
 * Shared by the quick editor and the geo map's marker pane, so a rename from either saves the same
 * way — through the title widget.
 */
export default function TitleRow({ compact }: {
    /** Standing in a narrow header rather than at the head of a split (see TitleRow.css). */
    compact?: boolean;
} = {}) {
    const { viewScope } = useNoteContext();
    const className = clsx("title-row", compact && "tn-title-row-compact");

    if (viewScope?.attachmentId) {
        return <AttachmentTitleRow className={className} attachmentId={viewScope.attachmentId} />;
    }

    return (
        <div className={className}>
            <NoteIcon />
            <NoteTitleWidget />
            {isNewLayout && <NoteBadges />}
        </div>
    );
}

/**
 * The header shown when an attachment is displayed instead of a note. Attachments are not editable
 * in place, so the title is plain read-only text, prefixed to make clear that what is displayed is
 * an attachment of the note and not the note itself.
 */
function AttachmentTitleRow({ className, attachmentId }: { className: string; attachmentId: string }) {
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
            <Icon icon="bx bx-paperclip" />
            <span className="attachment-title">{t("popup-editor.attachment_title", { title })}</span>
        </div>
    );
}
