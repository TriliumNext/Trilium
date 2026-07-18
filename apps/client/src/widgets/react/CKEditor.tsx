import type { CKTextEditor, AttributeEditor, EditorConfig, ModelPosition } from "@triliumnext/ckeditor5";
import { useEffect, useImperativeHandle, useRef } from "preact/compat";
import { MutableRef } from "preact/hooks";

export interface CKEditorApi {
    focus(): void;
    /**
     * Imperatively sets the text in the editor.
     *
     * Prefer setting `currentValue` prop where possible.
     *
     * @param text text to set in the editor
     */
    setText(text: string): void;
    /**
     * Appends a `> `-prefixed markdown quote to the end of the editor as a real block-quote element
     * (its prefixes stripped and content wrapped in a `blockQuote`, so it re-serializes to the same
     * markdown), then places the cursor in an empty paragraph below it and focuses the editor. Existing
     * content is preserved; an empty editor gets the quote at the top with no leading blank. Requires
     * the `BlockQuote` plugin to be loaded on the editor instance.
     *
     * @param markdown a `> `-prefixed markdown blockquote (lines may be joined by `\n`)
     */
    appendBlockQuote(markdown: string): void;
}

interface CKEditorOpts {
    apiRef: MutableRef<CKEditorApi | undefined>;
    currentValue?: string;
    className: string;
    tabIndex?: number;
    config: EditorConfig;
    editor: typeof AttributeEditor;
    disableNewlines?: boolean;
    disableSpellcheck?: boolean;
    onChange?: (newValue?: string) => void;
    onClick?: (e: MouseEvent, pos?: ModelPosition | null) => void;
    onKeyDown?: (e: KeyboardEvent) => void;
    onBlur?: () => void;
    onInitialized?: (editorInstance: CKTextEditor) => void;
}

export default function CKEditor({ apiRef, currentValue, editor, config, disableNewlines, disableSpellcheck, onChange, onClick, onInitialized, ...restProps }: CKEditorOpts) {
    const editorContainerRef = useRef<HTMLDivElement>(null);
    const textEditorRef = useRef<CKTextEditor>(null);
    useImperativeHandle(apiRef, () => {
        return {
            focus() {
                textEditorRef.current?.editing.view.focus();
                textEditorRef.current?.model.change((writer) => {
                    const documentRoot = textEditorRef.current?.editing.model.document.getRoot();
                    if (documentRoot) {
                        writer.setSelection(writer.createPositionAt(documentRoot, "end"));
                    }
                });
            },
            setText(text: string) {
                textEditorRef.current?.setData(text);
            },
            appendBlockQuote(markdown: string) {
                const editor = textEditorRef.current;
                if (!editor) return;
                // Strip the `> ` prefixes to recover the raw content; the block-quote element re-adds
                // them when the reply is serialized back to markdown.
                const lines = markdown.split("\n").map((line) => line.replace(/^\s*>\s?/, ""));
                editor.model.change((writer) => {
                    const root = editor.model.document.getRoot();
                    if (!root) return;

                    // An untouched editor holds a single empty paragraph — drop it so the quote
                    // starts at the top with no leading blank line.
                    const onlyChild = root.childCount === 1 ? root.getChild(0) : null;
                    if (onlyChild?.is("element", "paragraph") && onlyChild.isEmpty) {
                        writer.remove(onlyChild);
                    }

                    // A blank quote line separates paragraphs; lines within a paragraph are joined by
                    // soft breaks. Emitting one <paragraph> per group round-trips to `> a\n>\n> b`
                    // instead of collapsing the blank separator into a spurious hard break.
                    const quote = writer.createElement("blockQuote");
                    for (const paragraphLines of groupQuoteLinesIntoParagraphs(lines)) {
                        const paragraph = writer.createElement("paragraph");
                        writer.append(paragraph, quote);
                        paragraphLines.forEach((line, index) => {
                            if (index > 0) writer.appendElement("softBreak", paragraph);
                            writer.appendText(line, paragraph);
                        });
                    }
                    // A quote of only blank lines still needs a block child to stay schema-valid.
                    if (quote.isEmpty) {
                        writer.append(writer.createElement("paragraph"), quote);
                    }
                    writer.insert(quote, writer.createPositionAt(root, "end"));

                    // A trailing empty paragraph below the quote holds the cursor so the user types
                    // outside (after) the quote.
                    const cursorParagraph = writer.createElement("paragraph");
                    writer.insert(cursorParagraph, writer.createPositionAfter(quote));
                    writer.setSelection(cursorParagraph, "in");
                });
                editor.editing.view.focus();
            }
        };
    }, [ editorContainerRef ]);

    useEffect(() => {
        if (!editorContainerRef.current) return;

        editor.create(editorContainerRef.current, config).then((textEditor) => {
            textEditorRef.current = textEditor;

            if (disableNewlines) {
                textEditor.editing.view.document.on(
                    "enter",
                    (event, data) => {
                        // disable entering new line - see https://github.com/ckeditor/ckeditor5/issues/9422
                        data.preventDefault();
                        event.stop();
                    },
                    { priority: "high" }
                );
            }

            if (disableSpellcheck) {
                const documentRoot = textEditor.editing.view.document.getRoot();
                if (documentRoot) {
                    textEditor.editing.view.change((writer) => writer.setAttribute("spellcheck", "false", documentRoot));
                }
            }

            if (onChange) {
                textEditor.model.document.on("change:data", () => {
                    onChange(textEditor.getData())
                });
            }

            if (currentValue) {
                textEditor.setData(currentValue);
            }

            onInitialized?.(textEditor);
        });
    }, []);

    useEffect(() => {
        if (!textEditorRef.current) return;
        textEditorRef.current.setData(currentValue ?? "");
    }, [ currentValue ]);

    return (
        <div
            ref={editorContainerRef}
            onClick={(e) => {
                if (onClick) {
                    const pos = textEditorRef.current?.model.document.selection.getFirstPosition();
                    onClick(e, pos);
                }
            }}
            {...restProps}
        />
    )
}

/**
 * Groups the (already `> `-stripped) lines of a markdown quote into paragraphs: a blank line starts a
 * new paragraph, and consecutive non-blank lines belong to the same one. Returns one entry per
 * paragraph, each holding its lines (which become soft breaks). Used by {@link CKEditorApi.appendBlockQuote}
 * so a `> a\n>\n> b` quote becomes two paragraphs rather than one paragraph with a doubled hard break.
 */
export function groupQuoteLinesIntoParagraphs(lines: string[]): string[][] {
    const paragraphs: string[][] = [];
    let current: string[] | null = null;
    for (const line of lines) {
        if (line.length === 0) {
            current = null;
            continue;
        }
        if (!current) {
            current = [];
            paragraphs.push(current);
        }
        current.push(line);
    }
    return paragraphs;
}
