import { ComponentChildren, HTMLAttributes, JSX, RefObject, render } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import { useSyncedRef } from "./hooks";

interface ShadowDomProps extends Omit<HTMLAttributes<HTMLDivElement>, "ref"> {
    children: ComponentChildren;
    containerRef?: RefObject<HTMLDivElement | null>;
}

export default function ShadowDom({ children, containerRef: externalContainerRef, ...containerProps }: ShadowDomProps) {
    const containerRef = useSyncedRef<HTMLDivElement>(externalContainerRef, null);
    const [ shadowRoot, setShadowRoot ] = useState<ShadowRoot | null>(null);

    // Create the shadow root.
    useLayoutEffect(() => {
        if (!containerRef.current) return;
        const shadow = containerRef.current.attachShadow({ mode: "open" });
        setShadowRoot(shadow);
    }, []);

    // Render the child elements. A layout effect, so the shadow tree commits before the paint
    // together with the tree around it, as a portal from that tree into the shadow tree expects.
    useLayoutEffect(() => {
        if (!shadowRoot) return;
        render(<>{children}</>, shadowRoot);
    }, [ shadowRoot, children ]);

    // The shadow tree is a separate render, which unmounting this component does not unmount.
    useLayoutEffect(() => {
        if (!shadowRoot) return;
        return () => render(null, shadowRoot);
    }, [ shadowRoot ]);

    return <div ref={containerRef} {...containerProps} />
}
