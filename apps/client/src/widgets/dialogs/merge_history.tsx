import "./merge_history.css";

import { dayjs } from "@triliumnext/commons";
import { useEffect, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import { undoMerge } from "../../services/note_merge";
import server from "../../services/server";
import toast from "../../services/toast";
import Button from "../react/Button";
import { useTriliumEvent } from "../react/hooks";
import Modal from "../react/Modal";
import NoItems from "../react/NoItems";

interface MergeHistoryEntry {
    id: string;
    utcDate: string;
    sourceTitle: string;
    sourceNoteId: string;
    undoable: boolean;
}

/** Lists the merges that can still be undone on one note, newest first. */
export default function MergeHistoryDialog() {
    const [ shown, setShown ] = useState(false);
    const [ noteId, setNoteId ] = useState<string>();
    const [ entries, setEntries ] = useState<MergeHistoryEntry[] | null>(null);
    const [ generation, setGeneration ] = useState(0);

    useTriliumEvent("showMergeHistory", ({ noteId: openedNoteId }) => {
        setNoteId(openedNoteId);
        setEntries(null);
        setShown(true);
        setGeneration((value) => value + 1);
    });

    useEffect(() => {
        if (!shown || !noteId) {
            return;
        }
        const requestedNoteId = noteId;
        let cancelled = false;
        void server.get<{ entries: MergeHistoryEntry[] }>(`notes/${requestedNoteId}/merge-history`)
            .then((result) => {
                if (!cancelled) {
                    setEntries(result.entries);
                }
            })
            .catch(() => {
                // The request already toasted the server's reason.
                if (!cancelled) {
                    setEntries([]);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [ shown, noteId, generation ]);

    async function onUndo(entryId: string) {
        if (!noteId) {
            return;
        }
        await undoMerge(noteId, entryId);
        setGeneration((value) => value + 1);
    }

    async function onForget(entryId: string) {
        if (!noteId) {
            return;
        }
        try {
            await server.post(`notes/${noteId}/merge-history/forget`, { entryId });
        } catch {
            // The request already toasted the server's reason.
            return;
        }
        toast.showMessage(t("merge_history.forgotten"));
        setGeneration((value) => value + 1);
    }

    return (
        <Modal
            className="merge-history-dialog"
            title={t("merge_history.title")}
            size="lg"
            scrollable
            helpPageId="JIRlDJpCFD6E"
            show={shown}
            onHidden={() => setShown(false)}
        >
            <p className="merge-history-intro">{t("merge_history.intro")}</p>
            {entries?.length === 0 && (
                <NoItems icon="bx bx-history" text={t("merge_history.empty")} />
            )}
            {entries && entries.length > 0 && (
                <ul className="merge-history">
                    {entries.map((entry) => (
                        <li key={entry.id} className="merge-history-row">
                            <div className="merge-history-summary">
                                <span className="merge-history-when">
                                    {dayjs(entry.utcDate).format("MMM D, YYYY HH:mm")}
                                </span>
                                <span className="merge-history-what">
                                    {t("merge_history.merged", { title: entry.sourceTitle })}
                                </span>
                            </div>
                            <div className="merge-history-actions">
                                {entry.undoable && (
                                    <Button
                                        text={t("merge_notes.undo")}
                                        icon="bx-undo"
                                        size="small"
                                        kind="primary"
                                        onClick={() => void onUndo(entry.id)}
                                    />
                                )}
                                <Button
                                    text={t("merge_history.forget")}
                                    size="small"
                                    onClick={() => void onForget(entry.id)}
                                />
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </Modal>
    );
}
