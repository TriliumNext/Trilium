import $ from "jquery";
import { afterEach, describe, expect, it, vi } from "vitest";

import FBranch from "../entities/fbranch.js";
import froca from "../services/froca.js";
import hoistedNoteService from "../services/hoisted_note.js";
import LoadResults from "../services/load_results.js";
import noteCreateService from "../services/note_create.js";
import treeService from "../services/tree.js";
import { buildNote } from "../test/easy-froca.js";
import NoteTreeWidget, { publishDropMarkerShift } from "./note_tree.js";

function treeOf(widget: NoteTreeWidget): Fancytree.Fancytree {
    return (widget as unknown as { tree: Fancytree.Fancytree }).tree;
}

function setTree(widget: NoteTreeWidget, tree: Fancytree.Fancytree) {
    (widget as unknown as { tree: Fancytree.Fancytree }).tree = tree;
}

describe("fancytree scrollIntoView patch", () => {
    it("resolves instead of crashing for a node without rendered markup (#10407)", async () => {
        const $tree = $("<div>").appendTo(document.body);

        try {
            $tree.fancytree({
                source: [
                    {
                        title: "parent",
                        key: "parent",
                        expanded: true,
                        children: [{ title: "child", key: "child" }]
                    }
                ]
            });

            const tree: Fancytree.Fancytree = $tree.fancytree("getTree");

            // The rendered node scrolls normally.
            await tree.getNodeByKey("child").scrollIntoView();

            // Simulate a batchUpdate() window: rendering is suspended while nodes are
            // recreated (as entitiesReloadedEvent does via node.load(true) during a sync).
            tree.enableUpdate(false);
            const parent = tree.getNodeByKey("parent");
            parent.removeChildren();
            parent.addChildren({ title: "recreated child", key: "recreated" });
            // node.load() restores the expanded flag the same way after a forced reload
            await parent.setExpanded(true, { noAnimation: true, noEvents: true });

            const recreated = tree.getNodeByKey("recreated");
            expect(recreated.span).toBeFalsy(); // no markup was created,
            expect(recreated.isVisible()).toBe(true); // yet fancytree considers the node visible

            // Without the patch both of these threw
            // "TypeError: Cannot read properties of undefined (reading 'top')".
            await recreated.scrollIntoView();
            await recreated.setActive(true, { noEvents: true, noFocus: true });

            tree.enableUpdate(true);
            expect(recreated.span).toBeTruthy(); // re-enabling updates renders the node
        } finally {
            $tree.remove();
        }
    });
});

describe("NoteTreeWidget", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    /** Renders the widget shallowly — fancytree init (which needs a live froca tree) is stubbed out. */
    async function renderWidget() {
        const widget = new NoteTreeWidget();
        vi.spyOn(widget, "initFancyTree").mockImplementation(() => {});
        widget.doRender();
        // Let doRender's init promise chain settle against the stub above.
        await new Promise((resolve) => setTimeout(resolve));
        return widget;
    }

    it("creates new notes in the tree's own note context (not the active tab's)", async () => {
        const widget = await renderWidget();
        const noteContext = { ntxId: "popup-ctx" };
        (widget as { noteContext?: unknown }).noteContext = noteContext;

        const fakeNode = { data: { isProtected: true } };
        vi.spyOn($.ui.fancytree, "getNode").mockReturnValue(fakeNode as unknown as Fancytree.FancytreeNode);
        vi.spyOn(treeService, "getNotePath").mockReturnValue("root/parent");
        const createNote = vi.spyOn(noteCreateService, "createNote").mockResolvedValue(undefined as never);

        const button = document.createElement("div");
        button.className = "add-note-button";
        widget.$widget.find(".tree").append(button);
        button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));

        expect(createNote).toHaveBeenCalledWith("root/parent", {
            isProtected: true,
            noteContext
        });
    });

    it("refresh() consults hoisting with the tree's own hoistedNoteId for hidden-subtree paths", async () => {
        const widget = await renderWidget();
        (widget as { noteContext?: unknown }).noteContext = {
            notePath: "root/_hidden/_taskStates",
            hoistedNoteId: "_taskStates"
        };

        // Neutralise the parts of refresh() that need a live fancytree.
        vi.spyOn(widget, "isEnabled").mockReturnValue(false);
        vi.spyOn(widget, "activityDetected").mockImplementation(() => {});
        vi.spyOn(widget, "getActiveNode").mockReturnValue(null);
        vi.spyOn(widget, "getNodeFromPath").mockResolvedValue(undefined);
        vi.spyOn(widget, "filterHoistedBranch").mockResolvedValue(undefined);
        const isHoisted = vi.spyOn(hoistedNoteService, "isHoistedInHiddenSubtree").mockResolvedValue(false);

        await widget.refresh();

        // The popup's own hoisted note is passed explicitly — not the active tab's.
        expect(isHoisted).toHaveBeenCalledWith("_taskStates");
    });
});

