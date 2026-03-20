import { ClassicEditor, CodeBlock, Paragraph } from "ckeditor5";
import FormatCodeblockButton from "../src/plugins/format_codeblock/format_codeblock_button";
import type { CodeFormatterConfig } from "../src/plugins/format_codeblock/types";

export type { CodeFormatterConfig as CodeFormatter };

export async function createEditor(codeFormatter?: CodeFormatterConfig) {
    const div = document.createElement("div");
    document.body.appendChild(div);

    const editor = await ClassicEditor.create(div, {
        licenseKey: "GPL",
        plugins: [Paragraph, CodeBlock, FormatCodeblockButton],
        ...(codeFormatter ? { codeFormatter } : {}),
        codeBlock: {
            languages: [
                { language: "javascript", label: "JavaScript" },
                { language: "python", label: "Python" },
            ],
        },
    });

    return { editor, div };
}

export function setCodeFormatter(editor: ClassicEditor, config: CodeFormatterConfig) {
    editor.config.set("codeFormatter", config);
    editor.commands.get("formatCodeblock")!.refresh();
}

export function extractCodeBlockText(editor: ClassicEditor): string {
    const root = editor.model.document.getRoot()!;
    const codeBlock = Array.from(root.getChildren()).find((c) =>
        c.is("element", "codeBlock"),
    );
    return Array.from(codeBlock!.getChildren())
        .map((c) => ("data" in c ? c.data : "\n"))
        .join("");
}

/**
 * Two rounds of setTimeout(0) are needed because the source uses a
 * .then().catch() chain — each leg enqueues a new microtask.
 */
export async function flushMicrotasks(): Promise<void> {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
}
