import { useEffect, useState } from "preact/hooks";
import { t } from "../../services/i18n";
import Button from "../react/Button";
import FormCheckbox from "../react/FormCheckbox";
import FormFileUpload from "../react/FormFileUpload";
import FormGroup from "../react/FormGroup";
import Modal from "../react/Modal";
import options from "../../services/options";
import importService from "../../services/import.js";
import tree from "../../services/tree";
import { useTriliumEvent } from "../react/hooks";

export default function UploadAttachmentsDialog() {
    const [ parentNoteId, setParentNoteId ] = useState<string>();
    const [ files, setFiles ] = useState<FileList | null>(null);
    const [ shrinkImages, setShrinkImages ] = useState(options.is("compressImages"));
    const [ isUploading, setIsUploading ] = useState(false);
    const [ description, setDescription ] = useState<string | undefined>(undefined);
    const [ shown, setShown ] = useState(false);

    useTriliumEvent("showUploadAttachmentsDialog", ({ noteId }) => {
        setParentNoteId(noteId);
        setShown(true);
    });

    useEffect(() => {
        if (!parentNoteId) return;

        tree.getNoteTitle(parentNoteId).then((noteTitle) =>
            setDescription(t("upload_attachments.files_will_be_uploaded", { noteTitle })));
    }, [parentNoteId]);

    return (
        <Modal
            className="upload-attachments-dialog"
            size="lg"
            title={t("upload_attachments.upload_attachments_to_note")}
            footer={<Button text={t("upload_attachments.upload")} kind="primary" disabled={!files || isUploading} />}
            onSubmit={async () => {
                if (!files || !parentNoteId) {
                    return;
                }

                setIsUploading(true);
                const filesCopy = Array.from(files);
                await importService.uploadFiles("attachments", parentNoteId, filesCopy, { shrinkImages });
                setIsUploading(false);
                setShown(false);
            }}
            onHidden={() => {
                setShown(false);
                setFiles(null);
            }}
            show={shown}
        >
            <FormGroup name="files" label={t("upload_attachments.choose_files")} description={description}>
                <FormFileUpload onChange={setFiles} multiple />
            </FormGroup>

            <FormGroup name="shrink-images" label={t("upload_attachments.options")}>
                <FormCheckbox
                    hint={t("upload_attachments.tooltip")} label={t("upload_attachments.shrink_images")}
                    currentValue={shrinkImages} onChange={setShrinkImages}
                />
            </FormGroup>
        </Modal>
    );
}
