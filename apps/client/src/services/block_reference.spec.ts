import type { CKTextEditor, EditorConfig, ModelElement } from "@triliumnext/ckeditor5";
import { CANVAS_ATTACHMENT_MIME, MERMAID_ATTACHMENT_MIME } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommandNames } from "../components/app_context.js";
import type FNote from "../entities/fnote.js";
import type { MenuCommandItem, MenuHeader, MenuItem } from "../menus/context_menu.js";
import {
    type BlockHandleMenuActions,
    buildBlockReferenceMenuItems, buildReferenceConfig, consumeBlockReference, copyBlockReference,
    copyBlockShareLink, copyTabReference, getClipboardBlockReference, highlightBlockReference,
    openBlockHandleMenu, revealHighlightedBlocks
} from "./block_reference.js";
import type { ViewScope } from "./link.js";

const {
    showError, showMessage, showMenu, copyHtmlWithToast, copyTextWithToast, getTextEditorContaining,
    getNote, getNoteShareLink, buildSortSelectionMenuItem, attachments, menuState
} = vi.hoisted(() => ({
    buildSortSelectionMenuItem: vi.fn(),
    getNoteShareLink: vi.fn(),
    showError: vi.fn(),
    showMessage: vi.fn(),
    showMenu: vi.fn(),
    copyHtmlWithToast: vi.fn(),
    copyTextWithToast: vi.fn(),
    getTextEditorContaining: vi.fn(),
    getNote: vi.fn(),
    attachments: {} as Record<string, { mime: string }>,
    menuState: { dismissedByLastPress: false }
}));
vi.mock("./i18n.js", () => ({
    t: (key: string, options?: Record<string, unknown>) =>
        options ? `${key}:${Object.values(options).join(",")}` : key
}));
vi.mock("./toast.js", () => ({ default: { showError, showMessage } }));
vi.mock("../menus/context_menu.js", () => ({
    default: {
        show: showMenu,
        get dismissedByLastPress() {
            return menuState.dismissedByLastPress;
        }
    }
}));
vi.mock("../menus/text_editor_context_menu.js", async (importOriginal) => ({
    ...await importOriginal<typeof import("../menus/text_editor_context_menu.js")>(),
    buildSortSelectionMenuItem, getTextEditorContaining
}));
vi.mock("./clipboard_ext.js", () => ({ copyHtmlWithToast, copyTextWithToast }));
vi.mock("./froca.js", () => ({ default: { getNote, attachments } }));
vi.mock("./content_renderer.js", () => ({
    EXCERPT_BOX_SIZE: "full",
    getEmbedBoxSize: () => "medium"
}));

vi.mock("./share_link.js", () => ({ getNoteShareLink }));

const scrollBy = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    menuState.dismissedByLastPress = false;
    vi.useFakeTimers();
    Element.prototype.scrollBy = scrollBy;
});

afterEach(() => {
    vi.useRealTimers();
});

describe("consumeBlockReference", () => {
    it("shows the blocks and consumes the reference", () => {
        const container = buildContainer("<p data-trilium-block-id=\"a\">A</p>");
        const viewScope: ViewScope = { block: "a" };

        consumeBlockReference(container, viewScope);

        expect(scrollBy).toHaveBeenCalledOnce();
        expect(getFlashed(container)).toEqual([ "A" ]);
        expect(viewScope.block).toBeUndefined();
        expect(showError).not.toHaveBeenCalled();
    });

    it("says so when a block is missing or the reference is malformed", () => {
        const container = buildContainer("<p data-trilium-block-id=\"b\">B</p>");

        consumeBlockReference(container, { block: "gone:b" });
        consumeBlockReference(container, { block: "gone" });
        consumeBlockReference(container, { block: "a:b:c" });

        expect(getFlashed(container)).toEqual([ "B" ]);
        expect(showError).toHaveBeenCalledTimes(3);
        expect(showError).toHaveBeenCalledWith("block_reference.not_found");
    });

    it("waits for the content, and does nothing without a reference", () => {
        const viewScope: ViewScope = { block: "a" };

        consumeBlockReference(null, viewScope);
        consumeBlockReference(buildContainer(""), {});
        consumeBlockReference(buildContainer(""), undefined);

        expect(viewScope.block).toBe("a");
        expect(showError).not.toHaveBeenCalled();
    });
});

