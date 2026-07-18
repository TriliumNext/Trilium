import { useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n.js";
import Button from "../../react/Button.js";
import { Card, CardSection } from "../../react/Card.js";
import FileDropZone from "../../react/FileDropZone.js";
import { useTriliumOptionBool } from "../../react/hooks.js";
import { OptionsRowWithToggle } from "../../type_widgets/options/components/OptionsRow.js";
import iconUrl from "./icons/obsidian.svg?url";
import type { ImportProvider, ImportProviderPanelProps } from "./types.js";
import useProviderImport from "./useProviderImport.js";

function ObsidianPanel({ parentNoteId, closeDialog, setFooter }: ImportProviderPanelProps) {
    const [compressImages] = useTriliumOptionBool("compressImages");
    const [shrinkImages, setShrinkImages] = useState(compressImages);
    // `format: "obsidian"` routes the upload/native import to the Obsidian importer, overriding the .zip
    // extension's default (the generic zip importer).
    const { hasSelection, displayNames, onChange, onBrowse, onNativeDrop, onRemove, doImport } = useProviderImport({ format: "obsidian", parentNoteId, shrinkImages, closeDialog });

    // Keep the latest import handler in a ref so the footer effect depends only on whether a file is
    // selected, never on doImport's identity — otherwise re-pushing the footer on every change would loop
    // with the parent re-rendering us back (see the Anytype/Notion panels for the same reasoning).
    const doImportRef = useRef(doImport);
    doImportRef.current = doImport;

    useEffect(() => {
        setFooter(
            <Button
                text={t("obsidian_import.import")}
                kind="primary"
                disabled={!hasSelection}
                onClick={() => void doImportRef.current()}
            />
        );
    }, [hasSelection, setFooter]);

    return (
        <Card heading={t("obsidian_import.choose_file")}>
            <CardSection>
                <p className="import-files-description">{t("obsidian_import.description_long")}</p>
                <FileDropZone onChange={onChange} onBrowse={onBrowse} onNativeDrop={onNativeDrop} onRemove={onRemove} displayNames={displayNames} />
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
    id: "obsidian",
    helpPage: "iWD7wiIuMtgV",
    name: t("obsidian_import.name"),
    iconUrl,
    description: t("obsidian_import.description"),
    Panel: ObsidianPanel
};

export default provider;
