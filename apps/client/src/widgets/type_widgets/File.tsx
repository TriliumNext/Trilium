import "./File.css";

import { t } from "../../services/i18n";
import Alert from "../react/Alert";
import { useNoteBlob } from "../react/hooks";
import AudioPreview from "./file/Audio";
import PdfPreview from "./file/Pdf";
import VideoPreview from "./file/Video";
import { TypeWidgetProps } from "./type_widget";

const TEXT_MAX_NUM_CHARS = 5000;

export default function FileTypeWidget({ note, parentComponent, noteContext }: TypeWidgetProps) {
    const blob = useNoteBlob(note, parentComponent?.componentId);

    if (blob?.content) {
        return <TextPreview content={blob.content} />;
    } else if (note.mime === "application/pdf") {
        return noteContext && <PdfPreview blob={blob} note={note} componentId={parentComponent?.componentId} noteContext={noteContext} />;
    } else if (note.mime.startsWith("video/")) {
        return <VideoPreview note={note} />;
    } else if (note.mime.startsWith("audio/")) {
        return <AudioPreview note={note} />;
    }
    return <NoPreview />;

}

function TextPreview({ content }: { content: string }) {
    const trimmedContent = content.substring(0, TEXT_MAX_NUM_CHARS);
    const isTooLarge = trimmedContent.length !== content.length;

    return (
        <>
            {isTooLarge && (
                <Alert type="info">
                    {t("file.too_big", { maxNumChars: TEXT_MAX_NUM_CHARS })}
                </Alert>
            )}
            <pre class="file-preview-content">{trimmedContent}</pre>
        </>
    );
}

function NoPreview() {
    return (
        <Alert className="file-preview-not-available" type="info">
            {t("file.file_preview_not_available")}
        </Alert>
    );
}
