import { _setModelData as setModelData, ClassicEditor, Code, CodeBlock, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import CopyToClipboardButton, { CopyToClipboardCommand } from "./copy_to_clipboard_button.js";

describe("CopyToClipboardButton", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, CodeBlock, Code, CopyToClipboardButton]);
    });

    it("loads the plugin and registers the command and toolbar button", () => {
        expect(editor.plugins.get(CopyToClipboardButton)).toBeInstanceOf(CopyToClipboardButton);
        expect(editor.commands.get("copyToClipboard")).toBeDefined();
        expect(editor.ui.componentFactory.has("copyToClipboard")).toBe(true);
    });

    it("creates a button with the correct tooltip", () => {
        const button = editor.ui.componentFactory.create("copyToClipboard") as { tooltip: string; fire(name: string): void };
        expect(button.tooltip).toBe("Copy to clipboard");
    });

    it("wires the button to execute the copyToClipboard command", () => {
        const button = editor.ui.componentFactory.create("copyToClipboard") as { fire(name: string): void };
        const spy = vi.spyOn(editor, "execute");
        button.fire("execute");
        expect(spy).toHaveBeenCalledWith("copyToClipboard");
    });
});

describe("CopyToClipboardCommand - code block", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, CodeBlock, Code, CopyToClipboardButton]);
    });

    it("copies code block text using navigator.clipboard.writeText when no config callback", async () => {
        const writeSpy = vi.fn().mockResolvedValue(undefined);
        const origClipboard = navigator.clipboard;
        Object.defineProperty(navigator, "clipboard", {
            value: { writeText: writeSpy },
            writable: true,
            configurable: true
        });

        setModelData(editor.model, "<codeBlock language=\"plaintext\">hello world[]</codeBlock>");
        editor.execute("copyToClipboard");

        // Let the promise resolve
        await Promise.resolve();

        expect(writeSpy).toHaveBeenCalledWith("hello world");

        Object.defineProperty(navigator, "clipboard", {
            value: origClipboard,
            writable: true,
            configurable: true
        });
    });

    it("copies multiline code block — softBreak elements become newlines in the output", async () => {
        const writeSpy = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {
            value: { writeText: writeSpy },
            writable: true,
            configurable: true
        });

        // Set data as HTML so CKEditor's upcast creates real softBreak elements for newlines
        editor.setData("<pre><code class=\"language-plaintext\">line one\nline two</code></pre>");

        // Move selection inside the code block so the command can find it
        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) { return; }
            const codeBlock = root.getChild(0);
            if (!codeBlock || !codeBlock.is("element")) { return; }
            writer.setSelection(codeBlock, "in");
        });

        editor.execute("copyToClipboard");

        await Promise.resolve();

        expect(writeSpy).toHaveBeenCalled();
        const copiedText = writeSpy.mock.calls[0]?.[0] as string;
        // The softBreak element in the code block must produce a "\n" in the output
        expect(copiedText).toContain("\n");
        expect(copiedText).toBe("line one\nline two");
    });

    it("uses the config clipboard.copy callback instead of navigator.clipboard", () => {
        const copyCallback = vi.fn();

        // Rebuild editor with clipboard config
        return (async () => {
            editor = await createTestEditor([Essentials, Paragraph, CodeBlock, Code, CopyToClipboardButton], {
                clipboard: {
                    copy: copyCallback
                }
            } as unknown as Parameters<typeof createTestEditor>[1]);

            setModelData(editor.model, "<codeBlock language=\"plaintext\">callback text[]</codeBlock>");
            editor.execute("copyToClipboard");

            expect(copyCallback).toHaveBeenCalledWith("callback text");
        })();
    });

    it("warns when the code block has no text content", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        // Create an empty code block
        setModelData(editor.model, "<codeBlock language=\"plaintext\">[]</codeBlock>");
        editor.execute("copyToClipboard");

        // The empty string triggers the "No text found" warning
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("No text found"));

        warnSpy.mockRestore();
    });

    it("handles navigator.clipboard.writeText rejection gracefully", async () => {
        const writeError = new Error("Clipboard denied");
        const writeSpy = vi.fn().mockRejectedValue(writeError);
        Object.defineProperty(navigator, "clipboard", {
            value: { writeText: writeSpy },
            writable: true,
            configurable: true
        });
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        setModelData(editor.model, "<codeBlock language=\"plaintext\">fail text[]</codeBlock>");
        editor.execute("copyToClipboard");

        // Let the rejected promise propagate
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to copy"), writeError);

        errorSpy.mockRestore();
    });
});

