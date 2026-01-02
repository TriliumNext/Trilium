import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { t } from "../../../services/i18n";
import SplitEditor, { PreviewButton, SplitEditorProps } from "./SplitEditor";
import { RawHtmlBlock } from "../../react/RawHtml";
import server from "../../../services/server";
import svgPanZoom from "svg-pan-zoom";
import { RefObject } from "preact";
import { useElementSize, useTriliumEvent } from "../../react/hooks";
import utils from "../../../services/utils";
import toast from "../../../services/toast";

interface SvgSplitEditorProps extends Omit<SplitEditorProps, "previewContent"> {
    /**
     * The name of the note attachment (without .svg extension) that will be used for storing the preview.
     */
    attachmentName: string;
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
export default function SvgSplitEditor({ ntxId, note, attachmentName, renderSvg, ...props }: SvgSplitEditorProps) {
    const [ svg, setSvg ] = useState<string>();
    const [ error, setError ] = useState<string | null | undefined>();
    const containerRef = useRef<HTMLDivElement>(null);

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
            title: `${attachmentName}.svg`,
            mime: "image/svg+xml",
            content: svg,
            position: 0
        };

        server.post(`notes/${note.noteId}/attachments?matchBy=title`, payload);
    }, [ svg, attachmentName, note.noteId ]);

    // Save the SVG when entering a note only when it does not have an attachment.
    useEffect(() => {
        if (!svg) return; // Wait until SVG is rendered

        note?.getAttachments().then((attachments) => {
            if (!attachments.find((a) => a.title === `${attachmentName}.svg`)) {
                onSave();
            }
        }).catch(e => console.error("Failed to get attachments for SVGSplitEditor", e));
    }, [ note, svg, attachmentName, onSave ]);

    // Import/export
    useTriliumEvent("exportSvg", async({ ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId || !svg) return;

        try {
            const svgEl = containerRef.current?.querySelector("svg");
            if (!svgEl) throw new Error("SVG element not found");
            await utils.downloadAsSvg(note.title, svgEl);
        } catch (e) {
            console.warn(e);
            toast.showError(t("svg.export_to_svg"));
        }
    });

    useTriliumEvent("exportPng", async ({ ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId || !svg) return;
        try {
            const svgEl = containerRef.current?.querySelector("svg");
            if (!svgEl) throw new Error("SVG element not found");
            await utils.downloadAsPng(note.title, svgEl);
        } catch (e) {
            console.warn(e);
            toast.showError(t("svg.export_to_png"));
        }
    });

    // Pan & zoom.
    const zoomRef = useResizer(containerRef, note.noteId, svg);

    return (
        <SplitEditor
            className="svg-editor"
            note={note} ntxId={ntxId}
            error={error}
            onContentChanged={onContentChanged}
            dataSaved={onSave}
            previewContent={(
                <RawHtmlBlock
                    className="render-container"
                    containerRef={containerRef}
                    html={svg}
                />
            )}
            previewButtons={
                <>
                    <PreviewButton
                        icon="bx bx-zoom-in"
                        text={t("relation_map_buttons.zoom_in_title")}
                        onClick={() => zoomRef.current?.zoomIn()}
                    />
                    <PreviewButton
                        icon="bx bx-zoom-out"
                        text={t("relation_map_buttons.zoom_out_title")}
                        onClick={() => zoomRef.current?.zoomOut()}
                    />
                    <PreviewButton
                        icon="bx bx-crop"
                        text={t("relation_map_buttons.reset_pan_zoom_title")}
                        onClick={() => zoomRef.current?.fit().center()}
                    />
                </>
            }
            {...props}
        />
    )
}

function useResizer(containerRef: RefObject<HTMLDivElement>, noteId: string, svg: string | undefined) {
    const lastPanZoom = useRef<{ pan: SvgPanZoom.Point, zoom: number }>();
    const lastNoteId = useRef<string>();
    const zoomRef = useRef<SvgPanZoom.Instance>();
    const width = useElementSize(containerRef);

    // Set up pan & zoom.
    useEffect(() => {
        if (zoomRef.current || width?.width === 0) return;

        const shouldPreservePanZoom = (lastNoteId.current === noteId);
        const svgEl = containerRef.current?.querySelector("svg");
        if (!svgEl) return;

        const zoomInstance = svgPanZoom(svgEl, {
            zoomEnabled: true,
            controlIconsEnabled: false
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

        return () => {
            lastPanZoom.current = {
                pan: zoomInstance.getPan(),
                zoom: zoomInstance.getZoom()
            }
            zoomRef.current = undefined;
            zoomInstance.destroy();
        };
    }, [ svg, width ]);

    // React to container changes.
    useEffect(() => {
        if (!zoomRef.current || (width?.width ?? 0) < 1) return;
        zoomRef.current.resize().fit().center();
    }, [ width ]);

    return zoomRef;
}
