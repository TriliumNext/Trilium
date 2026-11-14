import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    type ButtonView,
    type ClassicEditor,
    ContextualBalloon,
    type DropdownView,
    Essentials,
    IconRemove,
    type ModelElement,
    Paragraph,
    type PositioningFunction,
    Rect,
    type ToolbarView,
    type ViewDocumentSelection,
    type ViewElement,
    WidgetToolbarRepository
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getListRows, pickListRow } from "../../../test/dropdown-kit.js";
import { createTestEditor } from "../../../test/editor-kit.js";
import asideIcon from "../../icons/aside.svg?raw";
import Aside from "./aside.js";

interface ToolbarDefinition {
    view: ToolbarView;
    positions: PositioningFunction[];
    getRelatedElement(selection: ViewDocumentSelection): ViewElement | null;
}

/** An aside in model notation, with `blocks` and the model `attributes`. */
function aside(blocks: string, attributes = " position=\"wrap-right\"") {
    return `<asideBlock${attributes}><asideContent>${blocks}</asideContent></asideBlock>`;
}

function paragraph(text: string) {
    return `<paragraph>${text}</paragraph>`;
}

describe("AsideUI", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([ Essentials, Paragraph, Aside ]);
    });

    function createButton(name: string) {
        return editor.ui.componentFactory.create(name) as ButtonView;
    }

    function selectAside(index = 0) {
        const element = editor.model.document.getRoot()?.getChild(index) as ModelElement;
        editor.model.change((writer) => writer.setSelection(element, "on"));
    }

    it("inserts an aside from its button and returns the focus to the text", () => {
        setModelData(editor.model, paragraph("[]"));
        const button = createButton("aside");
        expect([ button.label, button.icon, button.tooltip, button.isEnabled ])
            .toEqual([ "Aside", asideIcon, true, true ]);
        const focus = vi.spyOn(editor.editing.view, "focus");

        button.fire("execute");

        expect(getModelData(editor.model)).toBe(aside(paragraph("[]")));
        expect(focus).toHaveBeenCalled();
        expect(button.isEnabled).toBe(false);
    });

    it("removes the aside from its button, keeping its blocks", () => {
        setModelData(editor.model, aside(paragraph("A[]") + paragraph("B")));
        const button = createButton("removeAside");
        expect([ button.label, button.icon, button.tooltip, button.isEnabled ])
            .toEqual([ "Remove aside", IconRemove, true, true ]);

        button.fire("execute");

        expect(getModelData(editor.model)).toBe(paragraph("A[]") + paragraph("B"));
        expect(button.isEnabled).toBe(false);
    });

    it("places the aside from its position dropdown", () => {
        setModelData(editor.model, `[${aside(paragraph("A"))}]`);
        const dropdown = editor.ui.componentFactory.create("asidePosition") as DropdownView;
        dropdown.render();

        expect(dropdown.buttonView.label).toBe("Box position");
        expect(getListRows(dropdown)).toEqual([
            "# Break text", "Align left", "Align center", "Align right",
            "# Wrap text", "Align left", "Align right ✓"
        ]);

        pickListRow(dropdown, "Break text", "Align left");
        expect(getModelData(editor.model)).toBe(`[${aside(paragraph("A"), " position=\"left\"")}]`);
    });

    describe("toolbar", () => {
        function toolbarDefinition() {
            const repository = editor.plugins.get(WidgetToolbarRepository) as unknown as {
                _toolbarDefinitions: Map<string, ToolbarDefinition>;
            };
            const definition = repository._toolbarDefinitions.get("aside");
            expect(definition).toBeDefined();
            return definition as ToolbarDefinition;
        }

        function getRelatedElement() {
            return toolbarDefinition().getRelatedElement(editor.editing.view.document.selection);
        }

        it("shows the position dropdown and the remove button while the aside is selected",
            () => {
                setModelData(editor.model, aside(paragraph("A")) + paragraph("[]"));
                selectAside();
                editor.ui.focusTracker.isFocused = true;
                editor.ui.update();

                const toolbar = toolbarDefinition().view;
                expect(editor.plugins.get(ContextualBalloon).visibleView).toBe(toolbar);
                expect(toolbar.ariaLabel).toBe("Aside toolbar");
                const items = [ ...toolbar.items ] as (DropdownView | ButtonView)[];
                const labels = items.map((item) =>
                    "buttonView" in item ? item.buttonView.label : item.label);
                expect(labels).toEqual([ "Box position", "Remove aside" ]);
                expect(getRelatedElement()?.name).toBe("aside");
            });

        it("shows while the caret is in the aside, and not outside one", () => {
            setModelData(editor.model, aside(paragraph("A[]")) + paragraph("B"));
            expect(getRelatedElement()?.name).toBe("aside");

            editor.model.change((writer) => writer.setSelection(
                editor.model.document.getRoot()?.getChild(1) as ModelElement, 0));
            expect(getRelatedElement()).toBeNull();
        });

        it("is level with the edge that the aside is placed against", () => {
            const target = new Rect({
                left: 100, top: 300, right: 400, bottom: 500, width: 300, height: 200
            });
            const balloon = new Rect({
                left: 0, top: 0, right: 200, bottom: 40, width: 200, height: 40
            });
            const getFirstPosition = () => {
                const viewport = new Rect(window);
                const [ first ] = toolbarDefinition().positions
                    .map((position) => position(target, balloon, viewport))
                    .filter((position) => position !== null);
                return `${first?.name} ${first?.left}`;
            };

            setModelData(editor.model,
                aside(paragraph("A")) + aside(paragraph("B"), " position=\"left\"") +
                aside(paragraph("C"), "") + paragraph("[]"));
            expect(getFirstPosition()).toBe("arrow_s 150");
            for (const [ index, expected ] of [ "arrow_se 200", "arrow_sw 100", "arrow_s 150" ]
                .entries()) {
                selectAside(index);
                expect(getFirstPosition(), expected).toBe(expected);
            }
        });
    });
});
