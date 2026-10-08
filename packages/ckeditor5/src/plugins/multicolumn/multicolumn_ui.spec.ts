import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    type ButtonView,
    type ClassicEditor,
    ContextualBalloon,
    type DropdownView,
    Essentials,
    type ListItemGroupView,
    type ListItemView,
    type ModelElement,
    Paragraph,
    type ToolbarView,
    type ViewDocumentSelection,
    type ViewElement,
    WidgetToolbarRepository
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import Multicolumn from "./multicolumn.js";
import { formatRatios } from "./multicolumn_ui.js";

interface ToolbarDefinition {
    view: ToolbarView;
    getRelatedElement(selection: ViewDocumentSelection): ViewElement | null;
}

function paragraph(text: string) {
    return `<paragraph>${text}</paragraph>`;
}

function layout(ratios: string, ...columns: string[]) {
    const content = columns.map(column => `<multicolumnColumn>${column}</multicolumnColumn>`);
    return `<multicolumnLayout columnRatios="${ratios}">${content.join("")}</multicolumnLayout>`;
}

describe("MulticolumnUI", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Multicolumn]);
    });

    it("inserts a layout from its button and returns the focus to the editor", () => {
        setModelData(editor.model, "<paragraph>[]</paragraph>");
        const button = editor.ui.componentFactory.create("multicolumnLayout") as ButtonView;
        expect(button.label).toBe("Multicolumn layout");
        expect(button.icon && button.tooltip).toBeTruthy();
        expect(button.isEnabled).toBe(true);
        const focus = vi.spyOn(editor.editing.view, "focus");

        button.fire("execute");

        expect(getModelData(editor.model)).toContain("<multicolumnLayout");
        expect(focus).toHaveBeenCalled();

        editor.enableReadOnlyMode("spec");
        expect(button.isEnabled).toBe(false);
    });

    describe("layout dropdown", () => {
        function createDropdown() {
            const dropdown = editor.ui.componentFactory.create("columnLayout") as DropdownView;
            dropdown.render();
            dropdown.isOpen = true;
            return dropdown;
        }

        function groupsOf(dropdown: DropdownView) {
            const groups = [...dropdown.listView?.items ?? []] as ListItemGroupView[];
            return groups.map(group => ({
                label: group.label,
                buttons: ([...group.items] as ListItemView[])
                    .map(item => item.children.first as ButtonView)
            }));
        }

        it("lists every layout grouped by column count and checks the current one", () => {
            setModelData(editor.model, layout("1-3", paragraph("A[]"), paragraph("B")));
            const dropdown = createDropdown();
            const groups = groupsOf(dropdown);

            const labels = groups.map(group => [
                group.label,
                group.buttons.map(button => button.label)
            ]);
            expect(labels).toEqual([
                ["2 columns", ["50%-50%", "25%-75%", "75%-25%"]],
                ["3 columns", ["33%-33%-33%", "25%-50%-25%"]],
                ["4 columns", ["25%-25%-25%-25%"]]
            ]);
            const checked = groups.flatMap(group => group.buttons).filter(button => button.isOn);
            expect(checked.map(button => button.label)).toEqual(["25%-75%"]);
            expect(dropdown.buttonView.label).toBe("25%-75%");
            expect(dropdown.isEnabled).toBe(true);
        });

        it("applies the chosen layout and returns the focus to the editor", () => {
            setModelData(editor.model, layout("1-1", paragraph("A[]"), paragraph("B")));
            const dropdown = createDropdown();
            const focus = vi.spyOn(editor.editing.view, "focus");

            groupsOf(dropdown)[1].buttons[1].fire("execute");

            expect(getModelData(editor.model, { withoutSelection: true }))
                .toBe(layout("1-2-1", paragraph("A"), paragraph("B"), paragraph("")));
            expect(dropdown.buttonView.label).toBe("25%-50%-25%");
            expect(focus).toHaveBeenCalled();
        });

        it("is disabled and blank outside a layout", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            const dropdown = createDropdown();

            expect(dropdown.isEnabled).toBe(false);
            expect(dropdown.buttonView.label).toBe("");
        });
    });

    describe("toolbar", () => {
        function toolbarDefinition() {
            const repository = editor.plugins.get(WidgetToolbarRepository) as unknown as {
                _toolbarDefinitions: Map<string, ToolbarDefinition>;
            };
            const definition = repository._toolbarDefinitions.get("multicolumnLayout");
            expect(definition).toBeDefined();
            return definition as ToolbarDefinition;
        }

        function relatedRatios() {
            const selection = editor.editing.view.document.selection;
            const related = toolbarDefinition().getRelatedElement(selection);
            return related?.getAttribute("data-trilium-column-ratios") ?? null;
        }

        it("shows the layout dropdown while the selection is in a layout", () => {
            setModelData(editor.model, layout("1-3", paragraph("A[]"), paragraph("B")));
            editor.ui.focusTracker.isFocused = true;
            editor.ui.update();

            const toolbar = toolbarDefinition().view;
            expect(editor.plugins.get(ContextualBalloon).visibleView).toBe(toolbar);
            expect(toolbar.ariaLabel).toBe("Multicolumn layout toolbar");
            const items = [...toolbar.items] as DropdownView[];
            expect(items.map(item => [item.buttonView.tooltip, item.buttonView.label]))
                .toEqual([["Column layout", "25%-75%"]]);
        });

        it("belongs to the innermost layout that holds or is the selection", () => {
            const inner = layout("1-2-1", paragraph("A[]"), paragraph("B"), paragraph("C"));
            setModelData(editor.model, layout("1-3", inner, paragraph("D")) + paragraph("Outside"));
            expect(relatedRatios()).toBe("1-2-1");

            const root = editor.model.document.getRoot() as ModelElement;
            const outer = root.getChild(0) as ModelElement;
            const innerLayout = (outer.getChild(0) as ModelElement).getChild(0) as ModelElement;
            editor.model.change(writer => writer.setSelection(innerLayout, "on"));
            expect(relatedRatios()).toBe("1-2-1");

            editor.model.change(writer => writer.setSelection(outer, "on"));
            expect(relatedRatios()).toBe("1-3");

            editor.model.change(writer => writer.setSelection(root.getChild(1) as ModelElement, 0));
            expect(relatedRatios()).toBeNull();
        });
    });

    it("formats weights as rounded percentages", () => {
        expect(["1-1", "3-1", "1-1-1", "1-2-1"].map(formatRatios))
            .toEqual(["50%-50%", "75%-25%", "33%-33%-33%", "25%-50%-25%"]);
    });
});
