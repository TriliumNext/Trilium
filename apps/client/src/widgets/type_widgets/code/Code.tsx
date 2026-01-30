import "./code.css";

import { default as VanillaCodeMirror, getThemeById } from "@triliumnext/codemirror";
import { NoteType } from "@triliumnext/commons";
import { useEffect, useRef, useState } from "preact/hooks";

import appContext, { CommandListenerData } from "../../../components/app_context";
import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import utils from "../../../services/utils";
import { useEditorSpacedUpdate, useKeyboardShortcuts, useLegacyImperativeHandlers, useNoteBlob, useNoteProperty, useSyncedRef, useTriliumEvent, useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import { refToJQuerySelector } from "../../react/react_utils";
import TouchBar, { TouchBarButton } from "../../react/TouchBar";
import { CODE_THEME_DEFAULT_PREFIX as DEFAULT_PREFIX } from "../constants";
import { TypeWidgetProps } from "../type_widget";
import CodeMirror, { CodeMirrorProps } from "./CodeMirror";

interface CodeEditorProps {
    /** By default, the code editor will try to match the color of the scrolling container to match the one from the theme for a full-screen experience. If the editor is embedded, it makes sense not to have this behaviour. */
    noBackgroundChange?: boolean;
}

export interface EditableCodeProps extends TypeWidgetProps, Omit<CodeEditorProps, "onContentChanged"> {
    // if true, the update will be debounced to prevent excessive updates. Especially useful if the editor is linked to a live preview.
    debounceUpdate?: boolean;
    lineWrapping?: boolean;
    updateInterval?: number;
    noteType?: NoteType;
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

        let newContent = blob.content;
        if (viewScope?.viewMode === "source") {
            newContent = formatViewSource(note, newContent);
        }

        setContent(newContent);
    }, [ blob ]);

    return (
        <CodeEditor
            ntxId={ntxId} parentComponent={parentComponent}
            className="note-detail-readonly-code-content"
            content={content}
            mime={note.mime}
            readOnly
        />
    );
}

function formatViewSource(note: FNote, content: string) {
    if (note.type === "text") {
        return utils.formatHtml(content);
    }

    if (note.type !== "code" && note.mime === "application/json" && content.length < 512_000) {
        try {
            return JSON.stringify(JSON.parse(content), null, 4);
        } catch (e) {
            // Fallback to content.
        }
    }

    return content;
}

export function EditableCode({ note, ntxId, noteContext, debounceUpdate, parentComponent, updateInterval, noteType = "code", onContentChanged, dataSaved, ...editorProps }: EditableCodeProps) {
    const editorRef = useRef<VanillaCodeMirror>(null);
    const containerRef = useRef<HTMLPreElement>(null);
    const [ vimKeymapEnabled ] = useTriliumOptionBool("vimKeymapEnabled");
    const mime = useNoteProperty(note, "mime");
    const spacedUpdate = useEditorSpacedUpdate({
        note,
        noteType,
        noteContext,
        getData: () => ({ content: editorRef.current?.getText() ?? "" }),
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

    // make sure that script is saved before running it #4028
    useLegacyImperativeHandlers({
        async runActiveNoteCommand(params: CommandListenerData<"runActiveNote">) {
            if (params.ntxId === ntxId) {
                await spacedUpdate.updateNowIfNecessary();
            }

            return await parentComponent?.parent?.triggerCommand("runActiveNote", params);
        }
    });

    useKeyboardShortcuts("code-detail", containerRef, parentComponent, ntxId);

    return (
        <>
            <CodeEditor
                ntxId={ntxId} parentComponent={parentComponent}
                editorRef={editorRef} containerRef={containerRef}
                mime={mime ?? "text/plain"}
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
        </>
    );
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
        parentComponent?.$widget.closest(".scrolling-container").css("--code-background-color", backgroundColor);
    }, [ backgroundColor ]);

    // React to theme changes.
    useEffect(() => {
        if (codeEditorRef.current && codeNoteTheme.startsWith(DEFAULT_PREFIX)) {
            const theme = getThemeById(codeNoteTheme.substring(DEFAULT_PREFIX.length));
            if (theme) {
                codeEditorRef.current.setTheme(theme).then(() => {
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
    />;
}