describe("CopyToClipboardCommand - inline code", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, CodeBlock, Code, CopyToClipboardButton]);
    });

    it("copies inline code text when cursor is inside a code-attributed text node", async () => {
        const writeSpy = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {
            value: { writeText: writeSpy },
            writable: true,
            configurable: true
        });

        // Place cursor inside inline code: `foo` with code attribute
        setModelData(editor.model, "<paragraph><$text code=\"true\">foo[]bar</$text></paragraph>");
        editor.execute("copyToClipboard");

        await Promise.resolve();

        expect(writeSpy).toHaveBeenCalledWith("foobar");
    });

    it("warns when there is no code block or inline code at cursor", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        setModelData(editor.model, "<paragraph>plain text[]</paragraph>");
        editor.execute("copyToClipboard");

        expect(warnSpy).toHaveBeenCalledWith("No code block or inline code found to copy from.");

        warnSpy.mockRestore();
    });

    it("uses the config clipboard.copy callback for inline code", () => {
        const copyCallback = vi.fn();

        return (async () => {
            editor = await createTestEditor([Essentials, Paragraph, CodeBlock, Code, CopyToClipboardButton], {
                clipboard: {
                    copy: copyCallback
                }
            } as unknown as Parameters<typeof createTestEditor>[1]);

            setModelData(editor.model, "<paragraph><$text code=\"true\">inline[]code</$text></paragraph>");
            editor.execute("copyToClipboard");

            expect(copyCallback).toHaveBeenCalledWith("inlinecode");
        })();
    });

    it("copies from nodeBefore when cursor is at the end of inline code", async () => {
        const writeSpy = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {
            value: { writeText: writeSpy },
            writable: true,
            configurable: true
        });

        // Put cursor right after inline code (nodeAfter is plain text, nodeBefore has code attr)
        setModelData(editor.model,
            "<paragraph><$text code=\"true\">mycode</$text>[]plain</paragraph>");
        editor.execute("copyToClipboard");

        await Promise.resolve();

        expect(writeSpy).toHaveBeenCalledWith("mycode");
    });

    it("copies from nodeAfter when cursor is at the start of the paragraph before inline code", async () => {
        const writeSpy = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {
            value: { writeText: writeSpy },
            writable: true,
            configurable: true
        });

        // Put cursor at the very start of the paragraph: position.textNode=null,
        // position.nodeBefore=null, position.nodeAfter=the code text node.
        setModelData(editor.model,
            "<paragraph>[]<$text code=\"true\">aftercode</$text></paragraph>");
        editor.execute("copyToClipboard");

        await Promise.resolve();

        expect(writeSpy).toHaveBeenCalledWith("aftercode");
    });
});

describe("CopyToClipboardCommand - executeCallback caching", () => {
    let editor: ClassicEditor;

    it("re-uses the executeCallback set on first execute for subsequent calls", () => {
        const copyCallback = vi.fn();

        return (async () => {
            editor = await createTestEditor([Essentials, Paragraph, CodeBlock, Code, CopyToClipboardButton], {
                clipboard: {
                    copy: copyCallback
                }
            } as unknown as Parameters<typeof createTestEditor>[1]);

            setModelData(editor.model, "<codeBlock language=\"plaintext\">first[]</codeBlock>");
            editor.execute("copyToClipboard");
            expect(copyCallback).toHaveBeenCalledTimes(1);
            expect(copyCallback).toHaveBeenCalledWith("first");

            setModelData(editor.model, "<codeBlock language=\"plaintext\">second[]</codeBlock>");
            editor.execute("copyToClipboard");
            expect(copyCallback).toHaveBeenCalledTimes(2);
            expect(copyCallback).toHaveBeenLastCalledWith("second");
        })();
    });
});
