import { useState } from "preact/hooks";
import { t } from "../../services/i18n";
import tree from "../../services/tree";
import Button from "../react/Button";
import FormCheckbox from "../react/FormCheckbox";
import FormFileUpload from "../react/FormFileUpload";
import FormGroup, { FormMultiGroup } from "../react/FormGroup";
import Modal from "../react/Modal";
import RawHtml from "../react/RawHtml";
import importService, { UploadFilesOptions } from "../../services/import";
import { useTriliumEvent, useTriliumOptionBool } from "../react/hooks";

export default function ImportDialog() {
    const [ compressImages ] = useTriliumOptionBool("compressImages");
    const [ parentNoteId, setParentNoteId ] = useState<string>();
    const [ noteTitle, setNoteTitle ] = useState<string>();
    const [ files, setFiles ] = useState<FileList | null>(null);
    const [ safeImport, setSafeImport ] = useState(true);
    const [ explodeArchives, setExplodeArchives ] = useState(true);
    const [ shrinkImages, setShrinkImages ] = useState(compressImages);
    const [ textImportedAsText, setTextImportedAsText ] = useState(true);
    const [ codeImportedAsCode, setCodeImportedAsCode ] = useState(true);
    const [ replaceUnderscoresWithSpaces, setReplaceUnderscoresWithSpaces ] = useState(true);
    const [ shown, setShown ] = useState(false);

    useTriliumEvent("showImportDialog", ({ noteId }) => {
        setParentNoteId(noteId);
        tree.getNoteTitle(noteId).then(setNoteTitle);
        setShown(true);
    });

    return (
        <Modal
            className="import-dialog"
            size="lg"
            title={t("import.importIntoNote")}
            onSubmit={async () => {
                if (!files || !parentNoteId) {
                    return;
                }

                const options: UploadFilesOptions = {
                    safeImport: boolToString(safeImport),
                    shrinkImages: boolToString(shrinkImages),
                    textImportedAsText: boolToString(textImportedAsText),
                    codeImportedAsCode: boolToString(codeImportedAsCode),
                    explodeArchives: boolToString(explodeArchives),
                    replaceUnderscoresWithSpaces: boolToString(replaceUnderscoresWithSpaces)
                };

                setShown(false);
                await importService.uploadFiles("notes", parentNoteId, Array.from(files), options);
            }}
            onHidden={() => {
                setShown(false);
                setFiles(null);
            }}
            footer={<Button text={t("import.import")} kind="primary" disabled={!files} />}
            show={shown}
        >
            <FormGroup name="files" label={t("import.chooseImportFile")} description={
                <>
                    {t("import.importDescription")} <strong>{ noteTitle }</strong>.<br />
                    {t("import.importZipRecommendation")}
                </>
            }>
                <FormFileUpload multiple onChange={setFiles} />
            </FormGroup>

            <FormMultiGroup label={t("import.options")}>
                <FormCheckbox
                    name="safe-import" hint={t("import.safeImportTooltip")} label={t("import.safeImport")}
                    currentValue={safeImport} onChange={setSafeImport}
                />
                <FormCheckbox
                    name="explode-archives" hint={t("import.explodeArchivesTooltip")} label={<RawHtml html={t("import.explodeArchives")} />}
                    currentValue={explodeArchives} onChange={setExplodeArchives}
                />
                <FormCheckbox
                    name="shrink-images" hint={t("import.shrinkImagesTooltip")} label={t("import.shrinkImages")}
                    currentValue={compressImages && shrinkImages} onChange={setShrinkImages}
                    disabled={!compressImages}
                />
                <FormCheckbox
                    name="text-imported-as-text" label={t("import.textImportedAsText")}
                    currentValue={textImportedAsText} onChange={setTextImportedAsText}
                />
                <FormCheckbox
                    name="code-imported-as-code" label={<RawHtml html={t("import.codeImportedAsCode")} />}
                    currentValue={codeImportedAsCode} onChange={setCodeImportedAsCode}
                />
                <FormCheckbox
                    name="replace-underscores-with-spaces" label={t("import.replaceUnderscoresWithSpaces")}
                    currentValue={replaceUnderscoresWithSpaces} onChange={setReplaceUnderscoresWithSpaces}
                />
            </FormMultiGroup>
        </Modal>
    );
}

function boolToString(value: boolean) {
    return value ? "true" : "false";
}
