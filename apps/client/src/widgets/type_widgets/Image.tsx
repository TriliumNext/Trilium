import "./Image.css";

import { useEffect, useRef, useState } from "preact/hooks";
import { TransformComponent,TransformWrapper } from "react-zoom-pan-pinch";

import image_context_menu from "../../menus/image_context_menu";
import { copyImageReferenceToClipboard } from "../../services/image";
import { createImageSrcUrl } from "../../services/utils";
import { useTriliumEvent, useUniqueName } from "../react/hooks";
import { refToJQuerySelector } from "../react/react_utils";
import { TypeWidgetProps } from "./type_widget";

export default function Image({ note, ntxId }: TypeWidgetProps) {
    const uniqueId = useUniqueName("image");
    const containerRef = useRef<HTMLDivElement>(null);
    const [ refreshCounter, setRefreshCounter ] = useState(0);

    // Set up context menu
    useEffect(() => image_context_menu.setupContextMenu(refToJQuerySelector(containerRef)), []);

    // Copy reference events
    useTriliumEvent("copyImageReferenceToClipboard", ({ ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId) return;
        copyImageReferenceToClipboard(refToJQuerySelector(containerRef));
    });

    // React to new revisions.
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.isNoteReloaded(note.noteId)) {
            setRefreshCounter(refreshCounter + 1);
        }
    });

    return (
        <div ref={containerRef} className="note-detail-image-wrapper">
            <TransformWrapper
                initialScale={1}
                centerOnInit
            >
                <TransformComponent
                    wrapperStyle={{
                        width: "100%",
                        height: "100%"
                    }}
                >
                    <img
                        id={uniqueId}
                        className="note-detail-image-view"
                        src={createImageSrcUrl(note)}
                    />
                </TransformComponent>
            </TransformWrapper>
        </div>
    );
}
