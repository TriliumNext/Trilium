import {
    ClassicEditor,
    CodeBlock,
    Notification,
    Paragraph,
    _setModelData as setModelData,
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

/**
 * Extract plain text from the first codeBlock element in the editor model.
 * Mirrors FormatCodeblockCommand.extractCodeText so assertions test the same
 * value the formatter operates on.
 */
function getCodeBlockText(editor: ClassicEditor): string | undefined {
    const root = editor.model.document.getRoot()!;
    for (const child of root.getChildren()) {
        if (child.is("element", "codeBlock")) {
            return Array.from(child.getChildren())
                .map((c) => (c.is("$text") ? c.data : "\n"))
                .join("");
        }
    }
    return undefined;
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
            const unsupportedLanguages = [LANG_XML, LANG_PYTHON, LANG_RUST, LANG_C];

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
            setCodeBlockContent(
                editor,
                LANG_JAVASCRIPT_FRONTEND,
                "const x=1;const y=2;const z=x+y",
            );

            editor.execute("formatCodeblock");

            await vi.waitFor(
                () => {
                    const text = getCodeBlockText(editor);
                    expect(text).toEqual(
                        "const x = 1;\nconst y = 2;\nconst z = x + y;\n",
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
                    const text = getCodeBlockText(editor);
                    expect(text).toEqual(
                        '{ "a": 1, "b": 2, "c": [1, 2, 3] }\n',
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
                    const text = getCodeBlockText(editor);
                    expect(text).toEqual(
                        "body {\n    color: red;\n    background: blue;\n}\n",
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
                    const text = getCodeBlockText(editor);
                    expect(text).toEqual(
                        "interface Foo {\n    bar: string;\n    baz: number;\n}\n",
                    );
                },
                { timeout: 10000 },
            );
        });

        it("should not modify already-formatted code", async () => {
            // Prettier always appends a trailing newline, so the input must
            // already include one (represented as a softBreak) to be truly
            // "already formatted".
            setCodeBlockContent(
                editor,
                LANG_JAVASCRIPT_FRONTEND,
                "const x = 1;\n",
            );

            const textBefore = getCodeBlockText(editor);

            editor.execute("formatCodeblock");

            // Give the async formatter a chance to run, then verify no change.
            await vi.waitFor(() => {
                const textAfter = getCodeBlockText(editor);
                expect(textAfter).toBe(textBefore);
            });

            const textAfter = getCodeBlockText(editor);
            expect(textAfter).toBe(textBefore);
        });

        it("should not modify empty code blocks", () => {
            setCodeBlockContent(editor, LANG_JAVASCRIPT_FRONTEND, "");

            const textBefore = getCodeBlockText(editor);

            editor.execute("formatCodeblock");

            const textAfter = getCodeBlockText(editor);
            expect(textAfter).toBe(textBefore);
        });

        it("should not modify whitespace-only code blocks", () => {
            setCodeBlockContent(editor, LANG_JAVASCRIPT_FRONTEND, "   ");

            const textBefore = getCodeBlockText(editor);

            editor.execute("formatCodeblock");

            const textAfter = getCodeBlockText(editor);
            expect(textAfter).toBe(textBefore);
        });

        it("should not execute when language is unsupported", () => {
            setCodeBlockContent(editor, LANG_PYTHON, "x=1");

            const textBefore = getCodeBlockText(editor);

            // Manually try to execute — the command should be disabled, so
            // calling execute directly on the command should be a no-op.
            const command = editor.commands.get(
                "formatCodeblock",
            )! as FormatCodeblockCommand;
            command.execute();

            const textAfter = getCodeBlockText(editor);
            expect(textAfter).toBe(textBefore);
        });

        it("should handle multiline code with softBreaks in the model", async () => {
            setCodeBlockContent(
                editor,
                LANG_JAVASCRIPT_FRONTEND,
                "const x=1;\nconst y=2;",
            );

            editor.execute("formatCodeblock");

            await vi.waitFor(
                () => {
                    const text = getCodeBlockText(editor);
                    expect(text).toEqual("const x = 1;\nconst y = 2;\n");
                },
                { timeout: 10000 },
            );
        });

        it("should format YAML code", async () => {
            setCodeBlockContent(
                editor,
                LANG_YAML,
                "foo:   bar\nbaz:    qux",
            );

            editor.execute("formatCodeblock");

            await vi.waitFor(
                () => {
                    const text = getCodeBlockText(editor);
                    expect(text).toEqual("foo: bar\nbaz: qux\n");
                },
                { timeout: 10000 },
            );
        });
    });

    describe("notifications", () => {
        it("should fire a warning notification when formatting fails", async () => {
            setCodeBlockContent(
                editor,
                LANG_JAVASCRIPT_FRONTEND,
                'import { getLanguageStats }dfe wae from "./utils";',
            );

            const notification = editor.plugins.get(Notification);
            const showWarningSpy = vi.spyOn(notification, "showWarning");

            // Prevent CKEditor's default show:warning handler from calling window.alert.
            notification.on("show:warning", (evt) => evt.stop(), { priority: "high" });

            editor.execute("formatCodeblock");

            await vi.waitFor(
                () => {
                    expect(showWarningSpy).toHaveBeenCalled();
                    const [message, options] = showWarningSpy.mock.calls[0];
                    expect(typeof message).toBe("string");
                    expect((message as string).length).toBeGreaterThan(0);
                    expect(options).toMatchObject({
                        namespace: "formatCodeblock",
                    });
                    expect(options?.title).toContain("Prettier");
                },
                { timeout: 10000 },
            );
        });

        it("should fire a show:warning event when formatting fails", async () => {
            setCodeBlockContent(
                editor,
                LANG_JAVASCRIPT_FRONTEND,
                'import { getLanguageStats }dfe wae from "./utils";',
            );

            const notification = editor.plugins.get(Notification);
            const warningHandler = vi.fn();
            notification.on("show:warning", (evt, data) => {
                warningHandler(data);
                evt.stop();
            });

            editor.execute("formatCodeblock");

            await vi.waitFor(
                () => {
                    expect(warningHandler).toHaveBeenCalled();
                    const data = warningHandler.mock.calls[0][0];
                    expect(data.message).toBeTruthy();
                    expect(data.type).toBe("warning");
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
