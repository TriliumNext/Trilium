import type { CKTextEditor, AttributeEditor, EditorConfig, ModelPosition } from "@triliumnext/ckeditor5";
import type { DISPLAYABLE_LOCALE_IDS } from "@triliumnext/commons";
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
    /**
     * The language the editor's own strings — a toolbar's tooltips, the link balloon — are to be
     * shown in, whose dictionary is fetched and laid within reach before the editor is raised (see
     * `registerCkTranslations`). Settled here rather than in the configuration a caller hands over
     * because the editor is already built from within an effect, where waiting costs a field
     * nothing; a caller that waited would be holding back its own mounting instead.
     *
     * Left out, the editor speaks whatever its configuration says, which is the English it was
     * written in.
     */
    uiLanguage?: DISPLAYABLE_LOCALE_IDS;
    editor: typeof AttributeEditor;
    disableNewlines?: boolean;
    disableSpellcheck?: boolean;
    onChange?: (newValue?: string) => void;
    onClick?: (e: MouseEvent, pos?: ModelPosition | null) => void;
    onKeyDown?: (e: KeyboardEvent) => void;
    onBlur?: () => void;
    onInitialized?: (editorInstance: CKTextEditor) => void;
}

export default function CKEditor({ apiRef, currentValue, editor, config, uiLanguage, disableNewlines, disableSpellcheck, onChange, onClick, onInitialized, ...restProps }: CKEditorOpts) {
    const editorContainerRef = useRef<HTMLDivElement>(null);
    const textEditorRef = useRef<CKTextEditor>(null);
    /** The value as it stands now, for the building of the editor to end on rather than begin with. */
    const currentValueRef = useRef(currentValue);
    currentValueRef.current = currentValue;
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
        const container = editorContainerRef.current;
        if (!container) return;
        let unmounted = false;

        // Raised at once where no language was asked for, which is how every field that asks for
        // none has always been built. Where one was, the dictionary it is to speak from is laid
        // within reach first: an editor reads from what was there when it was raised, so a catalog
        // arriving after it would be a catalog it never looks in.
        const created = uiLanguage
            ? layTranslationsWithinReach(uiLanguage).then((language) => editor.create(container, { ...config, ...language }))
            : editor.create(container, config);

        created.then((textEditor) => {
            // Gone before it was ready: build no further, and take with it what it has put on the
            // page, or the next editor would find it there and take it for its own content.
            if (unmounted) {
                void textEditor.destroy();
                return;
            }

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

            // Read as the editor is ready rather than as it was asked for: building one takes a
            // while, and a value handed over in the meantime would otherwise be passed over — the
            // effect watching it having had no editor to give it to, and this one holding the value
            // as it stood when the building began.
            //
            // Set even when there is nothing to set: an editor built upon an element takes what
            // that element holds as its content, so anything left there — by an editor that stood
            // here before this one — would otherwise become the content of this one.
            textEditor.setData(currentValueRef.current ?? "");

            onInitialized?.(textEditor);
        });

        return () => {
            unmounted = true;
            void textEditorRef.current?.destroy();
            textEditorRef.current = null;
        };
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
 * Lays the locale's CKEditor dictionary within reach of the editor about to be raised, and says
 * which language it is then to speak.
 *
 * Fetched rather than named outright at the head of this module: everything else this module takes
 * from the editor package is a type, and a value taken from it here would put the whole of CKEditor
 * into every module that so much as mounts a field — the script API among them, which carries none
 * of it today. Nothing is really fetched: whoever asks for a language handed over an editor class
 * to build from, so the package is already in hand.
 */
async function layTranslationsWithinReach(uiLanguage: DISPLAYABLE_LOCALE_IDS) {
    const { registerCkTranslations } = await import("@triliumnext/ckeditor5");
    return registerCkTranslations(uiLanguage);
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
