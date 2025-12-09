import { useEffect, useRef, useState } from "preact/hooks";
import { createImageSrcUrl } from "../../services/utils";
import { useTriliumEvent, useUniqueName } from "../react/hooks";
import "./Image.css";
import { TypeWidgetProps } from "./type_widget";
import WheelZoom from 'vanilla-js-wheel-zoom';
import image_context_menu from "../../menus/image_context_menu";
import { refToJQuerySelector } from "../react/react_utils";
import { copyImageReferenceToClipboard } from "../../services/image";

export default function Image({ note, ntxId }: TypeWidgetProps) {
    const uniqueId = useUniqueName("image");
    const containerRef = useRef<HTMLDivElement>(null);
    const [ refreshCounter, setRefreshCounter ] = useState(0);

    // Set up pan & zoom
    useEffect(() => {
        const zoomInstance = WheelZoom.create(`#${uniqueId}`, {
            maxScale: 50,
            speed: 1.3,
            zoomOnClick: false
        });

        return () => zoomInstance.destroy();
    }, [ note ]);

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
            <img
                id={uniqueId}
                className="note-detail-image-view"
                src={createImageSrcUrl(note)}
            />
        </div>
    )
}
