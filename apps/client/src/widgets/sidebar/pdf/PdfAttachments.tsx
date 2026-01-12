import "./PdfAttachments.css";

import { t } from "../../../services/i18n";
import { formatSize } from "../../../services/utils";
import { useActiveNoteContext, useGetContextData, useNoteProperty } from "../../react/hooks";
import Icon from "../../react/Icon";
import RightPanelWidget from "../RightPanelWidget";

interface AttachmentInfo {
    filename: string;
    size: number;
}

export default function PdfAttachments() {
    const { note } = useActiveNoteContext();
    const noteType = useNoteProperty(note, "type");
    const noteMime = useNoteProperty(note, "mime");
    const attachmentsData = useGetContextData("pdfAttachments");

    if (noteType !== "file" || noteMime !== "application/pdf") {
        return null;
    }

    if (!attachmentsData || attachmentsData.attachments.length === 0) {
        return null;
    }

    return (
        <RightPanelWidget id="pdf-attachments" title={t("pdf.attachments", { count: attachmentsData.attachments.length })}>
            <div className="pdf-attachments-list">
                {attachmentsData.attachments.map((attachment) => (
                    <PdfAttachmentItem
                        key={attachment.filename}
                        attachment={attachment}
                        onDownload={attachmentsData.downloadAttachment}
                    />
                ))}
            </div>
        </RightPanelWidget>
    );
}

function PdfAttachmentItem({
    attachment,
    onDownload
}: {
    attachment: AttachmentInfo;
    onDownload: (filename: string) => void;
}) {
    const sizeText = formatSize(attachment.size);

    return (
        <div className="pdf-attachment-item" onClick={() => onDownload(attachment.filename)}>
            <Icon icon="bx bx-paperclip" />
            <div className="pdf-attachment-info">
                <div className="pdf-attachment-filename">{attachment.filename}</div>
                <div className="pdf-attachment-size">{sizeText}</div>
            </div>
            <Icon icon="bx bx-download" />
        </div>
    );
}
