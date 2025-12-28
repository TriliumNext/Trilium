import { useEffect, useMemo, useState } from "preact/hooks";

import FNote, { NotePathRecord } from "../../entities/fnote";
import { t } from "../../services/i18n";
import { NOTE_PATH_TITLE_SEPARATOR } from "../../services/tree";
import { useTriliumEvent } from "../react/hooks";
import NoteLink from "../react/NoteLink";
import { joinElements } from "../react/react_utils";
import { TabContext } from "./ribbon-interface";
import LinkButton from "../react/LinkButton";
import clsx from "clsx";


export default function NotePathsTab({ note, hoistedNoteId, notePath }: TabContext) {
    const sortedNotePaths = useSortedNotePaths(note, hoistedNoteId);
    return <NotePathsWidget sortedNotePaths={sortedNotePaths} currentNotePath={notePath} />;
}

export function NotePathsWidget({ sortedNotePaths, currentNotePath }: {
    sortedNotePaths: NotePathRecord[] | undefined;
    currentNotePath?: string | null | undefined;
}) {
    return (
        <div class="note-paths-widget">
            <>
                <div className="note-path-intro">
                    {sortedNotePaths?.length ? t("note_paths.intro_placed") : t("note_paths.intro_not_placed")}
                </div>

                <ul className="note-path-list">
                    {sortedNotePaths?.length ? sortedNotePaths.map(sortedNotePath => (
                        <NotePath
                            key={sortedNotePath.notePath}
                            currentNotePath={currentNotePath}
                            notePathRecord={sortedNotePath}
                        />
                    )) : undefined}
                </ul>

                <LinkButton
                    text={t("note_paths.clone_button")}
                    triggerCommand="cloneNoteIdsTo"
                />
            </>
        </div>
    );
}

export function useSortedNotePaths(note: FNote | null | undefined, hoistedNoteId?: string) {
    const [ sortedNotePaths, setSortedNotePaths ] = useState<NotePathRecord[]>();

    function refresh() {
        if (!note) return;
        setSortedNotePaths(note
            .getSortedNotePathRecords(hoistedNoteId)
            .filter((notePath) => !notePath.isHidden));
    }

    useEffect(refresh, [ note, hoistedNoteId ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const noteId = note?.noteId;
        if (!noteId) return;
        if (loadResults.getBranchRows().find((branch) => branch.noteId === noteId)
            || loadResults.isNoteReloaded(noteId)) {
            refresh();
        }
    });

    return sortedNotePaths;
}

function NotePath({ currentNotePath, notePathRecord }: { currentNotePath?: string | null, notePathRecord?: NotePathRecord }) {
    const notePath = notePathRecord?.notePath;
    const notePathString = useMemo(() => (notePath ?? []).join("/"), [ notePath ]);

    const [ classes, icons ] = useMemo(() => {
        const classes: string[] = [];
        const icons: { icon: string, title: string }[] = [];

        if (notePathString === currentNotePath) {
            classes.push("path-current");
        }

        if (!notePathRecord || notePathRecord.isInHoistedSubTree) {
            classes.push("path-in-hoisted-subtree");
        } else {
            icons.push({ icon: "bx bx-trending-up", title: t("note_paths.outside_hoisted") });
        }

        if (notePathRecord?.isArchived) {
            classes.push("path-archived");
            icons.push({ icon: "bx bx-archive", title: t("note_paths.archived") });
        }

        if (notePathRecord?.isSearch) {
            classes.push("path-search");
            icons.push({ icon: "bx bx-search", title: t("note_paths.search") });
        }

        return [ classes.join(" "), icons ];
    }, [ notePathString, currentNotePath, notePathRecord ]);

    // Determine the full note path (for the links) of every component of the current note path.
    const pathSegments: string[] = [];
    const fullNotePaths: string[] = [];
    for (const noteId of notePath ?? []) {
        pathSegments.push(noteId);
        fullNotePaths.push(pathSegments.join("/"));
    }

    return (
        <li class={classes}>
            {joinElements(fullNotePaths.map((notePath, index, arr) => (
                <NoteLink key={notePath}
                          className={clsx({"basename": (index === arr.length - 1)})}
                          notePath={notePath}
                          noPreview />
            )), NOTE_PATH_TITLE_SEPARATOR)}

            {icons.map(({ icon, title }) => (
                <i key={title} class={icon} title={title} />
            ))}
        </li>
    );
}
