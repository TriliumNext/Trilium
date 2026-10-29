import type VanillaCodeMirror from "@triliumnext/codemirror";
import { SharedHistory } from "@triliumnext/codemirror";
import clsx from "clsx";
import type { RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import type { ContentEditor } from "../../../services/content_renderer";
import { CodeMirrorFindTarget } from "../../find_in_code";
import { useNoteLabelOptionalBool, useTriliumOptionBool } from "../../react/hooks";
import { registerEmbedFindTarget } from "../text/content_embed_tools";
import { CaretNavigationContext, useEmbedCaretNavigation } from "../text/editable_embed";
import type { ContentHistory } from "../text/embed_history";
import { CodeEditor } from "./Code";

export interface CodeEmbedEditorProps {
    note: FNote | null;
    /** The note that holds an attachment, which images upload to and new notes go under. */
    ownerNote?: FNote | null;
    /** Saves the edits, or `undefined` to show the content read-only. */
    editor: ContentEditor | undefined;
    /** The undo history that the content shares with the text note, also while read-only. */
    history?: ContentHistory;
    content: string;
    mime: string;
    /** The tab width, or `undefined` to follow the global option. */
    tabWidth: number | undefined;
    /** Whether to indent with tabs, or `undefined` to follow the global option. */
    useTabs: boolean | undefined;
    /** Whether to wrap the lines, over the `#wrapLines` label of `note` and the global option. */
    wrapLines?: boolean;
    /** Whether to show the line numbers, or `undefined` to follow the global option. */
    hasLineNumbers?: boolean;
    /** The name of the language, shown in the corner of the editor as on a code block. */
    languageLabel?: string;
    /** Holds the CodeMirror view while the editor is open, and `null` once it goes away. */
    viewRef: RefObject<VanillaCodeMirror | null>;
    /** Whether the editor shows. "Search in note" skips a hidden one. Shown by default. */
    isShown?: boolean;
    /** Receives the edited content when the editor goes away. */
    onClose: (content: string) => void;
    /** Receives the content as it is edited. */
    onChange?: (content: string) => void;
    /** Called with CodeMirror once it mounts, for extensions such as a linter. */
    onReady?: (view: VanillaCodeMirror) => void;
}

/**
 * CodeMirror over the content of a code embed, which `editor` saves as it changes. Without an
 * `editor`, the content is read-only.
 */
export default function CodeEmbedEditor({
    note, ownerNote, editor, history, content, mime, tabWidth, useTabs, wrapLines, hasLineNumbers,
    languageLabel, viewRef, isShown = true, onClose, onChange, onReady
}: CodeEmbedEditorProps) {
    const isLoadingRef = useRef(false);
    const [ vimKeymapEnabled ] = useTriliumOptionBool("vimKeymapEnabled");
    const [ noteWrapLines ] = useNoteLabelOptionalBool(note, "wrapLines");
    const lineWrapping = wrapLines ?? noteWrapLines;
    // The effects below wait for this state rather than read `viewRef`: a render of this component
    // before the effects flush runs them ahead of the effect of `CodeMirror` that creates the view.
    const [ view, setView ] = useState<VanillaCodeMirror | null>(null);
    useEmbedCaretNavigation(() => viewRef.current);

    useEffect(() => {
        if (view) {
            onReady?.(view);
        }
    }, [ view ]);

    useEffect(() => {
        if (!view || !isShown) return;

        const unregister = registerEmbedFindTarget(view.dom, new CodeMirrorFindTarget(view));
        return () => {
            unregister();
            // Clears the search matches of an editor that is hidden rather than unmounted.
            if (view.dom.isConnected) {
                view.cleanSearch();
            }
        };
    }, [ view, isShown ]);

    // Runs after the effects of `CodeMirror`, which empties the document as it mounts, and before
    // the editor first paints.
    useLayoutEffect(() => {
        if (!view || view.getText() === content) return;

        // Loading changes the document as well, which must not schedule a save.
        isLoadingRef.current = true;
        view.loadText(content);
        isLoadingRef.current = false;
        view.clearHistory();
    }, [ view, content ]);

    useLayoutEffect(() => {
        if (!view || !history) return;

        history.shared ??= new SharedHistory(history.host, history.write);
        view.setSharedHistory(history.shared);
        return () => view.setSharedHistory(null);
    }, [ view, history ]);

    // Layout cleanups run as `editor` goes away and during the unmount, before CodeMirror is
    // destroyed, in the order of these hooks.
    useLayoutEffect(() => {
        if (!editor) return;

        return () => {
            const text = viewRef.current?.getText();
            // `release()` reads the pending content through `viewRef`, so the ref clears after it.
            editor.release();
            if (text !== undefined) {
                onClose(text);
            }
        };
    }, [ editor, onClose ]);

    useLayoutEffect(() => () => {
        viewRef.current = null;
    }, []);

    // `CodeMirror` keeps the `onContentChanged` it is created with, which calls the latest one.
    const handleChangeRef = useRef<() => void>(() => {});
    handleChangeRef.current = () => {
        if (editor && !isLoadingRef.current) {
            editor.scheduleSave(() => viewRef.current?.getText() ?? "");
            onChange?.(viewRef.current?.getText() ?? "");
        }
    };

    return (
        <CodeEditor
            ntxId={null}
            editorRef={viewRef}
            className={clsx("code-embed-editor", !editor && "read-only")}
            mime={mime}
            completions={editor && { note, ownerNote }}
            vimKeybindings={vimKeymapEnabled}
            readOnly={!editor}
            lineNumbers={hasLineNumbers}
            languageLabel={languageLabel}
            onInitialized={() => setView(viewRef.current)}
            onContentChanged={() => handleChangeRef.current()}
            {...(tabWidth !== undefined && { indentSize: tabWidth })}
            {...(useTabs !== undefined && { useTabs })}
            {...(lineWrapping != null && { lineWrapping })}
        />
    );
}

export interface EmbedSourcePaneProps
    extends Omit<CodeEmbedEditorProps, "isShown" | "onClose" | "onChange"> {
    /** The root of the embed content, which the arrow keys enter the source from. */
    rootRef: RefObject<HTMLElement | null>;
    /** Whether the Editable toggle of the embed is on. */
    isEditing: boolean;
    /** Whether the display mode of the embed shows the source. */
    isSourceShown: boolean;
    /** Receives the content as it is edited, and when the editor goes away. */
    onContentChange: (content: string) => void;
}

/**
 * The source pane of an embed laid out by `SplitLayout`: a {@link CodeEmbedEditor} that edits the
 * source while `isEditing`, and shows it read-only otherwise.
 */
export function EmbedSourcePane({
    rootRef, editor, isEditing, isSourceShown, onContentChange, ...editorProps
}: EmbedSourcePaneProps) {
    return (
        <div className="note-detail-split-editor">
            {/* An edited source stays mounted while the rendering shows alone, which keeps its
                undo history. "Search in note" and the arrow keys skip it then. */}
            {(isEditing || isSourceShown) && (
                <CaretNavigationContext.Provider
                    value={isEditing && isSourceShown ? rootRef : null}
                >
                    <CodeEmbedEditor
                        editor={isEditing ? editor : undefined}
                        history={editor?.history}
                        isShown={isSourceShown}
                        onClose={onContentChange}
                        onChange={onContentChange}
                        {...editorProps}
                    />
                </CaretNavigationContext.Provider>
            )}
        </div>
    );
}
