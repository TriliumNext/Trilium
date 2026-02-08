import "./BookmarkButtons.css";

import { CSSProperties } from "preact";
import { useContext, useMemo } from "preact/hooks";

import type FNote from "../../entities/fnote";
import { t } from "../../services/i18n";
import { FormDropdownSubmenu, FormListItem } from "../react/FormList";
import { useChildNotes, useNote, useNoteIcon, useNoteLabelBoolean } from "../react/hooks";
import NoteLink from "../react/NoteLink";
import ResponsiveContainer from "../react/ResponsiveContainer";
import { CustomNoteLauncher, launchCustomNoteLauncher } from "./GenericButtons";
import { LaunchBarContext, LaunchBarDropdownButton, useLauncherIconAndTitle } from "./launch_bar_widgets";

const PARENT_NOTE_ID = "_lbBookmarks";

export default function BookmarkButtons() {
    const { isHorizontalLayout } = useContext(LaunchBarContext);
    const style = useMemo<CSSProperties>(() => ({
        display: "flex",
        flexDirection: isHorizontalLayout ? "row" : "column",
        contain: "none"
    }), [ isHorizontalLayout ]);
    const childNotes = useChildNotes(PARENT_NOTE_ID);

    return (
        <ResponsiveContainer
            desktop={
                <div style={style}>
                    {childNotes?.map(childNote => <SingleBookmark key={childNote.noteId} note={childNote} />)}
                </div>
            }
            mobile={
                <LaunchBarDropdownButton
                    icon="bx bx-bookmark"
                    title={t("bookmark_buttons.bookmarks")}
                >
                    {childNotes?.map(childNote => <SingleBookmark key={childNote.noteId} note={childNote} />)}
                </LaunchBarDropdownButton>
            }
        />
    );
}

function SingleBookmark({ note }: { note: FNote }) {
    const [ bookmarkFolder ] = useNoteLabelBoolean(note, "bookmarkFolder");
    return <ResponsiveContainer
        desktop={
            bookmarkFolder
                ? <BookmarkFolder note={note} />
                : <CustomNoteLauncher launcherNote={note} getTargetNoteId={() => note.noteId} />
        }
        mobile={<MobileBookmarkItem noteId={note.noteId} bookmarkFolder={bookmarkFolder} />}
    />;
}

function MobileBookmarkItem({ noteId, bookmarkFolder }: { noteId: string, bookmarkFolder: boolean }) {
    const note = useNote(noteId);
    const noteIcon = useNoteIcon(note);
    if (!note) return null;

    return (
        !bookmarkFolder
            ? <FormListItem icon={noteIcon} onClick={(e) => launchCustomNoteLauncher(e, { launcherNote: note, getTargetNoteId: () => note.noteId })}>{note.title}</FormListItem>
            : <MobileBookmarkFolder note={note} />
    );
}

function MobileBookmarkFolder({ note }: { note: FNote }) {
    const childNotes = useChildNotes(note.noteId);

    return (
        <FormDropdownSubmenu icon="bx bx-folder" title={note.title}>
            {childNotes.map(childNote => (
                <FormListItem
                    key={childNote.noteId}
                    icon={childNote.getIcon()}
                    onClick={(e) => launchCustomNoteLauncher(e, { launcherNote: childNote, getTargetNoteId: () => childNote.noteId })}
                >
                    {childNote.title}
                </FormListItem>
            ))}
        </FormDropdownSubmenu>
    );
}

function BookmarkFolder({ note }: { note: FNote }) {
    const { icon, title } = useLauncherIconAndTitle(note);
    const childNotes = useChildNotes(note.noteId);

    return (
        <LaunchBarDropdownButton
            icon={icon}
            title={title}
        >
            <div className="bookmark-folder-widget">
                <div className="parent-note">
                    <NoteLink notePath={note.noteId} noPreview showNoteIcon containerClassName="note-link" noTnLink />
                </div>

                <ul className="children-notes">
                    {childNotes.map(childNote => (
                        <li key={childNote.noteId}>
                            <NoteLink notePath={childNote.noteId} noPreview showNoteIcon containerClassName="note-link" noTnLink />
                        </li>
                    ))}
                </ul>
            </div>
        </LaunchBarDropdownButton>
    );
}
