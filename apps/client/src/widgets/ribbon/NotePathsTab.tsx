import "./NotePathsTab.css";

import clsx from "clsx";
import { useContext, useEffect, useMemo, useState } from "preact/hooks";

import { openInCurrentNoteContext } from "../../components/note_context";
import FNote, { NotePathRecord } from "../../entities/fnote";
import { isExperimentalFeatureEnabled } from "../../services/experimental_features";
import { t } from "../../services/i18n";
import { NOTE_PATH_TITLE_SEPARATOR } from "../../services/tree";
import ActionButton from "../react/ActionButton";
import { useTriliumEvent } from "../react/hooks";
import LinkButton from "../react/LinkButton";
import NoteLink from "../react/NoteLink";
import { joinElements, ParentComponent } from "../react/react_utils";
import SegmentedChoice from "../react/SegmentedChoice";
import {
    buildInverseNotePathTree,
    CompressedInverseTreeNode,
    inverseTreeBranchId
} from "./inverse_note_path_tree";
import { TabContext } from "./ribbon-interface";

export default function NotePathsTab({ note, hoistedNoteId, notePath }: TabContext) {
    const sortedNotePaths = useSortedNotePaths(note, hoistedNoteId);
    return <NotePathsWidget sortedNotePaths={sortedNotePaths} currentNotePath={notePath} />;
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
    const [ view, setView ] = useState<"list" | "tree">("tree");
    const hasMultiplePaths = (sortedNotePaths?.length ?? 0) >= 2;
    const showTree = view === "tree" && hasMultiplePaths;
    const treeRoot = useMemo(
        () => showTree && sortedNotePaths
            ? buildInverseNotePathTree(sortedNotePaths, currentNotePath)
            : null,
        [ showTree, sortedNotePaths, currentNotePath ]
    );
    // Unfolded branches are keyed by note ids, not by the active clone path: switching placement
    // rebuilds ancestorPath strings and would remount every row if expand lived on the node.
    const [ expandedBranches, setExpandedBranches ] = useState<Set<string>>(() => new Set());

    function toggleBranch(branchId: string) {
        setExpandedBranches((current) => {
            const next = new Set(current);
            if (next.has(branchId)) {
                next.delete(branchId);
            } else {
                next.add(branchId);
            }
            return next;
        });
    }
    // What holds the list in the new layout — the sidebar's card, the mobile note menu's modal, the
    // badge the status bar's dropdown hangs off — names the paths already, so the line saying the note
    // is placed in them is left to the ribbon's tab, which carries no title of its own. A note placed
    // nowhere still says so wherever it is shown: the list is then empty, and nothing else would
    // account for it.
    const intro = sortedNotePaths?.length
        ? (isExperimentalFeatureEnabled("new-layout") ? null : t("note_paths.intro_placed"))
        : t("note_paths.intro_not_placed");

    return (
        <div class="note-paths-widget">
            {(intro || hasMultiplePaths) && (
                <div className="note-path-header">
                    {intro && <div className="note-path-intro">{intro}</div>}
                    {hasMultiplePaths && (
                        <SegmentedChoice
                            currentValue={showTree ? "tree" : "list"}
                            onChange={setView}
                            options={[
                                { value: "tree", icon: "bx-git-merge", title: t("note_paths.view_tree") },
                                { value: "list", icon: "bx-list-ul", title: t("note_paths.view_list") }
                            ]}
                        />
                    )}
                </div>
            )}

            {treeRoot ? (
                <ul className="note-path-inverse-tree">
                    <CompressedInverseTreeNodeView
                        node={treeRoot}
                        currentNotePath={currentNotePath}
                        isRoot
                        expandedBranches={expandedBranches}
                        onToggleBranch={toggleBranch}
                    />
                </ul>
            ) : (
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
            )}

            {cloneButton && (
                <LinkButton
                    text={t("note_paths.clone_button")}
                    onClick={() => void parentComponent?.triggerCommand("cloneNoteIdsTo")}
                />
            )}
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

export type NotePathStatusTitleKey =
    | "note_paths.outside_hoisted"
    | "note_paths.archived"
    | "note_paths.search";

export function getNotePathStatus(record: NotePathRecord | undefined, isCurrent: boolean) {
    const classes: string[] = [];
    const icons: { icon: string, titleKey: NotePathStatusTitleKey }[] = [];

    if (isCurrent) {
        classes.push("path-current");
    }

    if (!record || record.isInHoistedSubTree) {
        classes.push("path-in-hoisted-subtree");
    } else {
        icons.push({ icon: "bx bx-trending-up", titleKey: "note_paths.outside_hoisted" });
    }

    if (record?.isArchived) {
        classes.push("path-archived");
        icons.push({ icon: "bx bx-archive", titleKey: "note_paths.archived" });
    }

    if (record?.isSearch) {
        classes.push("path-search");
        icons.push({ icon: "bx bx-search", titleKey: "note_paths.search" });
    }

    return { classes, icons };
}

export function getInverseTreeNodeStatus(node: CompressedInverseTreeNode, currentNotePath?: string | null) {
    const status = node.record
        ? getNotePathStatus(node.record, node.pathToOpenNote === currentNotePath)
        : { classes: [] as string[], icons: [] as { icon: string, titleKey: NotePathStatusTitleKey }[] };
    const classes = [ ...status.classes ];
    if (node.isOnActiveTrail) {
        classes.push("path-on-active-branch");
    }
    return { classes, icons: status.icons };
}

function NotePath({ currentNotePath, notePathRecord }: { currentNotePath?: string | null, notePathRecord?: NotePathRecord }) {
    const notePath = notePathRecord?.notePath;
    const notePathString = useMemo(() => (notePath ?? []).join("/"), [ notePath ]);
    const { classes, icons } = useMemo(
        () => getNotePathStatus(notePathRecord, notePathString === currentNotePath),
        [ notePathRecord, notePathString, currentNotePath ]
    );

    const pathSegments: string[] = [];
    const fullNotePaths: string[] = [];
    for (const noteId of notePath ?? []) {
        pathSegments.push(noteId);
        fullNotePaths.push(pathSegments.join("/"));
    }

    return (
        <li class={classes.join(" ")}>
            {joinElements(fullNotePaths.map((notePath, index, arr) => (
                <NoteLink key={notePath}
                    className={clsx({"basename": (index === arr.length - 1)})}
                    notePath={notePath}
                    noPreview />
            )), NOTE_PATH_TITLE_SEPARATOR)}

            {icons.map(({ icon, titleKey }) => (
                <i key={titleKey} class={icon} title={t(titleKey)} />
            ))}
        </li>
    );
}

function CompressedInverseTreeNodeView({
    node,
    currentNotePath,
    isRoot = false,
    expandedBranches,
    onToggleBranch
}: {
    node: CompressedInverseTreeNode;
    currentNotePath?: string | null;
    isRoot?: boolean;
    expandedBranches: Set<string>;
    onToggleBranch: (branchId: string) => void;
}) {
    const branchId = inverseTreeBranchId(node);
    const hasChildren = node.children.length > 0;
    // The first fork is always shown; deeper unfolds are remembered by branch id so a path switch
    // does not remount them closed.
    const expanded = isRoot || expandedBranches.has(branchId);
    const { classes, icons } = useMemo(
        () => getInverseTreeNodeStatus(node, currentNotePath),
        [ node, currentNotePath ]
    );
    const showPathSwitch = !node.isOnActiveTrail
        && !!currentNotePath
        && node.pathToOpenNote !== currentNotePath;

    return (
        <li className={clsx("note-path-node", classes)}>
            <div className="note-path-row">
                {hasChildren && !isRoot && (
                    <ActionButton
                        className="note-path-expand"
                        icon={expanded ? "bx bx-chevron-down" : "bx bx-chevron-right"}
                        text={expanded ? t("note_paths.collapse_ancestors") : t("note_paths.expand_ancestors")}
                        noTooltipOnTouch
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onToggleBranch(branchId);
                        }}
                    />
                )}

                {joinElements(node.segments.map((segment) => (
                    <NoteLink
                        key={segment.noteId}
                        notePath={segment.ancestorPath}
                        className={clsx({ basename: segment.isOpenNote })}
                        noPreview
                    />
                )), NOTE_PATH_TITLE_SEPARATOR)}

                {showPathSwitch && (
                    <ActionButton
                        className="note-path-switch"
                        icon="bx bx-git-branch"
                        text={t("note_paths.switch_to_this_path")}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openInCurrentNoteContext(e, node.pathToOpenNote);
                        }}
                    />
                )}

                {icons.map(({ icon, titleKey }) => (
                    <i key={titleKey} className={icon} title={t(titleKey)} />
                ))}
            </div>

            {hasChildren && expanded && (
                <ul className="note-path-tree-branches">
                    {node.children.map((child) => (
                        <CompressedInverseTreeNodeView
                            key={inverseTreeBranchId(child)}
                            node={child}
                            currentNotePath={currentNotePath}
                            expandedBranches={expandedBranches}
                            onToggleBranch={onToggleBranch}
                        />
                    ))}
                </ul>
            )}
        </li>
    );
}
