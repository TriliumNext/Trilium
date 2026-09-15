import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

vi.mock("../react/NoteLink", () => ({
    default(props: { notePath: string | string[]; title?: string; className?: string }) {
        const path = Array.isArray(props.notePath) ? props.notePath.join("/") : props.notePath;
        return <a className={props.className} data-note-path={path}>{props.title ?? path}</a>;
    }
}));

import type { NotePathRecord } from "../../entities/fnote";
import { renderInto } from "../../test/render";
import type { CompressedInverseTreeNode } from "./inverse_note_path_tree";
import { getInverseTreeNodeStatus, getNotePathStatus, NotePathsWidget } from "./NotePathsTab";

function record(notePath: string[], extra: Partial<NotePathRecord> = {}): NotePathRecord {
    return {
        notePath,
        isArchived: false,
        isInHoistedSubTree: true,
        isHidden: false,
        ...extra
    };
}

function node(extra: Partial<CompressedInverseTreeNode> = {}): CompressedInverseTreeNode {
    return {
        segments: [ { noteId: "leaf", ancestorPath: "root/leaf", isOpenNote: true } ],
        pathToOpenNote: "root/leaf",
        isOnActiveTrail: true,
        children: [],
        ...extra
    };
}

describe("getNotePathStatus", () => {
    it("marks the current, archived, search and outside-hoist states together", () => {
        const { classes, icons } = getNotePathStatus(record([ "root" ], {
            isArchived: true,
            isSearch: true,
            isInHoistedSubTree: false
        }), true);

        expect(classes).toEqual([
            "path-current",
            "path-archived",
            "path-search"
        ]);
        expect(icons.map((icon) => icon.titleKey)).toEqual([
            "note_paths.outside_hoisted",
            "note_paths.archived",
            "note_paths.search"
        ]);
    });

    it("treats a missing record as in the hoisted subtree and not current", () => {
        const { classes, icons } = getNotePathStatus(undefined, false);
        expect(classes).toEqual([ "path-in-hoisted-subtree" ]);
        expect(icons).toEqual([]);
    });
});

describe("getInverseTreeNodeStatus", () => {
    it("puts path-level flags only on a leaf that carries a record", () => {
        const leaf = getInverseTreeNodeStatus(node({
            isOnActiveTrail: false,
            record: record([ "root", "other", "leaf" ], { isArchived: true }),
            pathToOpenNote: "root/other/leaf"
        }), "root/leaf");

        expect(leaf.classes).toContain("path-archived");
        expect(leaf.classes).not.toContain("path-on-active-branch");
        expect(leaf.icons.map((icon) => icon.titleKey)).toEqual([ "note_paths.archived" ]);

        const openNote = getInverseTreeNodeStatus(node(), "root/leaf");
        expect(openNote.classes).toEqual([ "path-on-active-branch" ]);
        expect(openNote.icons).toEqual([]);
    });
});

describe("NotePathsWidget", () => {
    it("defaults to inverse tree when multiple paths exist and offers flat list toggle", () => {
        const onePath = renderInto(
            <NotePathsWidget
                cloneButton={false}
                currentNotePath="root/leaf"
                sortedNotePaths={[ record([ "root", "leaf" ]) ]}
            />
        );
        expect(onePath.querySelector(".tn-segmented-choice")).toBeNull();
        expect(onePath.querySelectorAll(".note-path-list li")).toHaveLength(1);

        const twoPaths = renderInto(
            <NotePathsWidget
                cloneButton={false}
                currentNotePath="root/parentA/leaf"
                sortedNotePaths={[
                    record([ "root", "parentA", "leaf" ]),
                    record([ "root", "parentB", "leaf" ])
                ]}
            />
        );
        expect(twoPaths.querySelector(".tn-segmented-choice")).not.toBeNull();
        expect(twoPaths.querySelector(".note-path-inverse-tree")).not.toBeNull();
        expect(twoPaths.querySelector(".note-path-list")).toBeNull();
        expect(twoPaths.querySelector(".note-path-tree-branches")).not.toBeNull();
        expect(twoPaths.querySelector(".note-path-node.path-on-active-branch")).not.toBeNull();
        expect(twoPaths.querySelector(".note-path-switch")).not.toBeNull();

        const listButton = twoPaths.querySelector(".bx-list-ul")?.closest("button");
        expect(listButton).toBeTruthy();
        if (!listButton) {
            return;
        }
        act(() => {
            listButton.click();
        });

        expect(twoPaths.querySelector(".note-path-inverse-tree")).toBeNull();
        expect(twoPaths.querySelectorAll(".note-path-list li")).toHaveLength(2);
    });
});