describe("highlightBlockReference", () => {
    it("highlights a range and opens the collapsed blocks at its ends", () => {
        const container = buildContainer(
            "<details><summary>s1</summary><p data-trilium-block-id=\"a\">A</p></details>"
            + "<blockquote><p>quote</p></blockquote>"
            + "<details><summary>s2</summary><p data-trilium-block-id=\"b\">B</p></details>"
        );

        highlightBlockReference(container, "a:b");

        expect(getHighlighted(container)).toEqual([ "A", "quote", "s2", "B" ]);
        expect([ ...container.querySelectorAll("details") ].map((details) => details.open))
            .toEqual([ true, true ]);
    });

    it("highlights the block found of a broken range, and nothing for a missing block", () => {
        const container = buildContainer("<p data-trilium-block-id=\"b\">B</p><p>other</p>");

        highlightBlockReference(container, "gone");
        highlightBlockReference(container, "a:b:c");
        expect(getHighlighted(container)).toEqual([]);

        highlightBlockReference(container, "gone:b");
        expect(getHighlighted(container)).toEqual([ "B" ]);
    });
});

describe("revealHighlightedBlocks", () => {
    it("centers the highlighted blocks, or scrolls to their top when they don't fit", () => {
        const container = buildContainer(
            "<p>before</p><p class=\"block-reference-highlight\">A</p>"
            + "<p class=\"block-reference-highlight\">B</p>"
        );
        const [ , first, last ] = container.querySelectorAll("p");
        Object.defineProperty(container, "clientHeight", { value: 300 });
        stubRect(container, 100, 400);
        stubRect(first, 600, 650);
        stubRect(last, 650, 700);

        revealHighlightedBlocks(container);
        expect(container.scrollTop).toBe(400);

        container.scrollTop = 0;
        stubRect(last, 650, 1200);
        revealHighlightedBlocks(container);
        expect(container.scrollTop).toBe(500);
    });

    it("measures a highlighted tab from the top of its title to the bottom of its panel", () => {
        const container = buildContainer(
            "<div class=\"trilium-tabs\"><section class=\"trilium-tab block-reference-highlight\">"
            + "<p class=\"trilium-tab-title\">A</p><div class=\"trilium-tab-panel\"><p>a</p></div>"
            + "</section></div>"
        );
        const title = container.querySelector(".trilium-tab-title");
        const panel = container.querySelector(".trilium-tab-panel");
        expect(title).not.toBeNull();
        expect(panel).not.toBeNull();
        Object.defineProperty(container, "clientHeight", { value: 300 });
        stubRect(container, 100, 400);
        stubRect(title as Element, 600, 630);
        stubRect(panel as Element, 630, 700);

        revealHighlightedBlocks(container);

        expect(container.scrollTop).toBe(400);
    });

    it("leaves the scroll position alone without highlighted blocks", () => {
        const container = buildContainer("<p>A</p>");
        container.scrollTop = 20;

        revealHighlightedBlocks(container);

        expect(container.scrollTop).toBe(20);
    });
});

describe("copyBlockReference", () => {
    it("copies a link to the selected blocks, named by their text, and flashes them", async () => {
        const root = buildContainer(
            "<p>one</p><p data-trilium-block-id=\"s1\">Start</p>"
            + "<p data-trilium-block-id=\"e1\">End</p>"
        );
        const editor = buildEditor(root, { startId: "s1", endId: "e1", count: 2 });

        await copyBlockReference(editor, "root/p1/n1", "Note");

        const href = "#root/p1/n1?block=s1:e1";
        expect(editor.execute).toHaveBeenCalledWith("assignBlockReference");
        expect(copyHtmlWithToast).toHaveBeenCalledWith(
            `<a class="reference-link" href="${href}">Note - Start … End</a>`,
            href
        );
        expect(getFlashed(root)).toEqual([ "Start", "End" ]);
    });

    it("copies nothing when no block is referenced", async () => {
        const root = buildContainer("<p>one</p>");

        await copyBlockReference(buildEditor(root, undefined), "root/n1", "Note");
        const missingTarget = { startId: "x", endId: "x", count: 1 };
        await copyBlockReference(buildEditor(root, missingTarget), "root/n1", "Note");

        expect(copyHtmlWithToast).not.toHaveBeenCalled();
    });
});

describe("copyTabReference", () => {
    it("copies a link to the tab holding the selection, named by its title, and flashes it", async () => {
        const root = buildContainer(
            "<div class=\"trilium-tabs\"><section class=\"trilium-tab\" data-trilium-block-id=\"t1\">"
            + "<p class=\"trilium-tab-title\">Linux</p>"
            + "<div class=\"trilium-tab-panel\"><p>Use the package.</p></div></section></div>"
        );
        const editor = buildEditor(root, { startId: "t1", endId: "t1", count: 1 });

        await copyTabReference(editor, "root/n1", "Note");

        const href = "#root/n1?block=t1";
        expect(editor.execute).toHaveBeenCalledWith("assignTabReference");
        expect(copyHtmlWithToast).toHaveBeenCalledWith(
            `<a class="reference-link" href="${href}">Note - Linux</a>`,
            href
        );
        expect(root.querySelector(".trilium-tab")?.classList.contains("block-reference-flash")).toBe(true);
    });
});

