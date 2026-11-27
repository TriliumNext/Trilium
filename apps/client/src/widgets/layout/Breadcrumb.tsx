import "./Breadcrumb.css";

import clsx from "clsx";
import { Fragment } from "preact";
import { useContext, useRef, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import type Component from "../../components/component";
import NoteContext from "../../components/note_context";
import type FNote from "../../entities/fnote";
import type { MenuItem } from "../../menus/context_menu";
import { getReadableTextColor } from "../../services/css_class_manager";
import froca from "../../services/froca";
import hoisted_note from "../../services/hoisted_note";
import { t } from "../../services/i18n";
import note_create from "../../services/note_create";
import { noteTitleTextHtml, PROTECTED_ICON } from "../../services/tab_title";
import tree from "../../services/tree";
import ActionButton from "../react/ActionButton";
import { Badge } from "../react/Badge";
import Dropdown, { DropdownMenuItemRows } from "../react/Dropdown";
import { FormListItem } from "../react/FormList";
import {
    useChildNotes, useNote, useNoteColorClass, useNoteIcon, useNoteLabel, useNoteLabelBoolean
} from "../react/hooks/note";
import { useTriliumOptionBool } from "../react/hooks/options";
import { useActiveNoteContext, useNoteTitle } from "../react/hooks/tree";
import { useStaticTooltip } from "../react/hooks/tooltip";
import Icon from "../react/Icon";
import { NewNoteLink } from "../react/NoteLink";
import { ParentComponent } from "../react/react_utils";

const COLLAPSE_THRESHOLD = 5;
const INITIAL_ITEMS = 2;
const FINAL_ITEMS = 3;

export default function Breadcrumb() {
    const { notePath, notePaths, noteContext } = useNotePaths();
    const parentComponent = useContext(ParentComponent);
    const [ hideArchivedNotes ] = useTriliumOptionBool("hideArchivedNotes_main");
    const separatorProps: Omit<BreadcrumbSeparatorProps, "notePath" | "activeNotePath"> = { noteContext, hideArchivedNotes };

    return (
        <div className="breadcrumb">
            {notePaths.length > COLLAPSE_THRESHOLD ? (
                <>
                    {notePaths.slice(0, INITIAL_ITEMS).map((item, index) => (
                        <Fragment key={item}>
                            <BreadcrumbItem index={index} notePath={item} notePathLength={notePaths.length} noteContext={noteContext} parentComponent={parentComponent} />
                            <BreadcrumbSeparator notePath={item} activeNotePath={notePaths[index + 1]} {...separatorProps} />
                        </Fragment>
                    ))}
                    <BreadcrumbCollapsed items={notePaths.slice(INITIAL_ITEMS, -FINAL_ITEMS)} noteContext={noteContext} />
                    {notePaths.slice(-FINAL_ITEMS).map((item, index) => (
                        <Fragment key={item}>
                            <BreadcrumbSeparator notePath={notePaths[notePaths.length - FINAL_ITEMS - (1 - index)]} activeNotePath={item} {...separatorProps} />
                            <BreadcrumbItem index={notePaths.length - FINAL_ITEMS + index} notePath={item} notePathLength={notePaths.length} noteContext={noteContext} parentComponent={parentComponent} />
                        </Fragment>
                    ))}
                    <BreadcrumbSeparator notePath={notePaths.at(-1)} {...separatorProps} />
                </>
            ) : (
                notePaths.map((item, index) => (
                    <Fragment key={item}>
                        {index === 0
                            ? <BreadcrumbRoot noteContext={noteContext} />
                            : <BreadcrumbItem index={index} notePath={item} notePathLength={notePaths.length} noteContext={noteContext} parentComponent={parentComponent} />
                        }
                        <BreadcrumbSeparator notePath={item} activeNotePath={notePaths[index + 1]} {...separatorProps} />
                    </Fragment>
                ))
            )}

            <div
                className="filler"
                onContextMenu={buildEmptyAreaContextMenu(parentComponent, notePath)}
            />
        </div>
    );
}

function BreadcrumbRoot({ noteContext }: { noteContext: NoteContext | undefined }) {
    const noteId = noteContext?.hoistedNoteId ?? "root";
    if (noteId !== "root") {
        return <BreadcrumbHoistedNoteRoot noteId={noteId} />;
    }

    // Root note is icon only.
    const note = froca.getNoteFromCache("root");
    return (note &&
        <ActionButton
            className="root-note"
            icon={note.getIcon()}
            text={""}
            onClick={() => noteContext?.setNote(note.noteId)}
            onContextMenu={(e) => {
                e.preventDefault();
                void import("../../menus/link_context_menu").then(({ default: linkContextMenu }) =>
                    linkContextMenu.openContextMenu(note.noteId, e));
            }}
        />
    );

}

function BreadcrumbHoistedNoteRoot({ noteId }: { noteId: string }) {
    const note = useNote(noteId);
    const noteIcon = useNoteIcon(note);
    const [ workspace ] = useNoteLabelBoolean(note, "workspace");
    const [ workspaceIconClass ] = useNoteLabel(note, "workspaceIconClass");
    const [ workspaceColor ] = useNoteLabel(note, "workspaceTabBackgroundColor");

    // Hoisted workspace shows both text and icon and a way to exit easily out of the hoisting.
    return (note &&
        <>
            <Badge
                className="badge-hoisted"
                icon={workspace ? (workspaceIconClass || noteIcon) : "bx bxs-chevrons-up"}
                text={workspace ? t("breadcrumb.workspace_badge") : t("breadcrumb.hoisted_badge")}
                tooltip={t("breadcrumb.hoisted_badge_title")}
                onClick={() => hoisted_note.unhoist()}
                style={workspaceColor ? {
                    "--color": workspaceColor,
                    "color": getReadableTextColor(workspaceColor)
                } : undefined}
            />
            <NewNoteLink
                notePath={noteId}
                showNoteIcon
                noPreview
            />
        </>
    );
}

function BreadcrumbLastItem({ notePath, parentComponent }: { notePath: string, parentComponent: Component | null }) {
    const linkRef = useRef<HTMLAnchorElement>(null);
    const { noteId, parentNoteId } = tree.getNoteIdAndParentIdFromUrl(notePath);
    const [ note ] = useState(() => froca.getNoteFromCache(noteId!));
    const title = useNoteTitle(noteId, parentNoteId);
    const colorClass = useNoteColorClass(note);
    const [ archived ] = useNoteLabelBoolean(note, "archived");
    useStaticTooltip(linkRef, {
        placement: "top",
        title: t("breadcrumb.scroll_to_top_title")
    });

    if (!note) return null;

    return (
        <a
            ref={linkRef}
            href="#"
            className={clsx("breadcrumb-last-item tn-link", colorClass, archived && "archived")}
            onClick={() => {
                const activeNtxId = appContext.tabManager.activeNtxId;
                const scrollingContainer = document.querySelector(`[data-ntx-id="${activeNtxId}"] .scrolling-container`);
                scrollingContainer?.scrollTo({ top: 0, behavior: "smooth" });
            }}
            onContextMenu={buildContextMenu(notePath, parentComponent)}
        >{title}</a>
    );
}

function BreadcrumbItem({ index, notePath, noteContext, notePathLength, parentComponent }: { index: number, notePathLength: number, notePath: string, noteContext: NoteContext | undefined, parentComponent: Component | null }) {
    if (index === 0) {
        return <BreadcrumbRoot noteContext={noteContext} />;
    }

    if (index === notePathLength - 1) {
        return <>
            <BreadcrumbLastItem notePath={notePath} parentComponent={parentComponent} />
        </>;
    }

    return <NewNoteLink
        notePath={notePath}
        noContextMenu
        onContextMenu={buildContextMenu(notePath, parentComponent)}
    />;
}

interface BreadcrumbSeparatorProps {
    notePath: string | undefined,
    activeNotePath?: string,
    noteContext: NoteContext | undefined,
    hideArchivedNotes: boolean;
}

export function BreadcrumbSeparator(props: BreadcrumbSeparatorProps) {
    const notePathComponents = (props.notePath ?? "").split("/");
    const parentNoteId = notePathComponents.at(-1);
    const parentNote = useNote(parentNoteId);
    const [ subtreeHidden ] = useNoteLabelBoolean(parentNote, "subtreeHidden");

    if (subtreeHidden && !props.activeNotePath) {
        return null;
    }

    return (
        <Dropdown
            text={<Icon icon="bx bxs-chevron-right" />}
            noSelectButtonStyle
            buttonClassName="icon-action breadcrumb-separator"
            hideToggleArrow
            dropdownContainerClassName="breadcrumb-child-list"
            placement="top"
            filterable={!!parentNote?.hasChildren()}
            keepOrder
        >
            <BreadcrumbSeparatorDropdownContent {...props} />
        </Dropdown>
    );
}

function BreadcrumbSeparatorDropdownContent(props: BreadcrumbSeparatorProps) {
    const parentNoteId = (props.notePath ?? "").split("/").at(-1);
    const childNotes = useChildNotes(parentNoteId);
    return <DropdownMenuItemRows items={buildChildNoteItems(childNotes, props)} />;
}

/** The rows of a separator's menu: the children of the note before it, then "Create new note". */
export function buildChildNoteItems(childNotes: FNote[], props: BreadcrumbSeparatorProps) {
    const { notePath, activeNotePath, noteContext, hideArchivedNotes } = props;
    const items: MenuItem<unknown>[] = [];
    for (const note of childNotes) {
        if (note.noteId === "_hidden") continue;
        if (hideArchivedNotes && note.isArchived) continue;

        const childNotePath = `${notePath}/${note.noteId}`;
        const title = noteTitleTextHtml(note);
        items.push({
            title: childNotePath === activeNotePath ? `<strong>${title}</strong>` : title,
            titleIcon: note.isProtected ? PROTECTED_ICON : undefined,
            uiIcon: note.getIcon(),
            iconColorClass: note.getColorClass(),
            className: note.isArchived ? "archived" : undefined,
            handler: () => noteContext?.setNote(childNotePath)
        });
    }

    if (items.length > 0) items.push({ kind: "separator" });
    items.push({
        title: t("breadcrumb.create_new_note"),
        uiIcon: "bx bx-plus",
        handler: () => note_create.createNote(notePath, { activate: true })
    });
    return items;
}

function BreadcrumbCollapsed({ items, noteContext }: {
    items: string[],
    noteContext: NoteContext | undefined,
}) {
    return (
        <Dropdown
            text={<Icon icon="bx bx-dots-horizontal-rounded" />}
            noSelectButtonStyle
            buttonClassName="icon-action"
            dropdownContainerClassName="breadcrumb-child-list"
            hideToggleArrow
        >
            {items.map((notePath) => {
                const notePathComponents = notePath.split("/");
                const noteId = notePathComponents[notePathComponents.length - 1];
                const note = froca.getNoteFromCache(noteId);
                if (!note) return null;

                return <li key={note.noteId}>
                    <FormListItem
                        icon={note.getIcon()}
                        onClick={() => noteContext?.setNote(notePath)}
                    >
                        <span><BreadcrumbNoteTitle note={note} /></span>
                    </FormListItem>
                </li>;
            })}
        </Dropdown>
    );
}

export function BreadcrumbNoteTitle({ note }: { note: FNote }) {
    return (
        <>
            {note.isContentAvailable()
                ? note.title
                : <span className="protected-title">{t("protected_session.locked_note_title")}</span>}
            {note.isProtected && <Icon icon="bx bx-lock-alt" className="protected-icon" />}
        </>
    );
}

function useNotePaths() {
    const { note, notePath, hoistedNoteId, noteContext } = useActiveNoteContext();
    const notePathArray = (notePath ?? "").split("/");

    let prefix = "";
    let output: string[] = [];
    let pos = 0;
    let hoistedNotePos = -1;
    for (const notePath of notePathArray) {
        if (hoistedNoteId !== "root" && notePath === hoistedNoteId) {
            hoistedNotePos = pos;
        }
        output.push(`${prefix}${notePath}`);
        prefix += `${notePath}/`;
        pos++;
    }

    // When hoisted, display only the path starting with the hoisted note.
    if (hoistedNoteId !== "root" && hoistedNotePos > -1) {
        output = output.slice(hoistedNotePos);
    }

    return {
        note,
        notePath,
        notePaths: output,
        noteContext
    };
}

function buildContextMenu(notePath: string, parentComponent: Component | null) {
    return (e: MouseEvent) => {
        e.preventDefault();
        void import("./breadcrumb_context_menu").then(({ showNoteContextMenu }) =>
            showNoteContextMenu(e, notePath, parentComponent));
    };
}

function buildEmptyAreaContextMenu(parentComponent: Component | null, notePath: string | null | undefined) {
    return (e: MouseEvent) => {
        e.preventDefault();
        void import("./breadcrumb_context_menu").then(({ showEmptyAreaContextMenu }) =>
            showEmptyAreaContextMenu(e, parentComponent, notePath));
    };
}
