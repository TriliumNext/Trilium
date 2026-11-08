import "./BookmarkButtons.css";

import { CSSProperties } from "preact";
import { useContext, useMemo } from "preact/hooks";

import appContext from "../../components/app_context";
import type FNote from "../../entities/fnote";
import type { MenuCommandItem } from "../../menus/context_menu";
import { menuName } from "../../menus/context_menu_utils";
import link_context_menu from "../../menus/link_context_menu";
import { t } from "../../services/i18n";
import { isCtrlKey, isMobile } from "../../services/utils";
import { FormDropdownSubmenu, FormListItem } from "../react/FormList";
import {
    useChildNotes, useNote, useNoteIcon, useNoteLabelBoolean, useNoteProperty
} from "../react/hooks";
import { MenuItemRows } from "../react/Menu";
import { MenuFilterContext } from "../react/menu_context";
import ResponsiveContainer from "../react/ResponsiveContainer";
import { CustomNoteLauncher, launchCustomNoteLauncher } from "./GenericButtons";
import { LaunchBarContext, LaunchBarDropdownButton, launcherContextMenuHandler, LauncherNoteProps, useLauncherIconAndTitle } from "./launch_bar_widgets";

const PARENT_NOTE_ID = "_lbBookmarks";
/** The deepest a folder's submenus nest below the folder's own menu. */
const MAX_SUBMENU_DEPTH = 4;
/** The most children a menu lists without a filter input above them. */
const MAX_UNFILTERED_CHILDREN = 15;

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
        mobile={<MobileBookmarkItem noteId={note.noteId} bookmarkFolder={bookmarkFolder} />}
    />;
}

function MobileBookmarkItem({ noteId, bookmarkFolder }: { noteId: string, bookmarkFolder: boolean }) {
    const note = useNote(noteId);
    if (!note) return null;

    return bookmarkFolder ? <MobileBookmarkFolder note={note} /> : <NoteRow note={note} />;
}

function MobileBookmarkFolder({ note }: { note: FNote }) {
    return (
        <FormDropdownSubmenu
            icon="bx bx-folder" title={note.title} filterable={hasManyChildren(note)}
        >
            <FolderRows note={note} depth={0} />
        </FormDropdownSubmenu>
    );
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
        >
            <FolderRows note={note} depth={0} />
        </LaunchBarDropdownButton>
    );
}

/**
 * The rows of `note`'s children, in a menu `depth` submenus below the folder's own. The folder's
 * menu lists `note` above its children, and so does every submenu on a phone, where a split row
 * only opens its submenu.
 */
function FolderRows({ note, depth }: { note: FNote, depth: number }) {
    const childNotes = useChildNotes(note.noteId);
    const filter = useContext(MenuFilterContext);
    const listsNote = depth === 0 || isMobile();

    // Only rows given as data can be filtered, so `MenuItemRows` draws the matches.
    if (filter?.text) {
        const notes = listsNote ? [ note, ...childNotes ] : childNotes;
        return <MenuItemRows items={notes.map(toMenuItem)} />;
    }

    return <>
        {listsNote && <NoteRow note={note} className="bookmark-folder-note" />}
        {childNotes.map((childNote) => (
            <NoteRow
                key={childNote.noteId}
                note={childNote}
                className={listsNote ? "bookmark-folder-child" : undefined}
                submenuDepth={depth + 1}
            />
        ))}
    </>;
}

interface NoteRowProps {
    note: FNote;
    className?: string;
    /**
     * The depth of the submenu that would list the note's children. Without it, or past
     * {@link MAX_SUBMENU_DEPTH}, the row only opens the note.
     */
    submenuDepth?: number;
}

/**
 * A row that opens `note`. A note with children it shows becomes a split row, whose arrow opens a
 * submenu of them; `#subtreeHidden` keeps them out, as it does in the note tree.
 */
function NoteRow({ note, className, submenuDepth }: NoteRowProps) {
    const icon = useNoteIcon(note);
    const title = useNoteProperty(note, "title");
    const [ isSubtreeHidden ] = useNoteLabelBoolean(note, "subtreeHidden");
    const label = <span className="tn-menu-name">{title}</span>;
    const open = (e: MouseEvent) => openNote(e, note);
    const { middleClickHandler, contextMenuHandler } = getLinkHandlers(note);

    if (submenuDepth !== undefined && submenuDepth <= MAX_SUBMENU_DEPTH
            && note.hasChildren() && !isSubtreeHidden) {
        return (
            <FormDropdownSubmenu
                icon={icon} title={label} className={className}
                onDropdownToggleClicked={open} closeOnSelect filterable={hasManyChildren(note)}
                onMiddleClick={middleClickHandler} onContextMenu={contextMenuHandler}
            >
                <FolderRows note={note} depth={submenuDepth} />
            </FormDropdownSubmenu>
        );
    }

    return (
        <FormListItem
            icon={icon} className={className} onClick={open}
            onMiddleClick={middleClickHandler} onContextMenu={contextMenuHandler}
        >
            {label}
        </FormListItem>
    );
}

/** Whether the submenu of `note`'s children offers a filter input above them. */
function hasManyChildren(note: FNote) {
    return note.getChildNoteIds().length > MAX_UNFILTERED_CHILDREN;
}

/** `note` as a menu item, which `MenuItemRows` can filter. */
function toMenuItem(note: FNote): MenuCommandItem<unknown> {
    return {
        title: menuName(note.title),
        uiIcon: note.getIcon(),
        handler: (_item, e) => openNote(e, note),
        ...getLinkHandlers(note)
    };
}

/** Opens `note` as its launcher does, and in a new window on Shift, as a link to it does. */
function openNote(e: MouseEvent | KeyboardEvent, note: FNote) {
    if (e.shiftKey && !isCtrlKey(e)) {
        void appContext.triggerCommand("openInWindow", { notePath: note.noteId });
    } else {
        launchNote(e, note);
    }
}

/**
 * The middle click and right-click of a link to `note`: a new tab, made active with Shift, and the
 * link menu. A phone has no link menu: `Menu` ignores a long press there.
 */
function getLinkHandlers(note: FNote) {
    return {
        middleClickHandler: (e: MouseEvent) => launchNote(e, note),
        contextMenuHandler: isMobile() ? undefined : (e: MouseEvent) => {
            e.preventDefault();
            void link_context_menu.openContextMenu(note.noteId, e);
        }
    };
}

function launchNote(e: MouseEvent | KeyboardEvent, note: FNote) {
    void launchCustomNoteLauncher(e, {
        launcherNote: note,
        getTargetNoteId: () => note.noteId,
        getOpenMode: getBookmarkOpenMode
    });
}

/** Where a click opens a bookmarked note, or one dropped onto the launch bar. */
export function getBookmarkOpenMode(note: FNote) {
    return note.getLabelValue("bookmarkOpenMode");
}
