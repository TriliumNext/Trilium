import type { CKTextEditor, AttributeEditor, EditorConfig, ModelPosition } from "@triliumnext/ckeditor5";
import { useEffect, useImperativeHandle, useRef } from "preact/compat";
import { MutableRef } from "preact/hooks";

export interface CKEditorApi {
    focus: () => void;
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
}

export default function CKEditor({ apiRef, currentValue, editor, config, disableNewlines, disableSpellcheck, onChange, onClick, ...restProps }: CKEditorOpts) {
    const editorContainerRef = useRef<HTMLDivElement>(null);    
    const textEditorRef = useRef<CKTextEditor>(null);
    useImperativeHandle(apiRef, () => {
        return {
            focus() {
                editorContainerRef.current?.focus();
                textEditorRef.current?.model.change((writer) => {
                    const documentRoot = textEditorRef.current?.editing.model.document.getRoot();
                    if (documentRoot) {
                        writer.setSelection(writer.createPositionAt(documentRoot, "end"));
                    }
                });
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