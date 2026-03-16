import {
    ClassicEditor,
    CodeBlock,
    Paragraph,
    _setModelData as setModelData,
    _getModelData as getModelData,
} from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FormatCodeblockButton from "../src/plugins/format_codeblock/format_codeblock_button";
import { FormatCodeblockCommand } from "../src/plugins/format_codeblock/format_codeblock_command";

function setCodeBlockContent(
    editor: ClassicEditor,
    language: string,
    code: string,
) {
    editor.model.change((writer) => {
        const root = editor.model.document.getRoot()!;
        writer.remove(writer.createRangeIn(root));

        const codeBlock = writer.createElement("codeBlock", { language });

        const lines = code.split("\n");
        for (let i = 0; i < lines.length; i++) {
            if (i > 0) {
                writer.appendElement("softBreak", codeBlock);
            }
            if (lines[i]) {
                writer.appendText(lines[i], codeBlock);
            }
        }

        writer.append(codeBlock, root);
        writer.setSelection(codeBlock, "end");
    });
}

describe("FormatCodeblockButton", () => {
    let domElement: HTMLDivElement;
    let editor: ClassicEditor;

    beforeEach(async () => {
        domElement = document.createElement("div");
        document.body.appendChild(domElement);

        editor = await ClassicEditor.create(domElement, {
            licenseKey: "GPL",
            plugins: [Paragraph, CodeBlock, FormatCodeblockButton],
            codeBlock: {
                languages: [
                    {
                        language: "application-javascript-env-frontend",
                        label: "JavaScript (Frontend)",
                    },
                    { language: "text-typescript", label: "TypeScript" },
                    { language: "application-json", label: "JSON" },
                    { language: "text-css", label: "CSS" },
                    { language: "text-x-scss", label: "SCSS" },
                    { language: "text-x-less", label: "LESS" },
                    { language: "text-html", label: "HTML" },
                    { language: "text-xml", label: "XML" },
                    { language: "text-x-yaml", label: "YAML" },
                    { language: "text-x-markdown", label: "Markdown" },
                    { language: "text-x-graphql", label: "GraphQL" },
                    { language: "text-jsx", label: "JSX" },
                    { language: "text-tsx", label: "TSX" },
                    { language: "text-x-python", label: "Python" },
                    { language: "text-x-rustsrc", label: "Rust" },
                    { language: "text-x-csrc", label: "C" },
                ],
            },
        });
    });

    afterEach(() => {
        domElement.remove();
        return editor.destroy();
    });

    describe("plugin registration", () => {
        it("should register the formatCodeblock command", () => {
            const command = editor.commands.get("formatCodeblock");
            expect(command).toBeDefined();
            expect(command).toBeInstanceOf(FormatCodeblockCommand);
        });

        it("should register the formatCodeblock UI component", () => {
            const factory = editor.ui.componentFactory;
            expect(factory.has("formatCodeblock")).toBe(true);
        });
    });

    describe("FormatCodeblockCommand#refresh", () => {
        describe("should be enabled for supported languages", () => {
            const supportedLanguages = [
                "application-javascript-env-frontend",
                "text-typescript",
                "application-json",
                "text-css",
                "text-x-scss",
                "text-x-less",
                "text-html",
                "text-xml",
                "text-x-yaml",
                "text-x-markdown",
                "text-x-graphql",
                "text-jsx",
                "text-tsx",
            ];

            for (const lang of supportedLanguages) {
                it(`should be enabled for "${lang}"`, () => {
                    setModelData(
                        editor.model,
                        `<codeBlock language="${lang}">foo[]</codeBlock>`,
                    );

                    const command = editor.commands.get("formatCodeblock")!;
                    expect(command.isEnabled).toBe(true);
                    expect(command.value).toBe(lang);
                });
            }
        });

        describe("should be disabled for unsupported languages", () => {
            const unsupportedLanguages = [
                "text-x-python",
                "text-x-rustsrc",
                "text-x-csrc",
            ];

            for (const lang of unsupportedLanguages) {
                it(`should be disabled for "${lang}"`, () => {
                    setModelData(
                        editor.model,
                        `<codeBlock language="${lang}">foo[]</codeBlock>`,
                    );

                    const command = editor.commands.get("formatCodeblock")!;
                    expect(command.isEnabled).toBe(false);
                    expect(command.value).toBe(false);
                });
            }
        });

        it("should be disabled when not inside a code block", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");

            const command = editor.commands.get("formatCodeblock")!;
            expect(command.isEnabled).toBe(false);
            expect(command.value).toBe(false);
        });
    });

    describe("FormatCodeblockCommand#execute", () => {
        it("should format JavaScript code", async () => {
            setModelData(
                editor.model,
                '<codeBlock language="application-javascript-env-frontend">const x=1;const y=2;const z=x+y[]</codeBlock>',
            );

            editor.execute("formatCodeblock");

            await vi.waitFor(
                () => {
                    const modelData = getModelData(editor.model, {
                        withoutSelection: true,
                    });
                    expect(modelData).toEqual(
                        "const x = 1;\nconst y = 2;\nconst z = x + y;",
                    );
                },
                { timeout: 10000 },
            );
        });

        it("should format JSON code", async () => {
            setCodeBlockContent(
                editor,
                "application-json",
                '{"a":1,"b":  2,"c":    [1,2,3]}',
            );

            editor.execute("formatCodeblock");

            await vi.waitFor(
                () => {
                    const modelData = getModelData(editor.model, {
                        withoutSelection: true,
                    });
                    expect(modelData).toEqual(
                        '{\n    "a": 1,\n    "b": 2,\n    "c": [\n        1,\n        2,\n        3\n    ]\n}',
                    );
                },
                { timeout: 10000 },
            );
        });

        it("should format CSS code", async () => {
            setCodeBlockContent(
                editor,
                "text-css",
                "body{color:red;background:blue}",
            );

            editor.execute("formatCodeblock");

            await vi.waitFor(
                () => {
                    const modelData = getModelData(editor.model, {
                        withoutSelection: true,
                    });
                    expect(modelData).toEqual(
                        "body {\n    color: red;\n    background: blue;\n}",
                    );
                },
                { timeout: 10000 },
            );
        });

        it("should format TypeScript code", async () => {
            setCodeBlockContent(
                editor,
                "text-typescript",
                "interface Foo{bar:string;baz:number}",
            );

            editor.execute("formatCodeblock");

            await vi.waitFor(
                () => {
                    const modelData = getModelData(editor.model, {
                        withoutSelection: true,
                    });
                    expect(modelData).toEqual(
                        "interface Foo {\n    bar: string;\n    baz: number;\n}",
                    );
                },
                { timeout: 10000 },
            );
        });

        it("should not modify already-formatted code", async () => {
            const formattedCode = "const x = 1;";
            setModelData(
                editor.model,
                `<codeBlock language="application-javascript-env-frontend">${formattedCode}[]</codeBlock>`,
            );

            const modelDataBefore = getModelData(editor.model, {
                withoutSelection: true,
            });

            editor.execute("formatCodeblock");

            await new Promise((resolve) => setTimeout(resolve, 2000));

            const modelDataAfter = getModelData(editor.model, {
                withoutSelection: true,
            });
            expect(modelDataAfter).toBe(modelDataBefore);
        });

        it("should not modify empty code blocks", () => {
            setModelData(
                editor.model,
                '<codeBlock language="application-javascript-env-frontend">[]</codeBlock>',
            );

            const modelDataBefore = getModelData(editor.model, {
                withoutSelection: true,
            });

            editor.execute("formatCodeblock");

            const modelDataAfter = getModelData(editor.model, {
                withoutSelection: true,
            });
            expect(modelDataAfter).toBe(modelDataBefore);
        });

        it("should not modify whitespace-only code blocks", () => {
            setModelData(
                editor.model,
                '<codeBlock language="application-javascript-env-frontend">   []</codeBlock>',
            );

            const modelDataBefore = getModelData(editor.model, {
                withoutSelection: true,
            });

            editor.execute("formatCodeblock");

            const modelDataAfter = getModelData(editor.model, {
                withoutSelection: true,
            });
            expect(modelDataAfter).toBe(modelDataBefore);
        });

        it("should not execute when language is unsupported", () => {
            setModelData(
                editor.model,
                '<codeBlock language="text-x-python">x=1[]</codeBlock>',
            );

            const modelDataBefore = getModelData(editor.model, {
                withoutSelection: true,
            });

            // Manually try to execute — the command should be disabled, so
            // calling execute directly on the command should be a no-op.
            const command = editor.commands.get(
                "formatCodeblock",
            )! as FormatCodeblockCommand;
            command.execute();

            const modelDataAfter = getModelData(editor.model, {
                withoutSelection: true,
            });
            expect(modelDataAfter).toBe(modelDataBefore);
        });

        it("should handle multiline code with softBreaks in the model", async () => {
            editor.model.change((writer) => {
                const root = editor.model.document.getRoot()!;

                writer.remove(writer.createRangeIn(root));

                const codeBlock = writer.createElement("codeBlock", {
                    language: "application-javascript-env-frontend",
                });
                writer.appendText("const x=1;", codeBlock);
                writer.appendElement("softBreak", codeBlock);
                writer.appendText("const y=2;", codeBlock);

                writer.append(codeBlock, root);

                writer.setSelection(codeBlock, "end");
            });

            editor.execute("formatCodeblock");

            await vi.waitFor(
                () => {
                    const modelData = getModelData(editor.model, {
                        withoutSelection: true,
                    });
                    expect(modelData).toEqual("const x = 1;\nconst y = 2;");
                },
                { timeout: 10000 },
            );
        });

        it("should format YAML code", async () => {
            setModelData(
                editor.model,
                '<codeBlock language="text-x-yaml">foo:   bar\nbaz:    qux[]</codeBlock>',
            );

            editor.execute("formatCodeblock");

            await vi.waitFor(
                () => {
                    const modelData = getModelData(editor.model, {
                        withoutSelection: true,
                    });
                    expect(modelData).toEqual("foo: bar\nbaz: qux");
                },
                { timeout: 10000 },
            );
        });
    });

    describe("button UI", () => {
        it("should create a button with correct tooltip", () => {
            const button = editor.ui.componentFactory.create("formatCodeblock");
            expect((button as any).tooltip).toBe("Format code block");
        });

        it("button isEnabled should follow command isEnabled", () => {
            setCodeBlockContent(editor, "application-json", '{"key": "value"}');

            const button = editor.ui.componentFactory.create("formatCodeblock");
            const command = editor.commands.get("formatCodeblock")!;

            expect(command.isEnabled).toBe(true);
            expect((button as any).isEnabled).toBe(true);

            setModelData(editor.model, "<paragraph>foo[]</paragraph>");

            expect(command.isEnabled).toBe(false);
            expect((button as any).isEnabled).toBe(false);
        });
    });
});
