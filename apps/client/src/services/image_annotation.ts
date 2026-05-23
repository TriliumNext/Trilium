import { h, render } from "preact";

import FAttachment from "../entities/fattachment";
import type FNote from "../entities/fnote";
import { AnnotationOverlay } from "./image_annotation_overlay";

export interface AnnotationOptions {
    entity: FNote | FAttachment;
    imageUrl: string;
    onSaved?: (newUrl: string) => void;
}

export function openAnnotationOverlay({ entity, imageUrl, onSaved }: AnnotationOptions): void {
    const mountNode = document.createElement("div");
    document.body.appendChild(mountNode);

    const handleClose = () => {
        render(null, mountNode);
        mountNode.remove();
    };

    render(
        h(AnnotationOverlay, { entity, imageUrl, onClose: handleClose, onSaved }),
        mountNode
    );
}
