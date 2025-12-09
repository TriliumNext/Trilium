import { useEffect, useRef, useState } from "preact/hooks";
import { TypeWidgetProps } from "./type_widget";
import render from "../../services/render";
import { refToJQuerySelector } from "../react/react_utils";
import Alert from "../react/Alert";
import "./Render.css";
import { t } from "../../services/i18n";
import RawHtml from "../react/RawHtml";
import { useTriliumEvent } from "../react/hooks";

export default function Render({ note, noteContext, ntxId }: TypeWidgetProps) {
    const contentRef = useRef<HTMLDivElement>(null);
    const [ renderNotesFound, setRenderNotesFound ] = useState(false);

    function refresh() {
        if (!contentRef) return;
        render.render(note, refToJQuerySelector(contentRef)).then(setRenderNotesFound);
    }

    useEffect(refresh, [ note ]);

    // Keyboard shortcut.
    useTriliumEvent("renderActiveNote", () => {
        if (!noteContext?.isActive()) return;
        refresh();
    });

    // Refresh on floating buttons.
    useTriliumEvent("refreshData", ({ ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId) return;
        refresh();
    });

    // Integration with search.
    useTriliumEvent("executeWithContentElement", ({ resolve, ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId) return;
        resolve(refToJQuerySelector(contentRef));
    });

    return (
        <>
            {!renderNotesFound && (
                <Alert className="note-detail-render-help" type="warning">
                    <p><strong>{t("render.note_detail_render_help_1")}</strong></p>
                    <p><RawHtml html={t("render.note_detail_render_help_2")} /></p>
                </Alert>
            )}

            <div ref={contentRef} className="note-detail-render-content" />
        </>
    );
}
