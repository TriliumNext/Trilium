import {
    _getModelData, _setModelData, Bold, ButtonView, ClassicEditor, DropdownView, Essentials, HorizontalLine, ListItemView,
    Paragraph, SplitButtonView
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { installGlobMock } from "../../test/globals-test-kit.js";
import InsertDateTimePlugin, { COMMAND_NAME, DATE_TIME_PRESETS } from "./insert_date_time.js";

describe("InsertDateTimePlugin", () => {
    let editor: ClassicEditor;
    let formatDateTime: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        formatDateTime = vi.fn((_date: Date, format?: string) => (format ? `<${format}>` : "2026-09-25 10:30"));
        installGlobMock({
            getComponentByEl: () => ({ formatDateTime })
        });

        editor = await createTestEditor([Essentials, Paragraph, Bold, HorizontalLine, InsertDateTimePlugin]);
    });

    it("loads the plugin and registers the command and toolbar button", () => {
        expect(editor.plugins.get(InsertDateTimePlugin)).toBeInstanceOf(InsertDateTimePlugin);
        expect(editor.commands.get(COMMAND_NAME)).toBeDefined();
        expect(editor.ui.componentFactory.has("dateTime")).toBe(true);
    });

    it("inserts the date formatted by the host at the caret", () => {
        _setModelData(editor.model, "<paragraph>Due: []</paragraph>");
        editor.execute(COMMAND_NAME);

        expect(formatDateTime).toHaveBeenCalledWith(expect.any(Date), undefined);
        expect(_getModelData(editor.model)).toBe("<paragraph>Due: 2026-09-25 10:30[]</paragraph>");
    });

    it("replaces a selection and keeps its formatting", () => {
        _setModelData(editor.model, "<paragraph>Due: <$text bold=\"true\">[yesterday]</$text></paragraph>");
        editor.execute(COMMAND_NAME);

        expect(_getModelData(editor.model))
            .toBe("<paragraph>Due: <$text bold=\"true\">2026-09-25 10:30[]</$text></paragraph>");
    });

    it("replaces a selected widget with a paragraph holding the date", () => {
        _setModelData(editor.model, "<paragraph>a</paragraph>[<horizontalLine></horizontalLine>]");
        editor.execute(COMMAND_NAME);

        expect(_getModelData(editor.model))
            .toBe("<paragraph>a</paragraph><paragraph>2026-09-25 10:30[]</paragraph>");
    });

    it("undoes the insertion in a single step", () => {
        _setModelData(editor.model, "<paragraph>[yesterday]</paragraph>");
        editor.execute(COMMAND_NAME);
        editor.execute("undo");

        expect(_getModelData(editor.model)).toBe("<paragraph>[yesterday]</paragraph>");
    });

    it("passes a chosen format to the host", () => {
        _setModelData(editor.model, "<paragraph>[]</paragraph>");
        editor.execute(COMMAND_NAME, { format: "HH:mm" });

        expect(formatDateTime).toHaveBeenCalledWith(expect.any(Date), "HH:mm");
        expect(_getModelData(editor.model)).toBe("<paragraph><HH:mm>[]</paragraph>");
    });

    describe("split button", () => {
        let dropdown: DropdownView;

        beforeEach(() => {
            dropdown = editor.ui.componentFactory.create("dateTime") as DropdownView;
        });

        function openList() {
            dropdown.isOpen = true;
            const items = dropdown.listView?.items;
            expect(items).toBeDefined();
            return [ ...(items ?? []) ]
                .filter((item): item is ListItemView => item instanceof ListItemView)
                .map((item) => item.children.get(0) as ButtonView);
        }

        it("inserts the date in the default format from the main button", () => {
            expect(dropdown.buttonView).toBeInstanceOf(SplitButtonView);
            // No dictionary is configured here, so `t()` renders the message id, which is the
            // English label.
            expect(dropdown.buttonView.label).toBe("Insert date/time");

            const spy = vi.spyOn(editor, "execute");
            dropdown.buttonView.fire("execute");
            expect(spy).toHaveBeenCalledWith(COMMAND_NAME);
        });

        it("lists the default format and every preset, labeled with the current date in it", () => {
            const labels = openList().map((button) => button.label);

            expect(labels).toEqual([ "2026-09-25 10:30", ...DATE_TIME_PRESETS.map(({ format }) => `<${format}>`) ]);
        });

        it("leaves out a preset that renders the same as the default format", () => {
            formatDateTime.mockImplementation((_date: Date, format?: string) => (format === "HH:mm" || !format ? "same" : `<${format}>`));

            const labels = openList().map((button) => button.label);
            expect(labels.filter((label) => label === "same")).toHaveLength(1);
            expect(labels).toHaveLength(DATE_TIME_PRESETS.length);
        });

        it("renders the labels again every time it opens", () => {
            openList();
            dropdown.isOpen = false;
            formatDateTime.mockImplementation(() => "later");

            expect(openList().map((button) => button.label)).toContain("later");
        });

        it("inserts the date in the format picked from the list", () => {
            const [ defaultItem, firstPreset ] = openList();
            const spy = vi.spyOn(editor, "execute");

            firstPreset.fire("execute");
            expect(spy).toHaveBeenLastCalledWith(COMMAND_NAME, { format: DATE_TIME_PRESETS[0].format });

            defaultItem.fire("execute");
            expect(spy).toHaveBeenLastCalledWith(COMMAND_NAME, { format: undefined });
        });

        it("follows the command's enabled state", () => {
            expect(dropdown.isEnabled).toBe(true);
            editor.enableReadOnlyMode("test");
            expect(dropdown.isEnabled).toBe(false);
            editor.disableReadOnlyMode("test");
        });
    });

    it("is enabled only when the editor is editable", () => {
        const command = editor.commands.get(COMMAND_NAME);
        expect(command?.isEnabled).toBe(true);

        editor.enableReadOnlyMode("test");
        expect(command?.isEnabled).toBe(false);
        editor.disableReadOnlyMode("test");
    });
});
