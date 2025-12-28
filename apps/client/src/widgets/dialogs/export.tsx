import { useState } from "preact/hooks";
import { t } from "../../services/i18n";
import tree from "../../services/tree";
import Button from "../react/Button";
import FormRadioGroup from "../react/FormRadioGroup";
import Modal from "../react/Modal";
import "./export.css";
import ws from "../../services/ws";
import toastService, { type ToastOptionsWithRequiredId } from "../../services/toast";
import utils from "../../services/utils";
import open from "../../services/open";
import froca from "../../services/froca";
import { useTriliumEvent } from "../react/hooks";

interface ExportDialogProps {
    branchId?: string | null;
    noteTitle?: string;
    defaultType?: "subtree" | "single";
}

export default function ExportDialog() {
    const [ opts, setOpts ] = useState<ExportDialogProps>();
    const [ exportType, setExportType ] = useState<string>(opts?.defaultType ?? "subtree");
    const [ subtreeFormat, setSubtreeFormat ] = useState("html");
    const [ singleFormat, setSingleFormat ] = useState("html");
    const [ opmlVersion, setOpmlVersion ] = useState("2.0");
    const [ shown, setShown ] = useState(false);

    useTriliumEvent("showExportDialog", async ({ notePath, defaultType }) => {
        const { noteId, parentNoteId } = tree.getNoteIdAndParentIdFromUrl(notePath);
        if (!parentNoteId) {
            return;
        }

        const branchId = await froca.getBranchId(parentNoteId, noteId);

        setOpts({
            noteTitle: noteId && await tree.getNoteTitle(noteId),
            defaultType,
            branchId
        });
        setShown(true);
    });

    return (
        <Modal
            className="export-dialog"
            title={`${t("export.export_note_title")} ${opts?.noteTitle ?? ""}`}
            size="lg"
            onSubmit={() => {
                if (!opts || !opts.branchId) {
                    return;
                }

                const format = (exportType === "subtree" ? subtreeFormat : singleFormat);
                const version = (format === "opml" ? opmlVersion : "1.0");
                exportBranch(opts.branchId, exportType, format, version);
                setShown(false);
            }}
            onHidden={() => setShown(false)}
            footer={<Button className="export-button" text={t("export.export")} primary />}
            show={shown}
        >

            <FormRadioGroup
                name="export-type"
                currentValue={exportType} onChange={setExportType}
                values={[{
                    value: "subtree",
                    label: t("export.export_type_subtree")
                }]}
            />

            { exportType === "subtree" &&
                <div className="export-subtree-formats format-choice">
                    <FormRadioGroup
                        name="export-subtree-format"
                        currentValue={subtreeFormat} onChange={setSubtreeFormat}
                        values={[
                            { value: "html", label: t("export.format_html_zip") },
                            { value: "markdown", label: t("export.format_markdown") },
                            { value: "share", label: t("export.share-format") },
                            { value: "opml", label: t("export.format_opml") }
                        ]}
                    />

                    { subtreeFormat === "opml" &&
                        <div className="opml-versions">
                            <FormRadioGroup
                                name="opml-version"
                                currentValue={opmlVersion} onChange={setOpmlVersion}
                                values={[
                                    { value: "1.0", label: t("export.opml_version_1") },
                                    { value: "2.0", label: t("export.opml_version_2") }
                                ]}
                            />
                        </div>
                    }
                </div>
            }

            <FormRadioGroup
                name="export-type"
                currentValue={exportType} onChange={setExportType}
                values={[{
                    value: "single",
                    label: t("export.export_type_single")
                }]}
            />

            { exportType === "single" &&
                <div class="export-single-formats format-choice">
                    <FormRadioGroup
                        name="export-single-format"
                        currentValue={singleFormat} onChange={setSingleFormat}
                        values={[
                            { value: "html", label: t("export.format_html") },
                            { value: "markdown", label: t("export.format_markdown") }
                        ]}
                    />
                </div>
            }

        </Modal>
    );
}

function exportBranch(branchId: string, type: string, format: string, version: string) {
    const taskId = utils.randomString(10);
    const url = open.getUrlForDownload(`api/branches/${branchId}/export/${type}/${format}/${version}/${taskId}`);
    open.download(url);
}

ws.subscribeToMessages(async (message) => {
    function makeToast(id: string, message: string): ToastOptionsWithRequiredId {
        return {
            id,
            title: t("export.export_status"),
            message,
            icon: "export"
        };
    }

    if (!("taskType" in message) || message.taskType !== "export") {
        return;
    }

    if (message.type === "taskError") {
        toastService.closePersistent(message.taskId);
        toastService.showError(message.message);
    } else if (message.type === "taskProgressCount") {
        toastService.showPersistent(makeToast(message.taskId, t("export.export_in_progress", { progressCount: message.progressCount })));
    } else if (message.type === "taskSucceeded") {
        const toast = makeToast(message.taskId, t("export.export_finished_successfully"));
        toast.timeout = 5000;

        toastService.showPersistent(toast);
    }
});
