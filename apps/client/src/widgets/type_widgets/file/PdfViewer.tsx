import "./PdfViewer.css";

import type { PdfReadingPosition } from "@triliumnext/commons/src/lib/pdf_toc.js";
import type { HTMLAttributes, RefObject } from "preact";
import { useCallback, useEffect, useRef } from "preact/hooks";

import { onEffectiveThemeStyleChange } from "../../../services/theme";
import { useSyncedRef } from "../../react/hooks/dom";
import { useTriliumOption } from "../../react/hooks/options";
import type { ClientTocBuild } from "../../sidebar/CachedToCProvider";
import { useTocBuild } from "./toc_build";

interface FontDefinition {
    name: string;
    /** Path under the client's `fonts` directory, resolved by {@link getFontFaceCss}. */
    path: string;
}

const FONTS: FontDefinition[] = [
    {name: "Inter", path: "Inter/Inter-VariableFont_opsz,wght.woff2"},
];

/** A place in a PDF that a link opens it at. */
export interface PdfLinkTarget {
    page?: number;
    /** The id of a heading of the ToC cache. */
    heading?: string;
    annotation?: string;
}

/** Where a viewer reads: its reading position and the effective rotation of each page. */
export interface PdfReading {
    position: PdfReadingPosition | null;
    /** The effective rotation of each page, by page index. */
    rotations: number[];
}

/** The ToC cache of the document that a viewer builds where the server cannot read PDFs. */
export interface PdfTocDocument {
    /** The ToC route of the document, such as `attachments/abc/toc`. */
    tocUrl: string;
    isProtected: boolean;
}

interface PdfViewerProps extends Pick<HTMLAttributes<HTMLIFrameElement>, "tabIndex"> {
    iframeRef?: RefObject<HTMLIFrameElement | null>;
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
    /**
     * The note and note context the viewer addresses its messages to. They travel in the URL so
     * that messages posted before the frame's `load` event carry them too.
     */
    noteId?: string;
    ntxId?: string | null;
    /** Names the navigation of the frame: every message of the load includes it. */
    loadToken?: string;
    /** Called when the viewer of the load `loadToken` has loaded its document. */
    onDocumentLoaded?(): void;
    /** Called when the viewer of the load `loadToken` cannot load its document. */
    onDocumentError?(): void;
    /** Called with the build of `tocDocument` whenever its status or its ready cache changes. */
    onTocBuild?(build: ClientTocBuild): void;
    /** Called with where the viewer of the load `loadToken` reads, as it changes. */
    onReadingChange?(reading: PdfReading): void;
    /**
     * The place that the viewer opens at. Each target object is posted once: when the frame has
     * loaded, or at once for a target given later.
     */
    target?: PdfLinkTarget;
    /** The cache that the viewer builds. A PDF note builds its own, with its saves. */
    tocDocument?: PdfTocDocument;
}

/**
 * Reusable component displaying a PDF. The PDF needs to be provided via a URL.
 */
export default function PdfViewer({
    iframeRef: externalIframeRef, pdfUrl, onLoad, editable, toolbar = true, disableSelection,
    minPixelRatio, noteId, ntxId, loadToken, target, tocDocument, onDocumentLoaded,
    onDocumentError, onTocBuild, onReadingChange
}: PdfViewerProps) {
    const iframeRef = useSyncedRef(externalIframeRef, null);
    const [ locale ] = useTriliumOption("locale");
    const injectStyles = useStyleInjection(iframeRef, disableSelection);
    const showTarget = useTargetPosting(iframeRef, target);
    const tocBuild = useOwnTocBuild(iframeRef, tocDocument, onTocBuild);
    useLoadReports(iframeRef, loadToken, {
        onDocumentLoaded,
        onDocumentError() {
            tocBuild.onLoadError();
            onDocumentError?.();
        },
        onReadingChange
    });

    const src = `pdfjs/web/viewer.html?v=${glob.triliumVersion}&file=${pdfUrl}&locale=${locale}`
        + `&sidebar=0&editable=${editable ? "1" : "0"}&toolbar=${toolbar ? "1" : "0"}`
        + (minPixelRatio ? `&minPixelRatio=${minPixelRatio}` : "")
        + (noteId ? getAddressParams(noteId, ntxId) : "")
        + (onReadingChange ? "&position=1" : "")
        + (loadToken ? `&loadToken=${encodeURIComponent(loadToken)}` : "");

    return (
        <iframe
            ref={iframeRef}
            class="pdf-preview"
            src={src}
            onLoad={() => {
                injectStyles();
                showTarget();
                tocBuild.requestBuild();
                onLoad?.();
            }}
        />
    );
}

/**
 * Posts `target` to the viewer once the frame has loaded, and each later target once. Returns
 * what the frame calls when it loads.
 */
