import "./NotePathsTab.css";

import clsx from "clsx";
import { useContext, useEffect, useMemo, useState } from "preact/hooks";

import FNote, { NotePathRecord } from "../../entities/fnote";
import { t } from "../../services/i18n";
import { NOTE_PATH_TITLE_SEPARATOR } from "../../services/tree";
import { useTriliumEvent } from "../react/hooks";
import LinkButton from "../react/LinkButton";
import NoteLink from "../react/NoteLink";
import { joinElements, ParentComponent } from "../react/react_utils";
import { TabContext } from "./ribbon-interface";

interface InverseTreeNode {
    noteId: string;
    fullPathString: string;       // Direct path to this specific ancestor note
    fullNotePathString: string;   // Full destination path to the active note via this branch
    isCurrent: boolean;
    isOnActiveTrail: boolean;
    record?: NotePathRecord;
    children: Map<string, InverseTreeNode>;
}

export default function NotePathsTab({
    note,
    hoistedNoteId,
    notePath
}: TabContext) {
    const sortedNotePaths = useSortedNotePaths(note, hoistedNoteId);
    return (
        <NotePathsWidget
            sortedNotePaths={sortedNotePaths}
            currentNotePath={notePath}
        />
    );
}

export function NotePathsWidget({
    sortedNotePaths,
    currentNotePath
}: {
    sortedNotePaths: NotePathRecord[] | undefined;
    currentNotePath?: string | null | undefined;
}) {
    const parentComponent = useContext(ParentComponent);
    const [isTreeView, setIsTreeView] = useState(true);

    // Track total parent paths available to check if clones exist
    const hasMultiplePaths = useMemo(() => (sortedNotePaths?.length ?? 0) >= 2, [sortedNotePaths]);

    const treeRoots = useMemo(() => {
        if (!sortedNotePaths || !isTreeView) return [];

        const roots = new Map<string, InverseTreeNode>();

        for (const record of sortedNotePaths) {
            const originalPath = record.notePath ?? [];
            const branchIds = (record as any).branchIds ?? [];

            if (!originalPath.length) continue;

            let currentLevel = roots;

            for (let i = originalPath.length - 1; i >= 0; i--) {
                const noteId = originalPath[i];
                const branchId = branchIds[i] || noteId;
                const realPath = originalPath.slice(0, i + 1).join("/");

                let node = currentLevel.get(branchId);

                if (!node) {
                    node = {
                        noteId,
                        fullPathString: realPath,
                        fullNotePathString: originalPath.join("/"), // Capture full line down to target note
                        isCurrent: realPath === currentNotePath,
                        isOnActiveTrail: false,
                        children: new Map()
                    };
                    currentLevel.set(branchId, node);
                } else {
                    if (
                        realPath === currentNotePath ||
                        currentNotePath?.startsWith(`${realPath}/`)
                    ) {
                        node.fullPathString = realPath;
                        if (realPath === currentNotePath) {
                            node.isCurrent = true;
                        }
                    }
                }

                if (i === originalPath.length - 1) {
                    node.record = record;
                }

                currentLevel = node.children;
            }
        }

        const rootNodes = Array.from(roots.values());

        function markTrail(
            nodes: Map<string, InverseTreeNode>,
            depth: number
        ): boolean {
            if (!currentNotePath) return false;

            const ids = currentNotePath.split("/");
            const targetIndex = ids.length - 1 - depth;

            if (targetIndex < 0) return false;

            for (const node of nodes.values()) {
                if (node.noteId !== ids[targetIndex]) continue;

                if (targetIndex === 0) {
                    node.isOnActiveTrail = true;
                    return true;
                }

                if (markTrail(node.children, depth + 1)) {
                    node.isOnActiveTrail = true;
                    return true;
                }
            }

            return false;
        }

        markTrail(roots, 0);
        return rootNodes;
    }, [sortedNotePaths, currentNotePath, isTreeView]);

    return (
        <div className="note-paths-widget">
            <div
                className="note-path-header"
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "0.75rem"
                }}
            >
                <div className="note-path-intro" style={{ margin: 0 }}>
                    {sortedNotePaths?.length
                        ? t("note_paths.intro_placed")
                        : t("note_paths.intro_not_placed")}
                </div>

                {sortedNotePaths && sortedNotePaths.length > 0 && (
                    <button
                        className="btn btn-sm"
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.25rem",
                            padding: "2px 8px"
                        }}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setIsTreeView(!isTreeView);
                        }}
                    >
                        <i
                            className={
                                isTreeView ? "bx bx-list-ul" : "bx bx-git-merge"
                            }
                        />
                        {isTreeView ? t("note_paths.show_flat_list") : t("note_paths.show_inverse_tree")}
                    </button>
                )}
            </div>

            {isTreeView ? (
                <div
                    className="note-path-inverse-tree-container"
                    style={{ overflowX: "auto", padding: "0.5rem 0" }}
                >
                    <ul
                        className="note-path-inverse-tree"
                        style={{
                            listStyleType: "none",
                            padding: 0,
                            margin: 0
                        }}
                    >
                        {treeRoots.map((rootNode) => (
                            <InverseTreeNodeComponent
                                key={rootNode.noteId}
                                node={rootNode}
                                currentNotePath={currentNotePath}
                                isRoot={true}
                                hasMultiplePaths={hasMultiplePaths}
                            />
                        ))}
                    </ul>
                </div>
            ) : (
                <ul className="note-path-list">
                    {sortedNotePaths?.map((sortedNotePath) => (
                        <NotePathClassic
                            key={sortedNotePath.notePath?.join("/")}
                            currentNotePath={currentNotePath}
                            notePathRecord={sortedNotePath}
                        />
                    ))}
                </ul>
            )}

            <div style={{ marginTop: "1rem" }}>
                <LinkButton
                    text={t("note_paths.clone_button")}
                    onClick={() =>
                        parentComponent?.triggerCommand("cloneNoteIdsTo")
                    }
                />
            </div>
        </div>
    );
}

