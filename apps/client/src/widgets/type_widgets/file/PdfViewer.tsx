import type { HTMLAttributes, RefObject } from "preact";
import { useCallback, useEffect, useRef } from "preact/hooks";

import { useSyncedRef, useTriliumOption, useTriliumOptionBool } from "../../react/hooks";

const VARIABLE_WHITELIST = new Set([
    "root-background",
    "main-background-color",
    "main-border-color",
    "main-text-color"
]);

interface PdfViewerProps extends Pick<HTMLAttributes<HTMLIFrameElement>, "tabIndex"> {
    iframeRef?: RefObject<HTMLIFrameElement>;
    /** Note: URLs are relative to /pdfjs/web. */
    pdfUrl: string;
    onLoad?(): void;
    /**
     * If set, enables editable mode which includes persistence of user settings, annotations as well as specific features such as sending table of contents data for the sidebar.
     */
    editable?: boolean;
}

/**
 * Reusable component displaying a PDF. The PDF needs to be provided via a URL.
 */
export default function PdfViewer({ iframeRef: externalIframeRef, pdfUrl, onLoad, editable }: PdfViewerProps) {
    const iframeRef = useSyncedRef(externalIframeRef, null);
    const [ locale ] = useTriliumOption("locale");
    const [ newLayout ] = useTriliumOptionBool("newLayout");
    const injectStyles = useStyleInjection(iframeRef);

    return (
        <iframe
            ref={iframeRef}
            class="pdf-preview"
            src={`pdfjs/web/viewer.html?file=${pdfUrl}&lang=${locale}&sidebar=${newLayout ? "0" : "1"}&editable=${editable ? "1" : "0"}`}
            onLoad={() => {
                injectStyles();
                onLoad?.();
            }}
        />
    );
}

function useStyleInjection(iframeRef: RefObject<HTMLIFrameElement>) {
    const styleRef = useRef<HTMLStyleElement | null>(null);

    // First load.
    const onLoad = useCallback(() => {
        const doc = iframeRef.current?.contentDocument;
        if (!doc) return;

        const style = doc.createElement('style');
        style.id = 'client-root-vars';
        style.textContent = cssVarsToString(getRootCssVariables());
        styleRef.current = style;

        doc.head.appendChild(style);
    }, [ iframeRef ]);

    // React to changes.
    useEffect(() => {
        const listener = () => {
            styleRef.current!.textContent = cssVarsToString(getRootCssVariables());
        };

        const media = window.matchMedia("(prefers-color-scheme: dark)");
        media.addEventListener("change", listener);
        return () => media.removeEventListener("change", listener);
    }, [ iframeRef ]);

    return onLoad;
}

function getRootCssVariables() {
    const styles = getComputedStyle(document.documentElement);
    const vars: Record<string, string> = {};

    for (let i = 0; i < styles.length; i++) {
        const prop = styles[i];
        if (prop.startsWith('--') && VARIABLE_WHITELIST.has(prop.substring(2))) {
            vars[`--tn-${prop.substring(2)}`] = styles.getPropertyValue(prop).trim();
        }
    }

    return vars;
}

function cssVarsToString(vars: Record<string, string>) {
    return `:root {\n${Object.entries(vars)
        .map(([k, v]) => `  ${k}: ${v};`)
        .join('\n')}\n}`;
}
