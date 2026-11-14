import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    type ClassicEditor,
    Essentials,
    IconObjectInlineRight,
    ListItemGroupView,
    Paragraph,
    Plugin,
    Rect,
    toWidget,
    toWidgetEditable,
    Undo,
    Widget
} from "ckeditor5";
import { describe, expect, it, vi } from "vitest";

import { getListRow, getListRows, pickListRow } from "../../test/dropdown-kit.js";
import { createTestEditor } from "../../test/editor-kit.js";
import PositionedWidgets, {
    createWidgetPositionDropdown, getAnchoredToolbarPositions, getPositionAttributes,
    getPositionOfView, type PositionedWidgetConfig, POSITIONS, type PositionValue,
    type WidgetPositionCommand
} from "./positioned_widgets.js";
import type { ResizeAnchor } from "./resizable_widgets/resizable_widgets.js";

const COMMAND = "testBoxPosition";
const WRAPPED = "<div class=\"test-box\" data-position=\"wrap-left\">&nbsp;</div>";

let editor: ClassicEditor;

/** An editor with a `testBox` widget that can contain a `testCaption`, placed with `config`. */
async function createEditor(config: Omit<PositionedWidgetConfig, "commandName"> = {}) {
    class PositionedTestBox extends Plugin {
        static get requires() {
            return [ Widget, PositionedWidgets ];
        }

        init() {
            const { conversion, model, plugins } = this.editor;
            model.schema.register("testBox", { isObject: true, allowWhere: "$block" });
            model.schema.register("testCaption", {
                allowIn: "testBox", allowContentOf: "$block", isLimit: true
            });

            conversion.for("upcast").elementToElement({
                view: { name: "div", classes: "test-box" },
                model: (view, { writer }) =>
                    writer.createElement("testBox", getPositionOfView(view))
            });
            conversion.for("dataDowncast").elementToElement({
                model: "testBox",
                view: (box, { writer }) => writer.createContainerElement("div", {
                    class: "test-box", ...getPositionAttributes(box)
                })
            });
            conversion.for("editingDowncast").elementToElement({
                model: "testBox",
                view: (box, { writer }) => toWidget(writer.createContainerElement("div", {
                    class: "test-box", ...getPositionAttributes(box)
                }), writer)
            });
            conversion.for("editingDowncast").elementToElement({
                model: "testCaption",
                view: (_caption, { writer }) =>
                    toWidgetEditable(writer.createEditableElement("figcaption"), writer)
            });

            plugins.get(PositionedWidgets).register("testBox", { commandName: COMMAND, ...config });
        }
    }

    editor = await createTestEditor([ Essentials, Paragraph, Undo, PositionedTestBox ]);
}

function getCommand() {
    return editor.commands.get(COMMAND) as WidgetPositionCommand;
}

function getModelBox() {
    const box = [ ...editor.model.document.getRoot()?.getChildren() ?? [] ]
        .find((child) => child.is("element", "testBox"));
    if (!box?.is("element")) {
        throw new Error("Expected a box.");
    }
    return box;
}

/** The `data-position` of the rendered box. */
function getRenderedPosition() {
    const box = editor.editing.view.getDomRoot()?.querySelector(".test-box");
    if (!box) {
        throw new Error("Expected a rendered box.");
    }
    return box.getAttribute("data-position");
}

