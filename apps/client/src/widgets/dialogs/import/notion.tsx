import { useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n.js";
import Button from "../../react/Button.js";
import { Card, CardSection } from "../../react/Card.js";
import FileDropZone from "../../react/FileDropZone.js";
import { useTriliumOptionBool } from "../../react/hooks.js";
import OptionsRow, { OptionsRowWithToggle } from "../../type_widgets/options/components/OptionsRow.js";
import iconUrl from "./icons/notion.svg?url";
import type { ImportProvider, ImportProviderPanelProps } from "./types.js";
import useProviderImport from "./useProviderImport.js";

function NotionPanel({ parentNoteId, closeDialog, setFooter }: ImportProviderPanelProps) {
    const [compressImages] = useTriliumOptionBool("compressImages");
    const [shrinkImages, setShrinkImages] = useState(compressImages);
    // `format: "notion"` routes the upload/native import to the Notion importer, overriding the .zip
    // extension's default (the generic zip importer).
    const { hasSelection, displayNames, onChange, onBrowse, onNativeDrop, doImport } = useProviderImport({ format: "notion", parentNoteId, shrinkImages, closeDialog });

    // Keep the latest import handler in a ref so the footer effect depends only on whether a file is
    // selected, never on doImport's identity — otherwise re-pushing the footer on every change would loop
    // with the parent re-rendering us back (see the OneNote panel for the same reasoning).
    const doImportRef = useRef(doImport);
    doImportRef.current = doImport;

    useEffect(() => {
        setFooter(
            <Button
                text={t("notion_import.import")}
                kind="primary"
                disabled={!hasSelection}
                onClick={() => void doImportRef.current()}
            />
        );
    }, [hasSelection, setFooter]);

    return (
        <Card heading={t("notion_import.choose_file")}>
            <CardSection>
                <OptionsRow name="import-file" description={t("notion_import.description_long")} stacked>
                    <FileDropZone onChange={onChange} onBrowse={onBrowse} onNativeDrop={onNativeDrop} displayNames={displayNames} accept=".zip" />
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
