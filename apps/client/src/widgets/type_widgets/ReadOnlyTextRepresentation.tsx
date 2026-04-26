import "./ReadOnlyTextRepresentation.css";

import type { OCRProcessResponse, TextRepresentationResponse } from "@triliumnext/commons";
import { useEffect, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import { t } from "../../services/i18n";
import server from "../../services/server";
import toast from "../../services/toast";
import { randomString } from "../../services/utils";
import { TypeWidgetProps } from "./type_widget";

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

export default function ReadOnlyTextRepresentation({ note }: TypeWidgetProps) {
    return (
        <TextRepresentation
            textUrl={`ocr/notes/${note.noteId}/text`}
            processUrl={`ocr/process-note/${note.noteId}`}
        />
    );
}

export function TextRepresentation({ textUrl, processUrl }: TextRepresentationProps) {
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

    return (
        <div className="text-representation note-detail-printable">
            <div className="text-representation-header">
                <span className="bx bx-text" />{" "}{t("ocr.extracted_text_title")}
            </div>

            {state.kind === "loading" && (
                <div className="text-representation-loading">
                    <span className="bx bx-loader-alt bx-spin" />{" "}{t("ocr.loading_text")}
                </div>
            )}

            {state.kind === "loaded" && (
                <>
                    <div className="text-representation-content">
                        {state.text}
                    </div>
                </>
            )}

            {state.kind === "empty" && (
                <>
                    <div className="text-representation-empty">
                        <span className="bx bx-info-circle" />{" "}{t("ocr.no_text_available")}
                    </div>
                    <div className="text-representation-meta">
                        {t("ocr.no_text_explanation")}
                    </div>
                </>
            )}

            {state.kind === "error" && (
                <div className="text-representation-error">
                    <span className="bx bx-error" />{" "}{state.message}
                </div>
            )}

            {state.kind !== "loading" && (
                <button
                    type="button"
                    className="btn btn-secondary text-representation-process-btn"
                    disabled={processing}
                    onClick={processOCR}
                >
                    {processing
                        ? <><span className="bx bx-loader-alt bx-spin" />{" "}{t("ocr.processing")}</>
                        : <><span className="bx bx-play" />{" "}{t("ocr.process_now")}</>
                    }
                </button>
            )}
        </div>
    );
}
