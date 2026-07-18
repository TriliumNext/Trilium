import { ClassicEditor, Essentials, Image, ImageBlock, ImageInline, ImageUtils, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import ImageActions from "./image_actions.js";

describe("ImageActions", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Image, ImageBlock, ImageInline, ImageActions]);
    });

    it("loads the plugin and registers commands and toolbar buttons", () => {
        expect(editor.plugins.get(ImageActions)).toBeInstanceOf(ImageActions);
        expect(editor.commands.get("copyImageToClipboard")).toBeDefined();
        expect(editor.commands.get("downloadImage")).toBeDefined();
        expect(editor.ui.componentFactory.has("copyImageToClipboard")).toBe(true);
        expect(editor.ui.componentFactory.has("downloadImage")).toBe(true);
    });

    it("requires ImageUtils", () => {
        expect(editor.plugins.get(ImageUtils)).toBeInstanceOf(ImageUtils);
    });

    it("commands are disabled when no image is selected", () => {
        editor.setData("<p>no image here</p>");
        expect(editor.commands.get("copyImageToClipboard")?.isEnabled).toBe(false);
        expect(editor.commands.get("downloadImage")?.isEnabled).toBe(false);
    });

    it("commands are enabled when an image with a src is selected", () => {
        editor.setData('<figure class="image"><img src="https://example.com/img.png" /></figure>');

        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) { return; }
            const imageElement = root.getChild(0);
            if (!imageElement || !imageElement.is("element")) { return; }
            writer.setSelection(imageElement, "on");
        });

        expect(editor.commands.get("copyImageToClipboard")?.isEnabled).toBe(true);
        expect(editor.commands.get("downloadImage")?.isEnabled).toBe(true);
    });

    it("copyImageToClipboard command calls the copyToClipboard config callback with the image src", () => {
        const copyToClipboard = vi.fn();

        return (async () => {
            editor = await createTestEditor([Essentials, Paragraph, Image, ImageBlock, ImageInline, ImageActions], {
                imageActions: {
                    copyToClipboard,
                    download: vi.fn()
                } as unknown as Record<string, unknown>
            });

            editor.setData('<figure class="image"><img src="https://example.com/photo.png" /></figure>');

            editor.model.change((writer) => {
                const root = editor.model.document.getRoot();
                if (!root) { return; }
                const imageElement = root.getChild(0);
                if (!imageElement || !imageElement.is("element")) { return; }
                writer.setSelection(imageElement, "on");
            });

            editor.execute("copyImageToClipboard");

            expect(copyToClipboard).toHaveBeenCalledWith("https://example.com/photo.png");
        })();
    });

    it("downloadImage command calls the download config callback with the image src", () => {
        const download = vi.fn();

        return (async () => {
            editor = await createTestEditor([Essentials, Paragraph, Image, ImageBlock, ImageInline, ImageActions], {
                imageActions: {
                    copyToClipboard: vi.fn(),
                    download
                } as unknown as Record<string, unknown>
            });

            editor.setData('<figure class="image"><img src="https://example.com/file.jpg" /></figure>');

            editor.model.change((writer) => {
                const root = editor.model.document.getRoot();
                if (!root) { return; }
                const imageElement = root.getChild(0);
                if (!imageElement || !imageElement.is("element")) { return; }
                writer.setSelection(imageElement, "on");
            });

            editor.execute("downloadImage");

            expect(download).toHaveBeenCalledWith("https://example.com/file.jpg");
        })();
    });

    it("execute does nothing when no image is selected (covers the early-return guard)", () => {
        const copyToClipboard = vi.fn();

        return (async () => {
            editor = await createTestEditor([Essentials, Paragraph, Image, ImageBlock, ImageInline, ImageActions], {
                imageActions: {
                    copyToClipboard,
                    download: vi.fn()
                } as unknown as Record<string, unknown>
            });

            editor.setData("<p>no image</p>");

            // The command is disabled when no image is selected, so the CKEditor framework
            // would short-circuit before the override runs. Force isEnabled=true temporarily
            // so we can drive the "no src" branch in execute() directly.
            const cmd = editor.commands.get("copyImageToClipboard");
            if (!cmd) { throw new Error("command not found"); }
            (cmd as unknown as { isEnabled: boolean }).isEnabled = true;
            cmd.execute();

            expect(copyToClipboard).not.toHaveBeenCalled();
        })();
    });

    it("execute does nothing when imageActions config is absent", () => {
        // No imageActions in config — the optional-chain must not throw
        editor.setData('<figure class="image"><img src="https://example.com/img.png" /></figure>');

        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) { return; }
            const imageElement = root.getChild(0);
            if (!imageElement || !imageElement.is("element")) { return; }
            writer.setSelection(imageElement, "on");
        });

        // Should not throw
        expect(() => editor.execute("copyImageToClipboard")).not.toThrow();
        expect(() => editor.execute("downloadImage")).not.toThrow();
    });

    it("buttons are bound to command isEnabled state", () => {
        const copyButton = editor.ui.componentFactory.create("copyImageToClipboard") as { isEnabled: boolean };
        const downloadButton = editor.ui.componentFactory.create("downloadImage") as { isEnabled: boolean };

        const copyCommand = editor.commands.get("copyImageToClipboard");
        const downloadCommand = editor.commands.get("downloadImage");

        // Both should reflect command isEnabled
        expect(copyButton.isEnabled).toBe(copyCommand?.isEnabled ?? false);
        expect(downloadButton.isEnabled).toBe(downloadCommand?.isEnabled ?? false);
    });

    it("button execute fires the corresponding editor command", () => {
        const copyButton = editor.ui.componentFactory.create("copyImageToClipboard") as { fire(name: string): void };
        const downloadButton = editor.ui.componentFactory.create("downloadImage") as { fire(name: string): void };

        const spy = vi.spyOn(editor, "execute");

        copyButton.fire("execute");
        expect(spy).toHaveBeenCalledWith("copyImageToClipboard");

        downloadButton.fire("execute");
        expect(spy).toHaveBeenCalledWith("downloadImage");
    });

    it("uses the translate config callback to label buttons when provided", () => {
        return (async () => {
            const translate = (key: string) => `translated:${key}`;

            editor = await createTestEditor([Essentials, Paragraph, Image, ImageBlock, ImageInline, ImageActions], {
                translate
            });

            const copyButton = editor.ui.componentFactory.create("copyImageToClipboard") as { label: string };
            const downloadButton = editor.ui.componentFactory.create("downloadImage") as { label: string };

            expect(copyButton.label).toBe("translated:image.copy-to-clipboard");
            expect(downloadButton.label).toBe("translated:image.download");
        })();
    });

    it("falls back to the raw label key when translate config is absent", () => {
        const copyButton = editor.ui.componentFactory.create("copyImageToClipboard") as { label: string };
        const downloadButton = editor.ui.componentFactory.create("downloadImage") as { label: string };

        expect(copyButton.label).toBe("image.copy-to-clipboard");
        expect(downloadButton.label).toBe("image.download");
    });
});
