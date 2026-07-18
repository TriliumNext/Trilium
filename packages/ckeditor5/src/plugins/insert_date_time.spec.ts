import { ClassicEditor, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { installGlobMock } from "../../test/globals-test-kit.js";
import InsertDateTimePlugin, { COMMAND_NAME } from "./insert_date_time.js";

describe("InsertDateTimePlugin", () => {
    let editor: ClassicEditor;
    let triggerCommand: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        triggerCommand = vi.fn();
        installGlobMock({
            getComponentByEl: () => ({ triggerCommand })
        });

        editor = await createTestEditor([Essentials, Paragraph, InsertDateTimePlugin]);
    });

    it("loads the plugin and registers the command and toolbar button", () => {
        expect(editor.plugins.get(InsertDateTimePlugin)).toBeInstanceOf(InsertDateTimePlugin);
        expect(editor.commands.get(COMMAND_NAME)).toBeDefined();
        expect(editor.ui.componentFactory.has("dateTime")).toBe(true);
    });

    it("triggers insertDateTimeToText on the glob component when executed", () => {
        editor.execute(COMMAND_NAME);
        expect(triggerCommand).toHaveBeenCalledWith("insertDateTimeToText");
    });

    it("wires the button to the command (enablement and execution)", () => {
        const view = editor.ui.componentFactory.create("dateTime") as { isEnabled: boolean; fire(name: string): void };
        const command = editor.commands.get(COMMAND_NAME);

        expect(view.isEnabled).toBe(command?.isEnabled);

        const spy = vi.spyOn(editor, "execute");
        view.fire("execute");
        expect(spy).toHaveBeenCalledWith(COMMAND_NAME);
    });

    it("is enabled when the editor is not read-only", () => {
        expect(editor.commands.get(COMMAND_NAME)?.isEnabled).toBe(true);
    });

    it("is disabled when the editor is read-only", () => {
        editor.enableReadOnlyMode("test");
        expect(editor.commands.get(COMMAND_NAME)?.isEnabled).toBe(false);
        editor.disableReadOnlyMode("test");
    });
});
