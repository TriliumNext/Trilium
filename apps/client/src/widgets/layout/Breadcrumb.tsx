import "./Breadcrumb.css";

import clsx from "clsx";
import { useContext, useRef, useState } from "preact/hooks";
import { Fragment } from "preact/jsx-runtime";

import appContext from "../../components/app_context";
import Component from "../../components/component";
import NoteContext from "../../components/note_context";
import contextMenu, { MenuItem } from "../../menus/context_menu";
import NoteColorPicker from "../../menus/custom-items/NoteColorPicker";
import link_context_menu from "../../menus/link_context_menu";
import { TreeCommandNames } from "../../menus/tree_context_menu";
import attributes from "../../services/attributes";
import branches from "../../services/branches";
import { copyTextWithToast } from "../../services/clipboard_ext";
import { getReadableTextColor } from "../../services/css_class_manager";
import froca from "../../services/froca";
import hoisted_note from "../../services/hoisted_note";
import { t } from "../../services/i18n";
import note_create from "../../services/note_create";
import options from "../../services/options";
import tree from "../../services/tree";
import ActionButton from "../react/ActionButton";
import { Badge } from "../react/Badge";
import Dropdown from "../react/Dropdown";
import { FormDropdownDivider, FormListItem } from "../react/FormList";
import { useActiveNoteContext, useChildNotes, useNote, useNoteColorClass, useNoteIcon, useNoteLabel, useNoteLabelBoolean, useNoteTitle, useStaticTooltip, useTriliumOptionBool } from "../react/hooks";
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
                link_context_menu.openContextMenu(note.noteId, e);
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

function BreadcrumbSeparator(props: BreadcrumbSeparatorProps) {
    return (
        <Dropdown
            text={<Icon icon="bx bxs-chevron-right" />}
            noSelectButtonStyle
            buttonClassName="icon-action breadcrumb-separator"
            hideToggleArrow
            dropdownContainerClassName="tn-dropdown-menu-scrollable breadcrumb-child-list"
            dropdownOptions={{  popperConfig: { strategy: "fixed", placement: "top" } }}
        >
            <BreadcrumbSeparatorDropdownContent {...props} />
        </Dropdown>
    );
}

function BreadcrumbSeparatorDropdownContent({ notePath, noteContext, activeNotePath, hideArchivedNotes }: BreadcrumbSeparatorProps) {
    const notePathComponents = (notePath ?? "").split("/");
    const parentNoteId = notePathComponents.at(-1);
    const childNotes = useChildNotes(parentNoteId);

    return (
        <>
            {childNotes.map((note) => {
                if (note.noteId === "_hidden") return;
                if (hideArchivedNotes && note.isArchived) return null;

                const childNotePath = `${notePath}/${note.noteId}`;
                return <li key={note.noteId}>
                    <FormListItem
                        icon={note.getIcon()}
                        className={clsx(note.getColorClass(), note.isArchived && "archived")}
                        onClick={() => noteContext?.setNote(childNotePath)}
                    >
                        {childNotePath !== activeNotePath
                            ? <span>{note.title}</span>
                            : <strong>{note.title}</strong>}
                    </FormListItem>
                </li>;
            })}

            {childNotes.length > 0 && <FormDropdownDivider />}
            <FormListItem
                icon="bx bx-plus"
                onClick={() => note_create.createNote(notePath, { activate: true })}
            >{t("breadcrumb.create_new_note")}</FormListItem>
        </>
    );
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
            dropdownOptions={{ popperConfig: { strategy: "fixed" } }}
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
                        <span>{note.title}</span>
                    </FormListItem>
                </li>;
            })}
        </Dropdown>
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

