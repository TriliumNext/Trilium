import type { CKTextEditor } from "@triliumnext/ckeditor5";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommandNames } from "../components/app_context.js";
import type { MenuCommandItem, MenuItem } from "../menus/context_menu.js";
import {
    buildBlockReferenceMenuItems, consumeBlockReference, copyBlockReference,
    getBlockRangeElements, getClipboardBlockReference, highlightBlockReference,
    openBlockHandleMenu, revealHighlightedBlocks
} from "./block_reference.js";
import type { ViewScope } from "./link.js";

const {
    showError, showMessage, showMenu, copyHtmlWithToast, getTextEditorContaining, getNote
} = vi.hoisted(() => ({
    showError: vi.fn(),
    showMessage: vi.fn(),
    showMenu: vi.fn(),
    copyHtmlWithToast: vi.fn(),
    getTextEditorContaining: vi.fn(),
    getNote: vi.fn()
}));
vi.mock("./i18n.js", () => ({
    t: (key: string, options?: { count?: number }) => options ? `${key}:${options.count}` : key
}));
vi.mock("./toast.js", () => ({ default: { showError, showMessage } }));
vi.mock("../menus/context_menu.js", () => ({ default: { show: showMenu } }));
vi.mock("../menus/text_editor_context_menu.js", () => ({ getTextEditorContaining }));
vi.mock("./clipboard_ext.js", () => ({ copyHtmlWithToast }));
vi.mock("./froca.js", () => ({ default: { getNote } }));
vi.mock("./content_renderer.js", () => ({
    EXCERPT_BOX_SIZE: "full",
    getEmbedBoxSize: () => "medium"
}));

const scrollIntoView = vi.fn();
const getComponentByEl = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = scrollIntoView;
    glob.getComponentByEl = getComponentByEl;
});

afterEach(() => {
    vi.useRealTimers();
});

describe("consumeBlockReference", () => {
    it("reveals a block, flashes it for a moment and consumes the reference", () => {
        const container = buildContainer(
            "<details><summary>s</summary><p data-trilium-block-id=\"a\">A</p></details>"
        );
        const block = container.querySelector("p");
        const viewScope: ViewScope = { block: "a" };

        consumeBlockReference(container, viewScope);

        expect(container.querySelector("details")?.open).toBe(true);
        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
        expect(scrollIntoView.mock.contexts[0]).toBe(block);
        expect(block?.classList.contains("block-reference-flash")).toBe(true);
        expect(viewScope.block).toBeUndefined();
        expect(showError).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1500);
        expect(block?.classList.contains("block-reference-flash")).toBe(false);
    });

    it("flashes the outermost elements of a range", () => {
        const container = buildContainer(
            "<p>before</p><p data-trilium-block-id=\"a\">A</p><blockquote><p>quote</p></blockquote>"
            + "<ul><li><p data-trilium-block-id=\"b\">B</p><p>rest of item</p></li>"
            + "<li>after</li></ul>"
        );

        consumeBlockReference(container, { block: "b:a" });

        expect(getFlashed(container)).toEqual([ "A", "quote", "B" ]);
    });

    it("shows the block still found of a broken range, and says that it is broken", () => {
        const container = buildContainer("<p data-trilium-block-id=\"b\">B</p>");

        consumeBlockReference(container, { block: "gone:b" });

        expect(getFlashed(container)).toEqual([ "B" ]);
        expect(scrollIntoView).toHaveBeenCalledTimes(1);
        expect(showError).toHaveBeenCalledWith("block_reference.not_found");
    });

    it("only says so when no block is found, or the reference is malformed", () => {
        const container = buildContainer("<p data-trilium-block-id=\"a\">A</p>");

        consumeBlockReference(container, { block: "gone" });
        consumeBlockReference(container, { block: "a:b:c" });

        expect(scrollIntoView).not.toHaveBeenCalled();
        expect(showError).toHaveBeenCalledTimes(2);
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

describe("getBlockRangeElements", () => {
    it("returns a single block, or the blocks between two in a list", () => {
        const container = buildContainer(
            "<ol><li data-trilium-block-id=\"a\">A</li><li>B</li>"
            + "<li data-trilium-block-id=\"c\">C</li><li>D</li></ol>"
        );
        const [ first, , third ] = container.querySelectorAll("li");

        expect(getBlockRangeElements(first, first)).toEqual([ first ]);
        expect(getBlockRangeElements(first, third).map((element) => element.textContent))
            .toEqual([ "A", "B", "C" ]);
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

describe("openBlockHandleMenu", () => {
    it("offers to copy a reference to the selected blocks", () => {
        const event = new MouseEvent("contextmenu", { clientX: 10, clientY: 20 });
        const copyReference = vi.fn();

        openBlockHandleMenu(event, 3, copyReference);

        expect(showMenu).toHaveBeenCalledWith(expect.objectContaining({
            x: event.pageX,
            y: event.pageY,
            items: [ expect.objectContaining({
                title: "block_reference.copy:3",
                handler: copyReference
            }) ]
        }));
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

    it("copies a reference to the selected blocks through the host of the editor", async () => {
        const copyReference = vi.fn(async () => {});
        const { editor, root } = buildMenuEditor({ count: 3 });
        getTextEditorContaining.mockResolvedValue(editor);
        getComponentByEl.mockReturnValue({ copyBlockReference: copyReference });

        const items = await buildBlockReferenceMenuItems(element);
        runItem(items?.copy);

        expect(getTextEditorContaining).toHaveBeenCalledWith(element);
        expect(getComponentByEl).toHaveBeenCalledWith(root);
        expect(items?.copy).toMatchObject({ title: "block_reference.copy:3" });
        expect(copyReference).toHaveBeenCalledTimes(1);
        expect(items?.paste).toEqual([]);
    });

    it("offers no copy row where no reference can be made or the host cannot copy", async () => {
        getComponentByEl.mockReturnValue({ copyBlockReference: vi.fn() });
        getTextEditorContaining.mockResolvedValue(buildMenuEditor({ canReference: false }).editor);
        expect((await buildBlockReferenceMenuItems(element))?.copy).toBeNull();

        getComponentByEl.mockReturnValue({});
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

        clipboard.read.mockResolvedValue({ html: "", text: href });
        runItem(paste[1]);
        await vi.waitFor(() => expect(pasteTarget.release).toHaveBeenCalledTimes(2));
        expect(showError).toHaveBeenCalledWith("block_reference.not_found");
        expect(pasteTarget.paste).not.toHaveBeenCalled();
    });
});

function buildMenuEditor({
    count = 2, canReference = true, canEmbed = true, hasPlugin = true
} = {}) {
    const root = document.createElement("div");
    const pasteTarget = { paste: vi.fn(), release: vi.fn() };
    const commands: Record<string, { isEnabled: boolean; value?: number }> = {
        assignBlockReference: { isEnabled: canReference, value: count },
        insertContentEmbed: { isEnabled: canEmbed }
    };
    const editor = {
        plugins: { has: (name: string) => hasPlugin && name === "BlockReference" },
        commands: { get: (name: string) => commands[name] },
        editing: { view: { getDomRoot: () => root } },
        capturePasteTarget: vi.fn(() => pasteTarget)
    };

    return { editor: editor as typeof editor & CKTextEditor, root, pasteTarget };
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
        editing: { view: { getDomRoot: () => root } }
    } as unknown as CKTextEditor;
}
