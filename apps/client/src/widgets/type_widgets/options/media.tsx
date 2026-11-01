import "./media.css";

import type { ImageJpegHandling, ImagePngHandling } from "@triliumnext/commons";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { isElectron, isStandalone } from "../../../services/utils";
import {
    AUTOMATIC_IMAGE_COMPRESSION_DEFAULTS,
    type ImageCompressionToolOptions,
    readImageCompressionOptions
} from "../../dialogs/image_compression/image_compression_options";
import {
    type ImageCompressionSectionProps,
    JpegHandlingSection,
    PngHandlingSection,
    ResizeImageSection
} from "../../dialogs/image_compression/image_compression_sections";
import Button from "../../react/Button";
import { Card, OptionCardSection } from "../../react/Card";
import FormToggle from "../../react/FormToggle";
import HelpButton from "../../react/HelpButton";
import { useTriliumOption, useTriliumOptionBool, useTriliumOptionInt } from "../../react/hooks";
import Slider from "../../react/Slider";
import OptionsPageHeader from "./components/OptionsPageHeader";
import RelatedSettings from "./components/RelatedSettings";

export default function MediaSettings() {
    return (
        <>
            <OptionsPageHeader />
            <ImageSettings />
            <OcrSettings />
        </>
    );
}

/**
 * What happens to an image on its way in: whether one only referenced is fetched at all, and what
 * is done to the ones that arrive. Compression is part of the same card rather than a heading of
 * its own, being one more thing that happens to an arriving image rather than a subject beside it.
 *
 * The compression rows are the ones the compression tool is built from, because behind them it is
 * now the same compression. The one thing said here that the tool never has to say is *when* any of
 * it happens: on upload, on paste, on import. The descriptions are the ones the settings carried
 * before they were rows — a settings page is read by someone deciding, where a dialog is read by
 * someone who has already decided, so here the prose is on the page rather than behind the help
 * marks the dialogs use.
 */
function ImageSettings() {
    const [ downloadImagesAutomatically, setDownloadImagesAutomatically ] =
        useTriliumOptionBool("downloadImagesAutomatically");
    const [ compressImages, setCompressImages ] = useTriliumOptionBool("compressImages");
    const [ options, update ] = useAutomaticCompressionOptions();
    const sectionProps: ImageCompressionSectionProps = {
        options,
        onChange: update,
        disabled: !compressImages,
        descriptions: {
            resize: t("images.max_image_dimensions_description"),
            quality: t("images.jpeg_quality_description"),
            conversionQuality: t("images.jpeg_quality_description")
        }
    };

    return (
        <Card className="media-images" heading={t("images.images_section_title")}>
            <OptionCardSection
                name="download-images-automatically"
                label={t("images.download_images_automatically")}
                description={t("images.download_images_description")}
            >
                <FormToggle
                    currentValue={downloadImagesAutomatically}
                    onChange={setDownloadImagesAutomatically}
                />
            </OptionCardSection>

            {/* Not the tool's own "Compress images": that is something the user does to images
                already stored, where this is a standing instruction about every image still to
                arrive. Saying which is which is the whole of the label. */}
            <OptionCardSection
                name="compress-images"
                label={t("images.automatic_image_compression")}
                description={t("images.enable_image_compression_description")}
                subSectionsVisible={compressImages}
                subSections={[
                    <ResizeImageSection key="resize" {...sectionProps} />,
                    <JpegHandlingSection key="jpeg" {...sectionProps} />,
                    <PngHandlingSection key="png" {...sectionProps} />
                ]}
            >
                <FormToggle currentValue={compressImages} onChange={setCompressImages} />
            </OptionCardSection>
        </Card>
    );
}

/**
 * The image options, read and written as one set of compression settings.
 *
 * Each is its own synced option rather than a blob, as they always were — an install that has only
 * ever had a bound and a quality keeps them, and a client too old to know the rest still reads the
 * two it does. The adapter is what lets the tool's rows drive them: those rows speak in whole
 * settings objects, and this turns a patch of one back into the writes it stands for.
 */
function useAutomaticCompressionOptions(): [ ImageCompressionToolOptions, (patch: Partial<ImageCompressionToolOptions>) => void ] {
    const [ maxWidthHeight, setMaxWidthHeight ] = useTriliumOptionInt("imageMaxWidthHeight");
    const [ quality, setQuality ] = useTriliumOptionInt("imageJpegQuality");
    const [ conversionQuality, setConversionQuality ] = useTriliumOptionInt("imageConversionQuality");
    const [ resize, setResize ] = useTriliumOptionBool("imageResize");
    const [ jpegHandling, setJpegHandling ] = useTriliumOption("imageJpegHandling");
    const [ pngHandling, setPngHandling ] = useTriliumOption("imagePngHandling");

    const options = readImageCompressionOptions({
        resize,
        maxWidthHeight,
        quality,
        conversionQuality,
        jpegHandling: jpegHandling as ImageJpegHandling,
        pngHandling: pngHandling as ImagePngHandling,
        // Automatic compression reaches every image that arrives; there is no subtree to choose,
        // and no row here offers one. Held only because the rows share one settings type.
        processChildNotes: false
    }, AUTOMATIC_IMAGE_COMPRESSION_DEFAULTS);

    // Each write is left to settle on its own: a row changes one setting, the option is saved, and
    // nothing here waits on the round trip — the control already shows the new value.
    return [ options, (patch) => {
        if (patch.resize !== undefined) void setResize(patch.resize);
        if (patch.maxWidthHeight !== undefined) void setMaxWidthHeight(patch.maxWidthHeight);
        if (patch.quality !== undefined) void setQuality(patch.quality);
        if (patch.conversionQuality !== undefined) void setConversionQuality(patch.conversionQuality);
        if (patch.jpegHandling !== undefined) void setJpegHandling(patch.jpegHandling);
        if (patch.pngHandling !== undefined) void setPngHandling(patch.pngHandling);
    } ];
}

