import { RefObject } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import svgPanZoom from "svg-pan-zoom";

import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import utils from "../../../services/utils";
import { useElementSize, useTriliumEvent } from "../../react/hooks";
import OverlayControlGroup, { OverlayControlButton } from "../../react/OverlayControlGroup";
import { RawHtmlBlock } from "../../react/RawHtml";
import SplitEditor, { SplitEditorProps } from "./SplitEditor";

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
    const [ svg, setSvg ] = useState<string>();
    const [ error, setError ] = useState<string | null | undefined>();
    const containerRef = useRef<HTMLDivElement>(null);

    // Reset the render state when switching notes so a previous note's render (and the
    // "showing last valid render" badge) can't briefly carry over to a different note.
    useEffect(() => {
        setSvg(undefined);
        setError(undefined);
    }, [ note.noteId ]);

    // Render the SVG.
    async function onContentChanged(content: string) {
        try {
            const svg = await renderSvg(content);

            // Rendering was successful.
            setError(null);
            setSvg(svg);
        } catch (e) {
            // Rendering failed.
            setError((e as Error)?.message);
        }
    }

    // Save as attachment.
    const onSave = useCallback(() => {
        if (!svg) return; // Don't save if SVG hasn't been rendered yet

        const payload = {
            role: "image",
            title: attachmentTitle,
            mime: "image/svg+xml",
            content: svg,
            position: 0
        };

        server.post(`notes/${note.noteId}/attachments?matchBy=title`, payload);
    }, [ svg, attachmentTitle, note.noteId ]);

    // Save the SVG when entering a note only when it does not have an attachment.
    useEffect(() => {
        if (!svg) return; // Wait until SVG is rendered

        note?.getAttachments().then((attachments) => {
            if (!attachments.find((a) => a.title === attachmentTitle)) {
                onSave();
            }
        }).catch(e => console.error("Failed to get attachments for SVGSplitEditor", e));
    }, [ note, svg, attachmentTitle, onSave ]);

    // Import/export. The renderer's `svg` string is exported rather than the on-screen element,
    // which svg-pan-zoom has wrapped in a viewport transform reflecting the current pan/zoom.
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

    // Pan & zoom.
    const panZoom = useResizer(containerRef, note.noteId, svg);

    return (
        <SplitEditor
            className="svg-editor"
            note={note} ntxId={ntxId}
            error={error}
            previewStale={!!svg}
            onContentChanged={onContentChanged}
            dataSaved={onSave}
            placeholder={t("mermaid.placeholder")}
            previewContent={(
                <RawHtmlBlock
                    className="render-container"
                    containerRef={containerRef}
                    html={svg}
                />
            )}
            previewButtons={<PreviewControls panZoom={panZoom} />}
            {...props}
        />
    );
}

/**
 * How far in and out the rendered diagram may be taken, as a multiple of the view it opened at —
 * svg-pan-zoom's own defaults, said here so that the steps and the library agree on where the ends
 * are rather than one of them finding out by being clamped.
 */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 10;
/**
 * How near an end counts as being at it: the library clamps a step to the limit as an absolute scale,
 * and the trip back through the fitted scale can leave the readout a hair short of the round number.
 */
const ZOOM_LIMIT_TOLERANCE = 1e-6;

/**
 * The controls standing in the corner of a rendered diagram: how close in it is drawn, and the way
 * back to the view it opened at.
 *
 * They stand on the {@link OverlayControlGroup} the image viewer's zoom buttons stand on (see
 * {@link ImageViewer}), as the two maps' controls do, in place of the three floating buttons that
 * were here before. The readout between the steps says the scale the way the image viewer's does — a
 * hundred being the diagram at the size it was fitted to the pane at — and pressed, fits and centers
 * it there again, which is all the button wearing a crop mark used to do.
 *
 * Kept on mobile, unlike the image viewer's and the maps' steps: a pinch does nothing here — the
 * library follows a finger for panning and takes a double tap for a zoom in, and knows no pinch at
 * all — so the steps are the only way to settle on a scale. Absent until there is something to zoom,
 * an empty or not-yet-rendered diagram having no view to speak of.
 */
