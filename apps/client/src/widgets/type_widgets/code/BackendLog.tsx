import "./code.css";

import { MIME_TYPE_TRILIUM_LOG } from "@triliumnext/commons";
import CodeMirror from "@triliumnext/codemirror";
import { useEffect, useRef, useState } from "preact/hooks";

import server from "../../../services/server";
import utils from "../../../services/utils";
import { useNote, useNoteLabelOptionalBool, useTriliumEvent } from "../../react/hooks";
import { TypeWidgetProps } from "../type_widget";
import { CodeEditor } from "./Code";

export default function BackendLog({ ntxId, parentComponent }: TypeWidgetProps) {
    const [ content, setContent ] = useState<string>();
    const editorRef = useRef<CodeMirror>(null);
    const note = useNote("_backendLog");
    const [ noteWrapLines ] = useNoteLabelOptionalBool(note, "wrapLines");

    function refresh() {
        server.get<string>("backend-log").then(content => {
            setContent(content);
        });
    }

    useEffect(refresh, []);

    // Scroll to end
    useEffect(() => {
        requestAnimationFrame(() => editorRef.current?.scrollToEnd());
    }, [ content ]);

    // React to refresh button.
    useTriliumEvent("refreshData", ({ ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId) return;
        refresh();
    });

    // React to download button.
    useTriliumEvent("customDownload", ({ ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId) return;
        const text = editorRef.current?.getText() ?? "";
        const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
        utils.triggerDownload(`trilium-backend-log-${new Date().toISOString().slice(0, 10)}.log`, dataUrl);
    });

    return (
        <div className="backend-log-editor-container">
            <CodeEditor
                editorRef={editorRef}
                ntxId={ntxId} parentComponent={parentComponent}
                content={content ?? ""}
                mime={MIME_TYPE_TRILIUM_LOG}
                readOnly
                preferPerformance
                {...(noteWrapLines != null && { lineWrapping: noteWrapLines })}
            />
        </div>
    );
}