describe("copyBlockShareLink", () => {
    it("copies a link to the selected blocks on the shared page and flashes them", () => {
        const root = buildContainer(
            "<p data-trilium-block-id=\"s1\">Start</p><p data-trilium-block-id=\"e1\">End</p>"
        );
        const editor = buildEditor(root, { startId: "s1", endId: "e1", count: 2 });

        copyBlockShareLink(editor, "https://notes.example.com/share/page");

        expect(editor.execute).toHaveBeenCalledWith("assignBlockReference");
        expect(copyTextWithToast).toHaveBeenCalledWith(
            "https://notes.example.com/share/page?block=s1:e1"
        );
        expect(getFlashed(root)).toEqual([ "Start", "End" ]);
    });

    it("copies nothing when no block is referenced", () => {
        const root = buildContainer("<p>one</p>");
        const shareLink = "https://notes.example.com/share/page";

        copyBlockShareLink(buildEditor(root, undefined), shareLink);
        const missingTarget = { startId: "x", endId: "x", count: 1 };
        copyBlockShareLink(buildEditor(root, missingTarget), shareLink);

        expect(copyTextWithToast).not.toHaveBeenCalled();
    });
});

describe("openBlockHandleMenu", () => {
    it("offers the copy items, then the sort and the delete item after separators", () => {
        const event = new MouseEvent("contextmenu", { clientX: 10, clientY: 20 });
        const blocks = [ buildBlock("paragraph"), buildBlock("table"), buildBlock("paragraph") ];
        const header = { kind: "header", title: "block_reference.block_count:3" };
        const copyReference = vi.fn();
        const copyShareLink = vi.fn();
        const copyItem = expect.objectContaining({
            title: "block_reference.copy_reference",
            handler: copyReference
        });

        const deleteBlocks = vi.fn();
        const deleteItem = expect.objectContaining({
            title: "block_reference.delete",
            handler: deleteBlocks
        });

        openBlockHandleMenu(event, blocks, { copyReference });
        openBlockHandleMenu(event, blocks, { copyReference, copyShareLink });
        openBlockHandleMenu(event, blocks, { copyReference, sortItem: { title: "SORT" } });
        openBlockHandleMenu(event, blocks, { copyReference, deleteBlocks });
        openBlockHandleMenu(event, blocks, {
            copyReference, sortItem: { title: "SORT" }, deleteBlocks
        });
        openBlockHandleMenu(event, blocks, { insertItems: [ { title: "INSERT" } ], copyReference });

        expect(showMenu).toHaveBeenNthCalledWith(1, expect.objectContaining({
            x: event.pageX,
            y: event.pageY,
            items: [ header, copyItem ]
        }));
        expect(showMenu).toHaveBeenNthCalledWith(2, expect.objectContaining({
            items: [ header, copyItem, expect.objectContaining({
                title: "block_reference.copy_share_link",
                handler: copyShareLink
            }) ]
        }));
        expect(showMenu).toHaveBeenNthCalledWith(3, expect.objectContaining({
            items: [ header, copyItem, { kind: "separator" }, { title: "SORT" } ]
        }));
        expect(showMenu).toHaveBeenNthCalledWith(4, expect.objectContaining({
            items: [ header, copyItem, { kind: "separator" }, deleteItem ]
        }));
        expect(showMenu).toHaveBeenNthCalledWith(5, expect.objectContaining({
            items: [
                header, copyItem, { kind: "separator" }, { title: "SORT" },
                { kind: "separator" }, deleteItem
            ]
        }));
        expect(showMenu).toHaveBeenNthCalledWith(6, expect.objectContaining({
            items: [ header, { title: "INSERT" }, { kind: "separator" }, copyItem ]
        }));
    });

    it("opens below a clicked handle, unless the press closed the menu", () => {
        const handle = document.createElement("button");
        const rightClick = new MouseEvent("contextmenu", { clientX: 10, clientY: 20 });
        const blocks = [ buildBlock("paragraph") ];
        const onClose = vi.fn();

        openBlockHandleMenu(handle, blocks, { copyReference: vi.fn() }, null, onClose);
        menuState.dismissedByLastPress = true;
        openBlockHandleMenu(handle, blocks, { copyReference: vi.fn() }, null, onClose);
        openBlockHandleMenu(rightClick, blocks, { copyReference: vi.fn() }, null, onClose);

        const [ below, atPointer ] = showMenu.mock.calls.map(([ options ]) => options);
        expect(showMenu).toHaveBeenCalledTimes(2);
        expect(below).toMatchObject({ anchor: handle });
        expect(below).not.toHaveProperty("x");
        expect(atPointer).toMatchObject({ x: rightClick.pageX, y: rightClick.pageY });
        expect(atPointer).not.toHaveProperty("anchor");
        expect(onClose).toHaveBeenCalledOnce();
    });

    it("heads the menu with the type of a single block", () => {
        attachments.drawing1 = { mime: CANVAS_ATTACHMENT_MIME };
        attachments.diagram1 = { mime: MERMAID_ATTACHMENT_MIME };
        attachments.file1 = { mime: "application/pdf" };
        const blocks = [
            buildBlock("paragraph"),
            buildBlock("heading3"),
            buildBlock("paragraph", { listItemId: "a", listType: "bulleted" }),
            buildBlock("paragraph", { listItemId: "b", listType: "numbered" }),
            buildBlock("paragraph", { listItemId: "c", listType: "todo" }),
            buildBlock("table"),
            buildBlock("aside"),
            buildBlock("details"),
            buildBlock("multicolumnLayout"),
            buildBlock("footnoteContent"),
            buildBlock("contentEmbed", { url: "https://example.com/a.mp4", embedType: "video" }),
            buildBlock("contentEmbed", { url: "https://example.com/a.mp3", embedType: "audio" }),
            buildBlock("contentEmbed", { language: "mermaid", source: "graph TD" }),
            buildBlock("contentEmbed", { language: "text-plain", source: "code" }),
            buildBlock("contentEmbed", { noteId: "n1" }),
            buildBlock("contentEmbed", { noteId: "n1", block: "a:b" }),
            buildBlock("contentEmbed", { attachmentId: "drawing1" }),
            buildBlock("contentEmbed", { attachmentId: "diagram1" }),
            buildBlock("contentEmbed", { attachmentId: "file1" }),
            buildBlock("contentEmbed", { attachmentId: "notLoaded" }),
            buildBlock("contentEmbed", { uploadId: "u1" }),
            buildBlock("htmlDivParagraph")
        ];

        const titles = blocks.map((block) => {
            openBlockHandleMenu(new MouseEvent("contextmenu"), [ block ], {
                copyReference: vi.fn()
            });
            return showMenu.mock.lastCall?.[0].items[0].title;
        });

        expect(titles).toEqual([
            "paragraph", "heading:3", "list_item", "list_item", "todo_item", "table",
            "admonition", "collapsible", "columns", "footnote", "video", "audio", "mermaid",
            "code_block", "included_note", "excerpt", "drawing", "mermaid", "attachment",
            "attachment", "attachment", "block"
        ].map((type) => `block_reference.types.${type}`));
    });

    it("gives the heading of a single block a button that opens the help page of its type", () => {
        const openHelpPage = vi.fn();
        const getHeader = (blocks: ModelElement[], actions: BlockHandleMenuActions = {
            copyReference: vi.fn(), openHelpPage
        }) => {
            openBlockHandleMenu(new MouseEvent("contextmenu"), blocks, actions);
            return showMenu.mock.lastCall?.[0].items[0] as MenuHeader;
        };
        const runHelp = (header: MenuHeader) =>
            header.actions?.[0]?.callback(new MouseEvent("click"));

        const table = getHeader([ buildBlock("table") ]);
        expect(table.actions).toEqual([ {
            icon: "bx bx-help-circle", caption: "open-help-page", callback: expect.any(Function)
        } ]);
        runHelp(table);
        runHelp(getHeader([ buildBlock("heading2") ]));
        expect(openHelpPage.mock.calls).toEqual([ [ "NdowYOC1GFKS" ], [ "Gr6xFaF6ioJ5" ] ]);

        expect(getHeader([ buildBlock("paragraph") ])).not.toHaveProperty("actions");
        expect(getHeader([ buildBlock("htmlDivParagraph") ])).not.toHaveProperty("actions");
        expect(getHeader([ buildBlock("table"), buildBlock("table") ]))
            .not.toHaveProperty("actions");
        expect(getHeader([ buildBlock("table") ], { copyReference: vi.fn() }))
            .not.toHaveProperty("actions");
    });
});

