// The gap test below relies on the editor's headings having no top margin.
import "../theme/headings.css";

import {
    _getModelData as getModelData, _setModelData as setModelData, type ClassicEditor, CodeBlock,
    DragDropTarget, env, FindAndReplaceEditing, type ModelElement, TodoList, ViewDataTransfer
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { drop, pointIn, startDrag } from "../../test/drag-kit.js";
import { registerTestCleanup } from "../../test/globals-test-kit.js";
import {
    createHeadingsEditor, findBlock, getDomBlock, getRoot, outline
} from "../../test/headings-kit.js";
import BlockDragHandle from "./block_drag_handle.js";
import { HIDDEN_BLOCK_CLASS } from "./hidden_blocks.js";
import MoveBlockUpDownPlugin from "./move_block_updown.js";

/** `intro`, a collapsed `Alpha` with `a1` and `a2` under it, then `Beta` with `b1` under it. */
const DOCUMENT = "<paragraph>intro</paragraph>" +
    "<heading2 headingCollapsed=\"true\">Alpha</heading2>" +
    "<paragraph>a1</paragraph><paragraph>a2</paragraph>" +
    "<heading2>Beta</heading2><paragraph>b1</paragraph>";

describe("HiddenBlocks", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createHeadingsEditor([ CodeBlock, TodoList, MoveBlockUpDownPlugin ]);
    });

    describe("hiding", () => {
        it("gives each kind of hidden block a box of no height in place", () => {
            const blocks = "<paragraph>text</paragraph>" +
                "<table><tableRow><tableCell><paragraph>cell</paragraph></tableCell></tableRow>" +
                "</table>" +
                "<horizontalLine></horizontalLine>" +
                "<blockQuote><paragraph>quote</paragraph></blockQuote>" +
                "<codeBlock language=\"plaintext\">code</codeBlock>" +
                "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"bulleted\">" +
                "item</paragraph>" +
                "<paragraph listIndent=\"1\" listItemId=\"b\" listType=\"numbered\">" +
                "nested</paragraph>" +
                "<paragraph listIndent=\"0\" listItemId=\"c\" listType=\"todo\">task</paragraph>";
            setModelData(editor.model, "<heading2>Alpha</heading2><heading2>Beta</heading2>" +
                `<heading2 headingCollapsed="true">Gamma</heading2>${blocks}` +
                "<heading2>Delta</heading2>");
            const box = (text: string) => getDomBlock(editor, findBlock(editor, text))
                .getBoundingClientRect();
            const gap = (upper: string, lower: string) => box(lower).top - box(upper).bottom;

            const hidden = [ ...getDomRoot().querySelectorAll(`.${HIDDEN_BLOCK_CLASS}`) ];
            expect(new Set(hidden.map((element) => element.localName))).toEqual(new Set([
                "p", "figure", "div", "blockquote", "pre", "code", "span", "li", "ul", "ol"
            ]));
            for (const element of hidden) {
                expect(element.getBoundingClientRect().height, element.outerHTML).toBe(0);
            }
            // The next heading keeps the place it has when nothing is under the collapsed one.
            expect(gap("Gamma", "Delta")).toBe(gap("Alpha", "Beta"));
        });

        it("hides each list wrapper of a hidden list item", () => {
            setModelData(editor.model, "<heading2 headingCollapsed=\"true\">Alpha</heading2>" +
                "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"bulleted\">" +
                "item</paragraph>" +
                "<paragraph listIndent=\"1\" listItemId=\"b\" listType=\"bulleted\">" +
                "nested</paragraph>" +
                "<heading2>Beta</heading2>");

            const list = getDomRoot().querySelector("ul");
            expect(list?.classList.contains(HIDDEN_BLOCK_CLASS)).toBe(true);
            expect([ ...getDomRoot().querySelectorAll("li") ].every(
                (item) => item.classList.contains(HIDDEN_BLOCK_CLASS))).toBe(true);
        });

        it("puts the class back on a hidden block that is converted again", () => {
            setModelData(editor.model, DOCUMENT);

            editor.editing.reconvertItem(findBlock(editor, "a1"));
            expect(outline(editor)).toBe("intro, ▸Alpha, (a1), (a2), Beta, b1");

            editor.model.change((writer) => writer.rename(findBlock(editor, "a2"), "heading3"));
            expect(outline(editor)).toBe("intro, ▸Alpha, (a1), (a2), Beta, b1");

            editor.model.change((writer) => {
                writer.setAttributes({ listItemId: "x", listIndent: 0, listType: "bulleted" },
                    findBlock(editor, "a1"));
            });
            expect(outline(editor)).toBe("intro, ▸Alpha, (a1), (a2), Beta, b1");
            const list = getDomRoot().querySelector("ul");
            expect(list?.classList.contains(HIDDEN_BLOCK_CLASS)).toBe(true);
        });

        it("hides the sections of nested collapsed headings, and in any container", () => {
            setModelData(editor.model,
                "<heading2 headingCollapsed=\"true\">Top</heading2><paragraph>t1</paragraph>" +
                "<heading3 headingCollapsed=\"true\">Sub</heading3><paragraph>s1</paragraph>" +
                "<heading2>Next</heading2>" +
                "<blockQuote><heading4 headingCollapsed=\"true\">Quoted</heading4>" +
                "<paragraph>q1</paragraph></blockQuote>");

            expect(outline(editor)).toBe("▸Top, (t1), (▸Sub), (s1), Next, blockQuote");
            const quote = getRoot(editor).getChild(5) as ModelElement;
            expect(outline(editor, quote)).toBe("▸Quoted, (q1)");

            editor.model.change((writer) => {
                writer.removeAttribute("headingCollapsed", findBlock(editor, "Top"));
            });
            expect(outline(editor)).toBe("Top, t1, ▸Sub, (s1), Next, blockQuote");
        });

        it("ends a section at the footnotes", () => {
            editor.model.schema.register("footnoteSection", { inheritAllFrom: "$blockObject" });
            editor.conversion.elementToElement({ model: "footnoteSection", view: "section" });
            setModelData(editor.model, "<heading2 headingCollapsed=\"true\">Alpha</heading2>" +
                "<paragraph>a1</paragraph><footnoteSection></footnoteSection>");

            expect(outline(editor)).toBe("▸Alpha, (a1), footnoteSection");
        });

        it("does no work on typing, nor on any change of a note without collapsed headings", () => {
            setModelData(editor.model, "<heading2>Alpha[]</heading2><paragraph>a1</paragraph>");
            const collect = spyOnCollect(editor);

            editor.execute("insertText", { text: "x" });
            editor.execute("enter");
            expect(collect).not.toHaveBeenCalled();

            editor.execute("undo");
            editor.execute("toggleHeadingCollapse");
            collect.mockClear();
            editor.execute("insertText", { text: "y" });
            expect(collect).not.toHaveBeenCalled();
        });
    });

    describe("delete keys", () => {
        it("expands without deleting on Backspace right after a collapsed section", async () => {
            setModelData(editor.model, DOCUMENT.replace("Beta", "[]Beta"));
            editor.editing.view.focus();

            await userEvent.keyboard("{Backspace}");
            expect(outline(editor)).toBe("intro, Alpha, a1, a2, Beta, b1");

            await userEvent.keyboard("{Backspace}");
            expect(outline(editor)).toBe("intro, Alpha, a1, a2Beta, b1");
        });

        it("expands without deleting on Delete at the end of a collapsed heading", async () => {
            setModelData(editor.model, DOCUMENT.replace("Alpha", "Alpha[]"));
            editor.editing.view.focus();

            await userEvent.keyboard("{Delete}");

            expect(outline(editor)).toBe("intro, Alpha, a1, a2, Beta, b1");
        });

        it("expands for a hidden widget at the edge of the section", async () => {
            setModelData(editor.model, "<heading2 headingCollapsed=\"true\">Alpha</heading2>" +
                "<paragraph>a1</paragraph><horizontalLine></horizontalLine>" +
                "<heading2>[]Beta</heading2>");
            editor.editing.view.focus();

            await userEvent.keyboard("{Backspace}");

            expect(outline(editor)).toBe("Alpha, a1, horizontalLine, Beta");
        });

        it("leaves a delete in visible content alone", async () => {
            setModelData(editor.model, DOCUMENT.replace("b1", "b[]1"));
            editor.editing.view.focus();

            await userEvent.keyboard("{Backspace}");

            expect(outline(editor)).toBe("intro, ▸Alpha, (a1), (a2), Beta, 1");
        });
    });

    describe("arrow keys", () => {
        const RUN_WITH_WIDGETS = "<paragraph>intro</paragraph>" +
            "<heading2 headingCollapsed=\"true\">Alpha</heading2>" +
            "<horizontalLine></horizontalLine><paragraph>a1</paragraph>" +
            "<horizontalLine></horizontalLine>" +
            "<heading2>Beta</heading2><paragraph>b1</paragraph>";
        const RUN_OUTLINE = "intro, ▸Alpha, (horizontalLine), (a1), (horizontalLine), Beta, b1";

        it("moves the caret over a hidden run that starts and ends with a widget", async () => {
            const cases: [ string, string, string ][] = [
                [ "Alpha[]", "{ArrowRight}", "<heading2>[]Beta</heading2>" ],
                [ "Alpha[]", "{ArrowDown}", "<heading2>[]Beta</heading2>" ],
                [ "[]Beta", "{ArrowLeft}", "Alpha[]</heading2>" ],
                [ "[]Beta", "{ArrowUp}", "Alpha[]</heading2>" ]
            ];
            for (const [ caret, key, expected ] of cases) {
                setModelData(editor.model,
                    RUN_WITH_WIDGETS.replace(caret.replace("[]", ""), caret));
                editor.editing.view.focus();

                await userEvent.keyboard(key);

                expect(getModelData(editor.model), key).toContain(expected);
                expect(outline(editor)).toBe(RUN_OUTLINE);
            }
        });

        it("moves only the focus with Shift, so the selection spans the hidden run", async () => {
            setModelData(editor.model, RUN_WITH_WIDGETS.replace("Alpha", "Alpha[]"));
            editor.editing.view.focus();

            await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");

            expect(getModelData(editor.model)).toContain("Alpha[</heading2>");
            expect(getModelData(editor.model)).toContain("<heading2>]Beta</heading2>");
            expect(outline(editor)).toBe(RUN_OUTLINE);
        });

        it("moves the focus back over a hidden run with Shift and the up arrow", async () => {
            setModelData(editor.model, DOCUMENT.replace("Beta", "[]Beta"));
            editor.editing.view.focus();

            await userEvent.keyboard("{Shift>}{ArrowUp}{/Shift}");

            expect(getModelData(editor.model)).toContain("Alpha[</heading2>");
            expect(editor.model.document.selection.isBackward).toBe(true);
        });

        it("checks the up and down arrows on the first and last line of a block only", async () => {
            setModelData(editor.model,
                "<heading2 headingCollapsed=\"true\">[]</heading2><paragraph>a1</paragraph>" +
                `<heading2 headingCollapsed="true">${"word ".repeat(60)}</heading2>` +
                "<paragraph>b1</paragraph><heading2>Gamma</heading2>");
            editor.editing.view.focus();

            // An empty heading has a single line.
            await userEvent.keyboard("{ArrowDown}");
            expect(getModelData(editor.model))
                .toContain("<heading2 headingCollapsed=\"true\">[]word");

            // The first line of a long heading moves to its next line.
            expect(press("ArrowDown")).toBe(false);
        });

        it("moves by word over a hidden run", async () => {
            setModelData(editor.model, DOCUMENT.replace("Alpha", "Alpha[]"));
            editor.editing.view.focus();

            await userEvent.keyboard("{Control>}{ArrowRight}{/Control}");

            expect(getModelData(editor.model)).toContain("<heading2>[]Beta</heading2>");
        });

        it("keeps the caret when nothing follows the hidden run", async () => {
            setModelData(editor.model, "<paragraph>intro</paragraph>" +
                "<heading2 headingCollapsed=\"true\">Alpha[]</heading2><paragraph>a1</paragraph>");
            editor.editing.view.focus();

            await userEvent.keyboard("{ArrowRight}");
            await userEvent.keyboard("{ArrowDown}");

            expect(getModelData(editor.model)).toContain("Alpha[]</heading2>");
            expect(outline(editor)).toBe("intro, ▸Alpha, (a1)");
        });

        it("leaves the arrow keys alone inside a block and next to visible blocks", () => {
            setModelData(editor.model, DOCUMENT.replace("b1", "b[]1"));

            for (const key of [ "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home" ]) {
                expect(press(key), key).toBe(false);
            }
            // Alt with an arrow moves blocks, Ctrl with Up or Down moves by paragraph.
            setModelData(editor.model, DOCUMENT.replace("Alpha", "Alpha[]"));
            expect(press("ArrowDown", { ctrlKey: true })).toBe(false);
            expect(press("ArrowRight", { altKey: true })).toBe(false);
            // A selection without Shift collapses where it is.
            setModelData(editor.model, DOCUMENT.replace("Alpha", "Al[pha]"));
            expect(press("ArrowRight")).toBe(false);
        });

        it("moves forward with the left arrow in right-to-left content", async () => {
            const rtlEditor = await createHeadingsEditor([], { language: { content: "ar" } });
            setModelData(rtlEditor.model, DOCUMENT.replace("Alpha", "Alpha[]"));

            expect(press("ArrowLeft", {}, rtlEditor)).toBe(true);
            expect(getModelData(rtlEditor.model)).toContain("<heading2>[]Beta</heading2>");
        });

        it("moves by word with Option on macOS", () => {
            const isMac = env.isMac;
            env.isMac = true;
            registerTestCleanup(() => {
                env.isMac = isMac;
            });
            setModelData(editor.model, DOCUMENT.replace("Alpha", "Alpha[]"));

            expect(press("ArrowRight", { ctrlKey: true })).toBe(false);
            expect(press("ArrowRight", { altKey: true })).toBe(true);
            expect(getModelData(editor.model)).toContain("<heading2>[]Beta</heading2>");
        });

        it("enters a section that shows for the moment, which then expands for good", async () => {
            setModelData(editor.model, DOCUMENT.replace("Alpha", "Alpha[]"));
            editor.plugins.get("HiddenBlocks")
                .revealAround(editor.model.createPositionAt(findBlock(editor, "a1"), 0));
            editor.editing.view.focus();

            await userEvent.keyboard("{ArrowDown}");

            expect(getModelData(editor.model)).toContain("<paragraph>a1[]</paragraph>");
            expect(outline(editor)).toBe("intro, Alpha, a1, a2, Beta, b1");
        });
    });

    describe("showing for the moment", () => {
        it("shows a section with a match of Search in note without changing the content", () => {
            setModelData(editor.model, DOCUMENT);
            const findReveal = editor.plugins.get("FindReveal");
            const version = editor.model.document.version;
            const onData = vi.fn();
            editor.model.document.on("change:data", onData);

            findReveal.show(editor.model.createPositionAt(findBlock(editor, "a2"), 1));
            expect(outline(editor)).toBe("intro, ▸Alpha, a1, a2, Beta, b1");
            expect(isRevealedClass("Alpha")).toBe(true);

            // Another match in the same section, and one at the end of a block.
            findReveal.show(editor.model.createPositionAt(findBlock(editor, "a1"), "end"));
            expect(outline(editor)).toBe("intro, ▸Alpha, a1, a2, Beta, b1");

            findReveal.show(editor.model.createPositionAt(findBlock(editor, "b1"), 1));
            expect(outline(editor)).toBe("intro, ▸Alpha, (a1), (a2), Beta, b1");
            expect(isRevealedClass("Alpha")).toBe(false);
            expect(editor.model.document.version).toBe(version);
            expect(onData).not.toHaveBeenCalled();
        });

        it("shows the section around a widget that Search in note shows", () => {
            setModelData(editor.model, "<heading2 headingCollapsed=\"true\">Alpha</heading2>" +
                "<horizontalLine></horizontalLine><heading2>Beta</heading2>");
            const line = findBlock(editor, "horizontalLine");

            editor.plugins.get("FindReveal").show(editor.model.createPositionBefore(line));

            expect(outline(editor)).toBe("▸Alpha, horizontalLine, Beta");
        });

        it("puts the caret on the heading when Search in note closes on a hidden match", () => {
            setModelData(editor.model, DOCUMENT);
            const findReveal = editor.plugins.get("FindReveal");
            findReveal.show(editor.model.createPositionAt(findBlock(editor, "a2"), 1));

            // The find clears its match, then selects it, in one task.
            findReveal.show(null);
            editor.model.change((writer) => writer.setSelection(writer.createRange(
                writer.createPositionAt(findBlock(editor, "a2"), 0),
                writer.createPositionAt(findBlock(editor, "a2"), 2)
            )));

            expect(getModelData(editor.model)).toContain("Alpha[]</heading2>");
            expect(outline(editor)).toBe("intro, ▸Alpha, (a1), (a2), Beta, b1");
        });

        it("shows the sections around a jump at every level until a toggle or an edit", () => {
            setModelData(editor.model,
                "<heading2 headingCollapsed=\"true\">Top</heading2><paragraph>t1</paragraph>" +
                "<heading3 headingCollapsed=\"true\">Sub</heading3><paragraph>s1</paragraph>" +
                "<heading2>Next[]</heading2>");
            const hiddenBlocks = editor.plugins.get("HiddenBlocks");
            const s1 = () => getDomBlock(editor, findBlock(editor, "s1"));

            hiddenBlocks.revealAroundDomNode(s1());
            expect(outline(editor)).toBe("▸Top, t1, ▸Sub, s1, Next");
            expect(s1().getBoundingClientRect().height).toBeGreaterThan(0);

            // Another jump to the same place, or to a shown block, renders nothing.
            const render = vi.spyOn(editor.editing.view, "forceRender");
            hiddenBlocks.revealAroundDomNode(s1());
            hiddenBlocks.revealAround(editor.model.createPositionAt(findBlock(editor, "Next"), 0));
            expect(render).not.toHaveBeenCalled();

            // A toggle hides the section again; the caret in a section expands it for good.
            editor.plugins.get("CollapsibleHeadingsEditing").toggle(findBlock(editor, "Sub"));
            expect(outline(editor)).toBe("▸Top, t1, ▸Sub, (s1), Next");
            editor.model.change((writer) => writer.setSelection(findBlock(editor, "t1"), 0));
            expect(outline(editor)).toBe("Top, t1, ▸Sub, (s1), Next");

            hiddenBlocks.revealAroundDomNode(document.body);
            expect(outline(editor)).toBe("Top, t1, ▸Sub, (s1), Next");
        });

        it("puts the caret on a pasted collapsed heading, whose section stays collapsed", () => {
            setModelData(editor.model, "<paragraph>intro</paragraph><paragraph>[]</paragraph>" +
                "<heading2>Beta</heading2>");

            editor.editing.view.document.fire("clipboardInput", {
                dataTransfer: new ViewDataTransfer(new DataTransfer()),
                content: "<h2 data-trilium-collapsed=\"true\">Pasted</h2><p>p1</p><p>p2</p>",
                method: "paste"
            });

            expect(outline(editor)).toBe("intro, ▸Pasted, (p1), (p2), Beta");
            expect(getModelData(editor.model)).toContain("Pasted[]</heading2>");
        });

        it("shows a pasted section with the first match of Search in note", async () => {
            const findEditor = await createHeadingsEditor([ FindAndReplaceEditing ]);
            setModelData(findEditor.model, "<paragraph>intro</paragraph><paragraph>[]</paragraph>");
            findEditor.plugins.get(FindAndReplaceEditing).find("match");

            findEditor.editing.view.document.fire("clipboardInput", {
                dataTransfer: new ViewDataTransfer(new DataTransfer()),
                content: "<h2 data-trilium-collapsed=\"true\">Pasted</h2><p>a match</p>",
                method: "paste"
            });

            expect(outline(findEditor)).toBe("intro, ▸Pasted, a match");
            const pasted = findEditor.editing.mapper.toViewElement(findBlock(findEditor, "Pasted"));
            expect(pasted?.hasClass("trilium-temporarily-expanded")).toBe(true);
        });

        it("forgets a revealed heading that is removed or expanded", () => {
            setModelData(editor.model, DOCUMENT);
            const hiddenBlocks = editor.plugins.get("HiddenBlocks");
            hiddenBlocks.revealAround(editor.model.createPositionAt(findBlock(editor, "a1"), 0));
            const alpha = findBlock(editor, "Alpha");

            editor.model.change((writer) => writer.removeAttribute("headingCollapsed", alpha));
            expect(hiddenBlocks.isRevealed(alpha)).toBe(false);
            editor.model.change((writer) => writer.setAttribute("headingCollapsed", true, alpha));
            expect(outline(editor)).toBe("intro, ▸Alpha, (a1), (a2), Beta, b1");

            hiddenBlocks.revealAround(editor.model.createPositionAt(findBlock(editor, "a1"), 0));
            editor.model.change((writer) => writer.remove(alpha));
            expect(hiddenBlocks.isRevealed(alpha)).toBe(false);
        });
    });

    describe("moving blocks", () => {
        const SECTIONS = "<heading2 headingCollapsed=\"true\">Alpha</heading2>" +
            "<paragraph>a1</paragraph>" +
            "<heading2 headingCollapsed=\"true\">Beta</heading2><paragraph>b1</paragraph>";

        it("moves a collapsed heading with its section, past whole sections", () => {
            setModelData(editor.model, SECTIONS.replace("Alpha", "Alpha[]"));

            editor.execute("moveBlockDown");
            expect(outline(editor)).toBe("▸Beta, (b1), ▸Alpha, (a1)");
            expect(editor.commands.get("moveBlockDown")?.isEnabled).toBe(false);

            editor.execute("moveBlockUp");
            expect(outline(editor)).toBe("▸Alpha, (a1), ▸Beta, (b1)");
            expect(getModelData(editor.model)).toContain("Alpha[]</heading2>");
        });

        it("moves a block past a collapsed section, which expands as the block joins it", () => {
            setModelData(editor.model, "<paragraph>p[]</paragraph>" + SECTIONS);

            editor.execute("moveBlockDown");

            expect(outline(editor)).toBe("Alpha, a1, p, ▸Beta, (b1)");
        });
    });

    function isRevealedClass(text: string) {
        const viewElement = editor.editing.mapper.toViewElement(findBlock(editor, text));
        return !!viewElement?.hasClass("trilium-temporarily-expanded");
    }

    function getDomRoot() {
        return editor.editing.view.getDomRoot() as HTMLElement;
    }

    /**
     * Presses `key` in the editing root, as `addEditingKeydownCapture()` sees it. Returns whether
     * the key was taken.
     */
    function press(key: string, init: KeyboardEventInit = {}, target: ClassicEditor = editor) {
        const event = new KeyboardEvent("keydown", {
            key, bubbles: true, cancelable: true, ...init
        });
        (target.editing.view.getDomRoot() as HTMLElement).dispatchEvent(event);
        return event.defaultPrevented;
    }
});

