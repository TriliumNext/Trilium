import { _setModelData as setModelData, ClassicEditor, Essentials, Link, Paragraph } from "ckeditor5";
import { describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import CopyLinkUrlButton from "./copy_link_url.js";

describe("CopyLinkUrlButton", () => {
    let editor: ClassicEditor;

    async function createEditor(extraConfig: Record<string, unknown> = {}): Promise<ClassicEditor> {
        return createTestEditor([Essentials, Paragraph, Link, CopyLinkUrlButton], extraConfig);
    }

    it("registers itself as a plugin", async () => {
        editor = await createEditor();
        expect(editor.plugins.get(CopyLinkUrlButton)).toBeInstanceOf(CopyLinkUrlButton);
    });

    it("registers the copyLinkUrl component in the UI factory", async () => {
        editor = await createEditor();
        expect(editor.ui.componentFactory.has("copyLinkUrl")).toBe(true);
    });

    describe("button execution — with config.clipboard.copy", () => {
        it("calls clipboard.copy with the link href when a link is selected", async () => {
            const copyFn = vi.fn();
            editor = await createEditor({
                clipboard: { copy: copyFn }
            });

            // Set up a paragraph with a link and select inside it.
            setModelData(editor.model, '<paragraph><$text linkHref="https://example.com">my link</$text></paragraph>');

            // Move selection into the link text so the link command reports its href.
            editor.model.change((writer) => {
                const root = editor.model.document.getRoot();
                if (!root) {
                    throw new Error("No model root.");
                }
                const paragraph = root.getChild(0);
                if (!paragraph || !paragraph.is("element")) {
                    throw new Error("No paragraph.");
                }
                writer.setSelection(paragraph, 1);
            });

            const button = editor.ui.componentFactory.create("copyLinkUrl");
            button.fire("execute");

            expect(copyFn).toHaveBeenCalledWith("https://example.com");
        });

        it("does not call clipboard.copy when no link is selected", async () => {
            const copyFn = vi.fn();
            editor = await createEditor({
                clipboard: { copy: copyFn }
            });

            setModelData(editor.model, "<paragraph>plain text[]</paragraph>");

            const button = editor.ui.componentFactory.create("copyLinkUrl");
            button.fire("execute");

            expect(copyFn).not.toHaveBeenCalled();
        });

        it("does not call clipboard.copy when href is an empty string", async () => {
            const copyFn = vi.fn();
            editor = await createEditor({
                clipboard: { copy: copyFn }
            });

            // Manually override the link command value to empty string to exercise that branch.
            const linkCommand = editor.commands.get("link");
            if (!linkCommand) {
                throw new Error("Link command not registered.");
            }
            // Force the link command value to empty string via a spy.
            const original = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(linkCommand), "value");
            vi.spyOn(linkCommand, "value", "get").mockReturnValue("" as unknown as boolean);

            const button = editor.ui.componentFactory.create("copyLinkUrl");
            button.fire("execute");

            expect(copyFn).not.toHaveBeenCalled();

            // Restore so editor.destroy() doesn't trip over the spy.
            if (original) {
                Object.defineProperty(Object.getPrototypeOf(linkCommand), "value", original);
            }
        });
    });

    describe("button execution — without config.clipboard.copy", () => {
        it("does not throw when clipboard config is absent and a link is selected", async () => {
            editor = await createEditor();

            setModelData(editor.model, '<paragraph><$text linkHref="https://example.com">my link</$text></paragraph>');

            editor.model.change((writer) => {
                const root = editor.model.document.getRoot();
                if (!root) {
                    throw new Error("No model root.");
                }
                const paragraph = root.getChild(0);
                if (!paragraph || !paragraph.is("element")) {
                    throw new Error("No paragraph.");
                }
                writer.setSelection(paragraph, 1);
            });

            const button = editor.ui.componentFactory.create("copyLinkUrl");
            expect(() => button.fire("execute")).not.toThrow();
        });

        it("does not throw when clipboard.copy is absent and a link is selected", async () => {
            editor = await createEditor({
                clipboard: {}
            });

            setModelData(editor.model, '<paragraph><$text linkHref="https://example.com">my link</$text></paragraph>');

            editor.model.change((writer) => {
                const root = editor.model.document.getRoot();
                if (!root) {
                    throw new Error("No model root.");
                }
                const paragraph = root.getChild(0);
                if (!paragraph || !paragraph.is("element")) {
                    throw new Error("No paragraph.");
                }
                writer.setSelection(paragraph, 1);
            });

            const button = editor.ui.componentFactory.create("copyLinkUrl");
            expect(() => button.fire("execute")).not.toThrow();
        });
    });

    describe("_translate", () => {
        it("uses the translate function from config when provided", async () => {
            const translateFn = vi.fn((key: string) => `translated:${key}`);
            editor = await createEditor({
                translate: translateFn
            });

            const button = editor.ui.componentFactory.create("copyLinkUrl") as { label: string };
            expect(translateFn).toHaveBeenCalledWith("link.copy_url");
            expect(button.label).toBe("translated:link.copy_url");
        });

        it("returns the key as-is when no translate function is in config", async () => {
            editor = await createEditor();

            const button = editor.ui.componentFactory.create("copyLinkUrl") as { label: string };
            expect(button.label).toBe("link.copy_url");
        });
    });
});