describe("buildReferenceConfig", () => {
    const note = { noteId: "n1", title: "Note" } as FNote;
    const tabHtml = "<div class=\"trilium-tabs\"><section class=\"trilium-tab\" "
        + "data-trilium-block-id=\"t1\"><p class=\"trilium-tab-title\">Linux</p></section></div>"
        + "<p data-trilium-block-id=\"s1\">Start</p>";

    function buildSource(notePath?: string) {
        const root = buildContainer(tabHtml);
        const editor = buildEditor(root, { startId: "s1", endId: "s1", count: 1 });
        vi.mocked(editor.execute).mockImplementation(((name: string) => name === "assignTabReference"
            ? { startId: "t1", endId: "t1", count: 1 }
            : { startId: "s1", endId: "s1", count: 1 }) as never);
        const save = vi.fn();
        const openHelpPage = vi.fn();
        const config = buildReferenceConfig({
            getEditor: () => editor,
            getNote: () => note,
            getNotePath: () => notePath,
            save,
            openHelpPage
        });
        return { config, editor, save, openHelpPage };
    }

    it("copies references to the blocks and the tab of the note, then saves it", async () => {
        const { config, save } = buildSource("root/p1/n1");

        config.blockReference?.copyReference?.();
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
        config.tabs?.copyReference?.();
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));

        expect(copyHtmlWithToast).toHaveBeenNthCalledWith(1,
            "<a class=\"reference-link\" href=\"#root/p1/n1?block=s1\">Note - Start</a>",
            "#root/p1/n1?block=s1");
        expect(copyHtmlWithToast).toHaveBeenNthCalledWith(2,
            "<a class=\"reference-link\" href=\"#root/p1/n1?block=t1\">Note - Linux</a>",
            "#root/p1/n1?block=t1");
        expect(copyHtmlWithToast.mock.invocationCallOrder[0])
            .toBeLessThan(save.mock.invocationCallOrder[0]);
    });

    it("opens the block handle menu, which copies references or deletes the blocks", async () => {
        const { config, editor, save, openHelpPage } = buildSource();
        const event = new MouseEvent("contextmenu");
        getNoteShareLink.mockReturnValue("https://notes.example.com/share/page");

        const blocks = [ buildBlock("paragraph") ];
        config.blockReference?.openHandleMenu?.(event, blocks, vi.fn());
        const items = showMenu.mock.calls[0][0].items as MenuItem<CommandNames>[];
        expect(items[0]).toEqual({ kind: "header", title: "block_reference.types.paragraph" });
        runItem(items[1]);
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
        runItem(items[2]);
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));

        expect(getNoteShareLink).toHaveBeenCalledWith(note);
        expect(copyHtmlWithToast).toHaveBeenCalledWith(expect.anything(), "#root/n1?block=s1");
        expect(copyTextWithToast).toHaveBeenCalledWith(
            "https://notes.example.com/share/page?block=s1");

        getNoteShareLink.mockReturnValue(null);
        config.blockReference?.openHandleMenu?.(event, blocks, vi.fn());
        expect(showMenu.mock.calls[1][0].items).toHaveLength(2);

        buildSortSelectionMenuItem.mockReturnValueOnce({ title: "SORT" });
        config.blockReference?.openHandleMenu?.(event, blocks, vi.fn());
        expect(buildSortSelectionMenuItem).toHaveBeenCalledWith(editor);
        expect(showMenu.mock.calls[2][0].items.at(-1)).toEqual({ title: "SORT" });

        vi.mocked(editor.commands.get).mockReturnValue({ isEnabled: true } as never);
        config.blockReference?.openHandleMenu?.(event, blocks, vi.fn());
        const deleteItem = showMenu.mock.calls[3][0].items.at(-1);
        expect(deleteItem).toMatchObject({ title: "block_reference.delete" });
        runItem(deleteItem);
        expect(editor.commands.get).toHaveBeenCalledWith("deleteBlocks");
        expect(editor.execute).toHaveBeenLastCalledWith("deleteBlocks");
        expect(editor.editing.view.focus).toHaveBeenCalledOnce();

        config.blockReference?.openHandleMenu?.(event, [ buildBlock("table") ], vi.fn());
        const header = showMenu.mock.lastCall?.[0].items[0] as MenuHeader;
        header.actions?.[0]?.callback(new MouseEvent("click"));
        expect(openHelpPage).toHaveBeenCalledWith("NdowYOC1GFKS");
    });

    /** Opens the block handle menu of `blocks` while only the commands in `enabled` are enabled. */
    function openInsertMenu(blocks: ModelElement[], enabled: string[], palette: object = {
        listAll: () => [], canInsertBeside: () => true, runBeside: vi.fn()
    }) {
        const { config, editor } = buildSource();
        vi.mocked(editor.plugins.has).mockReturnValue(true);
        vi.mocked(editor.plugins.get).mockReturnValue(palette as never);
        vi.mocked(editor.commands.get).mockImplementation(((name: string) =>
            ({ isEnabled: enabled.includes(name) })) as never);
        config.blockReference?.openHandleMenu?.(new MouseEvent("contextmenu"), blocks, vi.fn());
        const items = showMenu.mock.lastCall?.[0].items as MenuCommandItem<CommandNames>[];
        return { editor, items };
    }

    it("runs the palette's entries in a new paragraph above or below the blocks", () => {
        const definitions = [
            { id: "insertTable", title: "Table", icon: "<svg></svg>", willInsert: true },
            { id: "align-left", title: "Align left", icon: "<svg></svg>", willTransform: true }
        ];
        const palette = {
            listAll: () => definitions,
            canInsertBeside: vi.fn((_block: ModelElement, side: string) => side === "before"),
            runBeside: vi.fn()
        };
        const blocks = [ buildBlock("paragraph"), buildBlock("paragraph") ];
        const submenu = (title: string, uiIcon: string, enabled: boolean) => ({
            title,
            uiIcon,
            enabled,
            filterable: true,
            submenuClassName: "slash-command-menu",
            items: [ expect.objectContaining({ title: "Table", handler: expect.any(Function) }) ]
        });

        const { items } = openInsertMenu(blocks, [ "insertParagraph" ], palette);
        expect(items.slice(1, 4)).toEqual([
            submenu("block_reference.insert_above", "bx bx-arrow-to-top", true),
            submenu("block_reference.insert_below", "bx bx-arrow-to-bottom", false),
            { kind: "separator" }
        ]);
        runItem(items[1].items?.[0]);
        runItem(items[2].items?.[0]);
        expect(palette.runBeside.mock.calls).toEqual([
            [ definitions[0], blocks[0], "before" ],
            [ definitions[0], blocks[1], "after" ]
        ]);

        expect(openInsertMenu([], [ "insertParagraph" ], palette).items[1].title)
            .toBe("block_reference.copy_reference");
        expect(openInsertMenu(blocks, [], palette).items[1].title)
            .toBe("block_reference.copy_reference");
    });

    it("inserts list items beside a list item, and rows in a table cell", () => {
        const listItem = buildBlock("paragraph", { listItemId: "a" });
        const commands = [
            "triliumInsertListItemAbove", "triliumInsertListItemBelow",
            "triliumInsertChildListItem",
            "triliumInsertTableRowsAbove", "triliumInsertTableRowsBelow"
        ];
        const row = (title: string, uiIcon: string) =>
            ({ title, uiIcon, handler: expect.any(Function) });

        const { editor, items } = openInsertMenu([ listItem ], [ "insertParagraph", ...commands ]);
        expect(items.slice(1, 7)).toEqual([
            row("block_reference.insert_item_above", "bx bx-arrow-to-top"),
            row("block_reference.insert_item_below", "bx bx-arrow-to-bottom"),
            row("block_reference.insert_child_item", "bx bx-subdirectory-right"),
            row("table_context_menu.insert_rows_above", "bx bx-horizontal-left bx-rotate-90"),
            row("table_context_menu.insert_rows_below", "bx bx-horizontal-left bx-rotate-270"),
            { kind: "separator" }
        ]);
        for (const item of items.slice(1, 6)) {
            runItem(item);
        }
        expect(vi.mocked(editor.execute).mock.calls.map(([ name ]) => name)).toEqual(commands);
        expect(editor.editing.view.focus).toHaveBeenCalledTimes(5);
        expect(editor.editing.view.scrollToTheSelection).toHaveBeenCalledTimes(5);

        const titles = (blocks: ModelElement[], enabled: string[]) =>
            openInsertMenu(blocks, enabled).items.slice(1, 4).map((item) => item.title);
        expect(titles([ buildBlock("paragraph"), listItem ], [ "insertParagraph", ...commands ]))
            .toEqual([
                "block_reference.insert_above", "block_reference.insert_item_below",
                "block_reference.insert_child_item"
            ]);
        expect(titles([ listItem ], [ "insertParagraph" ]))
            .toEqual([ "block_reference.copy_reference" ]);
    });

    it("keeps the editor focused while the block handle menu is up, then reports it closed", () => {
        const { config, editor } = buildSource();
        const { focusTracker } = editor.ui;
        const container = document.createElement("div");
        const onClose = vi.fn();

        config.blockReference?.openHandleMenu?.(
            new MouseEvent("contextmenu"), [ buildBlock("paragraph") ], onClose);
        const { onShow, onHide } = showMenu.mock.calls[0][0];
        onShow?.(container);
        expect(focusTracker.add).toHaveBeenCalledWith(container);
        expect(focusTracker.remove).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        onHide?.();
        expect(focusTracker.remove).toHaveBeenCalledWith(container);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it("copies nothing before the editor or the note is there", async () => {
        const save = vi.fn();
        const config = buildReferenceConfig({
            getEditor: () => null,
            getNote: () => note,
            getNotePath: () => undefined,
            save
        });

        config.blockReference?.copyReference?.();
        config.tabs?.copyReference?.();
        await vi.runAllTimersAsync();

        expect(copyHtmlWithToast).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
    });
});

