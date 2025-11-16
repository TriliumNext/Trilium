import { useEffect, useRef, useState } from "preact/hooks";
import { RawHtmlBlock } from "../react/RawHtml";
import renderDoc from "../../services/doc_renderer";
import "./Doc.css";
import { TypeWidgetProps } from "./type_widget";
import { useTriliumEvent } from "../react/hooks";
import { refToJQuerySelector } from "../react/react_utils";

export default function Doc({ note, viewScope, ntxId }: TypeWidgetProps) {
    const initialized = useRef<Promise<void> | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!note) return;

        initialized.current = renderDoc(note).then($content => {
            containerRef.current?.replaceChildren(...$content);
        });
    }, [ note ]);

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