describe("HiddenBlocks while dragging", () => {
    /**
     * `intro`, a collapsed `Alpha` with `a1` and `a2` under it, a collapsed `Beta` with `b1` under
     * it, then `Gamma` with `c1` under it.
     */
    const SECTIONS = "<paragraph>intro</paragraph>" +
        "<heading2 headingCollapsed=\"true\">Alpha</heading2>" +
        "<paragraph>a1</paragraph><paragraph>a2</paragraph>" +
        "<heading2 headingCollapsed=\"true\">Beta</heading2><paragraph>b1</paragraph>" +
        "<heading2>Gamma</heading2><paragraph>c1</paragraph>";

    async function createDragEditor(modelData: string) {
        const editor = await createHeadingsEditor([ BlockDragHandle ]);
        editor.ui.view.element?.style.setProperty("margin", "0 100px");
        setModelData(editor.model, modelData);
        editor.editing.view.focus();
        await expect.poll(() => editor.ui.focusTracker.isFocused).toBe(true);
        editor.ui.update();
        const handle = editor.plugins.get(BlockDragHandle).buttonView?.element;
        if (!handle) {
            throw new Error("The drag handle is not rendered.");
        }
        return { editor, handle };
    }

    /** A point in the block with the text `text`, `fraction` of its height from its top. */
    function pointAt(editor: ClassicEditor, text: string, fraction: number) {
        return pointIn(getDomBlock(editor, findBlock(editor, text)), fraction);
    }

    it("drags a collapsed section whole with the handle, which stays collapsed", async () => {
        const { editor, handle } = await createDragEditor(SECTIONS.replace("Alpha", "Al[]pha"));

        drop(handle, startDrag(handle), pointAt(editor, "c1", 0.8));

        expect(outline(editor)).toBe("intro, ▸Beta, (b1), Gamma, c1, ▸Alpha, (a1), (a2)");
    });

    it("drops a block below a collapsed heading after its section, which expands", async () => {
        const { editor, handle } = await createDragEditor(SECTIONS.replace("c1", "c[]1"));

        drop(handle, startDrag(handle), pointAt(editor, "Alpha", 0.8));

        expect(outline(editor)).toBe("intro, Alpha, a1, a2, c1, ▸Beta, (b1), Gamma");
    });

    it("drops a collapsed section below a collapsed heading after its section", async () => {
        const { editor, handle } = await createDragEditor(SECTIONS.replace("Beta", "Be[]ta"));

        drop(handle, startDrag(handle), pointAt(editor, "Alpha", 0.8));

        expect(outline(editor)).toBe("intro, ▸Alpha, (a1), (a2), ▸Beta, (b1), Gamma, c1");
    });

    it("drags the section of a heading selected whole, without the handle", async () => {
        const { editor } = await createDragEditor(SECTIONS.replace("Alpha", "[Alpha]"));
        const alpha = getDomBlock(editor, findBlock(editor, "Alpha"));

        drop(alpha, startDrag(alpha), pointAt(editor, "c1", 0.8));
        expect(outline(editor)).toBe("intro, ▸Beta, (b1), Gamma, c1, ▸Alpha, (a1), (a2)");

        editor.execute("undo");
        expect(outline(editor)).toBe("intro, ▸Alpha, (a1), (a2), ▸Beta, (b1), Gamma, c1");
    });

    it("leaves the drag of a widget to DragDrop", async () => {
        const { editor } = await createDragEditor(
            "<paragraph>in[]tro</paragraph><horizontalLine></horizontalLine>" +
            SECTIONS.replace("<paragraph>intro</paragraph>", ""));
        const line = getDomBlock(editor, findBlock(editor, "horizontalLine"));

        drop(line, startDrag(line), pointAt(editor, "c1", 0.8));

        expect(outline(editor))
            .toBe("intro, ▸Alpha, (a1), (a2), ▸Beta, (b1), Gamma, c1, horizontalLine");
    });

    it("leaves a drag of text or of a block without hidden blocks after it as it is", async () => {
        const { editor } = await createDragEditor(SECTIONS.replace("Gamma", "G[amm]a"));
        const gamma = getDomBlock(editor, findBlock(editor, "Gamma"));

        drop(gamma, startDrag(gamma), pointAt(editor, "intro", 0.5));
        expect(outline(editor)).toContain("Ga, c1");
    });

    it("finds the drop target in the gap above a collapsed section", async () => {
        const { editor } = await createDragEditor(
            "<paragraph>A[]</paragraph><paragraph>B</paragraph>" +
            "<heading2 headingCollapsed=\"true\">Alpha</heading2>" +
            "<paragraph>hidden</paragraph>".repeat(9) +
            "<heading2>Beta</heading2><paragraph>C</paragraph>");
        const first = getDomBlock(editor, findBlock(editor, "A")).getBoundingClientRect();
        const second = getDomBlock(editor, findBlock(editor, "B")).getBoundingClientRect();
        const root = editor.editing.view.document.getRoot();
        if (!root) {
            throw new Error("The editor has no root.");
        }

        const range = editor.plugins.get(DragDropTarget).getFinalDropRange(
            root, null, first.left + 5, (first.bottom + second.top) / 2, true, null);

        expect(range?.start.path).toEqual([ 1 ]);
    });
});

