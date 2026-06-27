import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n.js";
import importService, { type UploadFilesOptions } from "../../../services/import.js";
import Button from "../../react/Button.js";
import { Card, CardSection } from "../../react/Card.js";
import FileDropZone from "../../react/FileDropZone.js";
import { useTriliumOptionBool } from "../../react/hooks.js";
import RawHtml from "../../react/RawHtml.js";
import { OptionsRowWithToggle } from "../../type_widgets/options/components/OptionsRow.js";
import type { ImportProvider, ImportProviderPanelProps } from "./types.js";

function FilesPanel({ parentNoteId, closeDialog, setFooter }: ImportProviderPanelProps) {
    const [compressImages] = useTriliumOptionBool("compressImages");
    const [files, setFiles] = useState<FileList | null>(null);
    const [safeImport, setSafeImport] = useState(true);
    const [explodeArchives, setExplodeArchives] = useState(true);
    const [shrinkImages, setShrinkImages] = useState(compressImages);
    const [textImportedAsText, setTextImportedAsText] = useState(true);
    const [codeImportedAsCode, setCodeImportedAsCode] = useState(true);
    const [spreadsheetImportedAsSpreadsheet, setSpreadsheetImportedAsSpreadsheet] = useState(true);
    const [replaceUnderscoresWithSpaces, setReplaceUnderscoresWithSpaces] = useState(true);
    const [optionsShown, setOptionsShown] = useState(false);

    const doImport = useCallback(async () => {
        if (!files) {
            return;
        }

        const options: UploadFilesOptions = {
            safeImport: boolToString(safeImport),
            shrinkImages: boolToString(shrinkImages),
            textImportedAsText: boolToString(textImportedAsText),
            codeImportedAsCode: boolToString(codeImportedAsCode),
            spreadsheetImportedAsSpreadsheet: boolToString(spreadsheetImportedAsSpreadsheet),
            explodeArchives: boolToString(explodeArchives),
            replaceUnderscoresWithSpaces: boolToString(replaceUnderscoresWithSpaces)
        };

        // Close immediately and let the shared import toasts (registered in import.ts) report progress,
        // completion and any error. Swallow the rejection so this void-ed call doesn't raise an unhandled
        // rejection.
        closeDialog();
        await importService.uploadFiles("notes", parentNoteId, Array.from(files), options).catch(() => {});
    }, [files, safeImport, shrinkImages, textImportedAsText, codeImportedAsCode, spreadsheetImportedAsSpreadsheet, explodeArchives, replaceUnderscoresWithSpaces, parentNoteId, closeDialog]);

    // Keep the latest import handler in a ref so the footer effect depends only on whether files are
    // selected, never on doImport's identity — otherwise re-pushing the footer on every option toggle
    // would loop with the parent re-rendering us back (see the other panels for the same reasoning).
    const doImportRef = useRef(doImport);
    doImportRef.current = doImport;

    useEffect(() => {
        setFooter(
            <Button text={t("import.import")} kind="primary" disabled={!files} onClick={() => void doImportRef.current()} />
        );
    }, [files, setFooter]);

    return (
        <>
            <Card heading={t("import.chooseImportFile")}>
                <CardSection>
                    <p className="import-files-description">{t("import.importZipRecommendation")}</p>
                    <FileDropZone multiple onChange={setFiles} />
                </CardSection>
            </Card>

            <Card>
                <CardSection className="import-options-toggle" highlightOnHover onAction={() => setOptionsShown((shown) => !shown)}>
                    <span className={`bx ${optionsShown ? "bx-chevron-down" : "bx-chevron-right"}`} />
                    <span>{t("import.options")}</span>
                </CardSection>
                {optionsShown && (
                    <CardSection>
                        <OptionsRowWithToggle
                            name="safe-import" label={t("import.safeImport")} description={<RawHtml html={t("import.safeImportTooltip")} />}
                            currentValue={safeImport} onChange={setSafeImport}
                        />
                        <OptionsRowWithToggle
                            name="explode-archives" label={<RawHtml html={t("import.explodeArchives")} />} description={<RawHtml html={t("import.explodeArchivesTooltip")} />}
                            currentValue={explodeArchives} onChange={setExplodeArchives}
                        />
                        <OptionsRowWithToggle
                            name="shrink-images" label={t("import.shrinkImages")} description={<RawHtml html={t("import.shrinkImagesTooltip")} />}
                            currentValue={compressImages && shrinkImages} onChange={setShrinkImages} disabled={!compressImages}
                        />
                        <OptionsRowWithToggle
                            name="text-imported-as-text" label={t("import.textImportedAsText")}
                            currentValue={textImportedAsText} onChange={setTextImportedAsText}
                        />
                        <OptionsRowWithToggle
                            name="code-imported-as-code" label={<RawHtml html={t("import.codeImportedAsCode")} />}
                            currentValue={codeImportedAsCode} onChange={setCodeImportedAsCode}
                        />
                        <OptionsRowWithToggle
                            name="spreadsheet-imported-as-spreadsheet" label={t("import.spreadsheetImportedAsSpreadsheet")}
                            currentValue={spreadsheetImportedAsSpreadsheet} onChange={setSpreadsheetImportedAsSpreadsheet}
                        />
                        <OptionsRowWithToggle
                            name="replace-underscores-with-spaces" label={t("import.replaceUnderscoresWithSpaces")}
                            currentValue={replaceUnderscoresWithSpaces} onChange={setReplaceUnderscoresWithSpaces}
                        />
                    </CardSection>
                )}
            </Card>
        </>
    );
}

function boolToString(value: boolean) {
    return value ? "true" : "false";
}

const provider: ImportProvider = {
    id: "files",
    helpPage: "mHbBMPDPkVV5",
    group: "local",
    name: t("import.cardName"),
    icon: "bx bx-import",
    description: t("import.cardDescription"),
    Panel: FilesPanel
};

export default provider;
