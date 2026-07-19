import "./MediaViewerToolbar.css";

import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";

import { t } from "../../../services/i18n";
import { copyImageToClipboard, downloadImage, isImageCopySupported } from "../../../services/image";
import openService from "../../../services/open";
import { isMobile } from "../../../services/utils";
import { useStaticTooltip } from "../hooks";
import type { MediaGallery } from "./gallery";
import type { MediaViewerApi } from "./MediaViewer";

/** Zoom step applied per zoom-in/out button click (relative Viewer.js ratio). */
const BUTTON_ZOOM_STEP = 0.5;

export interface MediaViewerToolbarProps {
    api: MediaViewerApi | null;
    gallery: MediaGallery;
    /** Native-relative zoom percentage of the current image (100 = actual pixels). */
    zoomPercent: number;
    fullscreen: boolean;
    /** Copy-reference needs the caller's DOM/clipboard context; when omitted the button is hidden. */
    onCopyReference?: () => void;
}

/**
 * The single control surface of the media viewer, replacing the previous scattered chrome (zoom
 * overlay + sibling navigator + ribbon-only actions): gallery navigation with a position counter,
 * the zoom/fit/rotate/flip cluster, and the file actions (download, copy, open externally),
 * ending with the fullscreen toggle. On mobile it reduces to navigation + fullscreen — pinch,
 * drag, swipe and double-tap cover the rest.
 */
export default function MediaViewerToolbar({ api, gallery, zoomPercent, fullscreen, onCopyReference }: MediaViewerToolbarProps) {
    const currentItem = gallery.items[gallery.currentIndex] ?? gallery.items[0];
    const multiImage = gallery.items.length > 1;
    const total = gallery.items.length;
    const position = Math.max(gallery.currentIndex, 0);
    const titleOf = (index: number) => gallery.items[((index % total) + total) % total]?.title ?? "";

    const galleryCluster = multiImage && (
        <div className="tn-overlay-control-group media-viewer-gallery-controls">
            <OverlayButton
                icon="bx-chevron-left"
                title={t("image_navigation.previous", { title: titleOf(position - 1) })}
                onClick={() => gallery.navigatePrevious()}
            />
            <button
                className="media-viewer-position tn-overlay-text-button"
                aria-label={t("media_viewer.image_position", { index: position + 1, total })}
                disabled
            >
                {position + 1}/{total}
            </button>
            <OverlayButton
                icon="bx-chevron-right"
                title={t("image_navigation.next", { title: titleOf(position + 1) })}
                onClick={() => gallery.navigateNext()}
            />
        </div>
    );

    const fullscreenButton = (
        <OverlayButton
            icon={fullscreen ? "bx-exit-fullscreen" : "bx-fullscreen"}
            title={fullscreen ? t("media_viewer.exit_fullscreen") : t("media_viewer.enter_fullscreen")}
            onClick={() => api?.toggleFullscreen()}
        />
    );

    if (isMobile()) {
        return (
            <div className="media-viewer-toolbar">
                {galleryCluster}
                <div className="tn-overlay-control-group">{fullscreenButton}</div>
            </div>
        );
    }

    return (
        <div className="media-viewer-toolbar">
            {galleryCluster}

            <div className="tn-overlay-control-group media-viewer-view-controls">
                <OverlayButton icon="bx-minus-circle" title={t("media_viewer.zoom_out")} onClick={() => api?.zoomBy(-BUTTON_ZOOM_STEP)} />
                <TextOverlayButton className="media-viewer-zoom-level" title={t("media_viewer.zoom_reset", { percent: zoomPercent })} onClick={() => api?.reset()}>
                    {zoomPercent}%
                </TextOverlayButton>
                <OverlayButton icon="bx-plus-circle" title={t("media_viewer.zoom_in")} onClick={() => api?.zoomBy(BUTTON_ZOOM_STEP)} />
                <OverlayButton icon="bx-expand" className="media-viewer-fit" title={t("media_viewer.fit_to_window")} onClick={() => api?.fitToWindow()} />
                <TextOverlayButton className="media-viewer-actual-size" title={t("media_viewer.actual_size")} onClick={() => api?.actualSize()}>
                    1:1
                </TextOverlayButton>
                <OverlayButton icon="bx-rotate-left" title={t("media_viewer.rotate_left")} onClick={() => api?.rotate(-90)} />
                <OverlayButton icon="bx-rotate-right" title={t("media_viewer.rotate_right")} onClick={() => api?.rotate(90)} />
                <OverlayButton icon="bx-reflect-vertical" className="media-viewer-flip" title={t("media_viewer.flip_horizontal")} onClick={() => api?.flipHorizontal()} />
            </div>

            <div className="tn-overlay-control-group media-viewer-file-controls">
                <OverlayButton
                    icon="bx-download"
                    title={t("media_viewer.download")}
                    onClick={() => { if (currentItem) void downloadImage(currentItem.src); }}
                />
                {isImageCopySupported() && (
                    <OverlayButton
                        icon="bx-copy"
                        className="media-viewer-copy-image"
                        title={t("media_viewer.copy_image")}
                        onClick={() => { if (currentItem) void copyImageToClipboard(currentItem.src); }}
                    />
                )}
                {onCopyReference && (
                    <OverlayButton
                        icon="bx-link"
                        className="media-viewer-copy-reference"
                        title={t("media_viewer.copy_reference")}
                        onClick={onCopyReference}
                    />
                )}
                <OverlayButton
                    icon="bx-window-open"
                    className="media-viewer-open-externally"
                    title={t("media_viewer.open_externally")}
                    onClick={() => {
                        if (!currentItem) return;
                        if (currentItem.kind === "note") void openService.openNoteExternally(currentItem.id, currentItem.mime);
                        else void openService.openAttachmentExternally(currentItem.id, currentItem.mime);
                    }}
                />
                {fullscreenButton}
            </div>
        </div>
    );
}

function OverlayButton({ icon, className, title, onClick }: { icon: string; className?: string; title: string; onClick: () => void }) {
    const ref = useRef<HTMLButtonElement>(null);
    useStaticTooltip(ref, { title, placement: "top" });
    return (
        <button
            ref={ref}
            type="button"
            className={`tn-overlay-icon-button bx ${icon}${className ? ` ${className}` : ""}`}
            aria-label={title}
            onClick={onClick}
        />
    );
}

function TextOverlayButton({ className, title, onClick, children }: { className: string; title: string; onClick: () => void; children: ComponentChildren }) {
    const ref = useRef<HTMLButtonElement>(null);
    useStaticTooltip(ref, { title, placement: "top" });
    return (
        <button ref={ref} type="button" className={`tn-overlay-text-button ${className}`} aria-label={title} onClick={onClick}>
            {children}
        </button>
    );
}