function InverseTreeNodeComponent({
    node,
    currentNotePath,
    isRoot = false,
    hasMultiplePaths = false
}: {
    node: InverseTreeNode;
    currentNotePath?: string | null | undefined;
    isRoot?: boolean;
    hasMultiplePaths?: boolean;
}) {
    const [isExpanded, setIsExpanded] = useState(true);
    const hasChildren = node.children.size > 0;

    const [classes, icons] = useMemo(() => {
        const classList: string[] = ["note-path-node"];
        const iconList: { icon: string; title: string }[] = [];

        if (node.isCurrent) classList.push("path-current");
        if (node.isOnActiveTrail) classList.push("path-on-active-branch");

        if (node.record) {
            if (!node.record.isInHoistedSubTree) {
                iconList.push({
                    icon: "bx bx-trending-up",
                    title: t("note_paths.outside_hoisted")
                });
            }
            if (node.record.isArchived) {
                classList.push("path-archived");
                iconList.push({
                    icon: "bx bx-archive",
                    title: t("note_paths.archived")
                });
            }
            if (node.record.isSearch) {
                classList.push("path-search");
                iconList.push({
                    icon: "bx bx-search",
                    title: t("note_paths.search")
                });
            }
        }

        return [classList.join(" "), iconList];
    }, [node]);

    const childNodes = Array.from(node.children.values());

    return (
        <li
            className={classes}
            style={{
                display: "flex",
                flexDirection: "column",
                margin: "0.2rem 0"
            }}
        >
            <div
                className="note-path-row"
                style={{ display: "flex", alignItems: "center", gap: "0.25rem", flexWrap: "wrap" }}
            >
                {hasChildren && (
                    <span
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setIsExpanded(!isExpanded);
                        }}
                        style={{
                            cursor: "pointer",
                            display: "inline-flex",
                            padding: "2px",
                            userSelect: "none"
                        }}
                    >
                        <i
                            className={
                                isExpanded
                                    ? "bx bx-chevron-down"
                                    : "bx bx-chevron-right"
                            }
                        />
                    </span>
                )}

                {/* Main link: Jumps directly up to this ancestor note */}
                <NoteLink
                    notePath={node.fullPathString}
                    className={clsx({
                        basename: isRoot,
                        "active-trail": node.isOnActiveTrail
                    })}
                    noPreview
                />

                {/* Separator: Only shows if note has children to walk down to */}
                {hasChildren && (
                    <span className="separator" style={{ margin: "0 4px", opacity: 0.5 }}>
                        {NOTE_PATH_TITLE_SEPARATOR}
                    </span>
                )}

                {/* Contextual Action Capsule Block instead of bare auto-titled text */}
                {hasMultiplePaths && !node.isOnActiveTrail && (
                    <span
                        className="btn btn-xs btn-outline-secondary py-0 px-2"
                        style={{
                            fontSize: "0.65rem",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            marginLeft: "12px",
                            height: "20px",
                            borderRadius: "3px",
                            pointerEvents: "none" // Prevents the whole capsule wrapper from triggering navigation clicks
                        }}
                    >
                        <i className="bx bx-git-branch" style={{ fontSize: "0.75rem", opacity: 0.7 }} />

                        <span style={{ pointerEvents: "auto", fontWeight: "bold" }}>
                            <NoteLink
                                notePath={node.fullNotePathString}
                                style={{ textDecoration: "underline" }}
                                noPreview
                            />
                        </span>
                    </span>
                )}

                {icons.map(({ icon, title }) => (
                    <i key={title} className={icon} title={title} style={{ marginLeft: "4px" }} />
                ))}
            </div>

            {hasChildren && isExpanded && (
                <ul
                    className="note-path-tree-branches"
                    style={{ listStyleType: "none", margin: "0.1rem 0 0 1.2rem", padding: 0 }}
                >
                    {childNodes.map((childNode) => (
                        <InverseTreeNodeComponent
                            key={childNode.noteId}
                            node={childNode}
                            currentNotePath={currentNotePath}
                            isRoot={false}
                            hasMultiplePaths={hasMultiplePaths}
                        />
                    ))}
                </ul>
            )}
        </li>
    );
}

