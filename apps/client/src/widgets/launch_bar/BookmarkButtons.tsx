import "./BookmarkButtons.css";

import { CSSProperties } from "preact";
import { useContext, useMemo } from "preact/hooks";

import type FNote from "../../entities/fnote";
import { t } from "../../services/i18n";
import { useChildNotes, useNoteLabelBoolean } from "../react/hooks/note";
import { preloadLazyModule, useLazyModule } from "../react/LazyComponent";
import ResponsiveContainer from "../react/ResponsiveContainer";
import { CustomNoteLauncher } from "./GenericButtons";
import {
    LaunchBarContext, LaunchBarDropdownButton, launcherContextMenuHandler, LauncherNoteProps,
    useLauncherIconAndTitle
} from "./launch_bar_widgets";

const PARENT_NOTE_ID = "_lbBookmarks";
/** The most children a menu lists without a filter input above them. */
export const MAX_UNFILTERED_CHILDREN = 15;

export default function BookmarkButtons({ launcherNote }: LauncherNoteProps) {
    const { isHorizontalLayout } = useContext(LaunchBarContext);
    const style = useMemo<CSSProperties>(() => ({
        display: "flex",
        flexDirection: isHorizontalLayout ? "row" : "column",
        contain: "none"
    }), [ isHorizontalLayout ]);
    const childNotes = useChildNotes(PARENT_NOTE_ID);
    const bookmarks = childNotes?.map(childNote => <SingleBookmark key={childNote.noteId} note={childNote} />);
    const showContextMenu = launcherContextMenuHandler(launcherNote);

    return (
        <ResponsiveContainer
            desktop={
                <div
                    style={style}
                    // Only trigger on empty container area; individual bookmark buttons handle their own context menu.
                    onContextMenu={(e) => e.target === e.currentTarget && showContextMenu?.(e)}
                >
                    {bookmarks}
                </div>
            }
            mobile={
                <LaunchBarDropdownButton
                    launcherNote={launcherNote}
                    icon="bx bx-bookmark"
                    title={t("bookmark_buttons.bookmarks")}
                    buttonProps={PRELOAD_MENU_PROPS}
                >
                    {bookmarks}
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
                : <CustomNoteLauncher
                    launcherNote={note}
                    getTargetNoteId={() => note.noteId}
                    getOpenMode={getBookmarkOpenMode}
                />
        }
        mobile={<LazyMobileBookmarkItem noteId={note.noteId} bookmarkFolder={bookmarkFolder} />}
    />;
}

/**
 * A note with `#bookmarkFolder` in the launch bar, which opens a menu of the note and its
 * children. `parentNoteId` is the launch bar section that shows it, see
 * `ShowLauncherContextMenuOptions`.
 */
export function BookmarkFolder({ note, parentNoteId }: { note: FNote, parentNoteId?: string }) {
    const { icon, title } = useLauncherIconAndTitle(note);
    const childNotes = useChildNotes(note.noteId);

    return (
        <LaunchBarDropdownButton
            launcherNote={note}
            parentNoteId={parentNoteId}
            icon={icon}
            title={title}
            filterable={childNotes.length > MAX_UNFILTERED_CHILDREN}
            keepOrder
            buttonProps={PRELOAD_MENU_PROPS}
        >
            <LazyFolderRows note={note} />
        </LaunchBarDropdownButton>
    );
}

// The rows of the menus load once a menu is about to open.
const loadBookmarkMenu = () => import("./BookmarkMenu");
const PRELOAD_MENU_PROPS = {
    onPointerEnter: () => preloadLazyModule(loadBookmarkMenu),
    onFocus: () => preloadLazyModule(loadBookmarkMenu)
};

function LazyFolderRows({ note }: { note: FNote }) {
    const bookmarkMenu = useLazyModule(loadBookmarkMenu);
    return bookmarkMenu && <bookmarkMenu.FolderRows note={note} depth={0} />;
}

function LazyMobileBookmarkItem(props: { noteId: string, bookmarkFolder: boolean }) {
    const bookmarkMenu = useLazyModule(loadBookmarkMenu);
    return bookmarkMenu && <bookmarkMenu.MobileBookmarkItem {...props} />;
}

/** Where a click opens a bookmarked note, or one dropped onto the launch bar. */
export function getBookmarkOpenMode(note: FNote) {
    return note.getLabelValue("bookmarkOpenMode");
}