describe("ghost-note reconcile after cut/move (#7288)", () => {
    const widgets: NoteTreeWidget[] = [];

    afterEach(() => {
        vi.restoreAllMocks();
        for (const widget of widgets) {
            widget.$widget.remove();
        }
        widgets.length = 0;
    });

    async function mountTree(source: object[]) {
        const widget = new NoteTreeWidget();
        vi.spyOn(widget, "initFancyTree").mockImplementation(() => {});
        widget.doRender();
        await new Promise((resolve) => setTimeout(resolve));

        widget.$widget.appendTo(document.body);
        widgets.push(widget);

        const $tree = widget.$widget.find(".tree");
        $tree.fancytree({
            source,
            minExpandLevel: 1
        });
        setTree(widget, $tree.fancytree("getTree"));
        vi.spyOn(widget, "filterHoistedBranch").mockResolvedValue(undefined);
        vi.spyOn(widget, "getActiveNode").mockReturnValue(null);
        vi.spyOn(widget, "getNodesByNoteId").mockImplementation((noteId: string) => {
            const node = treeOf(widget).getNodeByKey(noteId);
            return node ? [node] : [];
        });
        return widget;
    }

    function nodeData(noteId: string, branchId: string, extra: object = {}) {
        return { title: noteId, key: noteId, noteId, branchId, ...extra };
    }

    function childNoteIds(node: Fancytree.FancytreeNode | null) {
        return (node?.getChildren() ?? []).map((child) => child.data.noteId);
    }

    it("updateNode removes a leftover child whose branch froca already dropped", async () => {
        const parent = buildNote({ title: "Main", children: [{ title: "Ghost" }] });
        const ghostNoteId = parent.children[0];
        const ghostBranchId = parent.childToBranch[ghostNoteId];

        const widget = await mountTree([
            nodeData(parent.noteId, "root_main", {
                folder: true,
                expanded: true,
                children: [nodeData(ghostNoteId, ghostBranchId)]
            })
        ]);

        delete froca.branches[ghostBranchId];
        const ghost = treeOf(widget).getNodeByKey(ghostNoteId);
        expect(ghost).toBeTruthy();

        await widget.updateNode(ghost);

        expect(treeOf(widget).getNodeByKey(ghostNoteId)).toBeFalsy();
    });

    it("updateNode leaves a parent-less node standing when its branch is gone", async () => {
        const note = buildNote({ title: "Rootish" });
        const widget = await mountTree([nodeData(note.noteId, "gone-branch")]);
        const node = treeOf(widget).getNodeByKey(note.noteId);
        vi.spyOn(node, "getParent").mockReturnValue(null as unknown as Fancytree.FancytreeNode);

        await widget.updateNode(node);

        expect(treeOf(widget).getNodeByKey(note.noteId)).toBeTruthy();
    });

    it("reconcile drops a ghost at the old parent, skips search notes, and ignores rows without a parent", async () => {
        const parent = buildNote({
            title: "Main",
            children: [{ title: "Kept" }, { title: "Ghost" }]
        });
        const keptId = parent.children[0];
        const ghostId = parent.children[1];
        const ghostBranchId = parent.childToBranch[ghostId];
        const searchNote = buildNote({ title: "Search", type: "search" });

        const widget = await mountTree([
            nodeData(parent.noteId, "root_main", {
                folder: true,
                expanded: true,
                children: [
                    nodeData(keptId, parent.childToBranch[keptId]),
                    nodeData(ghostId, ghostBranchId)
                ]
            })
        ]);

        parent.children = parent.children.filter((id) => id !== ghostId);
        delete parent.childToBranch[ghostId];
        delete froca.branches[ghostBranchId];

        const loadResults = new LoadResults([]);
        loadResults.addBranch(ghostBranchId, "comp", { parentNoteId: parent.noteId, isDeleted: true });
        loadResults.addBranch("search-row", "comp", { parentNoteId: searchNote.noteId, isDeleted: true });
        loadResults.addBranch("no-parent-row", "comp", { isDeleted: true });

        await widget.entitiesReloadedEvent({ loadResults });

        expect(treeOf(widget).getNodeByKey(ghostId)).toBeFalsy();
        expect(treeOf(widget).getNodeByKey(keptId)).toBeTruthy();
    });

    it("reconcile adds a missing child, fills an unloaded expanded folder from froca, and strips leftovers from a leaf", async () => {
        const parent = buildNote({
            title: "Main",
            children: [{ title: "AlreadyThere" }, { title: "MissingInTree" }]
        });
        const thereId = parent.children[0];
        const missingId = parent.children[1];

        const dest = buildNote({ title: "Dest", children: [{ title: "Incoming" }] });
        const incomingId = dest.children[0];
        const destBranchId = `holder_${dest.noteId}`;
        froca.branches[destBranchId] = new FBranch(froca, {
            branchId: destBranchId,
            noteId: dest.noteId,
            parentNoteId: "holder",
            notePosition: 0,
            fromSearchNote: false,
            isExpanded: true
        });

        const leaf = buildNote({ title: "Leaf" });
        const stray = buildNote({ title: "Stray" });

        const widget = await mountTree([
            nodeData(parent.noteId, "root_main", {
                folder: true,
                expanded: true,
                children: [nodeData(thereId, parent.childToBranch[thereId])]
            }),
            nodeData(dest.noteId, destBranchId, {
                folder: true,
                lazy: true
            }),
            nodeData(leaf.noteId, "root_leaf", {
                folder: false,
                expanded: true,
                children: [nodeData(stray.noteId, "stray-branch")]
            })
        ]);

        const destNode = treeOf(widget).getNodeByKey(dest.noteId);
        destNode.data.branchId = destBranchId;

        const loadResults = new LoadResults([]);
        loadResults.addBranch("p", "comp", { parentNoteId: parent.noteId });
        loadResults.addBranch("d", "comp", { parentNoteId: dest.noteId });
        loadResults.addBranch("l", "comp", { parentNoteId: leaf.noteId });

        await widget.entitiesReloadedEvent({ loadResults });

        expect(childNoteIds(treeOf(widget).getNodeByKey(parent.noteId))).toContain(missingId);
        expect(childNoteIds(treeOf(widget).getNodeByKey(dest.noteId))).toContain(incomingId);
        expect(childNoteIds(treeOf(widget).getNodeByKey(leaf.noteId))).not.toContain(stray.noteId);
    });

    it("skips a to-add branch that vanished from froca and a prepareNode that returns null", async () => {
        const parent = buildNote({ title: "P", children: [{ title: "SkipMe" }, { title: "AddMe" }] });
        const skipId = parent.children[0];
        const addId = parent.children[1];
        const skipBranchId = parent.childToBranch[skipId];
        const addBranchId = parent.childToBranch[addId];
        const widget = await mountTree([
            nodeData(parent.noteId, "root_p", { folder: true, expanded: true, children: [] })
        ]);

        vi.spyOn(widget, "prepareChildren").mockReturnValue([
            { branchId: "already-gone" } as Fancytree.FancytreeNewNode,
            { branchId: skipBranchId } as Fancytree.FancytreeNewNode,
            { branchId: addBranchId } as Fancytree.FancytreeNewNode,
            { title: "no-id" } as Fancytree.FancytreeNewNode
        ]);
        const originalPrepareNode = widget.prepareNode.bind(widget);
        vi.spyOn(widget, "prepareNode").mockImplementation((branch, forceLazy) => {
            if (branch.branchId === skipBranchId) {
                return null;
            }
            return originalPrepareNode(branch, forceLazy);
        });

        const loadResults = new LoadResults([]);
        loadResults.addBranch("p", "comp", { parentNoteId: parent.noteId });
        await widget.entitiesReloadedEvent({ loadResults });

        expect(childNoteIds(treeOf(widget).getNodeByKey(parent.noteId))).toEqual([addId]);
    });
});

