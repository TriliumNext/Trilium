import { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

import { useColorScheme } from "./hooks";

interface IsolatedFrameProps {
    className?: string;
    /** Accessible title for the underlying `<iframe>`. */
    title: string;
    /** CSS injected into the isolated document's `<head>`. Kept in sync on change. */
    css?: string;
    /** Host `:root` CSS custom properties to mirror into the frame, so its CSS can use `var(...)`. Re-synced on theme change. */
    cssVars?: string[];
    /** Class name applied to the frame's `<body>`, e.g. to toggle a mode the injected CSS keys off. */
    bodyClassName?: string;
    children?: ComponentChildren;
}

/**
 * Renders its children inside a same-origin, `src`-less `<iframe>`, giving them a fully isolated
 * document: none of the host page's stylesheets, `@font-face` declarations or CSS classes leak in,
 * and nothing rendered here leaks out. Children are Preact nodes portalled into the frame's `<body>`,
 * so they stay live and interactive (re-render on prop changes) rather than being a static snapshot.
 *
 * Provide the frame's own styling via {@link IsolatedFrameProps.css}; theme values can be forwarded
 * with {@link IsolatedFrameProps.cssVars}. Because the document has no base URL, any URLs referenced
 * from that CSS must be absolute.
 */
export default function IsolatedFrame({ className, title, css, cssVars, bodyClassName, children }: IsolatedFrameProps) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [ body, setBody ] = useState<HTMLElement | null>(null);
    const colorScheme = useColorScheme();

    // A same-origin, src-less iframe exposes an empty document synchronously once mounted; re-capture
    // on load in case the browser swaps the initial about:blank document.
    const captureBody = () => {
        const nextBody = iframeRef.current?.contentDocument?.body;
        if (nextBody) setBody(nextBody);
    };
    useLayoutEffect(captureBody, []);

    // `colorScheme` is not read directly — it re-runs this effect so mirrored vars pick up the new theme.
    useLayoutEffect(() => {
        const doc = body?.ownerDocument;
        if (!doc) return;
        let style = doc.getElementById("isolated-frame-style") as HTMLStyleElement | null;
        if (!style) {
            style = doc.createElement("style");
            style.id = "isolated-frame-style";
            doc.head.appendChild(style);
        }
        // Forward the app's color scheme so the frame's UA-painted elements (scrollbars, form
        // controls) match the theme instead of defaulting to light.
        style.textContent = `:root { color-scheme: ${colorScheme}; }\n${buildRootVars(cssVars)}${css ?? ""}`;
    }, [ css, cssVars, colorScheme, body ]);

    useLayoutEffect(() => {
        if (body) body.className = bodyClassName ?? "";
    }, [ bodyClassName, body ]);

    return (
        <>
            <iframe ref={iframeRef} className={className} title={title} onLoad={captureBody} />
            {body && createPortal(children, body)}
        </>
    );
}

/** Reads the named custom properties off the host's `:root` and emits a `:root { ... }` block for the frame. */
function buildRootVars(names: string[] | undefined): string {
    if (!names?.length) return "";
    const hostStyle = getComputedStyle(document.documentElement);
    const declarations = names
        .map((name) => [ name, hostStyle.getPropertyValue(name).trim() ] as const)
        .filter(([ , value ]) => value)
        .map(([ name, value ]) => `${name}: ${value};`)
        .join(" ");
    return declarations ? `:root { ${declarations} }\n` : "";
}
