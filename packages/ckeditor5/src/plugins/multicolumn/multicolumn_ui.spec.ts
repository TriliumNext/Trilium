import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    type ButtonView,
    type ClassicEditor,
    ContextualBalloon,
    DropdownView,
    Essentials,
    IconCancel,
    type ListItemView,
    type ModelElement,
    Paragraph,
    SplitButtonView,
    type ToolbarView,
    type ViewDocumentSelection,
    type ViewElement,
    WidgetToolbarRepository
} from "ckeditor5";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import multicolumnIcon from "../../icons/multicolumn.svg?raw";
import type TileRowView from "../tile_row_view.js";
import ToolbarGroupMenu, {
    type ToolbarGroupMenuEntry, type ToolbarGroupMenuHost, type ToolbarGroupMenuItem,
    type ToolbarGroupMenuRequest
} from "../toolbar_group_menu.js";
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

function entryOf(item: ToolbarGroupMenuItem | undefined): ToolbarGroupMenuEntry {
    if (item?.kind !== "entry") {
        throw new Error("expected a menu entry");
    }
    return item;
}

describe("MulticolumnUI", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Multicolumn]);
    });

    describe("insert button", () => {
        function createInsertDropdown() {
            const dropdown = editor.ui.componentFactory.create("multicolumnLayout") as DropdownView;
            dropdown.render();
            const element = dropdown.element as HTMLElement;
            document.body.appendChild(element);
            onTestFinished(() => element.remove());
            dropdown.isOpen = true;
            return dropdown;
        }

        function itemsOf(dropdown: DropdownView) {
            return [...dropdown.listView?.items ?? []]
                .map(item => (item as ListItemView).children.first as ButtonView);
        }

        it("inserts two columns from its main action and returns the focus to the editor", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            const dropdown = createInsertDropdown();
            const button = dropdown.buttonView;
            expect(button).toBeInstanceOf(SplitButtonView);
            expect([button.label, button.icon, button.tooltip])
                .toEqual(["Multiple column layout", multicolumnIcon, true]);
            expect(dropdown.isEnabled).toBe(true);
            const focus = vi.spyOn(editor.editing.view, "focus");

            button.fire("execute");

            expect(getModelData(editor.model, { withoutSelection: true }))
                .toBe(layout("1-1", paragraph(""), paragraph("")));
            expect(focus).toHaveBeenCalled();

            editor.enableReadOnlyMode("spec");
            expect([dropdown.isEnabled, button.isEnabled]).toEqual([false, false]);
        });

        it("lists 2, 3 and 4 columns, each inserting that many equal columns", () => {
            const dropdown = createInsertDropdown();
            const items = itemsOf(dropdown);
            const focus = vi.spyOn(editor.editing.view, "focus");

            expect(items.map(item => [item.label, item.icon])).toEqual([
                ["2 columns", createLayoutFigure("1-1", 20)],
                ["3 columns", createLayoutFigure("1-1-1", 20)],
                ["4 columns", createLayoutFigure("1-1-1-1", 20)]
            ]);
            for (const [index, ratios] of ["1-1", "1-1-1", "1-1-1-1"].entries()) {
                setModelData(editor.model, "<paragraph>[]</paragraph>");
                items[index].fire("execute");

                const columns = ratios.split("-").map(() => paragraph(""));
                expect(getModelData(editor.model, { withoutSelection: true }))
                    .toBe(layout(ratios, ...columns));
            }
            expect(focus).toHaveBeenCalledTimes(3);
        });

        it("is a split entry of a menu group, over its three column counts", async () => {
            const host = { show: vi.fn(), hide: vi.fn(), destroy: vi.fn() } satisfies
                ToolbarGroupMenuHost;
            const group = {
                label: "Insert", icon: "plus", asMenu: true, items: ["multicolumnLayout"]
            };
            const menuEditor = await createTestEditor(
                [Essentials, Paragraph, Multicolumn, ToolbarGroupMenu],
                { toolbarGroupMenu: { host: () => host }, toolbar: { items: [group] } }
            );
            const toolbar = (menuEditor.ui.view as { toolbar: ToolbarView }).toolbar;
            const dropdown = [...toolbar.items].find(item => item instanceof DropdownView);

            /** Opens the group and returns the menu entry of the layout. */
            function openEntry() {
                expect(dropdown).toBeInstanceOf(DropdownView);
                (dropdown as DropdownView).isOpen = true;
                const request = host.show.mock.lastCall?.[0] as ToolbarGroupMenuRequest | undefined;
                return entryOf(request?.items[0]);
            }

            setModelData(menuEditor.model, "<paragraph>[]</paragraph>");
            const entry = openEntry();
            expect(entry.label).toBe("Multiple column layout");
            expect(entry.children?.map(child => entryOf(child).label))
                .toEqual(["2 columns", "3 columns", "4 columns"]);

            entry.run?.();
            expect(getModelData(menuEditor.model, { withoutSelection: true }))
                .toBe(layout("1-1", paragraph(""), paragraph("")));

            setModelData(menuEditor.model, "<paragraph>[]</paragraph>");
            entryOf(openEntry().children?.[2]).run?.();
            expect(getModelData(menuEditor.model, { withoutSelection: true }))
                .toBe(layout("1-1-1-1", ...Array.from({ length: 4 }, () => paragraph(""))));
        });
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
