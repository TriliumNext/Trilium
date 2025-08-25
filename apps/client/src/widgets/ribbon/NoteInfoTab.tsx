import { useEffect, useState } from "preact/hooks";
import { t } from "../../services/i18n";
import { TabContext } from "./ribbon-interface";
import { MetadataResponse, NoteSizeResponse, SubtreeSizeResponse } from "@triliumnext/commons";
import server from "../../services/server";
import Button from "../react/Button";
import { formatDateTime } from "../../utils/formatters";
import { formatSize } from "../../services/utils";
import LoadingSpinner from "../react/LoadingSpinner";
import { useTriliumEvent } from "../react/hooks";

export default function NoteInfoTab({ note }: TabContext) {
    const [ metadata, setMetadata ] = useState<MetadataResponse>();
    const [ isLoading, setIsLoading ] = useState(false);
    const [ noteSizeResponse, setNoteSizeResponse ] = useState<NoteSizeResponse>();
    const [ subtreeSizeResponse, setSubtreeSizeResponse ] = useState<SubtreeSizeResponse>();

    function refresh() {
        if (note) {
            server.get<MetadataResponse>(`notes/${note?.noteId}/metadata`).then(setMetadata);
        }

        setNoteSizeResponse(undefined);
        setSubtreeSizeResponse(undefined);
        setIsLoading(false);
    }

    useEffect(refresh, [ note?.noteId ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const noteId = note?.noteId;
        if (noteId && (loadResults.isNoteReloaded(noteId) || loadResults.isNoteContentReloaded(noteId))) {
            refresh();
        }
    });

    return (
        <div className="note-info-widget">
            {note && (
                <table className="note-info-widget-table">
                    <tr>
                        <th>{t("note_info_widget.note_id")}:</th>
                        <td>{note.noteId}</td>
                        <th>{t("note_info_widget.created")}:</th>
                        <td>{formatDateTime(metadata?.dateCreated)}</td>
                        <th>{t("note_info_widget.modified")}:</th>
                        <td>{formatDateTime(metadata?.dateModified)}</td>
                    </tr>

                    <tr>
                        <th>{t("note_info_widget.type")}:</th>
                        <td>
                            <span class="note-info-type">{note.type}</span>{' '}
                            { note.mime && <span class="note-info-mime">({note.mime})</span> }
                        </td>

                        <th title={t("note_info_widget.note_size_info")}>{t("note_info_widget.note_size")}:</th>
                        <td colSpan={3}>
                            {!isLoading && !noteSizeResponse && !subtreeSizeResponse && (
                                <Button
                                    className="calculate-button"
                                    style={{ padding: "0px 10px 0px 10px" }}
                                    icon="bx bx-calculator"
                                    text={t("note_info_widget.calculate")}
                                    onClick={() => {
                                        setIsLoading(true);
                                        setTimeout(async () => {                      
                                            await Promise.allSettled([
                                                server.get<NoteSizeResponse>(`stats/note-size/${note.noteId}`).then(setNoteSizeResponse),
                                                server.get<SubtreeSizeResponse>(`stats/subtree-size/${note.noteId}`).then(setSubtreeSizeResponse)
                                            ]);  
                                            setIsLoading(false);
                                        }, 0);
                                    }}
                                />
                            )}

                            <span className="note-sizes-wrapper">
                                <span class="note-size">{formatSize(noteSizeResponse?.noteSize)}</span>
                                {" "}
                                {subtreeSizeResponse && subtreeSizeResponse.subTreeNoteCount > 1 &&
                                    <span class="subtree-size">{t("note_info_widget.subtree_size", { size: formatSize(subtreeSizeResponse.subTreeSize), count: subtreeSizeResponse.subTreeNoteCount })}</span>
                                }
                                {isLoading && <LoadingSpinner />}
                            </span>
                        </td>
                    </tr>
                </table>
            )}            
        </div>
    )
}