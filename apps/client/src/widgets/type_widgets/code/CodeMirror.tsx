import { useEffect, useRef } from "preact/hooks";
import { EditorConfig, default as VanillaCodeMirror } from "@triliumnext/codemirror";
import type { ScriptModuleTypes } from "@triliumnext/commons";
import { useSyncedRef } from "../../react/hooks";
import { Ref } from "preact";

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
    /** Declarations of the installed npm packages, so a backend script's `require()` is typed. */
    scriptModules?: ScriptModuleTypes[];
}

export default function CodeMirror({ className, content, mime, editorRef: externalEditorRef, containerRef: externalContainerRef, onInitialized, lineWrapping, customRequestHandler, scriptModules, ...extraOpts }: CodeMirrorProps) {
    const parentRef = useSyncedRef(externalContainerRef);
    const codeEditorRef = useRef<VanillaCodeMirror>();

    // Create CodeMirror instance.
    useEffect(() => {
        if (!parentRef.current) return;

        const codeEditor = new VanillaCodeMirror({
            parent: parentRef.current,
            ...extraOpts
        });
        codeEditorRef.current = codeEditor;
        if (typeof externalEditorRef === "function") externalEditorRef(codeEditor);
        else if (externalEditorRef) externalEditorRef.current = codeEditor;
        onInitialized?.();

        return () => codeEditor.destroy();
    }, []);

    // React to text changes.
    useEffect(() => {
        const codeEditor = codeEditorRef.current;
        codeEditor?.setText(content ?? "");
        codeEditor?.setMimeType(mime);
        codeEditor?.clearHistory();
    }, [content]);

    // React to language change.
    useEffect(() => {
        codeEditorRef.current?.setMimeType(mime);
    }, [ mime ]);

    // React to what tunes the offered types: custom-request-handler status, which gates the backend
    // api.req/res/pathParams completions, and the packages a `require()` can resolve to.
    useEffect(() => {
        codeEditorRef.current?.setScriptApiContext({
            customRequestHandler: !!customRequestHandler,
            ...(scriptModules?.length ? { scriptModules } : {})
        });
    }, [ customRequestHandler, scriptModules ]);

    // React to line wrapping.
    useEffect(() => codeEditorRef.current?.setLineWrapping(!!lineWrapping), [ lineWrapping ]);

    // React to indent size / style changes.
    useEffect(() => {
        if (extraOpts.indentSize != null || extraOpts.useTabs != null) {
            codeEditorRef.current?.setIndent(extraOpts.indentSize ?? 4, !!extraOpts.useTabs);
        }
    }, [ extraOpts.indentSize, extraOpts.useTabs ]);

    return (
        <pre ref={parentRef} className={className} />
    )
}
