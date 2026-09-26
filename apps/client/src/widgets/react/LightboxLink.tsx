import type { ComponentChildren, TargetedMouseEvent } from "preact";

import appContext from "../../components/app_context";
import type { LightboxOptions } from "../dialogs/lightbox";

interface LightboxLinkProps {
    /** What the lightbox shows; its `title` is also the link's tooltip. */
    lightbox: LightboxOptions;
    /** Where a modified or middle click goes. Defaults to `lightbox.src`. */
    href?: string;
    className?: string;
    children: ComponentChildren;
}

/**
 * Wraps a preview of an image or PDF so that a click opens it in the lightbox dialog. A click with a
 * modifier key, or a middle click, goes on to `goToLink()` in `services/link.ts`, which opens `href`
 * in a new tab.
 */
export default function LightboxLink({ lightbox, href = lightbox.src, className, children }: LightboxLinkProps) {
    function onClick(e: TargetedMouseEvent<HTMLAnchorElement>) {
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        stopLinkNavigation(e);
        appContext.triggerEvent("showLightbox", lightbox);
    }

    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={className}
            title={lightbox.title}
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
