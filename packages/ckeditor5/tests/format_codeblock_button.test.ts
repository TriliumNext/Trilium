import {
    ClassicEditor,
    CodeBlock,
    Notification,
    Paragraph,
    _setModelData as setModelData,
} from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FormatCodeblockButton from "../src/plugins/format_codeblock/format_codeblock_button";
import { FormatCodeblockCommand, type CodeFormatterInterface, type FormatterRegistryInterface } from "../src/plugins/format_codeblock/format_codeblock_command";
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

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

const SUPPORTED_LANGUAGES = new Set([
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
]);

/** A stub formatter that echoes the code unchanged. */
function makeEchoFormatter(name = "StubFormatter"): CodeFormatterInterface {
    return {
        name,
        format: async (code) => code,
    };
}

/** A stub formatter that always rejects with the given error. */
function makeFailingFormatter(errorMessage: string, name = "FailingFormatter"): CodeFormatterInterface {
    return {
        name,
        format: async () => { throw new Error(errorMessage); },
    };
}

function makeRegistry(formatter: CodeFormatterInterface): FormatterRegistryInterface {
    return {
        isLanguageSupported: (lang) => SUPPORTED_LANGUAGES.has(lang),
        getFormatterForLanguage: (lang) => SUPPORTED_LANGUAGES.has(lang) ? formatter : undefined,
    };
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
            codeFormatter: {
                registry: makeRegistry(makeEchoFormatter()),
            },
            codeBlock: {
                languages: [
                    { language: LANG_JAVASCRIPT_FRONTEND, label: "JavaScript (Frontend)" },
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
            expect(editor.ui.componentFactory.has("formatCodeblock")).toBe(true);
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
                    setModelData(editor.model, `<codeBlock language="${lang}">foo[]</codeBlock>`);

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
                    setModelData(editor.model, `<codeBlock language="${lang}">foo[]</codeBlock>`);

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
        it("should not modify the model when the formatter returns the same text", async () => {
            setModelData(editor.model, `<codeBlock language="${LANG_JAVASCRIPT_FRONTEND}">const x = 1;[]</codeBlock>`);

            const modelChangeSpy = vi.spyOn(editor.model, "change");
            editor.execute("formatCodeblock");

            await vi.waitFor(() => expect(modelChangeSpy).not.toHaveBeenCalled());
        });

        it("should update the model when the formatter returns different text", async () => {
            // Use a formatter that always returns a predictable transformed value.
            const transformingFormatter: CodeFormatterInterface = {
                name: "TransformingFormatter",
                format: async (code) => `formatted:${code}`,
            };
            const transformingDiv = document.createElement("div");
            document.body.appendChild(transformingDiv);
            const transformingEditor = await ClassicEditor.create(transformingDiv, {
                licenseKey: "GPL",
                plugins: [Paragraph, CodeBlock, FormatCodeblockButton],
                codeFormatter: { registry: makeRegistry(transformingFormatter) },
                codeBlock: { languages: [{ language: LANG_JAVASCRIPT_FRONTEND, label: "JS" }] },
            });

            setModelData(transformingEditor.model, `<codeBlock language="${LANG_JAVASCRIPT_FRONTEND}">original[]</codeBlock>`);

            transformingEditor.execute("formatCodeblock");

            await vi.waitFor(() => {
                const root = transformingEditor.model.document.getRoot()!;
                const codeBlock = Array.from(root.getChildren()).find((c) => c.is("element", "codeBlock"));
                const text = Array.from(codeBlock!.getChildren()).map((c) => (c.is("$text") ? c.data : "\n")).join("");
                expect(text).toBe("formatted:original");
            }, { timeout: 5000 });

            await transformingEditor.destroy();
            transformingDiv.remove();
        });

        it("should not execute when language is unsupported", () => {
            setModelData(editor.model, `<codeBlock language="${LANG_PYTHON}">x=1[]</codeBlock>`);

            const modelChangeSpy = vi.spyOn(editor.model, "change");
            const command = editor.commands.get("formatCodeblock")! as FormatCodeblockCommand;
            command.execute();

            expect(modelChangeSpy).not.toHaveBeenCalled();
        });
    });

    describe("notifications", () => {
        it("should show a warning notification when the formatter throws", async () => {
            const errorMessage = "Syntax error on line 1";
            const formatterName = "MyFormatter";
            const failingDiv = document.createElement("div");
            document.body.appendChild(failingDiv);
            const failingEditor = await ClassicEditor.create(failingDiv, {
                licenseKey: "GPL",
                plugins: [Paragraph, CodeBlock, FormatCodeblockButton],
                codeFormatter: { registry: makeRegistry(makeFailingFormatter(errorMessage, formatterName)) },
                codeBlock: { languages: [{ language: LANG_JAVASCRIPT_FRONTEND, label: "JS" }] },
            });

            setModelData(failingEditor.model, `<codeBlock language="${LANG_JAVASCRIPT_FRONTEND}">code[]</codeBlock>`);

            const notification = failingEditor.plugins.get(Notification);
            const showWarningSpy = vi.spyOn(notification, "showWarning");
            notification.on("show:warning", (evt) => evt.stop(), { priority: "high" });

            failingEditor.execute("formatCodeblock");

            await vi.waitFor(() => {
                expect(showWarningSpy).toHaveBeenCalledOnce();
                const [message, options] = showWarningSpy.mock.calls[0];
                expect(message).toBe(errorMessage);
                expect(options?.namespace).toBe("formatCodeblock");
                expect(options?.title).toContain(formatterName);
            }, { timeout: 5000 });

            await failingEditor.destroy();
            failingDiv.remove();
        });
    });

    describe("button UI", () => {
        it("should have the correct tooltip", () => {
            const button = editor.ui.componentFactory.create("formatCodeblock");
            expect((button as any).tooltip).toBe("Format code block");
        });

        it("button isEnabled should follow command isEnabled", () => {
            setModelData(editor.model, `<codeBlock language="${LANG_JSON}">foo[]</codeBlock>`);

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

describe("FormatCodeblockButton without codeFormatter config", () => {
    let domElement: HTMLDivElement;
    let editor: ClassicEditor;

    beforeEach(async () => {
        domElement = document.createElement("div");
        document.body.appendChild(domElement);

        editor = await ClassicEditor.create(domElement, {
            licenseKey: "GPL",
            plugins: [Paragraph, CodeBlock, FormatCodeblockButton],
            codeBlock: {
                languages: [{ language: LANG_JAVASCRIPT_FRONTEND, label: "JavaScript" }],
            },
            // intentionally no codeFormatter config
        });
    });

    afterEach(() => {
        domElement.remove();
        return editor.destroy();
    });

    it("should still register the command", () => {
        const command = editor.commands.get("formatCodeblock");
        expect(command).toBeDefined();
        expect(command).toBeInstanceOf(FormatCodeblockCommand);
    });

    it("should still register the UI component", () => {
        expect(editor.ui.componentFactory.has("formatCodeblock")).toBe(true);
    });

    it("command should always be disabled when no registry is configured", () => {
        setModelData(editor.model, `<codeBlock language="${LANG_JAVASCRIPT_FRONTEND}">foo[]</codeBlock>`);
        expect(editor.commands.get("formatCodeblock")!.isEnabled).toBe(false);
    });
});
