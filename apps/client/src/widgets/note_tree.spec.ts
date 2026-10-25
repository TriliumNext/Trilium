import $ from "jquery";
import { afterEach, describe, expect, it, vi } from "vitest";

import appContext from "../components/app_context.js";
import type { EventData } from "../components/app_context.js";
import type TabManager from "../components/tab_manager.js";
import froca from "../services/froca.js";
import hoistedNoteService from "../services/hoisted_note.js";
import noteCreateService from "../services/note_create.js";
import options from "../services/options.js";
import protectedSessionHolder from "../services/protected_session_holder.js";
import server from "../services/server.js";
import treeService from "../services/tree.js";
import ws from "../services/ws.js";
import { buildNote } from "../test/easy-froca.js";
import NoteTreeWidget, { publishDropMarkerShift } from "./note_tree.js";

vi.mock("../services/import.js", () => ({ uploadFiles: vi.fn() }));
vi.mock("../services/i18n.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../services/i18n.js")>()),
    t: (key: string) => key
}));

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

    it("opens a new launcher in the tree's own note context, keeping the dialog that holds the tree open", async () => {
        const widget = await renderWidget();
        const treeContext = { ntxId: "_tree-popup", setNote: vi.fn() };
        const activeContext = { ntxId: "tab", setNote: vi.fn() };
        (widget as { noteContext?: unknown }).noteContext = treeContext;
        vi.spyOn(server, "post").mockResolvedValue({ success: true, note: { noteId: "newLauncher" } });
        vi.spyOn(ws, "waitForMaxKnownEntityChangeId").mockResolvedValue(undefined);

        const tabManager = appContext.tabManager;
        appContext.tabManager = { getActiveContext: () => activeContext } as unknown as TabManager;
        try {
            await widget.createLauncherNote({ data: { noteId: "_lbVisibleLaunchers" } } as unknown as Fancytree.FancytreeNode, "note");
        } finally {
            appContext.tabManager = tabManager;
        }

        expect(treeContext.setNote).toHaveBeenCalledWith("newLauncher", { keepActiveDialog: true });
        expect(activeContext.setNote).not.toHaveBeenCalled();
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

    describe("the title of a protected note", () => {
        function prepareProtectedNode(isUnlocked: boolean) {
            vi.spyOn(protectedSessionHolder, "isProtectedSessionAvailable").mockReturnValue(isUnlocked);
            const parent = buildNote({ title: "Parent", children: [ { title: "R&D" } ] });
            const childNoteId = parent.children[0];
            const branch = froca.getBranch(`${parent.noteId}_${childNoteId}`);
            if (!branch) {
                throw new Error("fixture missing");
            }
            froca.notes[childNoteId].isProtected = true;
            branch.prefix = "Prefix";

            return new NoteTreeWidget().prepareNode(branch);
        }

        it("reads Protected while the protected session is locked", () => {
            const label = `<span class="protected-title">protected_session.locked_note_title</span>`;
            expect(prepareProtectedNode(false)?.title).toBe(`Prefix - ${label}`);
        });

        it("reads the note's own title inside the protected session", () => {
            expect(prepareProtectedNode(true)?.title).toBe("Prefix - R&amp;D");
        });
    });

    describe("restoring the active node after an entity reload", () => {
        async function reload(follow: boolean) {
            const widget = await renderWidget();
            vi.spyOn(options, "is").mockImplementation((name) => name === "treeScrollFollowNavigation" && follow);
            vi.spyOn(widget, "activityDetected").mockImplementation(() => {});
            vi.spyOn(widget, "getActiveNode").mockReturnValue({ hasFocus: () => false } as Fancytree.FancytreeNode);
            vi.spyOn(treeService, "getNotePath").mockReturnValue("root/parent/child");

            const tree = { options: { activeVisible: true } };
            (widget as unknown as { tree: unknown }).tree = tree;
            let activeVisibleOnActivation: boolean | undefined;
            const node = {
                data: { noteId: "child" },
                setActive: vi.fn(() => {
                    activeVisibleOnActivation = tree.options.activeVisible;
                })
            };
            const getNodeFromPath = vi.spyOn(widget, "getNodeFromPath")
                .mockResolvedValue(node as unknown as Fancytree.FancytreeNode);

            await widget.entitiesReloadedEvent({
                loadResults: {
                    isEmptyForTree: () => false,
                    getAttributeRows: () => [],
                    getBranchRows: () => [],
                    getNoteIds: () => [],
                    getNoteReorderings: () => []
                }
            } as unknown as EventData<"entitiesReloaded">);

            return { getNodeFromPath, node, activeVisibleOnActivation };
        }

        it("keeps collapsed ancestors collapsed when the tree does not follow the active note (#12220)", async () => {
            const { getNodeFromPath, node, activeVisibleOnActivation } = await reload(false);
            expect(getNodeFromPath).toHaveBeenCalledWith("root/parent/child", false, false);
            expect(node.setActive).toHaveBeenCalled();
            expect(activeVisibleOnActivation).toBe(false);
        });

        it("expands to the active note when the tree follows it", async () => {
            const { getNodeFromPath, node, activeVisibleOnActivation } = await reload(true);
            expect(getNodeFromPath).toHaveBeenCalledWith("root/parent/child", true, false);
            expect(node.setActive).toHaveBeenCalled();
            expect(activeVisibleOnActivation).toBe(true);
        });
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

describe("drags onto the tree", () => {
    const target = { data: { noteId: "target", noteType: "text" } };

    afterEach(() => {
        vi.restoreAllMocks();
    });

    /** The fancytree drag-and-drop handlers the widget registers, with no live tree behind them. */
    async function getDndHandlers() {
        const widget = new NoteTreeWidget();
        let treeOptions: Fancytree.FancytreeOptions | undefined;
        vi.spyOn(widget, "prepareRootNode").mockReturnValue({ key: "root" } as never);
        vi.spyOn($.fn, "fancytree").mockImplementation(function (this: JQuery, opts: unknown) {
            treeOptions = opts as Fancytree.FancytreeOptions;
            return this;
        } as never);
        vi.spyOn($.ui.fancytree, "getTree").mockReturnValue({} as never);

        widget.doRender();
        // Let doRender's init promise chain settle against the stubs above.
        await new Promise((resolve) => setTimeout(resolve));
        widget.initFancyTree();

        return treeOptions?.dnd5 as {
            dragEnter(node: unknown, data: unknown): unknown;
            dragDrop(node: unknown, data: unknown): Promise<void>;
        };
    }

    it("tags dropped files \"auto\", so the importer can recognize an archive", async () => {
        const file = new File(["zip bytes"], "MyVault.zip");
        const dnd = await getDndHandlers();
        await dnd.dragDrop(target, {
            hitMode: "over",
            dataTransfer: { files: [ file ], getData: () => "" }
        });

        const { uploadFiles } = await import("../services/import.js");
        expect(uploadFiles).toHaveBeenCalledWith("notes", "target", [file], expect.objectContaining({ format: "auto" }));
    });

    it("refuses content dragged out of a text note, which carries no notes", async () => {
        vi.spyOn(hoistedNoteService, "getHoistedNoteId").mockReturnValue("root");
        const dnd = await getDndHandlers();
        const dragOf = (...types: string[]) => ({ dataTransfer: { types } });

        const editorTypes = [ "text/plain", "text/html", "application/ckeditor5-dragging-uid" ];
        expect(dnd.dragEnter(target, dragOf(...editorTypes))).toBe(false);
        expect(dnd.dragEnter(target, dragOf("text/plain", "text/html"))).toBe(true);
    });
});
