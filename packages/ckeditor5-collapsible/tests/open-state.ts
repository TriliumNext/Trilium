import { ClassicEditor, Essentials, Paragraph, _setModelData as setModelData, _getModelData as getModelData } from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CollapsibleEditing from "../src/collapsible-editing.js";

/**
 * The expanded state is persisted as the `open` model attribute, which round-trips
 * into the note's saved HTML. A *missing* attribute means collapsed, so content
 * written before the state was persisted keeps loading fully collapsed.
 */
describe("collapsible open state", () => {
    let domElement: HTMLDivElement;
    let editor: ClassicEditor;
    let model: ClassicEditor["model"];

    beforeEach(async () => {
        domElement = document.createElement("div");
        document.body.appendChild(domElement);
        editor = await ClassicEditor.create(domElement, {
            licenseKey: "GPL",
            plugins: [Essentials, Paragraph, CollapsibleEditing]
        });
        model = editor.model;
    });

    afterEach(() => {
        domElement.remove();
        return editor.destroy();
    });

    const domRoot = () => editor.editing.view.getDomRoot() as HTMLElement;
    const detailsDom = (index = 0) =>
        domRoot().querySelectorAll<HTMLDetailsElement>("details.trilium-collapsible")[index];
    const clickArrow = (index = 0) =>
        domRoot()
            .querySelectorAll<HTMLElement>(".trilium-collapsible-arrow")[index]
            .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    describe("persistence", () => {
        it("round-trips the state a user leaves behind: collapsed content loads collapsed, expanding writes `open` into the saved HTML, and reloading that HTML comes back expanded", () => {
            // Existing content — authored before the state was persisted.
            editor.setData("<details class=\"trilium-collapsible\"><summary>T</summary><p>body</p></details>");
            expect(detailsDom().open).toBe(false);
            expect(editor.getData()).not.toContain("open");

            clickArrow();

            expect(detailsDom().open).toBe(true);
            expect(editor.getData()).toBe(
                "<details class=\"trilium-collapsible\" open=\"\"><summary>T</summary><p>body</p></details>"
            );

            // Reload exactly what would have been saved.
            editor.setData(editor.getData());
            expect(detailsDom().open).toBe(true);
        });

        it("upcasts the native boolean attribute to a model `true`, and its absence to no attribute at all", () => {
            editor.setData("<details open><summary>A</summary><p>a</p></details><details><summary>B</summary><p>b</p></details>");
            expect(getModelData(model, { withoutSelection: true })).toBe(
                "<details open=\"true\"><summary>A</summary><paragraph>a</paragraph></details>" +
                "<details><summary>B</summary><paragraph>b</paragraph></details>"
            );
        });

        it("collapsing removes the attribute rather than writing open=\"false\", keeping the saved HTML clean", () => {
            editor.setData("<details class=\"trilium-collapsible\" open><summary>T</summary><p>body</p></details>");
            expect(detailsDom().open).toBe(true);

            clickArrow();

            expect(getModelData(model, { withoutSelection: true })).toBe(
                "<details><summary>T</summary><paragraph>body</paragraph></details>"
            );
            expect(editor.getData()).not.toContain("open");
        });

        it("tracks nested collapsibles independently", () => {
            editor.setData(
                "<details><summary>Outer</summary>" +
                    "<details><summary>Inner</summary><p>x</p></details>" +
                "</details>"
            );
            // Index 1 is the nested one; expanding it must not expand its parent.
            clickArrow(1);

            expect(getModelData(model, { withoutSelection: true })).toBe(
                "<details><summary>Outer</summary>" +
                    "<details open=\"true\"><summary>Inner</summary><paragraph>x</paragraph></details>" +
                "</details>"
            );
        });

        it("survives the reconversion that a body-block change triggers", () => {
            // elementToStructure rebuilds the whole <details> when its children
            // change; the fresh DOM element defaults to closed unless the downcast
            // re-applies the state.
            editor.setData("<details class=\"trilium-collapsible\" open><summary>T</summary><p>First</p></details>");
            expect(detailsDom().open).toBe(true);

            model.change((writer) => {
                const details = model.document.getRoot()?.getChild(0);
                if (details?.is("element", "details")) {
                    writer.insertElement("paragraph", details, "end");
                }
            });

            expect(detailsDom().open).toBe(true);
        });

        it("keeps the attribute through insertContent, which filters against the schema", () => {
            // `allowAttributes` on the schema is what stops `open` being stripped
            // here — pasting an expanded collapsible must stay expanded.
            setModelData(model, "<paragraph>[]</paragraph>");
            model.change((writer) => {
                const details = writer.createElement("details", { open: true });
                const summary = writer.createElement("summary");
                writer.append(summary, details);
                writer.append(writer.createElement("paragraph"), details);
                model.insertContent(details);
            });

            expect(getModelData(model, { withoutSelection: true })).toContain("<details open=\"true\">");
        });

        it("carries the state along when the block is moved (a drag records as remove + insert)", () => {
            setModelData(model,
                "<paragraph>before</paragraph>" +
                "<details open=\"true\"><summary>T</summary><paragraph>body</paragraph></details>"
            );
            model.change((writer) => {
                const root = model.document.getRoot();
                const details = root?.getChild(1);
                if (root && details) {
                    writer.move(writer.createRangeOn(details), writer.createPositionAt(root, 0));
                }
            });

            expect(getModelData(model, { withoutSelection: true })).toBe(
                "<details open=\"true\"><summary>T</summary><paragraph>body</paragraph></details>" +
                "<paragraph>before</paragraph>"
            );
        });
    });

    describe("toggling", () => {
        it("toggles via the arrow and via Ctrl+Enter in the summary", () => {
            setModelData(model, "<details><summary>T[]</summary><paragraph>body</paragraph></details>");

            clickArrow();
            expect(detailsDom().open).toBe(true);

            domRoot().dispatchEvent(new KeyboardEvent("keydown", {
                key: "Enter", ctrlKey: true, bubbles: true, cancelable: true
            }));
            expect(detailsDom().open).toBe(false);
        });

        it("adopts a toggle the browser performed on its own (e.g. find-in-page expanding a closed block)", () => {
            setModelData(model, "<details><summary>T</summary><paragraph>body</paragraph></details>");

            const dom = detailsDom();
            dom.open = true;
            dom.dispatchEvent(new Event("toggle"));

            expect(getModelData(model, { withoutSelection: true })).toContain("<details open=\"true\">");
        });

        it("keeps the arrow's aria-expanded in sync", () => {
            setModelData(model, "<details><summary>T</summary><paragraph>body</paragraph></details>");
            const arrow = domRoot().querySelector(".trilium-collapsible-arrow");
            expect(arrow?.getAttribute("aria-expanded")).toBe("false");

            clickArrow();

            expect(arrow?.getAttribute("aria-expanded")).toBe("true");
        });
    });

    describe("undo", () => {
        it("does not put a toggle on the undo stack — Ctrl+Z after reading must not re-collapse the block", () => {
            setModelData(model, "<details open=\"true\"><summary>Title</summary><paragraph>body</paragraph></details>");

            // A real, undoable edit for the undo stack to hold.
            model.change((writer) => {
                const details = model.document.getRoot()?.getChild(0);
                const summary = details?.is("element", "details") ? details.getChild(0) : null;
                if (summary?.is("element", "summary")) {
                    writer.insertText("!", summary, "end");
                }
            });
            expect(getModelData(model, { withoutSelection: true })).toContain("<summary>Title!</summary>");

            // Collapse: a model change, but not an undoable one.
            clickArrow();
            expect(detailsDom().open).toBe(false);

            editor.execute("undo");

            // The text edit was undone, so the toggle never occupied a stack slot…
            expect(getModelData(model, { withoutSelection: true })).toContain("<summary>Title</summary>");
            // …and the collapse itself survived the undo.
            expect(getModelData(model, { withoutSelection: true })).not.toContain("open=");
        });

        it("restores the state with the block when an insert is undone and redone", () => {
            setModelData(model, "<paragraph>[]</paragraph>");
            editor.execute("collapsible");
            expect(getModelData(model, { withoutSelection: true })).toContain("<details open=\"true\">");

            editor.execute("undo");
            expect(getModelData(model, { withoutSelection: true })).not.toContain("<details");

            editor.execute("redo");
            // The attribute rides along in the insert operation — no separate
            // re-open pass is needed for the redone block.
            expect(getModelData(model, { withoutSelection: true })).toContain("<details open=\"true\">");
        });
    });

    describe("hiddenBodyPostFixer", () => {
        it("never leaves the caret inside a collapsed body", () => {
            // Placing the caret in the body of a closed block must bounce it to the
            // summary — the body is display:none, so a caret there is invisible.
            setModelData(model, "<details><summary>T</summary><paragraph>bo[]dy</paragraph></details>");

            expect(getModelData(model)).toBe(
                "<details><summary>T[]</summary><paragraph>body</paragraph></details>"
            );
        });

        it("leaves the caret alone when the block is open", () => {
            setModelData(model, "<details open=\"true\"><summary>T</summary><paragraph>bo[]dy</paragraph></details>");

            expect(getModelData(model)).toBe(
                "<details open=\"true\"><summary>T</summary><paragraph>bo[]dy</paragraph></details>"
            );
        });
    });
});