function useTargetPosting(
    iframeRef: RefObject<HTMLIFrameElement | null>, target: PdfLinkTarget | undefined
) {
    const isLoadedRef = useRef(false);
    const postedRef = useRef<PdfLinkTarget | undefined>(undefined);

    function post() {
        const frameWindow = iframeRef.current?.contentWindow;
        if (!isLoadedRef.current || !target || postedRef.current === target || !frameWindow) return;
        postedRef.current = target;
        const { page, heading, annotation } = target;
        frameWindow.postMessage(heading
            ? { type: "trilium-scroll-to-heading", headingId: heading, pageNumber: page }
            : { type: "trilium-scroll-to-annotation", annotationId: annotation, pageNumber: page },
        window.location.origin);
    }

    useEffect(post, [ target ]);
    return () => {
        isLoadedRef.current = true;
        post();
    };
}

/**
 * Builds the ToC cache of `tocDocument` when the viewer has loaded it, and saves the answers that
 * this frame sends. `onTocBuild` receives the build as it changes. Returns what the frame calls
 * when it loads, and when its document fails to load.
 */
function useOwnTocBuild(
    iframeRef: RefObject<HTMLIFrameElement | null>, tocDocument: PdfTocDocument | undefined,
    onTocBuild: ((build: ClientTocBuild) => void) | undefined
) {
    const { clientBuild, version, onLoad, onLoadError, saveBuild } = useTocBuild(iframeRef,
        tocDocument?.tocUrl ?? "", tocDocument?.isProtected ?? false);

    useEffect(() => {
        if (!tocDocument) return;
        function onMessage(event: MessageEvent) {
            const isOwnAnswer = event.source === iframeRef.current?.contentWindow
                && event.data?.type === "pdfjs-viewer-toc-build";
            if (isOwnAnswer) void saveBuild(event.data);
        }
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [ tocDocument ]);

    useEffect(() => {
        if (tocDocument) {
            onTocBuild?.(clientBuild);
        }
    }, [ version, tocDocument ]);

    return {
        requestBuild() {
            if (tocDocument) onLoad();
        },
        onLoadError() {
            if (tocDocument) onLoadError();
        }
    };
}

/**
 * Calls `onDocumentLoaded`, `onDocumentError` and `onReadingChange` for the messages of the load
 * `loadToken` that the frame in `iframeRef` posts.
 */
function useLoadReports(
    iframeRef: RefObject<HTMLIFrameElement | null>, loadToken: string | undefined,
    reports: {
        onDocumentLoaded?(): void;
        onDocumentError(): void;
        onReadingChange?(reading: PdfReading): void;
    }
) {
    const reportsRef = useRef(reports);
    reportsRef.current = reports;

    useEffect(() => {
        if (!loadToken) return;
        const reading: PdfReading = { position: null, rotations: [] };
        function onMessage(event: MessageEvent) {
            if (event.source !== iframeRef.current?.contentWindow
                || event.data?.loadToken !== loadToken) {
                return;
            }
            if (event.data.type === "pdfjs-viewer-document-loaded") {
                reportsRef.current.onDocumentLoaded?.();
            } else if (event.data.type === "pdfjs-viewer-document-error") {
                reportsRef.current.onDocumentError();
            } else if (applyReadingMessage(reading, event.data)) {
                reportsRef.current.onReadingChange?.({
                    position: reading.position, rotations: [ ...reading.rotations ]
                });
            }
        }
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [ loadToken ]);
}

/** Applies the message `data` to `reading`, and returns whether it is a reading message. */
export function applyReadingMessage(reading: PdfReading, data: PdfMessageEvent["data"]) {
    switch (data.type) {
        case "pdfjs-viewer-position":
            reading.position = { pageNumber: data.pageNumber, x: data.x, y: data.y };
            return true;
        case "pdfjs-viewer-rotations":
            reading.rotations = [ ...data.rotations ];
            return true;
        case "pdfjs-viewer-page-rotation":
            reading.rotations[data.pageNumber - 1] = data.rotation;
            return true;
        default:
            return false;
    }
}

let loadCounter = 0;

/** A token for a new navigation of a viewer's frame, which no other load of the page has. */
export function nextPdfLoadToken() {
    return String(++loadCounter);
}

function getAddressParams(noteId: string, ntxId: string | null | undefined) {
    return `&noteId=${encodeURIComponent(noteId)}${ntxId ? `&ntxId=${encodeURIComponent(ntxId)}` : ""}`;
}

function useStyleInjection(
    iframeRef: RefObject<HTMLIFrameElement | null>,
    disableSelection?: boolean
) {
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

        return onEffectiveThemeStyleChange(listener);
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
