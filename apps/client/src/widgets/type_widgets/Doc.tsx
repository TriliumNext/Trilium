import "./Doc.css";

import { useEffect, useRef } from "preact/hooks";

import appContext from "../../components/app_context";
import renderDoc from "../../services/doc_renderer";
import { useTriliumEvent } from "../react/hooks";
import { refToJQuerySelector } from "../react/react_utils";
import { TypeWidgetProps } from "./type_widget";
import { WebViewContent } from "./WebView";

export default function Doc({ note, viewScope, ntxId }: TypeWidgetProps) {
    const initialized = useRef<Promise<void> | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // In the standalone client the User Guide HTML is not bundled (only its searchable text is). Those
    // notes carry a `docUrl`, so embed the online documentation in a web view instead of rendering a
    // local doc file that isn't there. On server/desktop the HTML is present, so we render it locally.
    const onlineDocUrl = note && window.glob.isStandalone ? note.getLabelValue("docUrl") : null;

    useEffect(() => {
        if (!note || onlineDocUrl) return;

        initialized.current = renderDoc(note).then($content => {
            if (!containerRef.current) return;
            containerRef.current.replaceChildren(...$content);
            appContext.triggerEvent("contentElRefreshed", { ntxId, contentEl: containerRef.current });
        });
    }, [ note, ntxId, onlineDocUrl ]);

    useTriliumEvent("executeWithContentElement", async ({ resolve, ntxId: eventNtxId}) => {
        if (eventNtxId !== ntxId) return;
        await initialized.current;
        resolve(refToJQuerySelector(containerRef));
    });

    // TODO: temporary diagnostics for the standalone blank-doc issue — remove once resolved.
    console.log(`[doc-render] Doc widget note=${note?.noteId} isStandalone=${window.glob.isStandalone} onlineDocUrl=${JSON.stringify(onlineDocUrl)} → ${onlineDocUrl ? "WebView (online docs)" : "local renderDoc"}`);

    if (onlineDocUrl) {
        return <WebViewContent src={onlineDocUrl} ntxId={ntxId} />;
    }

    return (
        <div
            ref={containerRef}
            className={`note-detail-doc-content note-detail-readonly-text-content ck-content ${viewScope?.viewMode === "contextual-help" ? "contextual-help" : ""}`}
        />
    );
}
