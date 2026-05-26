import "./ocr_text.css";

import type { OCRProcessResponse, TextRepresentationResponse } from "@triliumnext/commons";
import { useEffect, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import { copyTextWithToast } from "../../services/clipboard_ext";
import { t } from "../../services/i18n";
import server from "../../services/server";
import toast from "../../services/toast";
import { randomString } from "../../services/utils";
import Button from "../react/Button";
import { useTriliumEvent } from "../react/hooks";
import Modal from "../react/Modal";

type State =
    | { kind: "loading" }
    | { kind: "loaded"; text: string }
    | { kind: "empty" }
    | { kind: "error"; message: string };

interface TextRepresentationProps {
    /** The API path to fetch OCR text from (e.g. `ocr/notes/{id}/text`). */
    textUrl: string;
    /** The API path to trigger OCR processing (e.g. `ocr/process-note/{id}`). */
    processUrl: string;
}

export default function OcrTextDialog() {
    const [ shown, setShown ] = useState(false);
    const [ textUrl, setTextUrl ] = useState("");
    const [ processUrl, setProcessUrl ] = useState("");

    useTriliumEvent("showOcrTextDialog", ({ textUrl, processUrl }) => {
        setTextUrl(textUrl);
        setProcessUrl(processUrl);
        setShown(true);
    });

    return shown && (
        <TextRepresentationModal
            textUrl={textUrl}
            processUrl={processUrl}
            onHidden={() => setShown(false)}
        />
    );
}

interface TextRepresentationModalProps extends TextRepresentationProps {
    onHidden: () => void;
}

function TextRepresentationModal({ textUrl, processUrl, onHidden }: TextRepresentationModalProps) {
    const [ state, setState ] = useState<State>({ kind: "loading" });
    const [ processing, setProcessing ] = useState(false);

    async function fetchText() {
        setState({ kind: "loading" });

        try {
            const response = await server.get<TextRepresentationResponse>(textUrl);

            if (!response.success) {
                setState({ kind: "error", message: response.message || t("ocr.failed_to_load") });
                return;
            }

            if (!response.hasOcr || !response.text) {
                setState({ kind: "empty" });
                return;
            }

            setState({ kind: "loaded", text: response.text });
        } catch (error: any) {
            console.error("Error loading text representation:", error);
            setState({ kind: "error", message: error.message || t("ocr.failed_to_load") });
        }
    }

    useEffect(() => { fetchText(); }, [ textUrl ]);

    async function processOCR() {
        setProcessing(true);
        try {
            const response = await server.post<OCRProcessResponse>(processUrl, { forceReprocess: true });
            if (response.success) {
                const result = response.result;
                const minConfidence = response.minConfidence ?? 0;

                // Check if this is an image-based PDF (no text extracted)
                if (result && !result.text && result.processingType === 'pdf') {
                    toast.showPersistent({
                        id: `ocr-pdf-unsupported-${randomString(8)}`,
                        icon: "bx bx-info-circle",
                        message: t("ocr.image_based_pdf_not_supported"),
                        timeout: 15000
                    });
                // Check if text was filtered due to low confidence
                } else if (result && !result.text && result.confidence > 0 && minConfidence > 0) {
                    const confidencePercent = Math.round(result.confidence * 100);
                    const thresholdPercent = Math.round(minConfidence * 100);
                    toast.showPersistent({
                        id: `ocr-low-confidence-${randomString(8)}`,
                        icon: "bx bx-info-circle",
                        message: t("ocr.text_filtered_low_confidence", {
                            confidence: confidencePercent,
                            threshold: thresholdPercent
                        }),
                        timeout: 15000,
                        buttons: [{
                            text: t("ocr.open_media_settings"),
                            onClick: ({ dismissToast }) => {
                                appContext.tabManager.openInNewTab("_optionsMedia", null, true);
                                dismissToast();
                            }
                        }]
                    });
                } else {
                    toast.showMessage(t("ocr.processing_complete"));
                }
                setTimeout(fetchText, 500);
            } else {
                toast.showError(response.message || t("ocr.processing_failed"));
            }
        } catch {
            // Server errors (4xx/5xx) are already shown as toasts by server.ts.
        } finally {
            setProcessing(false);
        }
    }

    function copyToClipboard() {
        if (state.kind === "loaded") {
            copyTextWithToast(state.text);
        }
    }

    const footer = state.kind !== "loading" && (
        <>
            <Button
                icon={processing ? "bx-loader-alt bx-spin" : "bx-refresh"}
                text={processing ? t("ocr.processing") : t("ocr.process_now")}
                size="small"
                disabled={processing}
                onClick={processOCR}
            />
            {state.kind === "loaded" && (
                <Button
                    icon="bx-copy"
                    text={t("info.copy_to_clipboard")}
                    size="small"
                    onClick={copyToClipboard}
                />
            )}
        </>
    );

    return (
        <Modal
            className="ocr-text-modal"
            title={t("ocr.extracted_text_title")}
            footer={footer}
            footerAlignment="between"
            show={true}
            onHidden={onHidden}
            size="lg"
            scrollable
        >
            {state.kind === "loading" && (
                <div className="ocr-text-modal-loading">
                    <span className="bx bx-loader-alt bx-spin" />{" "}{t("ocr.loading_text")}
                </div>
            )}

            {state.kind === "loaded" && (
                <div className="ocr-text-modal-content">
                    {state.text}
                </div>
            )}

            {state.kind === "empty" && (
                <div className="ocr-text-modal-empty">
                    <span className="bx bx-info-circle" />
                    <div>{t("ocr.no_text_available")}</div>
                    <div className="ocr-text-modal-explanation">{t("ocr.no_text_explanation")}</div>
                </div>
            )}

            {state.kind === "error" && (
                <div className="ocr-text-modal-error">
                    <span className="bx bx-error" />{" "}{state.message}
                </div>
            )}
        </Modal>
    );
}
