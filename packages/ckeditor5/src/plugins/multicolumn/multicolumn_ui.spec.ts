import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    type ButtonView,
    type ClassicEditor,
    ContextualBalloon,
    type DropdownView,
    Essentials,
    IconCancel,
    type ModelElement,
    Paragraph,
    type ToolbarView,
    type ViewDocumentSelection,
    type ViewElement,
    WidgetToolbarRepository
} from "ckeditor5";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import multicolumnIcon from "../../icons/multicolumn.svg?raw";
import type TileRowView from "../tile_row_view.js";
import { COLUMN_RATIOS } from "./constants.js";
import Multicolumn from "./multicolumn.js";
import { createLayoutFigure, formatRatios } from "./multicolumn_ui.js";

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

    it("removes the layout from its button, keeping the content", () => {
        setModelData(editor.model, layout("1-3", paragraph("A[]"), paragraph("B")));
        const button = editor.ui.componentFactory.create("removeMulticolumnLayout") as ButtonView;
        expect([button.label, button.icon, button.tooltip])
            .toEqual(["Remove layout", IconCancel, true]);
        expect(button.isEnabled).toBe(true);
        const focus = vi.spyOn(editor.editing.view, "focus");

        button.fire("execute");

        expect(getModelData(editor.model)).toBe(paragraph("A[]") + paragraph("B"));
        expect(focus).toHaveBeenCalled();
        expect(button.isEnabled).toBe(false);
    });

    describe("layout dropdown", () => {
        function createDropdown() {
            const dropdown = editor.ui.componentFactory.create("columnLayout") as DropdownView;
            dropdown.render();
            const element = dropdown.element as HTMLElement;
            document.body.appendChild(element);
            onTestFinished(() => element.remove());
            dropdown.isOpen = true;
            return dropdown;
        }

        function tilesOf(dropdown: DropdownView) {
            const row = dropdown.panelView.children.first as TileRowView;
            return [...row.tiles];
        }

        it("shows a figure of every layout, with the current one on and focused", () => {
            setModelData(editor.model, layout("1-3", paragraph("A[]"), paragraph("B")));
            const dropdown = createDropdown();
            const tiles = tilesOf(dropdown);

            expect(tiles.map(tile => tile.label)).toEqual([
                "2 columns (50%-50%)",
                "2 columns (25%-75%)",
                "2 columns (75%-25%)",
                "3 columns (33%-33%-33%)",
                "3 columns (25%-50%-25%)",
                "4 columns (25%-25%-25%-25%)"
            ]);
            expect(tiles.every(tile => tile.tooltip)).toBe(true);
            expect(tiles.map(tile => tile.icon))
                .toEqual(COLUMN_RATIOS.map(ratios => createLayoutFigure(ratios, 44)));

            expect(tiles.filter(tile => tile.isOn).map(tile => tile.label))
                .toEqual(["2 columns (25%-75%)"]);
            expect(document.activeElement).toBe(tiles[1].element);
            expect(dropdown.buttonView.label).toBe("Column layout");
            expect(dropdown.buttonView.icon).toBe(createLayoutFigure("1-3", 20));
            expect(dropdown.isEnabled).toBe(true);
        });

        it("applies the chosen layout, closes and returns the focus to the editor", () => {
            setModelData(editor.model, layout("1-1", paragraph("A[]"), paragraph("B")));
            const dropdown = createDropdown();
            const focus = vi.spyOn(editor.editing.view, "focus");

            tilesOf(dropdown)[4].fire("execute");

            expect(getModelData(editor.model, { withoutSelection: true }))
                .toBe(layout("1-2-1", paragraph("A"), paragraph("B"), paragraph("")));
            expect(dropdown.buttonView.icon).toBe(createLayoutFigure("1-2-1", 20));
            expect(dropdown.isOpen).toBe(false);
            expect(focus).toHaveBeenCalled();
        });

        it("is disabled outside a layout and shows the insert icon", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            const dropdown = createDropdown();

            expect(dropdown.isEnabled).toBe(false);
            expect(dropdown.buttonView.icon).toBe(multicolumnIcon);
            expect(tilesOf(dropdown).some(tile => tile.isOn)).toBe(false);
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

        it("shows the layout dropdown and the remove button while in a layout", () => {
            setModelData(editor.model, layout("1-3", paragraph("A[]"), paragraph("B")));
            editor.ui.focusTracker.isFocused = true;
            editor.ui.update();

            const toolbar = toolbarDefinition().view;
            expect(editor.plugins.get(ContextualBalloon).visibleView).toBe(toolbar);
            expect(toolbar.ariaLabel).toBe("Multicolumn layout toolbar");
            const items = [...toolbar.items] as (DropdownView | ButtonView)[];
            const buttons = items.map(item => "buttonView" in item ? item.buttonView : item);
            expect(buttons.map(button => [button.label, button.icon])).toEqual([
                ["Column layout", createLayoutFigure("1-3", 20)],
                ["Remove layout", IconCancel]
            ]);
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

    describe("layout figure", () => {
        function draw(ratios: string, size: number) {
            const svg = new DOMParser()
                .parseFromString(createLayoutFigure(ratios, size), "image/svg+xml");
            const rect = svg.querySelector("rect");
            const number = (element: Element | null, name: string) =>
                Number(element?.getAttribute(name));
            const dots = [...svg.querySelectorAll("circle")]
                .map(dot => ({ x: number(dot, "cx"), y: number(dot, "cy"), r: number(dot, "r") }));
            return {
                viewBox: svg.documentElement.getAttribute("viewBox"),
                box: ["x", "y", "width", "height"].map(name => number(rect, name)),
                columns: [...new Set(dots.map(dot => dot.x))],
                dots: dots.filter(dot => dot.x === dots[0].x)
            };
        }

        it("draws a dotted line between each pair of columns, 4px in from the sides", () => {
            const figures = COLUMN_RATIOS.map(ratios => draw(ratios, 44));

            expect(figures.map(figure => figure.columns)).toEqual([
                [22], [13], [31],
                [16, 28], [13, 31],
                [13, 22, 31]
            ]);
            expect(figures[0].viewBox).toBe("0 0 44 44");
            expect(figures[0].box).toEqual([4, 6.6, 36, 30.8]);
        });

        it("spaces the dots evenly, 1px from the outline at both ends, at any size", () => {
            for (const [size, count] of [[44, 9], [20, 4]]) {
                const { box: [, top, , height], dots } = draw("1-1", size);
                const outline = 1.5 / 2;
                const first = dots[0];
                const last = dots[dots.length - 1];
                const steps = dots.slice(1).map((dot, index) => dot.y - dots[index].y);

                expect(dots, `${size}px`).toHaveLength(count);
                expect(first.y - first.r - (top + outline)).toBeCloseTo(1, 2);
                expect(top + height - outline - (last.y + last.r)).toBeCloseTo(1, 2);
                expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(.02);
            }
        });
    });
});
