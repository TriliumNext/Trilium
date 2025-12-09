import { ComponentChildren, HTMLAttributes, JSX, RefObject, render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { useSyncedRef } from "./hooks";

interface ShadowDomProps extends Omit<HTMLAttributes<HTMLDivElement>, "ref"> {
    children: ComponentChildren;
    containerRef?: RefObject<HTMLDivElement>;
}

export default function ShadowDom({ children, containerRef: externalContainerRef, ...containerProps }: ShadowDomProps) {
    const containerRef = useSyncedRef<HTMLDivElement>(externalContainerRef, null);
    const [ shadowRoot, setShadowRoot ] = useState<ShadowRoot | null>(null);

    // Create the shadow root.
    useEffect(() => {
        if (!containerRef.current) return;
        const shadow = containerRef.current.attachShadow({ mode: "open" });
        setShadowRoot(shadow);
    }, []);

    // Render the child elements.
    useEffect(() => {
        if (!shadowRoot) return;
        render(<>{children}</>, shadowRoot);
    }, [ shadowRoot, children ]);

    return <div ref={containerRef} {...containerProps} />
}