function NotePathClassic({
    currentNotePath,
    notePathRecord
}: {
    currentNotePath?: string | null;
    notePathRecord?: NotePathRecord;
}) {
    const notePath = notePathRecord?.notePath;
    const notePathString = useMemo(
        () => (notePath ?? []).join("/"),
        [notePath]
    );

    const [classes, icons] = useMemo(() => {
        const classes: string[] = [];
        const icons: { icon: string; title: string }[] = [];

        if (notePathString === currentNotePath) {
            classes.push("path-current");
        }

        if (!notePathRecord || notePathRecord.isInHoistedSubTree) {
            classes.push("path-in-hoisted-subtree");
        } else {
            icons.push({
                icon: "bx bx-trending-up",
                title: t("note_paths.outside_hoisted")
            });
        }

        if (notePathRecord?.isArchived) {
            classes.push("path-archived");
            icons.push({
                icon: "bx bx-archive",
                title: t("note_paths.archived")
            });
        }

        if (notePathRecord?.isSearch) {
            classes.push("path-search");
            icons.push({
                icon: "bx bx-search",
                title: t("note_paths.search")
            });
        }

        return [classes.join(" "), icons];
    }, [notePathString, currentNotePath, notePathRecord]);

    const pathSegments: string[] = [];
    const fullNotePaths: string[] = [];
    for (const noteId of notePath ?? []) {
        pathSegments.push(noteId);
        fullNotePaths.push(pathSegments.join("/"));
    }

    return (
        <li className={classes}>
            {joinElements(
                fullNotePaths.map((notePath, index, arr) => (
                    <NoteLink
                        key={notePath}
                        className={clsx({
                            basename: index === arr.length - 1
                        })}
                        notePath={notePath}
                        noPreview
                    />
                )),
                NOTE_PATH_TITLE_SEPARATOR
            )}

            {icons.map(({ icon, title }) => (
                <i key={title} className={icon} title={title} />
            ))}
        </li>
    );
}

export function useSortedNotePaths(
    note: FNote | null | undefined,
    hoistedNoteId?: string
) {
    const [sortedNotePaths, setSortedNotePaths] = useState<NotePathRecord[]>();

    function refresh() {
        if (!note) return;
        setSortedNotePaths(
            note
                .getSortedNotePathRecords(hoistedNoteId)
                .filter((notePath) => !notePath.isHidden)
        );
    }

    useEffect(refresh, [note, hoistedNoteId]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const noteId = note?.noteId;
        if (!noteId) return;
        if (
            loadResults
                .getBranchRows()
                .find((branch) => branch.noteId === noteId) ||
            loadResults.isNoteReloaded(noteId)
        ) {
            refresh();
        }
    });

    return sortedNotePaths;
}
