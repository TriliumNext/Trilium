import "./Image.css";

import { useEffect, useRef } from "preact/hooks";

import image_context_menu from "../../menus/image_context_menu";
import { copyImageReferenceToClipboard } from "../../services/image";
import { createImageSrcUrl } from "../../services/utils";
import { useTriliumEvent } from "../react/hooks";
import { useImageNoteGallery } from "../react/media_viewer/gallery";
import MediaViewer from "../react/media_viewer/MediaViewer";
import { refToJQuerySelector } from "../react/react_utils";
import { TypeWidgetProps } from "./type_widget";

export default function Image({ note, ntxId, noteContext, isVisible }: TypeWidgetProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const hiddenImageCopyRef = useRef<HTMLDivElement>(null);
    const gallery = useImageNoteGallery(note, noteContext);
    // The widget instance persists across sibling navigation (type widgets are keyed by type), so
    // anything captured by mount-time closures must go through refs to see the current note.
    const galleryRef = useRef(gallery);
    galleryRef.current = gallery;

    // Copies a reference to the current image note: clean `<img>` markup that pastes into text
    // notes as an image reference (same hidden-wrapper technique as the floating/ribbon buttons).
    const copyReference = () => {
        const wrapper = hiddenImageCopyRef.current;
        if (!wrapper) return;
        const imageEl = document.createElement("img");
        imageEl.src = createImageSrcUrl(note, { versioned: false });
        wrapper.replaceChildren(imageEl);
        copyImageReferenceToClipboard(refToJQuerySelector(hiddenImageCopyRef));
        wrapper.removeChild(imageEl);
    };
    const copyReferenceRef = useRef(copyReference);
    copyReferenceRef.current = copyReference;

    useEffect(() => image_context_menu.setupContextMenu(refToJQuerySelector(containerRef), {
        getSrc: () => galleryRef.current.items[galleryRef.current.currentIndex]?.src,
        copyReference: () => copyReferenceRef.current()
    }), []);

    // The ribbon's "copy reference" button triggers this.
    useTriliumEvent("copyImageReferenceToClipboard", ({ ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId) return;
        copyReference();
    });

    return (
        <div ref={containerRef} className="note-detail-image-wrapper">
            <MediaViewer
                gallery={gallery}
                noteContext={noteContext}
                isVisible={isVisible}
                onCopyReference={copyReference}
            />
            <div ref={hiddenImageCopyRef} className="hidden-image-copy" />
        </div>
    );
}
