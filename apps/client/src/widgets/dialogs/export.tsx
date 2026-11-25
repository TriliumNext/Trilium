import "./export.css";

import type { NoteType } from "@triliumnext/commons";
import { useState } from "preact/hooks";

import froca from "../../services/froca";
import { t } from "../../services/i18n";
import open from "../../services/open";
import tree from "../../services/tree";
import utils from "../../services/utils";
import { ExtendedAdmonition } from "../react/Admonition";
import { Badge } from "../react/Badge";
import Button, { ButtonGroup } from "../react/Button";
import { Card, CardSection } from "../react/Card";
import { useTriliumEvent } from "../react/hooks/events";
import Modal from "../react/Modal";
import SelectableCard, { SelectableCardGrid } from "../react/SelectableCard";

interface ExportDialogProps {
    branchId?: string | null;
    noteTitle?: string;
    noteType?: NoteType;
    defaultType?: "subtree" | "single";
}

interface ExportFormat {
    value: string;
    name: string;
    description: string;
    icon: string;
    recommended?: boolean;
    beta?: boolean;
}

export default function ExportDialog() {
    const [ opts, setOpts ] = useState<ExportDialogProps>();
    const [ exportType, setExportType ] = useState<"subtree" | "single">("subtree");
    const [ subtreeFormat, setSubtreeFormat ] = useState("html");
    const [ singleFormat, setSingleFormat ] = useState("html");
    const [ shown, setShown ] = useState(false);

    useTriliumEvent("showExportDialog", async ({ notePath, defaultType }) => {
        const { noteId, parentNoteId } = tree.getNoteIdAndParentIdFromUrl(notePath);
        if (!parentNoteId) {
            return;
        }

        const branchId = await froca.getBranchId(parentNoteId, noteId);

        setExportType(defaultType ?? "subtree");
        setOpts({
            noteTitle: noteId && await tree.getNoteTitle(noteId),
            noteType: noteId ? (await froca.getNote(noteId))?.type : undefined,
            defaultType,
            branchId
        });
        setShown(true);
    });

    const formats = exportType === "subtree" ? subtreeFormats : getSingleFormats(opts?.noteType);
    const selectedFormat = exportType === "subtree"
        ? subtreeFormat
        : formats.some((format) => format.value === singleFormat) ? singleFormat : HTML_FORMAT.value;
    const setSelectedFormat = exportType === "subtree" ? setSubtreeFormat : setSingleFormat;

    return (
        <Modal
            className="export-dialog"
            title={`${t("export.export_note_title")} ${opts?.noteTitle ?? ""}`}
            size="lg"
            onSubmit={() => {
                if (!opts || !opts.branchId) {
                    return;
                }

                exportBranch(opts.branchId, exportType, selectedFormat, opts.noteTitle || "export");
                setShown(false);
            }}
            onHidden={() => setShown(false)}
            footer={<>
                <Button text={t("modal.cancel")} onClick={() => setShown(false)} />
                <Button className="export-button" text={t("export.export")} kind="primary" />
            </>}
            show={shown}
        >
            <Card heading={t("export.what_to_export")}>
                <CardSection>
                    <ButtonGroup className="export-type-group">
                        <button type="button" className={`btn btn-secondary ${exportType === "subtree" ? "active" : ""}`} onClick={() => setExportType("subtree")}>
                            {t("export.export_type_subtree")}
                        </button>
                        <button type="button" className={`btn btn-secondary ${exportType === "single" ? "active" : ""}`} onClick={() => setExportType("single")}>
                            {t("export.export_type_single")}
                        </button>
                    </ButtonGroup>
                </CardSection>
            </Card>

            <Card heading={t("export.format")}>
                <CardSection>
                    <SelectableCardGrid columns={2}>
                        {formats.map((format) => (
                            <SelectableCard
                                key={format.value} icon={format.icon}
                                title={<FormatHeading format={format} />}
                                description={format.description}
                                selected={selectedFormat === format.value} onSelect={() => setSelectedFormat(format.value)}
                            />
                        ))}
                    </SelectableCardGrid>
                </CardSection>
            </Card>

            <ExtendedAdmonition type="note" icon="bx bx-info-circle">
                {exportResultText(exportType, selectedFormat)}
            </ExtendedAdmonition>
        </Modal>
    );
}

/** The name of an export format, with the badge that marks it recommended or in beta. */
function FormatHeading({ format }: { format: ExportFormat }) {
    if (!format.recommended && !format.beta) {
        return <>{format.name}</>;
    }

    return (
        <span className="export-format-heading">
            {format.name}
            {format.recommended
                ? <Badge text={t("export.recommended")} className="export-format-badge" outline />
                : <Badge text={t("note_types.beta-feature")} className="export-format-badge" outline />}
        </span>
    );
}

const HTML_FORMAT: ExportFormat = { value: "html", name: t("export.format_html_name"), description: t("export.format_html_description"), icon: "bx bxl-html5", recommended: true };
const MARKDOWN_FORMAT: ExportFormat = { value: "markdown", name: t("export.format_markdown_name"), description: t("export.format_markdown_description"), icon: "bx bxl-markdown" };
const SHARE_FORMAT: ExportFormat = { value: "share", name: t("export.format_share_name"), description: t("export.format_share_description"), icon: "bx bx-globe" };
const DOCX_FORMAT: ExportFormat = { value: "docx", name: t("export.format_docx_name"), description: t("export.format_docx_description"), icon: "bx bxs-file-doc", beta: true };
const OPML_FORMAT: ExportFormat = { value: "opml", name: t("export.format_opml_name"), description: t("export.format_opml_description"), icon: "bx bx-list-ul" };

const subtreeFormats: ExportFormat[] = [HTML_FORMAT, MARKDOWN_FORMAT, SHARE_FORMAT, OPML_FORMAT];

/** A Word document is made only from a text note. */
function getSingleFormats(noteType: NoteType | undefined): ExportFormat[] {
    return noteType === "text" ? [HTML_FORMAT, MARKDOWN_FORMAT, DOCX_FORMAT] : [HTML_FORMAT, MARKDOWN_FORMAT];
}

// One-line summary of what the chosen export actually produces, shown in the dialog's result admonition.
function exportResultText(exportType: "subtree" | "single", format: string) {
    if (format === "opml") {
        return t("export.result_opml");
    }
    if (format === "share") {
        return t("export.result_share");
    }
    if (exportType === "single") {
        if (format === "docx") {
            return t("export.result_single_docx");
        }
        return format === "markdown" ? t("export.result_single_markdown") : t("export.result_single_html");
    }
    return format === "markdown" ? t("export.result_subtree_markdown") : t("export.result_subtree_html");
}

async function exportBranch(branchId: string, type: string, format: string, title: string) {
    const taskId = utils.randomString(10);

    // Desktop: stream subtree zip exports straight to a user-chosen file, bypassing
    // the in-memory download path. Electron's download manager buffers the whole
    // response in memory, which spikes badly for large (multi-GB) exports. OPML is
    // a single non-zip file handled by the regular download route.
    if (utils.isElectron() && type === "subtree" && format !== "opml") {
        await window.electronApi?.nativeExport.exportSubtreeToFile({ branchId, format, title, taskId });
        return;
    }

    const url = open.getUrlForDownload(`api/branches/${branchId}/export/${type}/${format}/${taskId}`);
    open.download(url);
}
