import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { isElectron } from "../../../services/utils";
import { FormTextBoxWithUnit } from "../../react/FormTextBox";
import { useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import Slider from "../../react/Slider";
import OptionsRow, { OptionsRowWithToggle } from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";
import RelatedSettings from "./components/RelatedSettings";

export default function MediaSettings() {
    return (
        <>
            <ImageSettings />
            <OcrSettings />
        </>
    );
}

function ImageSettings() {
    const [ downloadImagesAutomatically, setDownloadImagesAutomatically ] = useTriliumOptionBool("downloadImagesAutomatically");
    const [ compressImages, setCompressImages ] = useTriliumOptionBool("compressImages");
    const [ imageMaxWidthHeight, setImageMaxWidthHeight ] = useTriliumOption("imageMaxWidthHeight");
    const [ imageJpegQuality, setImageJpegQuality ] = useTriliumOption("imageJpegQuality");

    return (
        <OptionsSection title={t("images.images_section_title")}>
            <OptionsRowWithToggle
                name="download-images-automatically"
                label={t("images.download_images_automatically")}
                description={t("images.download_images_description")}
                currentValue={downloadImagesAutomatically}
                onChange={setDownloadImagesAutomatically}
            />

            <OptionsRowWithToggle
                name="image-compression-enabled"
                label={t("images.enable_image_compression")}
                description={t("images.enable_image_compression_description")}
                currentValue={compressImages}
                onChange={setCompressImages}
            />

            <OptionsRow name="image-max-width-height" label={t("images.max_image_dimensions")} description={t("images.max_image_dimensions_description")}>
                <FormTextBoxWithUnit
                    type="number" min="1"
                    disabled={!compressImages}
                    unit={t("images.max_image_dimensions_unit")}
                    currentValue={imageMaxWidthHeight} onChange={setImageMaxWidthHeight}
                />
            </OptionsRow>

            <OptionsRow name="image-jpeg-quality" label={`${t("images.jpeg_quality")} (${imageJpegQuality ?? 75}%)`} description={t("images.jpeg_quality_description")}>
                <Slider
                    min={10} max={100} step={5}
                    value={parseInt(imageJpegQuality ?? "75", 10)}
                    onChange={(v) => setImageJpegQuality(String(v))}
                />
            </OptionsRow>
        </OptionsSection>
    );
}

function OcrSettings() {
    const [ ocrAutoProcess, setOcrAutoProcess ] = useTriliumOptionBool("ocrAutoProcessImages");
    const [ ocrMinConfidence, setOcrMinConfidence ] = useTriliumOption("ocrMinConfidence");

    return (
        <>
            <OptionsSection title={t("images.ocr_section_title")}>
                <OptionsRowWithToggle
                    name="ocr-auto-process"
                    label={t("images.ocr_auto_process")}
                    description={t("images.ocr_auto_process_description")}
                    currentValue={ocrAutoProcess}
                    onChange={setOcrAutoProcess}
                />

                <OptionsRow name="ocr-min-confidence" label={`${t("images.ocr_min_confidence")} (${Math.round(parseFloat(ocrMinConfidence ?? "0.75") * 100)}%)`} description={t("images.ocr_confidence_description")}>
                    <Slider
                        min={0} max={100} step={5}
                        value={Math.round(parseFloat(ocrMinConfidence ?? "0.75") * 100)}
                        onChange={(v) => setOcrMinConfidence(String(v / 100))}
                    />
                </OptionsRow>

                <BatchProcessing />
            </OptionsSection>

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
                toast.showMessage(t("images.batch_ocr_completed", { processed: data.processed }));
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
        <OptionsRow name="batch-ocr" label={t("images.batch_ocr_title")} description={t("images.batch_ocr_description")}>
            {isRunning ? (
                <div style={{ width: "100%" }}>
                    <div className="progress" style={{ height: "24px" }}>
                        <div
                            className="progress-bar progress-bar-striped progress-bar-animated"
                            role="progressbar"
                            style={{ width: `${progress?.percentage ?? 0}%` }}
                        >
                            {t("images.batch_ocr_progress", { processed: progress?.processed ?? 0, total: progress?.total ?? 0 })}
                        </div>
                    </div>
                </div>
            ) : (
                <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={startBatch}
                >
                    <span className="bx bx-play" />{" "}{t("images.batch_ocr_start")}
                </button>
            )}
        </OptionsRow>
    );
}
