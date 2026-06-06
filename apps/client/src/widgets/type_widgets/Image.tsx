import "./Image.css";

import { useEffect, useRef, useState } from "preact/hooks";

import image_context_menu from "../../menus/image_context_menu";
import { copyImageReferenceToClipboard } from "../../services/image";
import { createImageSrcUrl } from "../../services/utils";
import { useTriliumEvent } from "../react/hooks";
import ImageViewer from "../react/ImageViewer";
import { refToJQuerySelector } from "../react/react_utils";
import SiblingNavigator from "../react/SiblingNavigator";
import { TypeWidgetProps } from "./type_widget";

// In addition to PageUp/PageDown, the image viewer navigates with Backspace (previous) and Space (next).
const IMAGE_PREVIOUS_KEYS = [ "Backspace" ];
const IMAGE_NEXT_KEYS = [ "Space" ];

export default function Image({ note, ntxId, noteContext }: TypeWidgetProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [ refreshCounter, setRefreshCounter ] = useState(0);

    useEffect(() => image_context_menu.setupContextMenu(refToJQuerySelector(containerRef)), []);

    // The ribbon's "copy reference" button triggers this. Select the rendered image's wrapper so
    // the clipboard gets clean <img> markup without the surrounding zoom/transform containers.
    useTriliumEvent("copyImageReferenceToClipboard", ({ ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId) return;
        const $img = refToJQuerySelector(containerRef).find("img");
        if ($img.length) copyImageReferenceToClipboard($img.parent());
    });

    // A new revision swaps the image content; remount so it re-fits to the viewport.
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.isNoteReloaded(note.noteId)) {
            setRefreshCounter((c) => c + 1);
        }
    });

    return (
        <div ref={containerRef} className="note-detail-image-wrapper">
            <ImageViewer
                key={`${note.noteId}-${refreshCounter}`}
                imgClassName="note-detail-image-view"
                src={createImageSrcUrl(note)}
                alt={note.title}
            />
            <SiblingNavigator
                note={note}
                noteContext={noteContext}
                previousTooltipI18nKey="image_navigation.previous"
                nextTooltipI18nKey="image_navigation.next"
                extraPreviousKeys={IMAGE_PREVIOUS_KEYS}
                extraNextKeys={IMAGE_NEXT_KEYS}
            />
        </div>
    );
}
