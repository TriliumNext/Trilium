import { Dispatch, StateUpdater, useEffect, useState } from "preact/hooks";
import appContext from "../../components/app_context";
import dialog from "../../services/dialog";
import { t } from "../../services/i18n";
import server from "../../services/server";
import toast from "../../services/toast";
import Button from "../react/Button";
import Modal from "../react/Modal";
import hoisted_note from "../../services/hoisted_note";
import type { RecentChangeRow } from "@triliumnext/commons";
import froca from "../../services/froca";
import { formatDateTime } from "../../utils/formatters";
import link from "../../services/link";
import RawHtml from "../react/RawHtml";
import ws from "../../services/ws";
import { useTriliumEvent } from "../react/hooks";

export default function RecentChangesDialog() {
    const [ ancestorNoteId, setAncestorNoteId ] = useState<string>();
    const [ groupedByDate, setGroupedByDate ] = useState<Map<string, RecentChangeRow[]>>();
    const [ refreshCounter, setRefreshCounter ] = useState(0);
    const [ shown, setShown ] = useState(false);

    useTriliumEvent("showRecentChanges", ({ ancestorNoteId }) => {
        setAncestorNoteId(ancestorNoteId ?? hoisted_note.getHoistedNoteId());
        setShown(true);
    });

    useEffect(() => {
        server.get<RecentChangeRow[]>(`recent-changes/${ancestorNoteId}`)
            .then(async (recentChanges) => {
                // preload all notes into cache
                await froca.getNotes(
                    recentChanges.map((r) => r.noteId),
                    true
                );

                const groupedByDate = groupByDate(recentChanges);
                setGroupedByDate(groupedByDate);
            });
    }, [ shown, refreshCounter ])

    return (
        <Modal
            title={t("recent_changes.title")}
            className="recent-changes-dialog"
            size="lg"
            scrollable
            header={
                <Button
                    text={t("recent_changes.erase_notes_button")}
                    size="small"
                    style={{ padding: "0 10px" }}
                    onClick={() => {
                        server.post("notes/erase-deleted-notes-now").then(() => {
                            setRefreshCounter(refreshCounter + 1);
                            toast.showMessage(t("recent_changes.deleted_notes_message"));
                        });
                    }}
                />
            }
            onHidden={() => setShown(false)}
            show={shown}
        >
            <div className="recent-changes-content">
                {groupedByDate?.size
                    ? <RecentChangesTimeline groupedByDate={groupedByDate} setShown={setShown} />
                    : <>{t("recent_changes.no_changes_message")}</>}
            </div>
        </Modal>
    )
}

function RecentChangesTimeline({ groupedByDate, setShown }: { groupedByDate: Map<string, RecentChangeRow[]>, setShown: Dispatch<StateUpdater<boolean>> }) {
    return (
        <>
            { Array.from(groupedByDate.entries()).map(([dateDay, dayChanges]) => {
                const formattedDate = formatDateTime(dateDay as string, "full", "none");

                return (
                    <div>
                        <b>{formattedDate}</b>

                        <ul>
                            { dayChanges.map((change) => {
                                const isDeleted = change.current_isDeleted;
                                const formattedTime = formatDateTime(change.date, "none", "short");
                                const note = froca.getNoteFromCache(change.noteId);
                                const notePath = note?.getBestNotePathString();

                                return (
                                    <li className={isDeleted ? "deleted-note" : ""}>
                                        <span title={change.date}>{formattedTime}</span>
                                        { notePath && !isDeleted
                                        ? <NoteLink notePath={notePath} title={change.current_title} />
                                        : <DeletedNoteLink change={change} setShown={setShown} /> }
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                );
            })}
        </>
    );
}

function NoteLink({ notePath, title }: { notePath: string, title: string }) {
    const [ noteLink, setNoteLink ] = useState<JQuery<HTMLElement> | null>(null);
    useEffect(() => {
        link.createLink(notePath, {
            title,
            showNotePath: true
        }).then(setNoteLink);
    }, [notePath, title]);
    return (
        noteLink ? <RawHtml className="note-title" html={noteLink[0].innerHTML} /> : <span className="note-title">{title}</span>
    );
}

function DeletedNoteLink({ change, setShown }: { change: RecentChangeRow, setShown: Dispatch<StateUpdater<boolean>> }) {
    return (
        <>
            <span className="note-title">{change.current_title}</span>
            &nbsp;
            (<a href="javascript:"
                onClick={async () => {
                    const text = t("recent_changes.confirm_undelete");

                    if (await dialog.confirm(text)) {
                        await server.put(`notes/${change.noteId}/undelete`);
                        setShown(false);
                        await ws.waitForMaxKnownEntityChangeId();

                        const activeContext = appContext.tabManager.getActiveContext();
                        if (activeContext) {
                            activeContext.setNote(change.noteId);
                        }
                    }
                }}>
                {t("recent_changes.undelete_link")})
            </a>
        </>
    );
}

function groupByDate(rows: RecentChangeRow[]) {
    const groupedByDate = new Map<string, RecentChangeRow[]>();

    for (const row of rows) {
        const dateDay = row.date.substr(0, 10);

        let dateDayArray = groupedByDate.get(dateDay);
        if (!dateDayArray) {
            dateDayArray = [];
            groupedByDate.set(dateDay, dateDayArray);
        }

        dateDayArray.push(row);
    }

    return groupedByDate;
}
