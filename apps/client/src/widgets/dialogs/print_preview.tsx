import "./print_preview.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import FNote from "../../entities/fnote";
import { t } from "../../services/i18n";
import toast from "../../services/toast";
import { dynamicRequire, isElectron } from "../../services/utils";
import Button, { ButtonGroup } from "../react/Button";
import Dropdown from "../react/Dropdown";
import { FormListHeader, FormListItem } from "../react/FormList";
import FormSelect from "../react/FormSelect";
import FormTextBox, { FormTextBoxWithUnit } from "../react/FormTextBox";
import { useNoteLabelBoolean, useNoteLabelWithDefault, useTriliumEvent } from "../react/hooks";
import Modal from "../react/Modal";
import Slider from "../react/Slider";
import PdfViewer from "../type_widgets/file/PdfViewer";
import OptionsRow from "../type_widgets/options/components/OptionsRow";
import OptionsSection from "../type_widgets/options/components/OptionsSection";

const PAGE_SIZES = ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "Legal", "Letter", "Tabloid", "Ledger"] as const;

/** Pseudo-printer name used to route the Print button to the PDF export flow. */
const DESTINATION_PDF = "__pdf__";

interface PrinterInfo {
    name: string;
    displayName: string;
    description: string;
    location: string;
    isDefault: boolean;
}

/** Builds the description line shown under a printer in the dropdown. */
function buildPrinterDescription(printer: PrinterInfo): string | undefined {
    const parts: string[] = [];
    if (printer.isDefault) parts.push(t("print_preview.destination_default"));
    if (printer.location) parts.push(printer.location);
    else if (printer.description) parts.push(printer.description);
    return parts.length ? parts.join(" · ") : undefined;
}
const MARGIN_PRESETS = ["default", "none", "minimum"] as const;
type MarginPreset = typeof MARGIN_PRESETS[number];

interface CustomMargins {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

function parseMarginValue(value: string): { preset: MarginPreset | "custom"; custom: CustomMargins } {
    if (MARGIN_PRESETS.includes(value as MarginPreset)) {
        return { preset: value as MarginPreset, custom: { top: 10, right: 10, bottom: 10, left: 10 } };
    }

    const parts = value.split(",").map(Number);
    if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
        return { preset: "custom", custom: { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] } };
    }

    return { preset: "default", custom: { top: 10, right: 10, bottom: 10, left: 10 } };
}

function serializeMargins(preset: MarginPreset | "custom", custom: CustomMargins): string {
    if (preset !== "custom") return preset;
    return `${custom.top},${custom.right},${custom.bottom},${custom.left}`;
}

/** Validates a page-range string such as "1-5, 8, 11-13". Empty string is valid (= all pages). */
function isValidPageRanges(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed) return true;
    return /^\s*\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*\s*$/.test(trimmed);
}

export interface PrintPreviewData {
    note: FNote;
    notePath: string;
}

interface PreviewOpts {
    landscape: boolean;
    pageSize: string;
    scale: number;
    margins: string;
    pageRanges: string;
}