describe("the drop marker's distance from the row boundary", () => {
    const shift = () => document.body.style.getPropertyValue("--tree-drop-marker-shift");

    /** A row of `rowHeight` around a title of `titleHeight`, which is all the measurement reads. */
    function nodeWithRow(rowHeight: number, titleHeight: number) {
        const row = document.createElement("span");
        const title = document.createElement("span");
        title.className = "fancytree-title";
        row.appendChild(title);

        vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ height: rowHeight } as DOMRect);
        vi.spyOn(title, "getBoundingClientRect").mockReturnValue({ height: titleHeight } as DOMRect);

        return { span: row } as Fancytree.FancytreeNode;
    }

    it("is half the room the row leaves around its title", () => {
        // dnd5 anchors on the title's edge, which is that far from the boundary the note lands on.
        publishDropMarkerShift(nodeWithRow(34, 18));
        expect(shift()).toBe("8px");

        // A larger tree font fills more of its row, so the two edges are closer together.
        publishDropMarkerShift(nodeWithRow(48, 40));
        expect(shift()).toBe("4px");
    });

    it("leaves the last measurement standing for a node that has no markup", () => {
        publishDropMarkerShift(nodeWithRow(34, 18));
        // A node can be dragged over before fancytree has rendered it; measuring nothing would put
        // the line back on the title's edge rather than on the boundary.
        publishDropMarkerShift({ span: undefined } as unknown as Fancytree.FancytreeNode);

        expect(shift()).toBe("8px");
    });
});
