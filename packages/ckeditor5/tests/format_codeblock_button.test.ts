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
import {
    FormatterRegistry,
    type CodeFormatter,
} from "../src/plugins/format_codeblock/code_formatter";
import {
    LANG_JAVASCRIPT_FRONTEND,
    LANG_TYPESCRIPT,
    LANG_JSON,
    LANG_CSS,
    LANG_SCSS,
    LANG_LESS,
    LANG_HTML,
    LANG_XML,
    LANG_YAML,
    LANG_MARKDOWN,
    LANG_GRAPHQL,
    LANG_JSX,
    LANG_TYPESCRIPT_JSX,
    LANG_PYTHON,
    LANG_RUST,
    LANG_C,
} from "../src/plugins/format_codeblock/languages";

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
                        language: LANG_JAVASCRIPT_FRONTEND,
                        label: "JavaScript (Frontend)",
                    },
                    { language: LANG_TYPESCRIPT, label: "TypeScript" },
                    { language: LANG_JSON, label: "JSON" },
                    { language: LANG_CSS, label: "CSS" },
                    { language: LANG_SCSS, label: "SCSS" },
                    { language: LANG_LESS, label: "LESS" },
                    { language: LANG_HTML, label: "HTML" },
                    { language: LANG_XML, label: "XML" },
                    { language: LANG_YAML, label: "YAML" },
                    { language: LANG_MARKDOWN, label: "Markdown" },
                    { language: LANG_GRAPHQL, label: "GraphQL" },
                    { language: LANG_JSX, label: "JSX" },
                    { language: LANG_TYPESCRIPT_JSX, label: "TSX" },
                    { language: LANG_PYTHON, label: "Python" },
                    { language: LANG_RUST, label: "Rust" },
                    { language: LANG_C, label: "C" },
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
                LANG_JAVASCRIPT_FRONTEND,
                LANG_TYPESCRIPT,
                LANG_JSON,
                LANG_CSS,
                LANG_SCSS,
                LANG_LESS,
                LANG_HTML,
                LANG_XML,
                LANG_YAML,
                LANG_MARKDOWN,
                LANG_GRAPHQL,
                LANG_JSX,
                LANG_TYPESCRIPT_JSX,
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
            const unsupportedLanguages = [LANG_PYTHON, LANG_RUST, LANG_C];

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
                `<codeBlock language="${LANG_JAVASCRIPT_FRONTEND}">const x=1;const y=2;const z=x+y[]</codeBlock>`,
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
                LANG_JSON,
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
                LANG_CSS,
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
                LANG_TYPESCRIPT,
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
                `<codeBlock language="${LANG_JAVASCRIPT_FRONTEND}">${formattedCode}[]</codeBlock>`,
            );

            const modelDataBefore = getModelData(editor.model, {
                withoutSelection: true,
            });

            editor.execute("formatCodeblock");

            await vi.waitFor(() => {
                const modelDataAfter = getModelData(editor.model, {
                    withoutSelection: true,
                });
                expect(modelDataAfter).toBe(modelDataBefore);
            });

            const modelDataAfter = getModelData(editor.model, {
                withoutSelection: true,
            });
            expect(modelDataAfter).toBe(modelDataBefore);
        });

        it("should not modify empty code blocks", () => {
            setModelData(
                editor.model,
                `<codeBlock language="${LANG_JAVASCRIPT_FRONTEND}">[]</codeBlock>`,
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
                `<codeBlock language="${LANG_JAVASCRIPT_FRONTEND}">   []</codeBlock>`,
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
                `<codeBlock language="${LANG_PYTHON}">x=1[]</codeBlock>`,
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
                    language: LANG_JAVASCRIPT_FRONTEND,
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
                `<codeBlock language="${LANG_YAML}">foo:   bar\nbaz:    qux[]</codeBlock>`,
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
            setCodeBlockContent(editor, LANG_JSON, '{"key": "value"}');

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

describe("FormatterRegistry", () => {
    let registry: FormatterRegistry;

    beforeEach(() => {
        registry = new FormatterRegistry();
    });

    it("should return undefined when no formatters are registered", () => {
        expect(registry.getFormatterForLanguage(LANG_CSS)).toBeUndefined();
    });

    it("should report no language as supported when empty", () => {
        expect(registry.isLanguageSupported(LANG_CSS)).toBe(false);
    });

    it("should find a registered formatter by language", () => {
        const mockFormatter: CodeFormatter = {
            name: "Mock",
            canFormat: (lang) => lang === LANG_PYTHON,
            format: async (code) => code,
        };
        registry.register(mockFormatter);

        expect(registry.getFormatterForLanguage(LANG_PYTHON)).toBe(
            mockFormatter,
        );
        expect(registry.isLanguageSupported(LANG_PYTHON)).toBe(true);
        expect(registry.isLanguageSupported(LANG_CSS)).toBe(false);
    });

    it("should return the first matching formatter when multiple match", () => {
        const first: CodeFormatter = {
            name: "First",
            canFormat: () => true,
            format: async (code) => code,
        };
        const second: CodeFormatter = {
            name: "Second",
            canFormat: () => true,
            format: async (code) => code,
        };
        registry.register(first);
        registry.register(second);

        expect(registry.getFormatterForLanguage("any-lang")?.name).toBe(
            "First",
        );
    });

    it("should maintain singleton identity", () => {
        const a = FormatterRegistry.getInstance();
        const b = FormatterRegistry.getInstance();
        expect(a).toBe(b);
    });
});
