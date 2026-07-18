import { Dispatch, StateUpdater, useEffect, useState } from "preact/hooks";
import appContext from "../../components/app_context";
import type FNote from "../../entities/fnote";
import dateNoteService from "../../services/date_notes";
import dialog from "../../services/dialog";
import { t } from "../../services/i18n";
import server from "../../services/server";
import toast from "../../services/toast";
import Dropdown from "../react/Dropdown";
import { FormDropdownDivider, FormListItem } from "../react/FormList";
import Modal from "../react/Modal";
import NoItems from "../react/NoItems";
import hoisted_note from "../../services/hoisted_note";
import type { RecentChangeRow } from "@triliumnext/commons";
import froca from "../../services/froca";
import { formatDateTime, formatDuration } from "../../utils/formatters";
import link from "../../services/link";
import RawHtml from "../react/RawHtml";
import ws from "../../services/ws";
import { useTriliumEvent, useTriliumOptionInt } from "../react/hooks";

export default function RecentChangesDialog() {
    const [ ancestorNoteId, setAncestorNoteId ] = useState<string>();
    const [ groupedByDate, setGroupedByDate ] = useState<Map<string, RecentChangeRow[]>>();
    const [ refreshCounter, setRefreshCounter ] = useState(0);
    const [ shown, setShown ] = useState(false);
    const [ deletedOnly, setDeletedOnly ] = useState(false);
    const [ ancestorTitle, setAncestorTitle ] = useState<string>();
    const [ eraseAfterSeconds ] = useTriliumOptionInt("eraseEntitiesAfterTimeInSeconds");
    const [ eraseTimeScale ] = useTriliumOptionInt("eraseEntitiesAfterTimeScale");

    useTriliumEvent("showRecentChanges", ({ ancestorNoteId }) => {
        setAncestorNoteId(ancestorNoteId ?? hoisted_note.getHoistedNoteId());
        setDeletedOnly(false);
        setShown(true);
    });

    useTriliumEvent("showDeletedNotes", ({ ancestorNoteId }) => {
        setAncestorNoteId(ancestorNoteId ?? hoisted_note.getHoistedNoteId());
        setDeletedOnly(true);
        setShown(true);
    });

    useEffect(() => {
        // A scoped view (a hoisted note, or a subtree opened from the tree context menu) should say
        // which subtree it covers. Root is the implicit default and needs no qualifier.
        if (!ancestorNoteId || ancestorNoteId === "root") {
            setAncestorTitle(undefined);
            return;
        }

        // Reopening the dialog for another subtree while this lookup is in flight would otherwise let
        // the stale title win, so ignore a resolution that arrives after the ancestor changed.
        let active = true;

        froca.getNote(ancestorNoteId, true).then((note) => {
            if (active) {
                setAncestorTitle(note?.title);
            }
        });

        return () => {
            active = false;
        };
    }, [ ancestorNoteId ]);

    // `ancestorNoteId` is a dependency: the dialog can already be open when it is re-triggered for a
    // different subtree (e.g. from the tree context menu), and without it the list would keep showing
    // the previous ancestor's results under the newly updated heading.
    useEffect(() => {
        if (!ancestorNoteId) return;
        server.get<RecentChangeRow[]>(`recent-changes/${ancestorNoteId}?deletedOnly=${deletedOnly}`)
            .then(async (recentChanges) => {
                // preload all notes into cache
                await froca.getNotes(
                    recentChanges.map((r) => r.noteId),
                    true
                );

                const groupedByDate = groupByDate(recentChanges);
                setGroupedByDate(groupedByDate);
            });
    }, [ shown, refreshCounter, deletedOnly, ancestorNoteId ])

    const baseTitle = deletedOnly ? t("recent_changes.deleted_notes_title") : t("recent_changes.title");
    // Null until the options have loaded, in which case the retention hint is omitted rather than
    // stating an unknown window.
    const erasePeriod = formatDuration(eraseAfterSeconds, eraseTimeScale);

    return (
        <Modal
            title={ancestorTitle
                ? t("recent_changes.title_with_ancestor", { title: baseTitle, ancestorTitle })
                : baseTitle}
            className={`recent-changes-dialog ${deletedOnly ? "recent-changes-dialog-view-mode-deleted-only" : "recent-changes-dialog-view-mode-all-changes"}`}
            size="lg"
            scrollable
            header={
                <Dropdown
                    className="recent-changes-actions"
                    buttonClassName="custom-title-bar-button bx bx-dots-horizontal-rounded"
                    title={t("recent_changes.more_actions")}
                    hideToggleArrow
                    noSelectButtonStyle
                >
                    <FormListItem
                        icon="bx bx-trash"
                        onClick={() => {
                            server.post("notes/erase-deleted-notes-now").then(() => {
                                setRefreshCounter(refreshCounter + 1);
                                toast.showMessage(t("recent_changes.deleted_notes_message"));
                            });
                        }}
                    >{t("recent_changes.erase_notes_button")}</FormListItem>
                    {deletedOnly && <>
                        <FormDropdownDivider />
                        <FormListItem
                            icon="bx bx-cog"
                            onClick={() => void appContext.triggerCommand("showOptions", { section: "_optionsOther" })}
                        >{t("recent_changes.deleted_notes_settings")}</FormListItem>
                    </>}
                </Dropdown>
            }
            onHidden={() => setShown(false)}
            show={shown}
        >
            <div className="recent-changes-content">
                {groupedByDate?.size
                    ? <RecentChangesTimeline groupedByDate={groupedByDate} setShown={setShown} />
                    : deletedOnly
                        ? <NoItems icon="bx bx-trash-alt" text={t("recent_changes.no_deleted_notes_message")}>
                            {erasePeriod && <small>{t("recent_changes.no_deleted_notes_erasure_hint", { duration: erasePeriod })}</small>}
                        </NoItems>
                        : <NoItems icon="bx bx-history" text={t("recent_changes.no_changes_message")} />}
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
            {/* `data-href` (not `href`, so it stays non-navigable) carries the note id to the global
                tooltip; the trailing `?` marks it as a note link rather than an in-page anchor.
                `data-note-deleted` tells the tooltip to resolve it via the deleted-content route. */}
            <span className="note-title" data-href={`#${change.noteId}?`} data-note-deleted>{change.current_title}</span>
            &nbsp;
            (<a href="javascript:" onClick={() => undeleteNote(change, setShown)}>{t("recent_changes.undelete_link")}</a>)
        </>
    );
}

