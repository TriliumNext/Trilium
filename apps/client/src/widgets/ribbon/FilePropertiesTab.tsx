import { useContext } from "preact/hooks";

import FNote from "../../entities/fnote";
import { t } from "../../services/i18n";
import { downloadFileNote, openNoteExternally } from "../../services/open";
import protected_session_holder from "../../services/protected_session_holder";
import server from "../../services/server";
import toast from "../../services/toast";
import { formatSize } from "../../services/utils";
import Button from "../react/Button";
import { FormFileUploadButton } from "../react/FormFileUpload";
import { useNoteBlob, useNoteLabel } from "../react/hooks";
import { ParentComponent } from "../react/react_utils";
import { TabContext } from "./ribbon-interface";

export default function FilePropertiesTab({ note, ntxId }: Pick<TabContext, "note" | "ntxId">) {
    const [ originalFileName ] = useNoteLabel(note, "originalFileName");
    const canAccessProtectedNote = !note?.isProtected || protected_session_holder.isProtectedSessionAvailable();
    const blob = useNoteBlob(note);
    const parentComponent = useContext(ParentComponent);

    return (
        <div className="file-properties-widget">
            {note && (
                <table className="file-table">
                    <tbody>
                        <tr>
                            <th className="text-nowrap">{t("file_properties.note_id")}:</th>
                            <td className="file-note-id selectable-text">{note.noteId}</td>
                            <th className="text-nowrap">{t("file_properties.original_file_name")}:</th>
                            <td className="file-filename selectable-text">{originalFileName ?? "?"}</td>
                        </tr>
                        <tr>
                            <th className="text-nowrap">{t("file_properties.file_type")}:</th>
                            <td className="file-filetype selectable-text">{note.mime}</td>
                            <th className="text-nowrap">{t("file_properties.file_size")}:</th>
                            <td className="file-filesize selectable-text">{formatSize(blob?.contentLength ?? 0)}</td>
                        </tr>

                        <tr>
                            <td colSpan={4}>
                                <div className="file-buttons">
                                    <Button
                                        icon="bx bx-download"
                                        text={t("file_properties.download")}
                                        primary
                                        disabled={!canAccessProtectedNote}
                                        onClick={() => downloadFileNote(note, parentComponent, ntxId)}
                                    />

                                    <Button
                                        icon="bx bx-link-external"
                                        text={t("file_properties.open")}
                                        disabled={note.isProtected}
                                        onClick={() => openNoteExternally(note.noteId, note.mime)}
                                    />

                                    <FormFileUploadButton
                                        icon="bx bx-folder-open"
                                        text={t("file_properties.upload_new_revision")}
                                        disabled={!canAccessProtectedNote}
                                        onChange={buildUploadNewFileRevisionListener(note)}
                                    />
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            )}
        </div>
    );
}

export function buildUploadNewFileRevisionListener(note: FNote) {
    return (fileToUpload: FileList | null) => {
        if (!fileToUpload) {
            return;
        }

        server.upload(`notes/${note.noteId}/file`, fileToUpload[0]).then((result) => {
            if (result.uploaded) {
                toast.showMessage(t("file_properties.upload_success"));
            } else {
                toast.showError(t("file_properties.upload_failed"));
            }
        });
    };
}