describe("getClipboardBlockReference", () => {
    it("reads the first link to blocks in the HTML, else the text, as a reference link", () => {
        const html = "<p><a href=\"https://example.com\">web</a><a href=\"#root/note0\">note</a>"
            + "<a href=\"#root/parent1/note1?block=s1%3Ae1\">blocks</a></p>";

        expect(getClipboardBlockReference({ html, text: "#root/note2?block=b2" })).toEqual({
            noteId: "note1",
            block: "s1:e1",
            href: "#root/parent1/note1?block=s1:e1"
        });
        expect(getClipboardBlockReference({
            html: "<p>No link</p>",
            text: " http://localhost:8080/#root/note2?block=b2&ntxId=x \n"
        })).toEqual({ noteId: "note2", block: "b2", href: "#root/note2?block=b2" });
    });

    it("finds none in a link to a whole note or with a malformed block parameter", () => {
        const texts = [
            "#root/note1", "#root/note1?block=", "#root/note1?block=a:b:c",
            "#root/note1?block=%E0", "plain text", ""
        ];

        for (const text of texts) {
            expect(getClipboardBlockReference({ html: "", text })).toBeNull();
        }
    });
});

describe("buildBlockReferenceMenuItems", () => {
    const element = document.createElement("p");
    const href = "#root/parent1/note1?block=s1:e1";

    it("copies a reference to the selected blocks through the editor config", async () => {
        const copyReference = vi.fn();
        const { editor } = buildMenuEditor({
            count: 3, hosts: { blockReference: { copyReference } }
        });
        getTextEditorContaining.mockResolvedValue(editor);

        const items = await buildBlockReferenceMenuItems(element);
        runItem(items?.copy);

        expect(getTextEditorContaining).toHaveBeenCalledWith(element);
        expect(items?.copy).toMatchObject({ title: "block_reference.copy:3" });
        expect(copyReference).toHaveBeenCalledTimes(1);
        expect(items?.paste).toEqual([]);
    });

    it("copies a link to the tab holding the selection through the editor config", async () => {
        const copyReference = vi.fn();
        const { editor } = buildMenuEditor({ hosts: { tabs: { copyReference } } });
        getTextEditorContaining.mockResolvedValue(editor);

        const items = await buildBlockReferenceMenuItems(element);
        runItem(items?.copyTab);

        expect(items?.copyTab).toMatchObject({ title: "block_reference.copy_tab" });
        expect(copyReference).toHaveBeenCalledTimes(1);

        getTextEditorContaining.mockResolvedValue(buildMenuEditor({
            isInTab: false, hosts: { tabs: { copyReference } }
        }).editor);
        expect((await buildBlockReferenceMenuItems(element))?.copyTab).toBeNull();
        getTextEditorContaining.mockResolvedValue(buildMenuEditor().editor);
        expect((await buildBlockReferenceMenuItems(element))?.copyTab).toBeNull();
    });

    it("offers no copy row where no reference can be made or the host cannot copy", async () => {
        const hosts = { blockReference: { copyReference: vi.fn() } };
        getTextEditorContaining.mockResolvedValue(buildMenuEditor({
            canReference: false, hosts
        }).editor);
        expect((await buildBlockReferenceMenuItems(element))?.copy).toBeNull();

        getTextEditorContaining.mockResolvedValue(buildMenuEditor().editor);
        expect((await buildBlockReferenceMenuItems(element))?.copy).toBeNull();
    });

    it("offers no rows outside a text editor with block references", async () => {
        getTextEditorContaining.mockResolvedValue(null);
        expect(await buildBlockReferenceMenuItems(element)).toBeNull();

        getTextEditorContaining.mockResolvedValue(buildMenuEditor({ hasPlugin: false }).editor);
        expect(await buildBlockReferenceMenuItems(element)).toBeNull();
    });

    it("pastes the reference on the clipboard as a link or an excerpt", async () => {
        const { editor, pasteTarget } = buildMenuEditor();
        getTextEditorContaining.mockResolvedValue(editor);
        getNote.mockResolvedValue({ noteId: "note1" });
        const clipboard = {
            enabled: true,
            read: vi.fn(async () => ({ html: `<a href="${href}">x</a>`, text: "" }))
        };

        const paste = (await buildBlockReferenceMenuItems(element, clipboard))?.paste ?? [];
        expect(paste).toMatchObject([
            { title: "block_reference.paste_as_link", enabled: true },
            { title: "block_reference.paste_as_excerpt", enabled: true }
        ]);

        runItem(paste[0]);
        await vi.waitFor(() => expect(pasteTarget.release).toHaveBeenCalledTimes(1));
        expect(editor.capturePasteTarget.mock.invocationCallOrder[0])
            .toBeLessThan(clipboard.read.mock.invocationCallOrder[0]);
        expect(pasteTarget.paste).toHaveBeenLastCalledWith(
            `<a class="reference-link" href="${href}">${href}</a>`, href);

        runItem(paste[1]);
        await vi.waitFor(() => expect(pasteTarget.release).toHaveBeenCalledTimes(2));
        expect(getNote).toHaveBeenCalledWith("note1", true);
        expect(pasteTarget.paste).toHaveBeenLastCalledWith(
            "<figure class=\"include-note\" data-note-id=\"note1\" data-block=\"s1:e1\""
            + " data-box-size=\"full\"></figure>",
            href
        );
    });

    it("disables the paste rows for an empty clipboard, and the excerpt where no embed fits",
        async () => {
            const clipboard = { enabled: false, read: vi.fn() };
            getTextEditorContaining.mockResolvedValue(buildMenuEditor().editor);
            const empty = await buildBlockReferenceMenuItems(element, clipboard);

            clipboard.enabled = true;
            getTextEditorContaining.mockResolvedValue(buildMenuEditor({ canEmbed: false }).editor);
            const noEmbed = await buildBlockReferenceMenuItems(element, clipboard);

            expect(getEnabled(empty?.paste)).toEqual([ false, false ]);
            expect(getEnabled(noEmbed?.paste)).toEqual([ true, false ]);
        });

    it("reports a clipboard without a reference and a referenced note that is gone", async () => {
        const { editor, pasteTarget } = buildMenuEditor();
        getTextEditorContaining.mockResolvedValue(editor);
        getNote.mockResolvedValue(null);
        const clipboard = {
            enabled: true,
            read: vi.fn(async () => ({ html: "", text: "plain text" }))
        };
        const paste = (await buildBlockReferenceMenuItems(element, clipboard))?.paste ?? [];

        runItem(paste[0]);
        await vi.waitFor(() => expect(pasteTarget.release).toHaveBeenCalledTimes(1));
        expect(showMessage).toHaveBeenCalledWith(
            "block_reference.no_reference_on_clipboard", 3000, "bx bx-info-circle");

        // A reference copied from another instance is to a note this one does not have.
        clipboard.read.mockResolvedValue({ html: "", text: `https://other.example/${href}` });
        runItem(paste[0]);
        await vi.waitFor(() => expect(pasteTarget.release).toHaveBeenCalledTimes(2));
        runItem(paste[1]);
        await vi.waitFor(() => expect(pasteTarget.release).toHaveBeenCalledTimes(3));
        expect(getNote.mock.calls).toEqual([ [ "note1", true ], [ "note1", true ] ]);
        expect(showError.mock.calls).toEqual([
            [ "block_reference.not_found" ], [ "block_reference.not_found" ]
        ]);
        expect(pasteTarget.paste).not.toHaveBeenCalled();
    });
});

