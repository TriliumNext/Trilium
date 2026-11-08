import "./NotePaths.css";

import clsx from "clsx";
import { useContext, useEffect, useMemo, useState } from "preact/hooks";

import FNote, { NotePathRecord } from "../../entities/fnote";
import { t } from "../../services/i18n";
import { NOTE_PATH_TITLE_SEPARATOR } from "../../services/tree";
import ActionButton from "../react/ActionButton";
import { useActiveNoteContext, useTriliumEvent } from "../react/hooks";
import LinkButton from "../react/LinkButton";
import NoteLink, { NewNoteLink } from "../react/NoteLink";
import { joinElements, ParentComponent } from "../react/react_utils";
import RightPanelWidget from "./RightPanelWidget";
import SidebarHelp from "./SidebarHelp";

export default function NotePaths() {
    const { note, notePath, hoistedNoteId } = useActiveNoteContext();
    const sortedNotePaths = useSortedNotePaths(note, hoistedNoteId);
    const parentComponent = useContext(ParentComponent);

    return (
        <RightPanelWidget
            id="notePaths"
            title={t("note_paths.title")}
            // Cloning the note is what one does about its paths, so it sits where the card keeps what
            // one does — its header — rather than as a line of its own below the list. The icon is the
            // tree context menu's for the same action.
            buttons={<>
                <SidebarHelp section="notePaths" />
                <ActionButton
                    icon="bx bx-duplicate"
                    text={t("note_paths.clone_button")}
                    onClick={() => void parentComponent?.triggerCommand("cloneNoteIdsTo")}
                />
            </>}
        >
            <NotePathsWidget sortedNotePaths={sortedNotePaths} currentNotePath={notePath} cloneButton={false} />
        </RightPanelWidget>
    );
}

export function NotePathsWidget({ sortedNotePaths, currentNotePath, cloneButton = true }: {
    sortedNotePaths: NotePathRecord[] | undefined;
    currentNotePath?: string | null | undefined;
    /**
     * Offer cloning the note below the list. Turned off by whoever offers it elsewhere — the sidebar's
     * card puts the action in its header, where the widget's own buttons go.
     */
    cloneButton?: boolean;
}) {
    const parentComponent = useContext(ParentComponent);

    return (
        <div class="note-paths-widget">
            <>
                {!sortedNotePaths?.length && <div className="note-path-intro">{t("note_paths.intro_not_placed")}</div>}

                <ul className="note-path-list">
                    {sortedNotePaths?.length ? sortedNotePaths.map(sortedNotePath => (
                        <NotePath
                            // Keyed by the joined path, not the array: `getAllNotePaths()` hands back
                            // fresh arrays on every refresh, so an array key never matches the previous
                            // one and each row would remount — blanking its links until they resolve.
                            key={sortedNotePath.notePath.join("/")}
                            currentNotePath={currentNotePath}
                            notePathRecord={sortedNotePath}
                        />
                    )) : undefined}
                </ul>

                {cloneButton && (
                    <LinkButton
                        text={t("note_paths.clone_button")}
                        onClick={() => void parentComponent?.triggerCommand("cloneNoteIdsTo")}
                    />
                )}
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
            {joinElements(fullNotePaths.map((notePath, index, arr) => notePath === "root" ? (
                <NewNoteLink key={notePath} notePath={notePath} iconOnly noPreview />
            ) : (
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
