import type { HTMLAttributes, RefObject } from "preact";
import { useCallback, useEffect, useRef } from "preact/hooks";

import { useSyncedRef, useTriliumOption, useTriliumOptionBool } from "../../react/hooks";

interface FontDefinition {
    name: string;
    /** Path under the client's `fonts` directory, resolved by {@link getFontFaceCss}. */
    path: string;
}

const FONTS: FontDefinition[] = [
    {name: "Inter", path: "Inter/Inter-VariableFont_opsz,wght.woff2"},
];

interface PdfViewerProps extends Pick<HTMLAttributes<HTMLIFrameElement>, "tabIndex"> {
    iframeRef?: RefObject<HTMLIFrameElement>;
    /** Relative URLs resolve against /pdfjs/web; build API paths with {@link getPdfUrl} instead. */
    pdfUrl: string;
    onLoad?(): void;
    /**
     * If set, enables editable mode which includes persistence of user settings, annotations as well as specific features such as sending table of contents data for the sidebar.
     */
    editable?: boolean;
    /** If set, hides the toolbar. Defaults to `true` (visible). */
    toolbar?: boolean;
    /** If set, disables text selection in the rendered PDF. */
    disableSelection?: boolean;
    /**
     * Forces the rendered pages to use at least this device-pixel-ratio when rasterizing to canvas.
     * On standard-DPI displays (DPR 1) PDF.js renders at 1× and text/headings look coarsely
     * anti-aliased; raising this supersamples the canvas (mimicking a high-DPI screen) for a
     * crisper preview. Has no effect when the real DPR already meets or exceeds this value.
     */
    minPixelRatio?: number;
}

/**
 * Reusable component displaying a PDF. The PDF needs to be provided via a URL.
 */
export default function PdfViewer({ iframeRef: externalIframeRef, pdfUrl, onLoad, editable, toolbar = true, disableSelection, minPixelRatio }: PdfViewerProps) {
    const iframeRef = useSyncedRef(externalIframeRef, null);
    const [ locale ] = useTriliumOption("locale");
    const [ newLayout ] = useTriliumOptionBool("newLayout");
    const injectStyles = useStyleInjection(iframeRef, disableSelection);

    return (
        <iframe
            ref={iframeRef}
            class="pdf-preview"
            style={{width: "100%", height: "100%"}}
            src={`pdfjs/web/viewer.html?v=${glob.triliumVersion}&file=${pdfUrl}&locale=${locale}&sidebar=${newLayout ? "0" : "1"}&editable=${editable ? "1" : "0"}&toolbar=${toolbar ? "1" : "0"}${minPixelRatio ? `&minPixelRatio=${minPixelRatio}` : ""}`}
            onLoad={() => {
                injectStyles();
                onLoad?.();
            }}
        />
    );
}

function useStyleInjection(iframeRef: RefObject<HTMLIFrameElement>, disableSelection?: boolean) {
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

        const fontStyles = doc.createElement("style");
        fontStyles.textContent = getFontFaceCss();
        doc.head.appendChild(fontStyles);

        if (disableSelection) {
            const selectionStyles = doc.createElement("style");
            selectionStyles.textContent = `.textLayer, .textLayer * { user-select: none !important; cursor: default !important; }`;
            doc.head.appendChild(selectionStyles);
        }

    }, [ iframeRef, disableSelection ]);

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
        if (prop.startsWith('--')) {
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

/**
 * Resolves an API path such as `attachments/<id>/open` to a root-relative URL for
 * {@link PdfViewerProps.pdfUrl}.
 */
export function getPdfUrl(apiPath: string) {
    return resolveFromDeployment(`${window.glob.baseApiUrl}${apiPath}`);
}

/**
 * The `@font-face` rules injected into the viewer, so its chrome matches the app's typography.
 * Each face points at the copy `viteStaticCopy` ships, which is the one `theme-next/base.css`
 * loads, so the page and the viewer share a single cache entry.
 */
export function getFontFaceCss() {
    return FONTS.map(({ name, path }) => {
        const url = resolveFromDeployment(`${window.glob.assetPath}/fonts/${path}`);

        return `
        @font-face {
            font-family: '${name}';
            src: url('${url}');
        }
    `;
    }).join("\n");
}

/**
 * Resolves a URL against the deployment root rather than the viewer. A URL relative to the viewer
 * needs `../../` to climb out of /pdfjs/web, which proxies that filter path traversal reject before
 * the request reaches Trilium (Nginx Proxy Manager's "Block Common Exploits" answers 403). See #8877.
 */
function resolveFromDeployment(url: string) {
    return new URL(url, window.location.href).pathname;
}