function buildMenuEditor({
    count = 2, canReference = true, canEmbed = true, hasPlugin = true, isInTab = true,
    hosts = {} as Pick<EditorConfig, "blockReference" | "tabs">
} = {}) {
    const pasteTarget = { paste: vi.fn(), release: vi.fn() };
    const commands: Record<string, { isEnabled: boolean; value?: number }> = {
        assignBlockReference: { isEnabled: canReference, value: count },
        assignTabReference: { isEnabled: isInTab },
        insertContentEmbed: { isEnabled: canEmbed }
    };
    const editor = {
        plugins: { has: (name: string) => hasPlugin && name === "BlockReference" },
        commands: { get: (name: string) => commands[name] },
        config: { get: (name: "blockReference" | "tabs") => hosts[name] },
        capturePasteTarget: vi.fn(() => pasteTarget)
    };

    return { editor: editor as typeof editor & CKTextEditor, pasteTarget };
}

/** A model element named `name` with `attributes`, as the block handle passes it. */
function buildBlock(name: string, attributes: Record<string, string> = {}) {
    return {
        name,
        getAttribute: (key: string) => attributes[key],
        hasAttribute: (key: string) => key in attributes
    } as unknown as ModelElement;
}

function runItem(item: MenuItem<CommandNames> | null | undefined) {
    (item as MenuCommandItem<CommandNames> | undefined)?.handler?.({} as never, {} as never);
}

function getEnabled(items: MenuItem<CommandNames>[] | undefined) {
    return items?.map((item) => (item as MenuCommandItem<CommandNames>).enabled);
}

function buildContainer(html: string) {
    const container = document.createElement("div");
    container.innerHTML = html;
    return container;
}

function getFlashed(container: HTMLElement) {
    return [ ...container.querySelectorAll(".block-reference-flash") ]
        .map((element) => element.textContent);
}

function getHighlighted(container: HTMLElement) {
    return [ ...container.querySelectorAll(".block-reference-highlight") ]
        .map((element) => element.textContent);
}

function stubRect(element: Element, top: number, bottom: number) {
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({ top, bottom } as DOMRect);
}

function buildEditor(root: HTMLElement, target: unknown) {
    return {
        execute: vi.fn(() => target),
        commands: { get: vi.fn() },
        plugins: { has: vi.fn(() => false), get: vi.fn() },
        editing: {
            view: { getDomRoot: () => root, focus: vi.fn(), scrollToTheSelection: vi.fn() }
        },
        ui: { focusTracker: { add: vi.fn(), remove: vi.fn() } }
    } as unknown as CKTextEditor;
}
