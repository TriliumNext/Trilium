import { _setModelData as setModelData, ClassicEditor, CodeBlock, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { installGlobMock } from "../../test/globals-test-kit.js";
import InternalLinkPlugin, { COMMAND_NAME } from "./internallink.js";

describe("InternalLinkPlugin", () => {
    let editor: ClassicEditor;
    let triggerCommand: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        triggerCommand = vi.fn();
        installGlobMock({
            getComponentByEl: () => ({ triggerCommand })
        });

        editor = await createTestEditor([Essentials, Paragraph, CodeBlock, InternalLinkPlugin]);
    });

    it("loads the plugin and registers the command and toolbar button", () => {
        expect(editor.plugins.get(InternalLinkPlugin)).toBeInstanceOf(InternalLinkPlugin);
        expect(editor.commands.get(COMMAND_NAME)).toBeDefined();
        expect(editor.ui.componentFactory.has("internalLink")).toBe(true);
    });

    it("triggers the addLinkToText command on the Trilium component when executed", () => {
        editor.execute(COMMAND_NAME);
        expect(triggerCommand).toHaveBeenCalledWith("addLinkToText");
    });

    it("labels the button without the shortcut, leaving that to the keystroke", () => {
        const view = editor.ui.componentFactory.create("internalLink") as { label?: string; keystroke?: string };

        // No dictionary is configured here, so `t()` renders the message id, which is the English
        // label. The shortcut is not part of it — CKEditor appends the keystroke to the tooltip,
        // localized per platform.
        expect(view.label).toBe("Internal link");
        expect(view.keystroke).toBe("CTRL+L");
    });

    it("wires the button to the command (enablement and execution)", () => {
        const view = editor.ui.componentFactory.create("internalLink") as { isEnabled: boolean; fire(name: string): void };
        const command = editor.commands.get(COMMAND_NAME);

        expect(view.isEnabled).toBe(command?.isEnabled);

        const spy = vi.spyOn(editor, "execute");
        view.fire("execute");
        expect(spy).toHaveBeenCalledWith(COMMAND_NAME);
    });

    it("is enabled in a regular paragraph", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        expect(editor.commands.get(COMMAND_NAME)?.isEnabled).toBe(true);
    });

    it("is disabled inside a code block", () => {
        setModelData(editor.model, "<codeBlock language=\"plaintext\">foo[]bar</codeBlock>");
        expect(editor.commands.get(COMMAND_NAME)?.isEnabled).toBe(false);
    });

    it("is disabled when the editor is read-only", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        editor.enableReadOnlyMode("test");
        expect(editor.commands.get(COMMAND_NAME)?.isEnabled).toBe(false);
        editor.disableReadOnlyMode("test");
    });
});
