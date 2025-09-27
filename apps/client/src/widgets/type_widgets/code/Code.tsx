import { useEffect, useRef, useState } from "preact/hooks";
import { getThemeById, default as VanillaCodeMirror } from "@triliumnext/codemirror";
import { TypeWidgetProps } from "../type_widget";
import "./code.css";
import CodeMirror, { CodeMirrorProps } from "./CodeMirror";
import utils from "../../../services/utils";
import { useEditorSpacedUpdate, useKeyboardShortcuts, useNoteBlob, useSyncedRef, useTriliumEvent, useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import { t } from "../../../services/i18n";
import appContext from "../../../components/app_context";
import TouchBar, { TouchBarButton } from "../../react/TouchBar";
import { refToJQuerySelector } from "../../react/react_utils";
import { CODE_THEME_DEFAULT_PREFIX as DEFAULT_PREFIX } from "../constants";

interface CodeEditorProps {
    /** By default, the code editor will try to match the color of the scrolling container to match the one from the theme for a full-screen experience. If the editor is embedded, it makes sense not to have this behaviour. */
    noBackgroundChange?: boolean;
}

export interface EditableCodeProps extends TypeWidgetProps, Omit<CodeEditorProps, "onContentChanged"> {
    // if true, the update will be debounced to prevent excessive updates. Especially useful if the editor is linked to a live preview.
    debounceUpdate?: boolean;
    lineWrapping?: boolean;
    updateInterval?: number;
    /** Invoked when the content of the note is changed, such as a different revision or a note switch. */
    onContentChanged?: (content: string) => void;
    /** Invoked after the content of the note has been uploaded to the server, using a spaced update. */
    dataSaved?: () => void;
}

export function ReadOnlyCode({ note, viewScope, ntxId, parentComponent }: TypeWidgetProps) {
    const [ content, setContent ] = useState("");
    const blob = useNoteBlob(note);

    useEffect(() => {
        if (!blob) return;
        const isFormattable = note.type === "text" && viewScope?.viewMode === "source";
        setContent(isFormattable ? utils.formatHtml(blob.content) : blob.content);
    }, [ blob ]);

    return (
        <div className="note-detail-readonly-code note-detail-printable">
            <CodeEditor
                ntxId={ntxId} parentComponent={parentComponent}
                className="note-detail-readonly-code-content"
                content={content}
                mime={note.mime}
                readOnly
            />
        </div>
    )
}

export function EditableCode({ note, ntxId, debounceUpdate, parentComponent, updateInterval, onContentChanged, dataSaved, ...editorProps }: EditableCodeProps) {
    const editorRef = useRef<VanillaCodeMirror>(null);
    const containerRef = useRef<HTMLPreElement>(null);
    const [ vimKeymapEnabled ] = useTriliumOptionBool("vimKeymapEnabled");
    const spacedUpdate = useEditorSpacedUpdate({
        note,
        getData: () => ({ content: editorRef.current?.getText() }),
        onContentChange: (content) => {
            const codeEditor = editorRef.current;
            if (!codeEditor) return;
            codeEditor.setText(content ?? "");
            codeEditor.setMimeType(note.mime);
            codeEditor.clearHistory();
        },
        dataSaved,
        updateInterval
    });

    useKeyboardShortcuts("code-detail", containerRef, parentComponent);

    return (
        <div className="note-detail-code note-detail-printable">
            <CodeEditor
                ntxId={ntxId} parentComponent={parentComponent}
                editorRef={editorRef} containerRef={containerRef}
                mime={note.mime}
                className="note-detail-code-editor"
                placeholder={t("editable_code.placeholder")}
                vimKeybindings={vimKeymapEnabled}
                tabIndex={300}
                onContentChanged={() => {
                    if (debounceUpdate) {
                        spacedUpdate.resetUpdateTimer();
                    }
                    spacedUpdate.scheduleUpdate();
                    if (editorRef.current && onContentChanged) {
                        onContentChanged(editorRef.current.getText());
                    }
                }}
                {...editorProps}
            />

            <TouchBar>
                {(note?.mime.startsWith("application/javascript") || note?.mime === "text/x-sqlite;schema=trilium") && (
                    <TouchBarButton icon="NSImageNameTouchBarPlayTemplate" click={() => appContext.triggerCommand("runActiveNote")} />
                )}
            </TouchBar>
        </div>
    )
}

export function CodeEditor({ parentComponent, ntxId, containerRef: externalContainerRef, editorRef: externalEditorRef, mime, onInitialized, lineWrapping, noBackgroundChange, ...editorProps }: CodeEditorProps & CodeMirrorProps & Pick<TypeWidgetProps, "parentComponent" | "ntxId">) {
    const codeEditorRef = useRef<VanillaCodeMirror>(null);
    const containerRef = useSyncedRef(externalContainerRef);
    const initialized = useRef($.Deferred());
    const [ codeLineWrapEnabled ] = useTriliumOptionBool("codeLineWrapEnabled");
    const [ codeNoteTheme ] = useTriliumOption("codeNoteTheme");

    // React to background color.
    const [ backgroundColor, setBackgroundColor ] = useState<string>();
    useEffect(() => {
        if (!backgroundColor || noBackgroundChange) return;
        parentComponent?.$widget.closest(".scrolling-container").css("background-color", backgroundColor);
        return () => {
            parentComponent?.$widget.closest(".scrolling-container").css("background-color", "unset");
        };
    }, [ backgroundColor ]);

    // React to theme changes.
    useEffect(() => {
        if (codeEditorRef.current && codeNoteTheme.startsWith(DEFAULT_PREFIX)) {
            const theme = getThemeById(codeNoteTheme.substring(DEFAULT_PREFIX.length));
            if (theme) {
                codeEditorRef.current.setTheme(theme).then(() => {
                    if (mime === "text/x-sqlite;schema=trilium") return;
                    const editor = containerRef.current?.querySelector(".cm-editor");
                    if (!editor) return;
                    const style = window.getComputedStyle(editor);
                    setBackgroundColor(style.backgroundColor);
                });
            }
        }
    }, [ codeEditorRef, codeNoteTheme ]);

    useTriliumEvent("executeWithCodeEditor", async ({ resolve, ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId) return;
        await initialized.current.promise();
        resolve(codeEditorRef.current!);
    });

    useTriliumEvent("executeWithContentElement", async ({ resolve, ntxId: eventNtxId}) => {
        if (eventNtxId !== ntxId) return;
        await initialized.current.promise();
        resolve(refToJQuerySelector(containerRef));
    });

    useTriliumEvent("scrollToEnd", () => {
        const editor = codeEditorRef.current;
        if (!editor) return;
        editor.scrollToEnd();
        editor.focus();
    });

    useTriliumEvent("focusOnDetail", ({ ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId) return;
        codeEditorRef.current?.focus();
    });

    return <CodeMirror
        {...editorProps}
        mime={mime}
        editorRef={codeEditorRef}
        containerRef={containerRef}
        lineWrapping={lineWrapping ?? codeLineWrapEnabled}
        onInitialized={() => {
            if (externalContainerRef && containerRef.current) {
                externalContainerRef.current = containerRef.current;
            }
            if (externalEditorRef && codeEditorRef.current) {
                externalEditorRef.current = codeEditorRef.current;
            }
            initialized.current.resolve();
            onInitialized?.();
        }}
    />
}