describe("HiddenBlocks in a long note", () => {
    it("collapses 50 sections of 5,000 blocks fast and does no work on typing", async () => {
        const editor = await createHeadingsEditor();
        editor.setData(Array.from({ length: 50 },
            (_, index) => `<h2>H${index}</h2>${"<p>text</p>".repeat(99)}`).join(""));
        const headings = [ ...getRoot(editor).getChildren() ]
            .filter((child) => child.is("element", "heading2"));

        const start = performance.now();
        editor.model.change((writer) => {
            for (const heading of headings) {
                writer.setAttribute("headingCollapsed", true, heading);
            }
        });
        const elapsed = performance.now() - start;

        const hidden = editor.editing.view.getDomRoot()?.querySelectorAll(`.${HIDDEN_BLOCK_CLASS}`);
        expect(hidden?.length).toBe(50 * 99);
        expect(elapsed, `${elapsed} ms`).toBeLessThan(500);

        const collect = spyOnCollect(editor);
        editor.model.change((writer) => writer.setSelection(headings[0], "end"));
        editor.execute("insertText", { text: "x" });
        expect(collect).not.toHaveBeenCalled();
    });
});

/** A spy on the walk of `HiddenBlocks` over the whole document. */
function spyOnCollect(editor: ClassicEditor) {
    const hiddenBlocks = editor.plugins.get("HiddenBlocks") as unknown as { collectIn(): void };
    return vi.spyOn(hiddenBlocks, "collectIn");
}
