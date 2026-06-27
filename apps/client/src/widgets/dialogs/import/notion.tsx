import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n.js";
import importService from "../../../services/import.js";
import Button from "../../react/Button.js";
import { Card, CardSection } from "../../react/Card.js";
import FileDropZone from "../../react/FileDropZone.js";
import { useTriliumOptionBool } from "../../react/hooks.js";
import OptionsRow, { OptionsRowWithToggle } from "../../type_widgets/options/components/OptionsRow.js";
import iconUrl from "./icons/notion.svg?url";
import type { ImportProvider, ImportProviderPanelProps } from "./types.js";

function NotionPanel({ parentNoteId, closeDialog, setFooter }: ImportProviderPanelProps) {
    const [file, setFile] = useState<File | null>(null);
    const [compressImages] = useTriliumOptionBool("compressImages");
    const [shrinkImages, setShrinkImages] = useState(compressImages);

    const onChange = useCallback((files: FileList | null) => setFile(files?.[0] ?? null), []);

    const doImport = useCallback(async () => {
        if (!file) {
            return;
        }

        // Close immediately and let the shared import toasts (registered in import.ts) report progress,
        // completion and any error. `format: "notion"` routes the upload to the Notion importer on the
        // shared file-import endpoint, overriding the .zip extension's default (the generic zip importer).
        // uploadFiles surfaces any upload error via its own toast; swallow the rejection so this void-ed
        // call doesn't raise an unhandled rejection.
        closeDialog();
        await importService.uploadFiles("notes", parentNoteId, [file], { format: "notion", safeImport: "true", shrinkImages: shrinkImages ? "true" : "false" }).catch(() => {});
    }, [file, shrinkImages, parentNoteId, closeDialog]);

    // Keep the latest import handler in a ref so the footer effect depends only on `file` being present,
    // never on doImport's identity — otherwise re-pushing the footer on every change would loop with the
    // parent re-rendering us back (see the OneNote panel for the same reasoning).
    const doImportRef = useRef(doImport);
    doImportRef.current = doImport;

    useEffect(() => {
        setFooter(
            <Button
                text={t("notion_import.import")}
                kind="primary"
                disabled={!file}
                onClick={() => void doImportRef.current()}
            />
        );
    }, [file, setFooter]);

    return (
        <Card heading={t("notion_import.choose_file")}>
            <CardSection>
                <OptionsRow name="import-file" description={t("notion_import.description_long")} stacked>
                    <FileDropZone onChange={onChange} accept=".zip" />
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
    id: "notion",
    helpPage: "Y5mKeJ6dsCld",
    name: t("notion_import.name"),
    iconUrl,
    description: t("notion_import.description"),
    Panel: NotionPanel
};

export default provider;