function PreviewControls({ panZoom }: { panZoom: SvgPanZoom.Instance | undefined }) {
    const zoom = usePanZoomScale(panZoom);

    if (!panZoom) return null;

    return (
        <OverlayControlGroup className="svg-preview-controls" placement="bottom-end">
            <OverlayControlButton
                title={t("svg.zoom_out")}
                icon="bx-minus-circle"
                disabled={zoom <= MIN_ZOOM * (1 + ZOOM_LIMIT_TOLERANCE)}
                onClick={() => panZoom.zoomOut()}
            />
            <OverlayControlButton
                title={t("svg.reset_zoom")}
                text={`${Math.round(zoom * 100)}%`}
                onClick={() => panZoom.fit().center()}
            />
            <OverlayControlButton
                title={t("svg.zoom_in")}
                icon="bx-plus-circle"
                disabled={zoom >= MAX_ZOOM * (1 - ZOOM_LIMIT_TOLERANCE)}
                onClick={() => panZoom.zoomIn()}
            />
        </OverlayControlGroup>
    );
}

/**
 * The scale the diagram is drawn at, followed as it changes — by these buttons, by the wheel, or by
 * the diagram being fitted afresh. It is told as a multiple of the fitted view rather than of the
 * diagram's own coordinates, which is what makes a hundred mean the view the pane opened at.
 *
 * Nothing is unsubscribed on the way out: what stops the reports is the instance being destroyed by
 * the hook that made it, which drops the callback along with the rest of its options.
 */
function usePanZoomScale(panZoom: SvgPanZoom.Instance | undefined) {
    const [ zoom, setZoom ] = useState(1);

    useEffect(() => {
        if (!panZoom) return;

        // It is fitted as it is built, and may have been moved again before being listened to.
        setZoom(panZoom.getZoom());
        panZoom.setOnZoom(setZoom);
    }, [ panZoom ]);

    return zoom;
}

/**
 * Sets the rendered diagram up to be panned and zoomed, and hands the instance driving it back so
 * that the controls over it can drive it too — as state rather than as the ref the effects here
 * keep, so that the controls are drawn afresh when the diagram is fitted anew under a different
 * instance.
 */
function useResizer(containerRef: RefObject<HTMLDivElement>, noteId: string, svg: string | undefined) {
    const lastPanZoom = useRef<{ pan: SvgPanZoom.Point, zoom: number }>();
    const lastNoteId = useRef<string>();
    const wasEmpty = useRef<boolean>(false);
    const zoomRef = useRef<SvgPanZoom.Instance>();
    const [ panZoom, setPanZoom ] = useState<SvgPanZoom.Instance>();
    const width = useElementSize(containerRef);

    // Set up pan & zoom.
    useEffect(() => {
        if (zoomRef.current || width?.width === 0) return;

        const shouldPreservePanZoom = (lastNoteId.current === noteId) && !wasEmpty.current;
        const svgEl = containerRef.current?.querySelector("svg");
        if (!svgEl) {
            if (svg?.trim().length === 0) {
                wasEmpty.current = true;
            }
            return;
        };

        // svg-pan-zoom strips the SVG's viewBox attribute on init and never restores it on
        // destroy(), so a re-init (e.g. triggered by a `width` change below) would otherwise
        // fit from `getBBox()` instead. For mermaid gantt diagrams the bounding box is inflated
        // by an off-screen "today" marker, which makes the re-fit shrink the chart to invisibility
        // (issue #9749). Save it here and restore it in the cleanup below.
        const viewBox = svgEl.getAttribute("viewBox");

        const zoomInstance = svgPanZoom(svgEl, {
            zoomEnabled: true,
            controlIconsEnabled: false,
            minZoom: MIN_ZOOM,
            maxZoom: MAX_ZOOM
        });

        // Restore the previous pan/zoom if the user updates same note.
        if (shouldPreservePanZoom && lastPanZoom.current) {
            zoomInstance.zoom(lastPanZoom.current.zoom);
            zoomInstance.pan(lastPanZoom.current.pan);
        } else {
            zoomInstance.resize().center().fit();
        }

        lastNoteId.current = noteId;
        zoomRef.current = zoomInstance;
        setPanZoom(zoomInstance);

        return () => {
            lastPanZoom.current = {
                pan: zoomInstance.getPan(),
                zoom: zoomInstance.getZoom()
            };
            zoomRef.current = undefined;
            setPanZoom(undefined);
            zoomInstance.destroy();
            if (viewBox !== null) {
                svgEl.setAttribute("viewBox", viewBox);
            }
        };
    }, [ containerRef, noteId, svg, width ]);

    // React to container changes.
    useEffect(() => {
        if (!zoomRef.current || (width?.width ?? 0) < 1) return;
        zoomRef.current.resize().fit().center();
    }, [ width ]);

    return panZoom;
}