/**
 * Restores a deleted note. When its original parent is gone (deleted or erased) there is no location
 * to put it back into, so — after telling the user — the note is restored into the default new-note
 * location (the inbox) instead. On success the dialog closes and the restored note is opened.
 */
async function undeleteNote(change: RecentChangeRow, setShown: Dispatch<StateUpdater<boolean>>) {
    const hasOriginalLocation = !!change.canBeUndeleted;

    const confirmed = await dialog.confirm(hasOriginalLocation
        ? t("recent_changes.confirm_undelete")
        : t("recent_changes.confirm_undelete_to_default_location"));

    if (!confirmed) {
        return;
    }

    let fallbackParent: FNote | null = null;

    if (!hasOriginalLocation) {
        fallbackParent = await dateNoteService.getInboxNote();

        if (!fallbackParent) {
            toast.showError(t("recent_changes.undelete_failed"));
            return;
        }
    }

    // The note may still fail to restore if it was erased since the dialog opened, so act on the reported result.
    const { undeleted, restoredToFallbackParent } = await server.put<UndeleteResponse>(
        `notes/${change.noteId}/undelete`,
        { fallbackParentNoteId: fallbackParent?.noteId }
    );

    if (!undeleted) {
        toast.showError(t("recent_changes.undelete_failed"));
        return;
    }

    if (restoredToFallbackParent && fallbackParent) {
        // The note could not go back where it was, so name where it actually landed — the user only
        // saw a prompt about the fallback, never a confirmation of it.
        toast.showMessage(t("recent_changes.undeleted_to_default_location", { title: fallbackParent.title }));
    }

    setShown(false);
    await ws.waitForMaxKnownEntityChangeId();
    appContext.tabManager.getActiveContext()?.setNote(change.noteId);
}

interface UndeleteResponse {
    undeleted: boolean;
    restoredToFallbackParent: boolean;
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
