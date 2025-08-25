import { t } from "../../services/i18n";
import { formatSize } from "../../services/utils";
import { FormFileUploadButton } from "../react/FormFileUpload";
import { useNoteBlob, useNoteLabel } from "../react/hooks";
import { TabContext } from "./ribbon-interface";
import Button from "../react/Button";
import protected_session_holder from "../../services/protected_session_holder";
import { downloadFileNote, openNoteExternally } from "../../services/open";
import toast from "../../services/toast";
import server from "../../services/server";

export default function FilePropertiesTab({ note }: TabContext) {
    const [ originalFileName ] = useNoteLabel(note, "originalFileName");
    const canAccessProtectedNote = !note?.isProtected || protected_session_holder.isProtectedSessionAvailable();
    const [ blob ] = useNoteBlob(note);    

    return (
        <div className="file-properties-widget">
            {note && (
                <table class="file-table">
                    <tr>
                        <th class="text-nowrap">{t("file_properties.note_id")}:</th>
                        <td class="file-note-id">{note.noteId}</td>
                        <th class="text-nowrap">{t("file_properties.original_file_name")}:</th>
                        <td class="file-filename">{originalFileName ?? "?"}</td>
                    </tr>
                    <tr>
                        <th class="text-nowrap">{t("file_properties.file_type")}:</th>
                        <td class="file-filetype">{note.mime}</td>
                        <th class="text-nowrap">{t("file_properties.file_size")}:</th>
                        <td class="file-filesize">{formatSize(blob?.contentLength ?? 0)}</td>
                    </tr>

                    <tr>
                        <td colSpan={4}>
                            <div class="file-buttons">
                                <Button
                                    icon="bx bx-download"
                                    text={t("file_properties.download")}
                                    primary
                                    disabled={!canAccessProtectedNote}
                                    onClick={() => downloadFileNote(note.noteId)}
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
                                    onChange={(fileToUpload) => {
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
                                    }}
                                />
                            </div>
                        </td>
                    </tr>
                </table>
            )}
        </div>
    );
}