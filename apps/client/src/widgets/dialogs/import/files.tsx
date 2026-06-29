import type { NativeImportOptions, NativeImportPickedFile } from "@triliumnext/commons";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n.js";
import importService, { type UploadFilesOptions } from "../../../services/import.js";
import utils from "../../../services/utils.js";
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
    // Desktop only: files picked via the native OS dialog, identified by capability tokens (not paths) so
    // they can be imported in place. Mutually exclusive with `files` — picking clears one, the other clears it.
    const [nativeFiles, setNativeFiles] = useState<NativeImportPickedFile[] | null>(null);
    const [safeImport, setSafeImport] = useState(true);
    const [explodeArchives, setExplodeArchives] = useState(true);
    const [shrinkImages, setShrinkImages] = useState(compressImages);
    const [textImportedAsText, setTextImportedAsText] = useState(true);
    const [codeImportedAsCode, setCodeImportedAsCode] = useState(true);
    const [spreadsheetImportedAsSpreadsheet, setSpreadsheetImportedAsSpreadsheet] = useState(true);
    const [replaceUnderscoresWithSpaces, setReplaceUnderscoresWithSpaces] = useState(true);
    const [optionsShown, setOptionsShown] = useState(false);

    const doImport = useCallback(async () => {
        // Close immediately and let the shared import toasts (registered in import.ts) report progress,
        // completion and any error over the WebSocket. Rejections are swallowed so these void-ed calls
        // don't raise an unhandled rejection.
        if (nativeFiles?.length) {
            const options: NativeImportOptions = {
                safeImport, shrinkImages, textImportedAsText, codeImportedAsCode,
                spreadsheetImportedAsSpreadsheet, explodeArchives, replaceUnderscoresWithSpaces
            };
            // One taskId for the whole batch so the toast tracks all files together; `last` on the final
            // file fires the success toast once, mirroring the upload route.
            const taskId = utils.randomString(10);
            closeDialog();
            for (let i = 0; i < nativeFiles.length; i++) {
                await window.electronApi?.nativeImport.importFromToken({
                    token: nativeFiles[i].token, parentNoteId, taskId, options, last: i === nativeFiles.length - 1
                }).catch(() => {});
            }
            return;
        }

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

        closeDialog();
        await importService.uploadFiles("notes", parentNoteId, Array.from(files), options).catch(() => {});
    }, [files, nativeFiles, safeImport, shrinkImages, textImportedAsText, codeImportedAsCode, spreadsheetImportedAsSpreadsheet, explodeArchives, replaceUnderscoresWithSpaces, parentNoteId, closeDialog]);

    // Desktop only: browse via the native OS dialog. The dialog (in the main process) is the sole source of
    // the path — it returns single-use capability tokens, never paths — and the files are read in place, so
    // a multi-GB archive stays memory-bounded (no upload, no temp copy). Picking clears any dropped files.
    const doNativeBrowse = useCallback(async () => {
        const pick = await window.electronApi?.nativeImport.pickFiles();
        if (pick?.status !== "selected" || !pick.files?.length) {
            return;
        }
        setFiles(null);
        setNativeFiles(pick.files);
    }, []);

    // Drag-and-drop (or, off desktop, the in-page picker) goes through the normal upload route; a fresh
    // selection there clears any native pick so the two never coexist.
    const onFilesChange = useCallback((list: FileList | null) => {
        setFiles(list);
        if (list?.length) {
            setNativeFiles(null);
        }
    }, []);

    // Desktop: route a drop through the native in-place path too. Handle it natively only when *every*
    // dropped file resolved to a real path (the rest — folders, browser drags — fall back to upload so
    // nothing is silently dropped).
    const onNativeDrop = useCallback(async (dropped: File[]) => {
        const pick = await window.electronApi?.nativeImport.grantDroppedFiles(dropped);
        if (pick?.status !== "selected" || pick.files?.length !== dropped.length) {
            return false;
        }
        setFiles(null);
        setNativeFiles(pick.files);
        return true;
    }, []);

    // Keep the latest import handler in a ref so the footer effect depends only on whether files are
    // selected, never on doImport's identity — otherwise re-pushing the footer on every option toggle
    // would loop with the parent re-rendering us back (see the other panels for the same reasoning).
    const doImportRef = useRef(doImport);
    doImportRef.current = doImport;

    const hasSelection = !!files || !!nativeFiles?.length;
    useEffect(() => {
        setFooter(
            <Button text={t("import.import")} kind="primary" disabled={!hasSelection} onClick={() => void doImportRef.current()} />
        );
    }, [hasSelection, setFooter]);

    return (
        <>
            <Card heading={t("import.chooseImportFile")}>
                <CardSection>
                    <p className="import-files-description">{t("import.importZipRecommendation")}</p>
                    <FileDropZone
                        multiple
                        onChange={onFilesChange}
                        // On desktop, browsing opens the native dialog so the chosen files (zips especially)
                        // are read in place. Drag-and-drop still uses the upload route via onChange.
                        onBrowse={utils.isElectron() ? () => void doNativeBrowse() : undefined}
                        onNativeDrop={utils.isElectron() ? onNativeDrop : undefined}
                        displayNames={nativeFiles?.map((file) => file.fileName)}
                    />
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
