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
                <>
                    <div className="note-info-item">
                        <span>{t("note_info_widget.note_id")}:</span>
                        <span className="note-info-id selectable-text">{note.noteId}</span>
                    </div>
                    <div className="note-info-item">
                        <span>{t("note_info_widget.created")}:</span>
                        <span className="selectable-text">{formatDateTime(metadata?.dateCreated)}</span>
                    </div>
                    <div className="note-info-item">
                        <span>{t("note_info_widget.modified")}:</span>
                        <span className="selectable-text">{formatDateTime(metadata?.dateModified)}</span>
                    </div>
                    <div className="note-info-item">
                        <span>{t("note_info_widget.type")}:</span>
                        <span>
                            <span className="note-info-type">{note.type}</span>{' '}
                            {note.mime && <span className="note-info-mime selectable-text">({note.mime})</span>}
                        </span>
                    </div>
                    <div className="note-info-item">
                        <span title={t("note_info_widget.note_size_info")}>{t("note_info_widget.note_size")}:</span>
                        <span className="note-info-size-col-span">
                            {!isLoading && !noteSizeResponse && !subtreeSizeResponse && (
                                <Button
                                    className="calculate-button"
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

                            <span className="note-sizes-wrapper selectable-text">
                                <span className="note-size">{formatSize(noteSizeResponse?.noteSize)}</span>
                                {" "}
                                {subtreeSizeResponse && subtreeSizeResponse.subTreeNoteCount > 1 &&
                                    <span className="subtree-size">{t("note_info_widget.subtree_size", { size: formatSize(subtreeSizeResponse.subTreeSize), count: subtreeSizeResponse.subTreeNoteCount })}</span>
                                }
                                {isLoading && <LoadingSpinner />}
                            </span>
                        </span>
                    </div>
                </>
            )}
        </div>
    )
}
