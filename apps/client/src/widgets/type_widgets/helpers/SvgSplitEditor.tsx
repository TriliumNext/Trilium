import { RefObject } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import svgPanZoom from "svg-pan-zoom";

import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import utils from "../../../services/utils";
import { useElementSize, useTriliumEvent } from "../../react/hooks";
import { RawHtmlBlock } from "../../react/RawHtml";
import SplitEditor, { PreviewButton, SplitEditorProps } from "./SplitEditor";

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
    const zoomRef = useResizer(containerRef, note.noteId, svg);

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
    );
}

function useResizer(containerRef: RefObject<HTMLDivElement>, noteId: string, svg: string | undefined) {
    const lastPanZoom = useRef<{ pan: SvgPanZoom.Point, zoom: number }>();
    const lastNoteId = useRef<string>();
    const wasEmpty = useRef<boolean>(false);
    const zoomRef = useRef<SvgPanZoom.Instance>();
    const resizeTimerRef = useRef<ReturnType<typeof setTimeout>>();
    const width = useElementSize(containerRef);

    // Set up pan & zoom.
    useEffect(() => {
        if (zoomRef.current || (containerRef.current?.offsetWidth ?? 0) === 0) return;

        const shouldPreservePanZoom = (lastNoteId.current === noteId) && !wasEmpty.current;
        const svgEl = containerRef.current?.querySelector("svg");
        if (!svgEl) {
            if (svg?.trim().length === 0) {
                wasEmpty.current = true;
            }
            return;
        };

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
            };
            zoomRef.current = undefined;
            zoomInstance.destroy();
        };
    }, [ containerRef, noteId, svg ]);

    // React to container changes.
    useEffect(() => {
        if (!zoomRef.current || (width?.width ?? 0) < 1) return;
        clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = setTimeout(() => {
            zoomRef.current?.resize().fit().center();
        }, 100);
        return () => clearTimeout(resizeTimerRef.current);
    }, [ width ]);

    return zoomRef;
}