//#region Note Context menu
function buildContextMenu(notePath: string, parentComponent: Component | null) {
    return async (e: MouseEvent) => {
        e.preventDefault();

        const { noteId, parentNoteId } = tree.getNoteIdAndParentIdFromUrl(notePath);
        if (!parentNoteId || !noteId) return;

        const branchId = await froca.getBranchId(parentNoteId, noteId);
        if (!branchId) return;
        const branch = froca.getBranch(branchId);
        if (!branch) return;

        const note = await branch?.getNote();
        if (!note) return;

        const notSearch = note.type !== "search";
        const notOptionsOrHelp = !note.noteId.startsWith("_options") && !note.noteId.startsWith("_help");
        const isArchived = note.isArchived;
        const isNotRoot = note.noteId !== "root";
        const isHoisted = note.noteId === appContext.tabManager.getActiveContext()?.hoistedNoteId;
        const parentNote = isNotRoot && branch ? await froca.getNote(branch.parentNoteId) : null;
        const parentNotSearch = !parentNote || parentNote.type !== "search";

        const items = [
            ...link_context_menu.getItems(e),
            {
                title: `${t("tree-context-menu.hoist-note")}`,
                command: "toggleNoteHoisting",
                uiIcon: "bx bxs-chevrons-up",
                enabled: notSearch
            },
            { kind: "separator" },
            {
                title: t("tree-context-menu.move-to"),
                command: "moveNotesTo",
                uiIcon: "bx bx-transfer",
                enabled: isNotRoot && !isHoisted && parentNotSearch
            },
            {
                title: t("tree-context-menu.clone-to"),
                command: "cloneNotesTo",
                uiIcon: "bx bx-duplicate",
                enabled: isNotRoot && !isHoisted
            },
            { kind: "separator" },
            {
                title: t("tree-context-menu.duplicate"),
                command: "duplicateSubtree",
                uiIcon: "bx bx-outline",
                enabled: parentNotSearch && isNotRoot && !isHoisted && notOptionsOrHelp && note.isContentAvailable(),
                handler: () => note_create.duplicateSubtree(noteId, branch.parentNoteId)
            },

            {
                title: !isArchived ? t("tree-context-menu.archive") : t("tree-context-menu.unarchive"),
                uiIcon: !isArchived ? "bx bx-archive" : "bx bx-archive-out",
                handler: () => {
                    if (!isArchived) {
                        attributes.addLabel(note.noteId, "archived");
                    } else {
                        attributes.removeOwnedLabelByName(note, "archived");
                    }
                }
            },
            {
                title: t("tree-context-menu.delete"),
                command: "deleteNotes",
                uiIcon: "bx bx-trash destructive-action-icon",
                enabled: isNotRoot && !isHoisted && parentNotSearch && notOptionsOrHelp,
                handler: () => branches.deleteNotes([ branchId ])
            },
            { kind: "separator" },
            (notOptionsOrHelp ? {
                kind: "custom",
                componentFn: () => {
                    return NoteColorPicker({note});
                }
            } : null),
            { kind: "separator" },
            {
                title: t("tree-context-menu.recent-changes-in-subtree"),
                uiIcon: "bx bx-history",
                enabled: notOptionsOrHelp,
                handler: () => parentComponent?.triggerCommand("showRecentChanges", { ancestorNoteId: noteId })
            },
            {
                title: t("tree-context-menu.search-in-subtree"),
                command: "searchInSubtree",
                uiIcon: "bx bx-search",
                enabled: notSearch
            }
        ];

        contextMenu.show({
            items: items.filter(Boolean) as MenuItem<TreeCommandNames>[],
            x: e.pageX,
            y: e.pageY,
            selectMenuItemHandler: ({ command }) => {
                if (link_context_menu.handleLinkContextMenuItem(command, e, notePath)) {
                    return;
                }

                if (!command) return;
                parentComponent?.triggerCommand(command, {
                    noteId,
                    notePath,
                    selectedOrActiveBranchIds: [ branchId ],
                    selectedOrActiveNoteIds: [ noteId ]
                });
            },
        });
    };
}
//#endregion

//#region Empty context menu
function buildEmptyAreaContextMenu(parentComponent: Component | null, notePath: string | null | undefined) {
    return (e: MouseEvent) => {
        const hideArchivedNotes = (options.get("hideArchivedNotes_main") === "true");

        e.preventDefault();
        contextMenu.show({
            items: [
                {
                    title: t("breadcrumb.empty_hide_archived_notes"),
                    handler: async () => {
                        await options.save("hideArchivedNotes_main", !hideArchivedNotes ? "true" : "false");

                        // Note tree doesn't update by itself.
                        parentComponent?.triggerEvent("frocaReloaded", {});
                    },
                    checked: hideArchivedNotes
                },
                { kind: "separator" },
                {
                    title: t("tree-context-menu.copy-note-path-to-clipboard"),
                    command: "copyNotePathToClipboard",
                    uiIcon: "bx bx-directions",
                    handler: () => copyTextWithToast(`#${notePath}`)
                },
            ],
            x: e.pageX,
            y: e.pageY,
            selectMenuItemHandler: () => {}
        });
    };
}
//#endregion
