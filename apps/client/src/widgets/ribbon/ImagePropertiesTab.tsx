import { useContext } from "preact/hooks";

import FNote from "../../entities/fnote";
import { t } from "../../services/i18n";
import { downloadFileNote, openNoteExternally } from "../../services/open";
import server from "../../services/server";
import toast from "../../services/toast";
import { clearBrowserCache, formatSize } from "../../services/utils";
import Button from "../react/Button";
import { FormFileUploadButton } from "../react/FormFileUpload";
import { useNoteBlob, useNoteLabel } from "../react/hooks";
import { ParentComponent } from "../react/react_utils";
import { TabContext } from "./ribbon-interface";

export default function ImagePropertiesTab({ note, ntxId }: TabContext) {
    const [ originalFileName ] = useNoteLabel(note, "originalFileName");
    const blob = useNoteBlob(note);

    const parentComponent = useContext(ParentComponent);

    return (
        <div className="image-properties">
            {note && (
                <>
                    <div style={{ display: "flex", justifyContent: "space-evenly", margin: "10px" }}>
                        <span>
                            <strong>{t("image_properties.original_file_name")}:</strong>{" "}
                            <span className="selectable-text">{originalFileName ?? "?"}</span>
                        </span>

                        <span>
                            <strong>{t("image_properties.file_type")}:</strong>{" "}
                            <span className="selectable-text">{note.mime}</span>
                        </span>

                        <span>
                            <strong>{t("image_properties.file_size")}:</strong>{" "}
                            <span className="selectable-text">{formatSize(blob?.contentLength)}</span>
                        </span>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-evenly", margin: "10px" }}>
                        <Button
                            text={t("image_properties.download")}
                            icon="bx bx-download"
                            primary
                            onClick={() => downloadFileNote(note, parentComponent, ntxId)}
                        />

                        <Button
                            text={t("image_properties.open")}
                            icon="bx bx-link-external"
                            onClick={() => openNoteExternally(note.noteId, note.mime)}
                        />

                        <Button
                            text={t("image_properties.copy_reference_to_clipboard")}
                            icon="bx bx-copy"
                            onClick={() => parentComponent?.triggerEvent("copyImageReferenceToClipboard", { ntxId })}
                        />

                        <FormFileUploadButton
                            text={t("image_properties.upload_new_revision")}
                            icon="bx bx-folder-open"
                            onChange={buildUploadNewImageRevisionListener(note)}
                        />
                    </div>
                </>
            )}
        </div>
    );
}

export function buildUploadNewImageRevisionListener(note: FNote) {
    return async (files: FileList | null) => {
        if (!files) return;
        const fileToUpload = files[0]; // copy to allow reset below

        const result = await server.upload(`images/${note.noteId}`, fileToUpload);

        if (result.uploaded) {
            toast.showMessage(t("image_properties.upload_success"));
            await clearBrowserCache();
        } else {
            toast.showError(t("image_properties.upload_failed", { message: result.message }));
        }
    };
}
