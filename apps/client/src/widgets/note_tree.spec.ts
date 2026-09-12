import $ from "jquery";
import { afterEach, describe, expect, it, vi } from "vitest";

import hoistedNoteService from "../services/hoisted_note.js";
import noteCreateService from "../services/note_create.js";
import treeService from "../services/tree.js";
import NoteTreeWidget, { publishDropMarkerShift } from "./note_tree.js";

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
