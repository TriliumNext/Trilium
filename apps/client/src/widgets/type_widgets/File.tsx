import { VNode } from "preact";
import { useNoteBlob } from "../react/hooks";
import "./File.css";
import { TypeWidgetProps } from "./type_widget";
import FNote from "../../entities/fnote";
import { getUrlForDownload } from "../../services/open";
import Alert from "../react/Alert";
import { t } from "../../services/i18n";

const TEXT_MAX_NUM_CHARS = 5000;

export default function File({ note }: TypeWidgetProps) {
    const blob = useNoteBlob(note);

    if (blob?.content) {
        return <TextPreview content={blob.content} />
    } else if (note.mime === "application/pdf") {
        return <PdfPreview note={note} />
    } else if (note.mime.startsWith("video/")) {
        return <VideoPreview note={note} />
    } else if (note.mime.startsWith("audio/")) {
        return <AudioPreview note={note} />
    } else {
        return <NoPreview />
    }
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
    )
}

function PdfPreview({ note }: { note: FNote }) {
    return (
        <iframe
            class="pdf-preview"
            src={getUrlForDownload(`api/notes/${note.noteId}/open`)} />
    );
}

function VideoPreview({ note }: { note: FNote }) {
    return (
        <video
            class="video-preview"
            src={getUrlForDownload(`api/notes/${note.noteId}/open-partial`)}
            datatype={note?.mime}
            controls
        />
    )
}

function AudioPreview({ note }: { note: FNote }) {
    return (
        <audio
            class="audio-preview"
            src={getUrlForDownload(`api/notes/${note.noteId}/open-partial`)}
            controls
        />
    )
}

function NoPreview() {
    return (
        <Alert className="file-preview-not-available" type="info">
            {t("file.file_preview_not_available")}
        </Alert>
    );
}
