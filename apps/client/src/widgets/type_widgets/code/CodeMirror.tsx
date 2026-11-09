import { EditorConfig, default as VanillaCodeMirror } from "@triliumnext/codemirror";
import { Ref } from "preact";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";

import { useSyncedRef } from "../../react/hooks";
import { codeCompletions } from "./code_completions";
import type { CodeSnippet } from "./snippets";

export interface CodeMirrorProps extends Omit<EditorConfig, "parent"> {
    content?: string;
    mime: string;
    className?: string;
    editorRef?: Ref<VanillaCodeMirror>;
    containerRef?: Ref<HTMLPreElement>;
    onInitialized?: () => void;
    /**
     * Whether the edited note is a custom request handler (has `#customRequestHandler`).
     * Gates the `api.req`/`api.res`/`api.pathParams` completions for backend scripts.
     */
    customRequestHandler?: boolean;
    /** Whether the script is a bulk action's, which runs with the processed note as `note`. */
    bulkActionNote?: boolean;
    /** The snippets the completion list offers after a `/`, read each time the list opens. */
    getSnippets?: () => CodeSnippet[];
    /**
     * The name of the language, which a text editor around the code shows in its corner, as on its
     * code blocks.
     */
    languageLabel?: string;
}

export default function CodeMirror({
    className, content, mime, editorRef: externalEditorRef, containerRef: externalContainerRef,
    onInitialized, lineWrapping, lineNumbers = true, customRequestHandler, bulkActionNote,
    allowKeyboardSuggestions, getSnippets, languageLabel, ...extraOpts
}: CodeMirrorProps) {
    const parentRef = useSyncedRef(externalContainerRef);
    const codeEditorRef = useRef<VanillaCodeMirror | undefined>(undefined);
    const getSnippetsRef = useRef(getSnippets);
    getSnippetsRef.current = getSnippets;

    // Create CodeMirror instance.
    useEffect(() => {
        if (!parentRef.current) return;

        const codeEditor = new VanillaCodeMirror({
            parent: parentRef.current,
            allowKeyboardSuggestions,
            lineNumbers,
            ...extraOpts
        });
        codeEditorRef.current = codeEditor;
        codeEditor.setNamedExtension("codeCompletions", codeCompletions(codeEditor, () => getSnippetsRef.current?.() ?? []));
        if (typeof externalEditorRef === "function") externalEditorRef(codeEditor);
        else if (externalEditorRef) externalEditorRef.current = codeEditor;
        onInitialized?.();

        return () => codeEditor.destroy();
    }, []);

    // React to text changes.
    useEffect(() => {
        const codeEditor = codeEditorRef.current;
        codeEditor?.loadText(content ?? "");
        codeEditor?.setMimeType(mime);
        codeEditor?.clearHistory();
    }, [content]);

    // React to language change.
    useEffect(() => {
        codeEditorRef.current?.setMimeType(mime);
    }, [ mime ]);

    // React to custom-request-handler status, which gates the backend api.req/res/pathParams completions.
    useEffect(() => {
        codeEditorRef.current?.setScriptApiContext({
            customRequestHandler: !!customRequestHandler,
            bulkActionNote: !!bulkActionNote
        });
    }, [ customRequestHandler, bulkActionNote ]);

    // React to the language switching between prose and code, which decides whether the
    // on-screen keyboard is allowed to suggest words.
    useEffect(() => codeEditorRef.current?.setAllowKeyboardSuggestions(!!allowKeyboardSuggestions), [ allowKeyboardSuggestions ]);

    // React to editability, in the same commit as the change.
    useLayoutEffect(() => {
        codeEditorRef.current?.setReadOnly(!!extraOpts.readOnly);
    }, [ extraOpts.readOnly ]);

    // React to line wrapping.
    useEffect(() => codeEditorRef.current?.setLineWrapping(!!lineWrapping), [ lineWrapping ]);

    // React to line numbers.
    useEffect(() => codeEditorRef.current?.setLineNumbers(lineNumbers), [ lineNumbers ]);

    // React to indent size / style changes.
    useEffect(() => {
        if (extraOpts.indentSize != null || extraOpts.useTabs != null) {
            codeEditorRef.current?.setIndent(extraOpts.indentSize ?? 4, !!extraOpts.useTabs);
        }
    }, [ extraOpts.indentSize, extraOpts.useTabs ]);

    return (
        <pre ref={parentRef} className={className} data-language={languageLabel} />
    )
}
