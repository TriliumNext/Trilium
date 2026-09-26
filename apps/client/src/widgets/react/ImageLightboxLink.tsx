import type { ComponentChildren, TargetedMouseEvent } from "preact";

import appContext from "../../components/app_context";

interface ImageLightboxLinkProps {
    /** The URL of the full-size image, opened in the lightbox and used as the link's `href`. */
    src: string;
    /** The image's name, shown in the lightbox header and as the link's tooltip. */
    title?: string;
    className?: string;
    children: ComponentChildren;
}

/**
 * Wraps an image preview so that a click opens `src` in the image lightbox dialog. A click with a
 * modifier key, or a middle click, goes on to `goToLink()` in `services/link.ts`, which opens the raw
 * image in a new tab.
 */
export default function ImageLightboxLink({ src, title, className, children }: ImageLightboxLinkProps) {
    function onClick(e: TargetedMouseEvent<HTMLAnchorElement>) {
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        stopLinkNavigation(e);
        appContext.triggerEvent("showImageLightbox", { src, title });
    }

    return (
        <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className={className}
            title={title}
            onClick={onClick}
            onDblClick={stopLinkNavigation}
        >
            {children}
        </a>
    );
}

/** Keeps the event from the browser and from `goToLink()`, which listens on the document. */
function stopLinkNavigation(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
}
