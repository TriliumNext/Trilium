import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n.js";
import importService from "../../../services/import.js";
import Button from "../../react/Button.js";
import { Card, CardSection } from "../../react/Card.js";
import FileDropZone from "../../react/FileDropZone.js";
import { useTriliumOptionBool } from "../../react/hooks.js";
import OptionsRow, { OptionsRowWithToggle } from "../../type_widgets/options/components/OptionsRow.js";
import iconUrl from "./icons/evernote.svg?url";
import type { ImportProvider, ImportProviderPanelProps } from "./types.js";

function EvernotePanel({ parentNoteId, closeDialog, setFooter }: ImportProviderPanelProps) {
    const [files, setFiles] = useState<File[]>([]);
    const [compressImages] = useTriliumOptionBool("compressImages");
    const [shrinkImages, setShrinkImages] = useState(compressImages);

    // An Evernote export is one ENEX (.enex) file per notebook, so allow selecting several at once.
    const onChange = useCallback((fileList: File[] | null) => setFiles(fileList ?? []), []);

    const doImport = useCallback(async () => {
        if (!files.length) {
            return;
        }

        // Close immediately and let the shared import toasts (registered in import.ts) report progress,
        // completion and any error. Unlike Notion (a .zip that needs an explicit format tag), an ENEX
        // upload is routed by its .enex extension on the shared file-import endpoint, so no format is set;
        // each file becomes its own notebook root. uploadFiles surfaces upload errors via its own toast,
        // so swallow the rejection to avoid an unhandled rejection from this void-ed call.
        closeDialog();
        await importService.uploadFiles("notes", parentNoteId, files, { safeImport: "true", shrinkImages: shrinkImages ? "true" : "false" }).catch(() => {});
    }, [files, shrinkImages, parentNoteId, closeDialog]);

    // Keep the latest import handler in a ref so the footer effect depends only on whether files are
    // selected, never on doImport's identity — otherwise re-pushing the footer on every change would loop
    // with the parent re-rendering us back (see the Notion/OneNote panels for the same reasoning).
    const doImportRef = useRef(doImport);
    doImportRef.current = doImport;

    useEffect(() => {
        setFooter(
            <Button
                text={t("evernote_import.import")}
                kind="primary"
                disabled={!files.length}
                onClick={() => void doImportRef.current()}
            />
        );
    }, [files.length, setFooter]);

    return (
        <Card heading={t("evernote_import.choose_file")}>
            <CardSection>
                <OptionsRow name="import-file" description={t("evernote_import.description_long")} stacked>
                    <FileDropZone multiple onChange={onChange} accept=".enex" />
                </OptionsRow>
                <OptionsRowWithToggle
                    name="shrink-images"
                    label={t("import.shrinkImages")}
                    description={t("import.shrinkImagesProviderTooltip")}
                    currentValue={compressImages && shrinkImages}
                    onChange={setShrinkImages}
                    disabled={!compressImages}
                />
            </CardSection>
        </Card>
    );
}

const provider: ImportProvider = {
    id: "evernote",
    helpPage: "syuSEKf2rUGr",
    name: t("evernote_import.name"),
    iconUrl,
    description: t("evernote_import.description"),
    Panel: EvernotePanel
};

export default provider;
