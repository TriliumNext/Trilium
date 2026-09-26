import "./image_lightbox.css";

import { useState } from "preact/hooks";

import { t } from "../../services/i18n";
import { useTriliumEvent } from "../react/hooks";
import ImageViewer from "../react/ImageViewer";
import Modal from "../react/Modal";
import { ZOOM_PAN_HINTS } from "../react/zoom_pan_keyboard";

export interface ImageLightboxOptions {
    /** The URL of the image to show. */
    src: string;
    /** Shown in the dialog header and used as the image's alt text. */
    title?: string;
}

/**
 * Shows a single image in a modal, zoomable and pannable through {@link ImageViewer}. Summon it from
 * anywhere with `appContext.triggerEvent("showImageLightbox", { src, title })`.
 */
export default function ImageLightboxDialog() {
    const [ opts, setOpts ] = useState<ImageLightboxOptions>();
    const [ shown, setShown ] = useState(false);

    useTriliumEvent("showImageLightbox", (opts) => {
        setOpts(opts);
        setShown(true);
    });

    const title = opts?.title || t("image_viewer.lightbox_title");

    return (
        <Modal
            className="image-lightbox-dialog"
            size="xl"
            title={title}
            show={shown}
            onHidden={() => setShown(false)}
            isFullPageOnMobile
            customTitleBarButtons={[ opts ? {
                title: t("image_viewer.open_original"),
                iconClassName: "bx-link-external",
                onClick: () => window.open(opts.src, "_blank", "noopener,noreferrer")
            } : null ]}
        >
            {shown && opts && (
                <ImageViewer src={opts.src} alt={title} shortcutHints={ZOOM_PAN_HINTS} />
            )}
        </Modal>
    );
}
