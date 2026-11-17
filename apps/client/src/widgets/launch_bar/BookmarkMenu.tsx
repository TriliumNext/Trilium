import { useContext } from "preact/hooks";

import appContext from "../../components/app_context";
import type FNote from "../../entities/fnote";
import type { MenuCommandItem } from "../../menus/context_menu";
import { isCtrlKey, isMobile, menuName } from "../../services/utils";
import { FormDropdownSubmenu, FormListItem } from "../react/FormList";
import { useChildNotes, useNote, useNoteIcon, useNoteLabelBoolean, useNoteProperty } from "../react/hooks/note";
import { MenuItemRows } from "../react/Menu";
import { MenuFilterContext } from "../react/menu_context";
import { getBookmarkOpenMode, MAX_UNFILTERED_CHILDREN } from "./BookmarkButtons";
import { launchCustomNoteLauncher } from "./GenericButtons";

/** The deepest a folder's submenus nest below the folder's own menu. */
const MAX_SUBMENU_DEPTH = 4;

/** A bookmark in the menu of a phone's launch bar: a row, or a submenu for a folder. */
export function MobileBookmarkItem({ noteId, bookmarkFolder }: { noteId: string, bookmarkFolder: boolean }) {
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
 * The rows of `note`'s children, in a menu `depth` submenus below the folder's own. The folder's
 * menu lists `note` above its children, and so does every submenu on a phone, where a split row
 * only opens its submenu.
 */
export function FolderRows({ note, depth }: { note: FNote, depth: number }) {
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
            void import("../../menus/link_context_menu").then(({ default: linkContextMenu }) =>
                linkContextMenu.openContextMenu(note.noteId, e));
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
