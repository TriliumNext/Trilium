import type { ComponentChildren, Ref } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";

import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import utils, { isMobile } from "../../../services/utils";
import { useContextualShortcutHints, useEffectiveReadOnly, useNoteLabel, useTriliumEvent } from "../../react/hooks";
import OverlayControlGroup, { ZoomControls } from "../../react/OverlayControlGroup";
import { RawHtmlBlock } from "../../react/RawHtml";
import { useZoomPanPinch, useZoomPanWheel } from "../../react/zoom_pan";
import { useZoomPanKeyboard, ZOOM_PAN_HINTS, ZOOM_PAN_VIEWPORT_CLASS } from "../../react/zoom_pan_keyboard";
import { ShortcutHintOverlayButton } from "../../shortcut_hints/shortcut_hint_button";
import SplitEditor, { SplitEditorProps } from "./SplitEditor";
import { resolveDisplayMode } from "./split_editor_mode";

/** How long the rendered SVG stays the same before it is saved, in ms. */
const SVG_SAVE_DELAY = 500;
/** The picture of a note without content. */
const EMPTY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"></svg>`;

interface SvgSplitEditorProps extends Omit<SplitEditorProps, "previewContent"> {
    /**
     * The title of the note attachment used for storing the preview, extension included. Take it from
     * `NOTE_TYPE_IMAGE_ATTACHMENTS` so that the `api/images` endpoints can find it again.
     */
    attachmentTitle: string;
    /**
     * Called upon when the SVG preview needs refreshing, such as when the editor has switched to a new note or the content has switched.
     *
     * The method must return a valid SVG string that will be automatically displayed in the preview.
     *
     * @param content the content of the note, in plain text.
     */
    renderSvg(content: string): string | Promise<string>;
}

/**
 * A specialization of `SplitTypeWidget` meant for note types that have a SVG preview.
 *
 * This adds the following functionality:
 *
 * - Automatic handling of the preview when content or the note changes via {@link renderSvg}.
 * - Built-in pan and zoom functionality with automatic re-centering.
 * - Automatically displays errors to the user if {@link renderSvg} failed.
 * - Automatically saves the SVG attachment.
 *
 */
export default function SvgSplitEditor({ ntxId, note, attachmentTitle, renderSvg, ...props }: SvgSplitEditorProps) {
    const { svg, error, render, reset } = useSvgRender(renderSvg);
    const zoom = useSvgZoom(note.noteId);
    const [ previewEl, setPreviewEl ] = useState<HTMLDivElement | null>(null);

    // Wire the keys in every display mode: without a pointer there is no other way to pan the
    // diagram. Source-only mounts no preview, so it registers no hints for it.
    const [ displayMode ] = useNoteLabel(note, "displayMode");
    const readOnly = useEffectiveReadOnly(note, props.noteContext);
    const mode = resolveDisplayMode(displayMode, readOnly);
    useZoomPanKeyboard(zoom.ref, previewEl);
    useZoomPanWheel(zoom.ref, previewEl);
    useContextualShortcutHints(mode !== "source" ? ZOOM_PAN_HINTS : []);

    // The SVG that the attachment holds, as far as the editor knows: the first one rendered for the
    // note, which the attachment was saved from, then each one saved.
    const savedSvgRef = useRef<string | undefined>(undefined);

    // Reset the render state when switching notes so a previous note's render (and the
    // "showing last valid render" badge) can't briefly carry over to a different note.
    useEffect(() => {
        reset();
        savedSvgRef.current = undefined;
    }, [ note.noteId ]);

    const saveSvg = useCallback((toSave: string) => {
        if (toSave === savedSvgRef.current) return;
        savedSvgRef.current = toSave;
        server.post(`notes/${note.noteId}/attachments?matchBy=title`, {
            role: "image",
            title: attachmentTitle,
            mime: "image/svg+xml",
            content: toSave || EMPTY_SVG,
            position: 0
        });
    }, [ attachmentTitle, note.noteId ]);

    // A save of the note saves the SVG at once, which also covers a save as the editor closes.
    const onSave = useCallback(() => {
        if (svg !== undefined) saveSvg(svg);
    }, [ svg, saveSvg ]);

    // The SVG also changes with content that the editor does not save, such as a sample diagram
    // written to the note, so each SVG that differs from the attachment's is saved once it settles.
    useEffect(() => {
        if (svg === undefined) return;
        if (savedSvgRef.current === undefined) {
            savedSvgRef.current = svg;
            // A note made before its pictures were saved has no attachment yet.
            note.getAttachments().then((attachments) => {
                if (!attachments.some((a) => a.title === attachmentTitle)) {
                    savedSvgRef.current = undefined;
                    saveSvg(svg);
                }
            }).catch(e => console.error("Failed to get attachments for SVGSplitEditor", e));
            return;
        }
        if (readOnly || svg === savedSvgRef.current) return;
        const timer = setTimeout(() => saveSvg(svg), SVG_SAVE_DELAY);
        return () => clearTimeout(timer);
    }, [ svg ]);

    // Import/export. Exports the `svg` string from `renderSvg()` rather than the on-screen element,
    // which CSS has sized to the preview pane.
    useTriliumEvent("exportSvg", ({ ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId || !svg) return;

        try {
            utils.downloadSvg(note.title, svg);
        } catch (e) {
            console.warn(e);
            toast.showError(t("svg.export_to_svg"));
        }
    });

    useTriliumEvent("exportPng", async ({ ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId || !svg) return;
        try {
            await utils.downloadSvgAsPng(note.title, svg);
        } catch (e) {
            console.warn(e);
            toast.showError(t("svg.export_to_png"));
        }
    });

    return (
        <SplitEditor
            className="svg-editor"
            note={note} ntxId={ntxId}
            error={error}
            previewStale={!!svg}
            onContentChanged={render}
            dataSaved={onSave}
            placeholder={t("mermaid.placeholder")}
            previewContent={(
                // The transform sits on an ancestor of the diagram, so it survives a re-render of
                // the same note. Keying it on the note drops it when a different one opens.
                <SvgPreview key={note.noteId} svg={svg} zoom={zoom} viewportRef={setPreviewEl} />
            )}
            previewButtons={!!svg && (
                <SvgZoomControls zoom={zoom}>
                    {/* At the leading end of the group rather than in the corner opposite, which the
                        render-error card spans the full width of. */}
                    {!isMobile() && <ShortcutHintOverlayButton />}
                </SvgZoomControls>
            )}
            {...props}
        />
    );
}

