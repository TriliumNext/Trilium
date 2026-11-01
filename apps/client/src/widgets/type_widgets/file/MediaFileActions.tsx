import { useState } from "preact/hooks";

import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import openService from "../../../services/open";
import ActionButton from "../../react/ActionButton";

/**
 * Download and Open-externally, as two buttons the player carries at the end of its controls. The content
 * renderer otherwise appends these below the player as a `.file-footer`, which an embed has no room for
 * (see {@link showsFileActions}).
 */
export default function MediaFileActions({ entity }: { entity: FNote | FAttachment }) {
    const [ opening, setOpening ] = useState(false);

    const download = () => {
        // The parent component is only there to divert PDFs and the backend log into their own download
        // handling; media never takes that path, so it downloads straight from the URL.
        if ("noteId" in entity) {
            openService.downloadFileNote(entity, null, null);
        } else {
            openService.downloadAttachment(entity.attachmentId);
        }
    };

    const openExternally = async () => {
        setOpening(true);
        try {
            if ("noteId" in entity) {
                await openService.openNoteExternally(entity.noteId, entity.mime);
            } else {
                await openService.openAttachmentExternally(entity.attachmentId, entity.mime);
            }
        } finally {
            setOpening(false);
        }
    };

    return (
        <>
            <ActionButton icon="bx bx-download" text={t("file_properties.download")} onClick={download} />
            {/* Opening goes through the browser, which is not in the protected session. */}
            {!entity.isProtected && (
                <ActionButton
                    icon={opening ? "bx bx-loader spin" : "bx bx-link-external"}
                    text={t("file_properties.open")}
                    onClick={() => void openExternally()}
                />
            )}
        </>
    );
}