describe("PositionedWidgets", () => {
    it("loads and saves a position other than centered, and drops an unknown one", async () => {
        await createEditor();
        editor.setData(WRAPPED);
        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe("<testBox position=\"wrap-left\"></testBox>");
        expect(editor.getData()).toBe(WRAPPED);
        expect(getRenderedPosition()).toBe("wrap-left");

        for (const value of [ "center", "other" ]) {
            editor.setData(WRAPPED.replace("wrap-left", value));
            expect(getModelData(editor.model, { withoutSelection: true }), value)
                .toBe("<testBox></testBox>");
            expect(editor.getData(), value).toBe("<div class=\"test-box\">&nbsp;</div>");
        }
    });

    it("sets the position of the selected widget in one undo step, and centered removes it",
        async () => {
            await createEditor();
            setModelData(editor.model, "[<testBox></testBox>]");
            const command = getCommand();
            expect([ command.isEnabled, command.value, command.positions ])
                .toEqual([ true, "center", POSITIONS ]);

            editor.execute(COMMAND, { value: "wrap-right" });
            expect([ command.value, getRenderedPosition() ])
                .toEqual([ "wrap-right", "wrap-right" ]);
            expect(editor.getData()).toBe(WRAPPED.replace("wrap-left", "wrap-right"));

            editor.execute(COMMAND, { value: "center" });
            expect([ command.value, getRenderedPosition() ]).toEqual([ "center", null ]);
            expect(getModelData(editor.model)).toBe("[<testBox></testBox>]");

            editor.execute("undo");
            expect([ command.value, getRenderedPosition() ])
                .toEqual([ "wrap-right", "wrap-right" ]);
        });

    it("acts on the widget around the selection, and on nothing outside one", async () => {
        await createEditor();
        setModelData(editor.model,
            "<paragraph>fo[]o</paragraph><testBox><testCaption>bar</testCaption></testBox>");
        const command = getCommand();
        expect([ command.isEnabled, command.value, command.positions ])
            .toEqual([ false, null, [] ]);

        // The decorated `execute()` skips a disabled command, so it is forced enabled.
        command.isEnabled = true;
        command.execute({ value: "left" });
        expect(getModelData(editor.model)).not.toContain("position");

        setModelData(editor.model,
            "<paragraph>foo</paragraph><testBox><testCaption>b[]ar</testCaption></testBox>");
        expect([ command.isEnabled, command.value ]).toEqual([ true, "center" ]);
        editor.execute(COMMAND, { value: "left" });
        expect(getModelData(editor.model, { withoutSelection: true })).toBe(
            "<paragraph>foo</paragraph>"
            + "<testBox position=\"left\"><testCaption>bar</testCaption></testBox>"
        );
    });

    it("offers only the positions that the widget can take now", async () => {
        let offered: readonly PositionValue[] = [ "left", "center", "right" ];
        await createEditor({ getPositions: () => offered });
        setModelData(editor.model, "[<testBox></testBox>]");
        const command = getCommand();
        expect([ command.isEnabled, command.positions ]).toEqual([ true, offered ]);

        editor.execute(COMMAND, { value: "wrap-left" });
        expect(getModelData(editor.model)).toBe("[<testBox></testBox>]");

        offered = [];
        command.refresh();
        expect([ command.isEnabled, command.value, command.positions ])
            .toEqual([ false, null, [] ]);
    });

    it("anchors a widget to the edge that its position places it against", async () => {
        await createEditor();
        const positionedWidgets = editor.plugins.get(PositionedWidgets);
        const getAnchor = (position: PositionValue) => {
            editor.setData(WRAPPED.replace("wrap-left", position));
            return positionedWidgets.getAnchor(getModelBox());
        };

        expect(POSITIONS.map(getAnchor)).toEqual([ "left", "center", "right", "left", "right" ]);
    });

    it("places a widget at the position that its `getPosition()` returns", async () => {
        // As an embed whose box size cannot wrap the text, with a wrap position saved.
        await createEditor({ getPosition: () => "center" });
        editor.setData(WRAPPED);
        editor.model.change((writer) => writer.setSelection(getModelBox(), "on"));

        expect([
            getCommand().value, editor.plugins.get(PositionedWidgets).getAnchor(getModelBox())
        ]).toEqual([ "center", "center" ]);
        expect(editor.getData()).toBe(WRAPPED);
    });
});

describe("createWidgetPositionDropdown", () => {
    function createDropdown() {
        const dropdown = createWidgetPositionDropdown(editor, editor.locale, {
            commandName: COMMAND, label: "Box position"
        });
        dropdown.render();
        return dropdown;
    }

    it("lists the positions by how the text runs around the widget, and sets the one picked",
        async () => {
            await createEditor();
            const dropdown = createDropdown();
            setModelData(editor.model, "[<testBox></testBox>]");

            expect(dropdown.buttonView).toMatchObject({ label: "Box position", tooltip: true });
            expect(getListRows(dropdown)).toStrictEqual([
                "# Break text", "Align left", "Align center ✓", "Align right",
                "# Wrap text", "Align left", "Align right"
            ]);

            const focus = vi.spyOn(editor.editing.view, "focus");
            pickListRow(dropdown, "Wrap text", "Align right");
            expect(getModelData(editor.model))
                .toBe("[<testBox position=\"wrap-right\"></testBox>]");
            expect(focus).toHaveBeenCalled();
            expect(dropdown.buttonView.icon).toBe(IconObjectInlineRight);
        });

    it("hides the positions that the widget cannot take now", async () => {
        await createEditor({ getPositions: () => [ "left", "center", "right" ] });
        const dropdown = createDropdown();
        setModelData(editor.model, "[<testBox></testBox>]");
        const groups = () => [ ...dropdown.listView?.items ?? [] ]
            .filter((item) => item instanceof ListItemGroupView)
            .map((group) => [ group.label, group.isVisible ]);

        expect([
            getListRow(dropdown, "Break text", "Align right").isVisible,
            getListRow(dropdown, "Wrap text", "Align right").isVisible
        ]).toEqual([ true, false ]);
        expect(groups()).toEqual([ [ "Break text", true ], [ "Wrap text", false ] ]);
    });
});

describe("getAnchoredToolbarPositions", () => {
    it("is level with the edge that the widget is placed against, else centered", () => {
        let anchor: ResizeAnchor = "left";
        const positions = getAnchoredToolbarPositions(() => anchor);
        const target = new Rect({
            left: 100, top: 300, right: 400, bottom: 500, width: 300, height: 200
        });
        const balloon = new Rect({
            left: 0, top: 0, right: 200, bottom: 40, width: 200, height: 40
        });
        const viewport = new Rect(window);
        const getFirstPositions = () => positions
            .map((position) => position(target, balloon, viewport))
            .filter((position) => position !== null)
            .slice(0, 2)
            .map(({ name, left }) => `${name} ${left}`);

        expect(getFirstPositions()).toEqual([ "arrow_sw 100", "arrow_nw 100" ]);
        anchor = "right";
        expect(getFirstPositions()).toEqual([ "arrow_se 200", "arrow_ne 200" ]);
        anchor = "center";
        expect(getFirstPositions()).toEqual([ "arrow_s 150", "arrow_sw 225" ]);
    });
});
