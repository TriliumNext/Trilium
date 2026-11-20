import "./PdfAttachments.css";

import { t } from "../../../services/i18n";
import { formatSize } from "../../../services/utils";
import { useFilterState } from "../../react/filter";
import { useNoteProperty } from "../../react/hooks/note";
import { useActiveNoteContext, useGetContextData } from "../../react/hooks/tree";
import Icon from "../../react/Icon";
import { HighlightedText } from "../../react/RawHtml";
import { OutlineLoading, useOutlineFilter } from "../outline_filter";
import RightPanelWidget from "../RightPanelWidget";

interface AttachmentInfo {
    id: string;
    filename: string;
    size: number;
}

export default function PdfAttachments() {
    const { note } = useActiveNoteContext();
    const noteType = useNoteProperty(note, "type");
    const noteMime = useNoteProperty(note, "mime");
    const attachmentsData = useGetContextData("pdfAttachments");
    const tokens = useFilterState()?.tokens;
    const ready = attachmentsData?.status === "ready" ? attachmentsData : undefined;
    const matches = useOutlineFilter(ready?.attachments ?? null, {
        section: "pdf-attachments",
        getText: (attachment) => attachment.filename
    });

    if (noteType !== "file" || noteMime !== "application/pdf" || !attachmentsData) {
        return null;
    }

    if (!ready) {
        return matches ? (
            <RightPanelWidget id="pdf-attachments" title={t("pdf.attachments_title")}>
                <OutlineLoading />
            </RightPanelWidget>
        ) : null;
    }

    if (ready.attachments.length === 0) {
        return null;
    }

    const shown = matches ? matches.map(({ item }) => item) : ready.attachments;
    return (
        <RightPanelWidget
            id="pdf-attachments"
            title={t("pdf.attachments", { count: ready.attachments.length })}
        >
            <div className="pdf-attachments-list">
                {shown.map((attachment) => (
                    <PdfAttachmentItem
                        key={attachment.id}
                        attachment={attachment}
                        onDownload={ready.downloadAttachment}
                        tokens={tokens}
                    />
                ))}
            </div>
        </RightPanelWidget>
    );
}

function PdfAttachmentItem({
    attachment,
    onDownload,
    tokens
}: {
    attachment: AttachmentInfo;
    onDownload: (id: string) => void;
    tokens?: string[];
}) {
    const sizeText = formatSize(attachment.size);

    return (
        <div className="pdf-attachment-item" onClick={() => onDownload(attachment.id)}>
            <Icon icon="bx bx-paperclip" />
            <div className="pdf-attachment-info">
                <HighlightedText
                    className="pdf-attachment-filename"
                    text={attachment.filename}
                    highlightedTokens={tokens}
                />
                <div className="pdf-attachment-size">{sizeText}</div>
            </div>
            <Icon icon="bx bx-download" />
        </div>
    );
}
