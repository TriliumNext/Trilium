import {
    _getModelData as getModelData, _setModelData as setModelData, ButtonView, ClassicEditor,
    CodeBlock, Essentials, LinkEditing, Paragraph
} from "ckeditor5";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import ChildNotePlugin, { type ChildNoteHost, COMMAND_NAME } from "./child_note.js";

describe("ChildNotePlugin", () => {
    let editor: ClassicEditor;
    let create: Mock<ChildNoteHost["create"]>;
    let open: Mock<ChildNoteHost["open"]>;

    beforeEach(async () => {
        create = vi.fn(async () => undefined);
        open = vi.fn();
        editor = await createTestEditor(
            [ Essentials, Paragraph, CodeBlock, LinkEditing, ChildNotePlugin ],
            { childNote: { create, open } }
        );
    });

    /** Runs the command with `create()` resolving to `notePath` once `whileCreating` has run. */
    async function createChildNote(notePath: string | undefined, whileCreating = () => {}) {
        let resolveNote: (path: string | undefined) => void = () => {};
        create.mockReturnValue(new Promise((resolve) => { resolveNote = resolve; }));

        const executed = editor.execute(COMMAND_NAME) as Promise<void>;
        whileCreating();
        resolveNote(notePath);
        await executed;
        // The reference goes in once its title resolves.
        await Promise.resolve();
        await Promise.resolve();
    }

    const content = () => getModelData(editor.model, { withoutSelection: true });

    it("has the host create the note from a button bound to the command", () => {
        const button = editor.ui.componentFactory.create(COMMAND_NAME);
        if (!(button instanceof ButtonView)) {
            throw new Error("The child note component is not a button.");
        }
        const command = editor.commands.get(COMMAND_NAME);

        // No dictionary is configured here, so `t()` renders the message id, the English label.
        expect(button.label).toBe("New child note");
        expect(button.icon).toContain("<svg");
        expect(button.isEnabled).toBe(true);

        button.fire("execute");
        expect(create).toHaveBeenCalledOnce();

        editor.enableReadOnlyMode("test");
        expect(command?.isEnabled).toBe(false);
        expect(button.isEnabled).toBe(false);
    });

    it("links to the new note where the caret was, then has the host open it", async () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        const paragraph = editor.model.document.getRoot()?.getChild(0);

        await createChildNote("root/parent/child", () => {
            editor.model.change((writer) => {
                if (paragraph) writer.setSelection(paragraph, "end");
            });
        });

        // Without a host to name it, a reference is titled by its address.
        expect(content()).toBe("<paragraph>foo<reference href=\"#root/parent/child\" "
            + "storedTitle=\"#root/parent/child\"></reference>bar</paragraph>");
        expect(open).toHaveBeenCalledExactlyOnceWith("root/parent/child");
    });

    it("links and opens nothing without a new note, or after a switch of note", async () => {
        setModelData(editor.model, "<paragraph>foo[]</paragraph>");

        await createChildNote(undefined);
        expect(content()).toBe("<paragraph>foo</paragraph>");

        await createChildNote("root/parent/child", () => editor.setData("<p>other</p>"));
        expect(content()).toBe("<paragraph>other</paragraph>");
        expect(open).not.toHaveBeenCalled();
    });

    it("is enabled only where the link to the new note can go", () => {
        const command = editor.commands.get(COMMAND_NAME);

        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        expect(command?.isEnabled).toBe(true);

        setModelData(editor.model, "<codeBlock language=\"plaintext\">foo[]bar</codeBlock>");
        expect(command?.isEnabled).toBe(false);
    });

    it("is disabled without a host to create the note, and does nothing if run", async () => {
        const hostless =
            await createTestEditor([ Essentials, Paragraph, LinkEditing, ChildNotePlugin ]);
        setModelData(hostless.model, "<paragraph>foo[]</paragraph>");
        const command = hostless.commands.get(COMMAND_NAME);
        expect(command?.isEnabled).toBe(false);

        if (command) {
            command.isEnabled = true;
        }
        await hostless.execute(COMMAND_NAME);
        expect(getModelData(hostless.model, { withoutSelection: true }))
            .toBe("<paragraph>foo</paragraph>");
    });
});