export default function PrintPreviewDialog() {
    const [shown, setShown] = useState(false);
    const [pdfUrl, setPdfUrl] = useState<string>();
    const [note, setNote] = useState<FNote>();
    const [loading, setLoading] = useState(false);
    const bufferRef = useRef<Uint8Array>();
    const notePathRef = useRef("");
    const pdfUrlRef = useRef<string>();


    const [landscape, setLandscape] = useNoteLabelBoolean(note, "printLandscape");
    const [pageSize, setPageSize] = useNoteLabelWithDefault(note, "printPageSize", "Letter");
    const [scaleStr, setScaleStr] = useNoteLabelWithDefault(note, "printScale", "1");
    const scale = parseFloat(scaleStr) || 1;
    const [marginsStr, setMarginsStr] = useNoteLabelWithDefault(note, "printMargins", "default");
    const { preset: marginPreset, custom: customMargins } = useMemo(() => parseMarginValue(marginsStr), [marginsStr]);

    // Page ranges are kept local — they're one-off per export, not a persistent preference.
    const [pageRanges, setPageRanges] = useState("");
    const pageRangesValid = isValidPageRanges(pageRanges);

    // Printer list and current destination. DESTINATION_PDF means "Save as PDF";
    // any other value is the system printer name to use for silent printing.
    const [printers, setPrinters] = useState<PrinterInfo[]>([]);
    const [destination, setDestination] = useState<string>(DESTINATION_PDF);

    useEffect(() => {
        if (!shown || !isElectron()) return;
        const { ipcRenderer } = dynamicRequire("electron");
        ipcRenderer.invoke("get-printers").then((list: PrinterInfo[]) => {
            setPrinters(list ?? []);
            const defaultPrinter = list?.find((p) => p.isDefault);
            if (defaultPrinter) setDestination(defaultPrinter.name);
        });
    }, [shown]);

    const updatePreview = useCallback((buffer: Uint8Array) => {
        bufferRef.current = buffer;

        if (pdfUrlRef.current) {
            URL.revokeObjectURL(pdfUrlRef.current);
        }

        const blob = new Blob([buffer as BlobPart], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        pdfUrlRef.current = url;
        setPdfUrl(url);
        setLoading(false);
    }, []);

    useTriliumEvent("showPrintPreview", (data: PrintPreviewData) => {
        if (shown) return;

        setNote(data.note);
        notePathRef.current = data.notePath;
        setLoading(true);
        setShown(true);
    });

    // Handle regeneration results via a persistent listener scoped to the
    // dialog's lifecycle. A generation counter discards stale results when
    // multiple requests overlap.
    useEffect(() => {
        if (!shown || !isElectron()) return;
        const { ipcRenderer } = dynamicRequire("electron");

        const onResult = (_e: any, { buffer, error }: { buffer?: Uint8Array; error?: string }) => {
            toast.closePersistent("printing");
            if (error) {
                setLoading(false);
                if (pdfUrlRef.current) {
                    URL.revokeObjectURL(pdfUrlRef.current);
                    pdfUrlRef.current = undefined;
                    setPdfUrl(undefined);
                }
                toast.showPersistent({
                    id: "print-preview-error",
                    icon: "bx bx-error-circle",
                    message: `${t("print_preview.render_error")}\n\n${error}`
                });
                return;
            }
            toast.closePersistent("print-preview-error");
            if (buffer) {
                updatePreview(buffer);
            }
        };
        ipcRenderer.on("export-as-pdf-preview-result", onResult);
        return () => {
            ipcRenderer.off("export-as-pdf-preview-result", onResult);
        };
    }, [shown, updatePreview]);

    const regeneratePreview = useCallback((opts: PreviewOpts) => {
        if (!isElectron()) return;

        setLoading(true);
        const { ipcRenderer } = dynamicRequire("electron");
        ipcRenderer.send("export-as-pdf-preview", {
            notePath: notePathRef.current,
            pageSize: opts.pageSize,
            landscape: opts.landscape,
            scale: opts.scale,
            margins: opts.margins,
            pageRanges: opts.pageRanges
        });
    }, []);

    const isFirstGenerationRef = useRef(true);

    useEffect(() => {
        if (!shown || !pageRangesValid) return;

        const delay = isFirstGenerationRef.current ? 0 : 800;
        isFirstGenerationRef.current = false;

        const handle = setTimeout(() => {
            regeneratePreview({ landscape, pageSize, scale, margins: marginsStr, pageRanges: pageRanges.trim() });
        }, delay);
        return () => clearTimeout(handle);
    }, [shown, landscape, pageSize, scale, marginsStr, pageRanges, pageRangesValid, regeneratePreview]);

    function handleClose() {
        setShown(false);
        isFirstGenerationRef.current = true;
        toast.closePersistent("print-preview-error");
        if (pdfUrlRef.current) {
            URL.revokeObjectURL(pdfUrlRef.current);
            pdfUrlRef.current = undefined;
            setPdfUrl(undefined);
        }
        bufferRef.current = undefined;
        setLoading(false);
    }

    function handleExportPdf() {
        if (!bufferRef.current) return;

        const { ipcRenderer } = dynamicRequire("electron");
        ipcRenderer.send("save-pdf", {
            title: note?.title ?? "",
            buffer: bufferRef.current
        });
        handleClose();
    }

    function handlePrint(silent: boolean, deviceName?: string) {
        if (!isElectron()) return;
        const { ipcRenderer } = dynamicRequire("electron");
        ipcRenderer.send("print-from-preview", {
            notePath: notePathRef.current,
            pageSize,
            landscape,
            scale,
            margins: marginsStr,
            pageRanges,
            silent,
            deviceName
        });
        handleClose();
    }

    /** Primary action: route to PDF export or silent print based on the selected destination. */
    function handlePrimaryAction() {
        if (destination === DESTINATION_PDF) {
            handleExportPdf();
        } else {
            handlePrint(true, destination);
        }
    }

    function handleScaleChange(newScale: number) {
        const clamped = Math.min(2, Math.max(0.1, Math.round(newScale * 10) / 10));
        setScaleStr(String(clamped));
    }

    function handleCustomMarginChange(side: keyof CustomMargins, value: number) {
        const newCustom = { ...customMargins, [side]: Math.max(0, value) };
        setMarginsStr(serializeMargins("custom", newCustom));
    }

    return (
        <Modal
            className="print-preview-dialog"
            title={t("print_preview.title")}
            size="xl"
            show={shown}
            onHidden={handleClose}
            stackable
            footerAlignment="between"
            footer={
                <>
                    <a
                        href="#"
                        class={loading ? "disabled" : ""}
                        onClick={(e) => {
                            e.preventDefault();
                            if (loading) return;
                            // When a specific printer is selected, pre-select it in the system dialog.
                            const deviceName = destination === DESTINATION_PDF ? undefined : destination;
                            handlePrint(false, deviceName);
                        }}
                    >
                        {t("print_preview.system_print")}
                    </a>
                    <Button
                        text={destination === DESTINATION_PDF ? t("print_preview.export_pdf") : t("print_preview.print")}
                        icon={destination === DESTINATION_PDF ? "bx-file" : "bx-printer"}
                        className="btn-primary"
                        onClick={handlePrimaryAction}
                        disabled={loading}
                    />
                </>
            }
        >
            <div class="print-preview-settings">
                <OptionsSection>
                    <OptionsRow name="destination" label={t("print_preview.destination")}>
                        <Dropdown
                            disabled={loading}
                            text={<DestinationLabel destination={destination} printers={printers} />}
                        >
                            <FormListItem
                                icon="bx bxs-file-pdf"
                                selected={destination === DESTINATION_PDF}
                                onClick={() => setDestination(DESTINATION_PDF)}
                            >
                                {t("print_preview.destination_pdf")}
                            </FormListItem>
                            {printers.length > 0 && <FormListHeader text={t("print_preview.destination_printers")} />}
                            {printers.map((printer) => (
                                <FormListItem
                                    key={printer.name}
                                    icon="bx bx-printer"
                                    selected={destination === printer.name}
                                    onClick={() => setDestination(printer.name)}
                                    description={buildPrinterDescription(printer)}
                                >
                                    {printer.displayName || printer.name}
                                </FormListItem>
                            ))}
                        </Dropdown>
                    </OptionsRow>

                    <OptionsRow name="orientation" label={t("print_preview.orientation")}>
                        <ButtonGroup>
                            <Button
                                text={t("print_preview.portrait")}
                                icon="bx-rectangle bx-rotate-90"
                                className={!landscape ? "active" : ""}
                                onClick={() => setLandscape(false)}
                                disabled={loading}
                                size="small"
                            />
                            <Button
                                text={t("print_preview.landscape")}
                                icon="bx-rectangle"
                                className={landscape ? "active" : ""}
                                onClick={() => setLandscape(true)}
                                disabled={loading}
                                size="small"
                            />
                        </ButtonGroup>
                    </OptionsRow>

                    <OptionsRow name="pageSize" label={t("print_preview.page_size")}>
                        <FormSelect
                            values={PAGE_SIZES.map((size) => ({ key: size, title: size }))}
                            keyProperty="key"
                            titleProperty="title"
                            currentValue={pageSize}
                            onChange={setPageSize}
                            disabled={loading}
                        />
                    </OptionsRow>

                    <OptionsRow name="scale" label={t("print_preview.scale")} description={`${Math.round(scale * 100)}%`}>
                        <Slider
                            value={scale}
                            min={0.1}
                            max={2}
                            step={0.1}
                            onChange={handleScaleChange}
                        />
                    </OptionsRow>

                    <OptionsRow name="margins" label={t("print_preview.margins")}>
                        <FormSelect
                            values={[
                                { key: "default", title: t("print_preview.margins_default") },
                                { key: "none", title: t("print_preview.margins_none") },
                                { key: "minimum", title: t("print_preview.margins_minimum") },
                                { key: "custom", title: t("print_preview.margins_custom") },
                            ]}
                            keyProperty="key"
                            titleProperty="title"
                            currentValue={marginPreset}
                            onChange={(value) => setMarginsStr(serializeMargins(value as MarginPreset | "custom", customMargins))}
                            disabled={loading}
                        />
                    </OptionsRow>

                    {marginPreset === "custom" && (
                        <MarginEditor margins={customMargins} onChange={handleCustomMarginChange} disabled={loading} />
                    )}

                    <OptionsRow
                        name="pageRanges"
                        label={t("print_preview.page_ranges")}
                        description={!pageRangesValid ? t("print_preview.page_ranges_invalid") : t("print_preview.page_ranges_hint")}
                    >
                        <FormTextBox
                            className={`print-preview-page-ranges ${!pageRangesValid ? "is-invalid" : ""}`}
                            currentValue={pageRanges}
                            placeholder={t("print_preview.page_ranges_placeholder")}
                            onChange={(value) => setPageRanges(value)}
                            disabled={loading}
                        />
                    </OptionsRow>
                </OptionsSection>
            </div>

            <div class="print-preview-pane">
                {loading && (
                    <div class="print-preview-loading-overlay">
                        <span class="bx bx-loader-circle bx-spin" />
                    </div>
                )}
                {pdfUrl && <PdfViewer pdfUrl={pdfUrl} toolbar={false} disableSelection />}
            </div>
        </Modal>
    );
}

function DestinationLabel({ destination, printers }: { destination: string; printers: PrinterInfo[] }) {
    if (destination === DESTINATION_PDF) {
        return <><span class="bx bxs-file-pdf" /> {t("print_preview.destination_pdf")}</>;
    }
    const printer = printers.find((p) => p.name === destination);
    return <><span class="bx bx-printer" /> {printer?.displayName || printer?.name || destination}</>;
}

function MarginEditor({ margins, onChange, disabled }: {
    margins: CustomMargins;
    onChange: (side: keyof CustomMargins, value: number) => void;
    disabled: boolean;
}) {
    return (
        <div class="margin-editor">
            <MarginSpinner label={t("print_preview.margin_top")} value={margins.top} onChange={(v) => onChange("top", v)} disabled={disabled} />
            <div class="margin-editor-row">
                <MarginSpinner label={t("print_preview.margin_left")} value={margins.left} onChange={(v) => onChange("left", v)} disabled={disabled} />
                <MarginSpinner label={t("print_preview.margin_right")} value={margins.right} onChange={(v) => onChange("right", v)} disabled={disabled} />
            </div>
            <MarginSpinner label={t("print_preview.margin_bottom")} value={margins.bottom} onChange={(v) => onChange("bottom", v)} disabled={disabled} />
        </div>
    );
}

function MarginSpinner({ label, value, onChange, disabled }: {
    label: string;
    value: number;
    onChange: (value: number) => void;
    disabled: boolean;
}) {
    return (
        <FormTextBoxWithUnit
            type="number"
            className="margin-spinner"
            title={label}
            aria-label={label}
            currentValue={String(value)}
            min={0}
            max={100}
            step={1}
            onChange={(val) => onChange(Math.min(100, parseInt(val, 10) || 0))}
            disabled={disabled}
            unit="mm"
        />
    );
}
