import "./File.css";

import { isOfficeMimeType } from "@triliumnext/commons";

import { GPX_MIME } from "../../services/gpx";
import { t } from "../../services/i18n";
import Alert from "../react/Alert";
import CodeBlock from "../react/CodeBlock";
import { useNoteBlob } from "../react/hooks";
import GpxPreview from "./file/GpxPreview";
import MediaPreview from "./file/MediaPreview";
import OfficePreview from "./file/Office";
import PdfPreview from "./file/Pdf";
import { TypeWidgetProps } from "./type_widget";

const TEXT_MAX_NUM_CHARS = 5000;

export default function FileTypeWidget({ note, parentComponent, noteContext, isVisible }: TypeWidgetProps) {
    // Office previews are server-rendered, so don't fetch the blob for them — it would
    // download the document a second time without being used.
    const isOffice = isOfficeMimeType(note.mime);
    const blob = useNoteBlob(isOffice ? null : note, parentComponent?.componentId);

    // Office formats are checked first: RTF can arrive as text/rtf (string content), which
    // would otherwise be caught by the blob.content branch below and shown as raw markup.
    if (isOffice) {
        return <OfficePreview note={note} />;
    } else if (note.mime === GPX_MIME) {
        return <GpxPreview note={note} blob={blob} />;
    } else if (blob?.content) {
        return <TextPreview content={blob.content} mime={note.mime} />;
    } else if (note.mime === "application/pdf") {
        return noteContext && <PdfPreview blob={blob} note={note} componentId={parentComponent?.componentId} noteContext={noteContext} />;
    } else if (note.mime.startsWith("video/") || note.mime.startsWith("audio/")) {
        return <MediaPreview entity={note} environment="standalone" noteContext={noteContext} isVisible={isVisible} />;
    }
    return <NoPreview />;

}

export function TextPreview({ content, mime }: { content: string, mime?: string }) {
    const trimmedContent = content.substring(0, TEXT_MAX_NUM_CHARS);
    const isTooLarge = trimmedContent.length !== content.length;

    return (
        <>
            {isTooLarge && (
                <Alert type="info">
                    {t("file.too_big", { maxNumChars: TEXT_MAX_NUM_CHARS })}
                </Alert>
            )}
            {/* The copy button is dropped for a truncated preview — it could only copy the visible
                5000 characters, which reads as copying the whole file. */}
            <CodeBlock
                className="file-preview-content"
                code={trimmedContent}
                mimeType={resolveHighlightMime(mime)}
                copyable={!isTooLarge}
            />
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

/**
 * Resolves a MIME type to one the highlighter has a grammar for. Concrete types carrying an
 * RFC 6839 structured-syntax suffix (e.g. `application/inkml+xml`, OneNote's ink debug source)
 * are unknown to the registry as such, but highlight fine as their base syntax.
 */
function resolveHighlightMime(mime: string | undefined): string | undefined {
    if (mime?.endsWith("+xml")) {
        return "text/xml";
    }
    if (mime?.endsWith("+json")) {
        return "application/json";
    }
    return mime;
}
