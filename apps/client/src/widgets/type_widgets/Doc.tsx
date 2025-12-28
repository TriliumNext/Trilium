import "./Doc.css";

import { useEffect, useRef } from "preact/hooks";

import appContext from "../../components/app_context";
import renderDoc from "../../services/doc_renderer";
import { useTriliumEvent } from "../react/hooks";
import { refToJQuerySelector } from "../react/react_utils";
import { TypeWidgetProps } from "./type_widget";

export default function Doc({ note, viewScope, ntxId }: TypeWidgetProps) {
    const initialized = useRef<Promise<void> | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!note) return;

        initialized.current = renderDoc(note).then($content => {
            if (!containerRef.current) return;
            containerRef.current.replaceChildren(...$content);
            appContext.triggerEvent("contentElRefreshed", { ntxId, contentEl: containerRef.current });
        });
    }, [ note, ntxId ]);

    useTriliumEvent("executeWithContentElement", async ({ resolve, ntxId: eventNtxId}) => {
        if (eventNtxId !== ntxId) return;
        await initialized.current;
        resolve(refToJQuerySelector(containerRef));
    });

    return (
        <div
            ref={containerRef}
            className={`note-detail-doc-content ck-content ${viewScope?.viewMode === "contextual-help" ? "contextual-help" : ""}`}
        />
    );
}