function OcrSettings() {
    const [ ocrAutoProcess, setOcrAutoProcess ] = useTriliumOptionBool("ocrAutoProcessImages");
    const [ ocrMinConfidence, setOcrMinConfidence ] = useTriliumOption("ocrMinConfidence");
    const confidence = Math.round(parseFloat(ocrMinConfidence ?? "0.75") * 100);

    return (
        <>
            <Card className="media-ocr"
                heading={t("images.ocr_section_title")}
                actions={<HelpButton helpPage="TiQbQDgP8L5t" />}
            >
                <OptionCardSection
                    name="ocr-auto-process"
                    label={t("images.ocr_auto_process")}
                    description={t("images.ocr_auto_process_description")}
                >
                    <FormToggle currentValue={ocrAutoProcess} onChange={setOcrAutoProcess} />
                </OptionCardSection>

                <OptionCardSection
                    name="ocr-min-confidence"
                    label={`${t("images.ocr_min_confidence")} (${confidence}%)`}
                    description={t("images.ocr_confidence_description")}
                >
                    <Slider
                        min={0} max={100} step={5}
                        value={confidence}
                        onChange={(value) => setOcrMinConfidence(String(value / 100))}
                    />
                </OptionCardSection>

                {/* Running OCR needs the engine the server holds; a standalone client only ever
                    reads text extracted elsewhere and synced to it. */}
                {!isStandalone && <BatchProcessing />}
            </Card>

            <RelatedSettings items={[
                {
                    title: t("images.ocr_related_content_languages"),
                    targetPage: "_optionsLocalization",
                    enabled: isElectron(), // This setting is only relevant for desktop, as web browsers use their own native OCR which doesn't support language selection.
                }
            ]} />
        </>
    );
}

interface BatchProgress {
    inProgress: boolean;
    total: number;
    processed: number;
    failed: number;
    percentage?: number;
}

function BatchProcessing() {
    const [ progress, setProgress ] = useState<BatchProgress | null>(null);
    const pollingRef = useRef<ReturnType<typeof setInterval>>(null);

    const pollProgress = useCallback(() => {
        server.get<BatchProgress>("ocr/batch-progress").then((data) => {
            setProgress(data);
            if (!data.inProgress && pollingRef.current) {
                clearInterval(pollingRef.current);
                pollingRef.current = null;
                if (data.failed > 0) {
                    toast.showError(t("images.batch_ocr_completed_with_failures", { processed: data.processed, failed: data.failed }));
                } else {
                    toast.showMessage(t("images.batch_ocr_completed", { processed: data.processed }));
                }
            }
        });
    }, []);

    // Clean up polling on unmount.
    useEffect(() => {
        return () => {
            if (pollingRef.current) {
                clearInterval(pollingRef.current);
            }
        };
    }, []);

    async function startBatch() {
        try {
            const result = await server.post<{ success: boolean; message?: string }>("ocr/batch-process");
            if (result.success) {
                toast.showMessage(t("images.batch_ocr_starting"));
                pollingRef.current = setInterval(pollProgress, 2000);
                pollProgress();
            } else {
                toast.showError(result.message || t("images.batch_ocr_error", { error: "Unknown" }));
            }
        } catch {
            // Server errors are already shown as toasts by server.ts.
        }
    }

    const isRunning = progress?.inProgress ?? false;

    return (
        <OptionCardSection
            className="media-batch-ocr"
            label={t("images.batch_ocr_title")}
            description={t("images.batch_ocr_description")}
        >
            {isRunning ? (
                <div className="progress media-batch-ocr-progress">
                    <div
                        className="progress-bar progress-bar-striped progress-bar-animated"
                        role="progressbar"
                        style={{ width: `${progress?.percentage ?? 0}%` }}
                    >
                        {t("images.batch_ocr_progress", { processed: progress?.processed ?? 0, total: progress?.total ?? 0 })}
                    </div>
                </div>
            ) : (
                <Button
                    name="batch-ocr-start-button"
                    text={t("images.batch_ocr_start")}
                    icon="bx-play"
                    size="micro"
                    onClick={startBatch}
                />
            )}
        </OptionCardSection>
    );
}
