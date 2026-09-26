import "./lightbox.css";

import { useState } from "preact/hooks";

import { t } from "../../services/i18n";
import { useTriliumEvent } from "../react/hooks";
import ImageViewer from "../react/ImageViewer";
import Modal from "../react/Modal";
import { ZOOM_PAN_HINTS } from "../react/zoom_pan_keyboard";
import PdfViewer from "../type_widgets/file/PdfViewer";

export interface LightboxOptions {
    /**
     * The URL of the file to show. For a PDF it must be root-relative, as `getPdfUrl()` returns it,
     * because the viewer resolves relative URLs against its own directory.
     */
    src: string;
    /** Defaults to `"image"`. */
    kind?: "image" | "pdf";
    /** Shown in the dialog header and used as an image's alt text. */
    title?: string;
}

/**
 * Shows a single image or PDF in a modal: an image zoomable and pannable through {@link ImageViewer},
 * a PDF read-only in {@link PdfViewer}. Summon it from anywhere with
 * `appContext.triggerEvent("showLightbox", { src, kind, title })`.
 */
export default function LightboxDialog() {
    const [ opts, setOpts ] = useState<LightboxOptions>();
    const [ shown, setShown ] = useState(false);

    useTriliumEvent("showLightbox", (opts) => {
        setOpts(opts);
        setShown(true);
    });

    const kind = opts?.kind ?? "image";
    const title = opts?.title || t(`lightbox.${kind}`);

    return (
        <Modal
            className="lightbox-dialog"
            size="xl"
            title={title}
            show={shown}
            onHidden={() => setShown(false)}
            isFullPageOnMobile
            customTitleBarButtons={[ opts ? {
                title: t("lightbox.open_original"),
                iconClassName: "bx-link-external",
                onClick: () => window.open(opts.src, "_blank", "noopener,noreferrer")
            } : null ]}
        >
            {shown && opts && (kind === "pdf"
                ? <PdfViewer pdfUrl={opts.src} />
                : <ImageViewer src={opts.src} alt={title} shortcutHints={ZOOM_PAN_HINTS} />
            )}
        </Modal>
    );
}