/**
 * The SVG that `renderSvg` makes of the content passed to `render()`. While the content fails to
 * render, `error` holds why and `svg` keeps the last SVG that rendered. Only the latest
 * `render()` call updates them.
 */
export function useSvgRender(renderSvg: (content: string) => string | Promise<string>) {
    const [ svg, setSvg ] = useState<string>();
    const [ error, setError ] = useState<string | null | undefined>();
    const latestRender = useRef(0);

    const render = useCallback(async (content: string) => {
        const id = ++latestRender.current;
        try {
            const rendered = await renderSvg(content);
            if (id !== latestRender.current) return;
            setError(null);
            setSvg(rendered);
        } catch (e) {
            if (id !== latestRender.current) return;
            setError((e as Error)?.message ?? String(e));
        }
    }, [ renderSvg ]);

    const reset = useCallback(() => {
        setSvg(undefined);
        setError(undefined);
    }, []);

    return { svg, error, render, reset };
}

export type SvgZoom = ReturnType<typeof useSvgZoom>;

/** The zoom of an {@link SvgPreview}, reset when `resetOn` changes. */
export function useSvgZoom(resetOn?: unknown) {
    return useZoomPanPinch({ minScale: MIN_ZOOM, maxScale: MAX_ZOOM, resetOn });
}

/** The SVG in a pan/zoom viewer, which CSS fits to the preview pane at a scale of 1. */
export function SvgPreview({ svg, zoom, viewportRef }: {
    svg: string | undefined;
    zoom: SvgZoom;
    /** Receives the focusable viewer, for the keyboard and wheel zoom. */
    viewportRef: Ref<HTMLDivElement>;
}) {
    return (
        <div
            ref={viewportRef}
            tabIndex={0}
            role="group"
            aria-label={t("svg.preview")}
            className={`svg-preview-root ${ZOOM_PAN_VIEWPORT_CLASS}`}
        >
            <TransformWrapper
                ref={zoom.ref}
                minScale={MIN_ZOOM}
                maxScale={MAX_ZOOM}
                centerOnInit
                centerZoomedOut
                wheel={zoom.wheel}
                doubleClick={{ mode: "reset" }}
                onTransform={zoom.onTransform}
            >
                <TransformComponent wrapperClass="svg-preview-viewport" contentClass="svg-preview-content">
                    <RawHtmlBlock className="render-container" html={svg} />
                </TransformComponent>
            </TransformWrapper>
        </div>
    );
}

/** The zoom buttons over an {@link SvgPreview}, between `children` and `after`. */
export function SvgZoomControls({ zoom, children, after }: {
    zoom: SvgZoom;
    children?: ComponentChildren;
    after?: ComponentChildren;
}) {
    return (
        <OverlayControlGroup className="svg-preview-controls" placement="bottom-end">
            {children}
            <ZoomControls
                percent={zoom.scale * 100}
                canZoomIn={zoom.canZoomIn}
                canZoomOut={zoom.canZoomOut}
                onZoomIn={zoom.zoomIn}
                onZoomOut={zoom.zoomOut}
                onReset={zoom.reset}
            />
            {after}
        </OverlayControlGroup>
    );
}

/**
 * Zoom bounds, as a multiple of the fitted view.
 *
 * CSS fits the SVG to the preview pane through its `viewBox` and `preserveAspectRatio` (see the SVG
 * section of SplitEditor.css), so a scale of 1 is already that fitted view and these bounds need no
 * measurement.
 */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 10;
