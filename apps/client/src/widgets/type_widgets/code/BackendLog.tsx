import { useEffect, useRef, useState } from "preact/hooks";
import "./code.css";
import { CodeEditor } from "./Code";
import CodeMirror from "@triliumnext/codemirror";
import server from "../../../services/server";
import { useTriliumEvent } from "../../react/hooks";
import { TypeWidgetProps } from "../type_widget";

export default function BackendLog({ ntxId, parentComponent }: TypeWidgetProps) {
    const [ content, setContent ] = useState<string>();
    const editorRef = useRef<CodeMirror>(null);

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

    return (
        <div className="backend-log-editor-container">
            <CodeEditor
                editorRef={editorRef}
                ntxId={ntxId} parentComponent={parentComponent}
                content={content ?? ""}
                mime="text/plain"
                readOnly
                preferPerformance
            />
        </div>
    )
}
