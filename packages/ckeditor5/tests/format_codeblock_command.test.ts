import {
    ClassicEditor,
    Notification,
    _setModelData as setModelData,
} from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormatCodeblockCommand } from "../src/plugins/format_codeblock/format_codeblock_command";
import {
    type CodeFormatter,
    createEditor,
    extractCodeBlockText,
    flushMicrotasks,
    setCodeFormatter,
} from "./format_codeblock_helpers";

describe("FormatCodeblockCommand", () => {
    let domElement: HTMLDivElement;
    let editor: ClassicEditor;

    beforeEach(async () => {
        const result = await createEditor({
            isLanguageSupported: () => true,
            format: async (code) => code,
        });
        editor = result.editor;
        domElement = result.div;
    });

    afterEach(() => {
        domElement.remove();
        return editor.destroy();
    });

    describe("refresh", () => {
        it("should be enabled for a supported language", () => {
            setModelData(editor.model, '<codeBlock language="javascript">foo[]</codeBlock>');

            const command = editor.commands.get("formatCodeblock")!;
            expect(command.isEnabled).toBe(true);
            expect(command.value).toBe("javascript");
        });

        it("should be disabled for an unsupported language", () => {
            setCodeFormatter(editor, {
                isLanguageSupported: () => false,
                format: async (code) => code,
            });
            setModelData(editor.model, '<codeBlock language="javascript">foo[]</codeBlock>');

            const command = editor.commands.get("formatCodeblock")!;
            expect(command.isEnabled).toBe(false);
            expect(command.value).toBe(false);
        });

        it("should be disabled when selection is outside a code block", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");

            const command = editor.commands.get("formatCodeblock")!;
            expect(command.isEnabled).toBe(false);
            expect(command.value).toBe(false);
        });

        it("should re-evaluate isLanguageSupported on every refresh", () => {
            let supported = false;
            setCodeFormatter(editor, {
                isLanguageSupported: () => supported,
                format: async (code) => code,
            });
            setModelData(editor.model, '<codeBlock language="javascript">foo[]</codeBlock>');

            const command = editor.commands.get("formatCodeblock")!;
            expect(command.isEnabled).toBe(false);

            supported = true;
            command.refresh();

            expect(command.isEnabled).toBe(true);
        });
    });

    describe("execute", () => {
        it("should preserve code block content when formatted output equals input", async () => {
            const originalCode = "const answer = 42;";
            setModelData(editor.model, `<codeBlock language="javascript">${originalCode}[]</codeBlock>`);

            const modelChangeSpy = vi.spyOn(editor.model, "change");
            editor.execute("formatCodeblock");

            await flushMicrotasks();
            expect(modelChangeSpy).not.toHaveBeenCalled();
            expect(extractCodeBlockText(editor)).toBe(originalCode);
        });

        it("should replace code block content with the formatted result", async () => {
            setCodeFormatter(editor, {
                isLanguageSupported: () => true,
                format: async (code) => `formatted:${code}`,
            });
            setModelData(editor.model, '<codeBlock language="javascript">original[]</codeBlock>');
            editor.execute("formatCodeblock");

            await vi.waitFor(() => {
                expect(extractCodeBlockText(editor)).toBe("formatted:original");
            }, { timeout: 5000 });
        });

        it("should insert softBreak elements between lines for multi-line output", async () => {
            setCodeFormatter(editor, {
                isLanguageSupported: () => true,
                format: async () => "line1\nline2\nline3",
            });
            setModelData(editor.model, '<codeBlock language="javascript">anything[]</codeBlock>');
            editor.execute("formatCodeblock");

            await vi.waitFor(() => {
                const root = editor.model.document.getRoot()!;
                const codeBlock = Array.from(root.getChildren()).find((c) => c.is("element", "codeBlock"));
                const children = Array.from(codeBlock!.getChildren());

                expect(children).toHaveLength(5);
                expect(children[0].is("$text")).toBe(true);
                expect((children[0] as any).data).toBe("line1");
                expect(children[1].is("element", "softBreak")).toBe(true);
                expect(children[2].is("$text")).toBe(true);
                expect((children[2] as any).data).toBe("line2");
                expect(children[3].is("element", "softBreak")).toBe(true);
                expect(children[4].is("$text")).toBe(true);
                expect((children[4] as any).data).toBe("line3");
            }, { timeout: 5000 });
        });

        it("should emit only softBreak (no text node) for empty lines", async () => {
            setCodeFormatter(editor, {
                isLanguageSupported: () => true,
                format: async () => "a\n\nb",
            });
            setModelData(editor.model, '<codeBlock language="javascript">placeholder[]</codeBlock>');
            editor.execute("formatCodeblock");

            await vi.waitFor(() => {
                const root = editor.model.document.getRoot()!;
                const codeBlock = Array.from(root.getChildren()).find((c) => c.is("element", "codeBlock"));
                const children = Array.from(codeBlock!.getChildren());

                expect(children).toHaveLength(4);
                expect(children[0].is("$text")).toBe(true);
                expect((children[0] as any).data).toBe("a");
                expect(children[1].is("element", "softBreak")).toBe(true);
                expect(children[2].is("element", "softBreak")).toBe(true);
                expect(children[3].is("$text")).toBe(true);
                expect((children[3] as any).data).toBe("b");
            }, { timeout: 5000 });
        });

        it("should round-trip multi-line formatted code back to the original string", async () => {
            const formattedCode = "const x = 1;\nconst y = 2;\nconst z = 3;";
            setCodeFormatter(editor, {
                isLanguageSupported: () => true,
                format: async () => formattedCode,
            });
            setModelData(editor.model, '<codeBlock language="javascript">unformatted[]</codeBlock>');
            editor.execute("formatCodeblock");

            await vi.waitFor(() => {
                expect(extractCodeBlockText(editor)).toBe(formattedCode);
            }, { timeout: 5000 });
        });

        it("should not call model.change when selection is in a paragraph", () => {
            setModelData(editor.model, "<paragraph>hello world[]</paragraph>");

            const modelChangeSpy = vi.spyOn(editor.model, "change");
            (editor.commands.get("formatCodeblock")! as FormatCodeblockCommand).execute();

            expect(modelChangeSpy).not.toHaveBeenCalled();
        });

        it("should not call model.change when selection is in an unsupported-language code block", () => {
            setCodeFormatter(editor, {
                isLanguageSupported: () => false,
                format: async (code) => code,
            });
            setModelData(editor.model, '<codeBlock language="javascript">code[]</codeBlock>');

            const modelChangeSpy = vi.spyOn(editor.model, "change");
            (editor.commands.get("formatCodeblock")! as FormatCodeblockCommand).execute();

            expect(modelChangeSpy).not.toHaveBeenCalled();
        });

        it("should not call format when code block contains only whitespace", async () => {
            const formatSpy = vi.fn(async (code: string) => code);
            setCodeFormatter(editor, {
                isLanguageSupported: () => true,
                format: formatSpy,
            });
            setModelData(editor.model, '<codeBlock language="javascript">   []</codeBlock>');
            editor.execute("formatCodeblock");

            await flushMicrotasks();
            expect(formatSpy).not.toHaveBeenCalled();
        });

        it("should not call format when code block is empty", async () => {
            const formatSpy = vi.fn(async (code: string) => code);
            setCodeFormatter(editor, {
                isLanguageSupported: () => true,
                format: formatSpy,
            });
            setModelData(editor.model, '<codeBlock language="javascript">[]</codeBlock>');
            editor.execute("formatCodeblock");

            await flushMicrotasks();
            expect(formatSpy).not.toHaveBeenCalled();
        });
    });

    describe("error handling", () => {
        it("should show a warning notification when format throws", async () => {
            const errorMessage = "Unexpected token on line 3";
            setCodeFormatter(editor, {
                isLanguageSupported: () => true,
                format: async () => { throw new Error(errorMessage); },
            });
            setModelData(editor.model, '<codeBlock language="javascript">bad code[]</codeBlock>');

            const notification = editor.plugins.get(Notification);
            const showWarningSpy = vi.spyOn(notification, "showWarning");
            notification.on("show:warning", (evt) => evt.stop(), { priority: "high" });

            editor.execute("formatCodeblock");

            await vi.waitFor(() => {
                expect(showWarningSpy).toHaveBeenCalledOnce();
            }, { timeout: 5000 });

            const [message, options] = showWarningSpy.mock.calls[0];
            expect(message).toBe(errorMessage);
            expect(options?.namespace).toBe("formatCodeblock");
        });

        it("should not modify the model when format rejects", async () => {
            setCodeFormatter(editor, {
                isLanguageSupported: () => true,
                format: async () => { throw new Error("boom"); },
            });
            setModelData(editor.model, '<codeBlock language="javascript">body { color red }[]</codeBlock>');

            const notification = editor.plugins.get(Notification);
            const showWarningSpy = vi.spyOn(notification, "showWarning");
            notification.on("show:warning", (evt) => evt.stop(), { priority: "high" });

            const modelChangeSpy = vi.spyOn(editor.model, "change");
            editor.execute("formatCodeblock");

            await vi.waitFor(() => {
                expect(showWarningSpy).toHaveBeenCalledOnce();
            }, { timeout: 5000 });

            expect(modelChangeSpy).not.toHaveBeenCalled();
        });
    });

    describe("without codeFormatter config", () => {
        it("should always be disabled when no config is provided", async () => {
            const { editor: noConfigEditor, div } = await createEditor();

            setModelData(noConfigEditor.model, '<codeBlock language="javascript">foo[]</codeBlock>');
            expect(noConfigEditor.commands.get("formatCodeblock")!.isEnabled).toBe(false);

            await noConfigEditor.destroy();
            div.remove();
        });
    });
});
