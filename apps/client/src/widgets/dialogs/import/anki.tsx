import { useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n.js";
import Button from "../../react/Button.js";
import { Card, CardSection } from "../../react/Card.js";
import FileDropZone from "../../react/FileDropZone.js";
import { useTriliumOptionBool } from "../../react/hooks.js";
import OptionsRow, {
    OptionsRowWithToggle
} from "../../type_widgets/options/components/OptionsRow.js";
import type { ImportProvider, ImportProviderPanelProps } from "./types.js";
import useProviderImport from "./useProviderImport.js";

function AnkiPanel({ parentNoteId, closeDialog, setFooter }: ImportProviderPanelProps) {
    const [compressImages] = useTriliumOptionBool("compressImages");
    const [shrinkImages, setShrinkImages] = useState(compressImages);
    const {
        hasSelection,
        displayNames,
        onChange,
        onBrowse,
        onNativeDrop,
        onRemove,
        doImport
    } = useProviderImport({
        format: "anki",
        parentNoteId,
        shrinkImages,
        closeDialog
    });

    const doImportRef = useRef(doImport);
    doImportRef.current = doImport;

    useEffect(() => {
        setFooter(
            <Button
                text={t("anki_import.import")}
                kind="primary"
                disabled={!hasSelection}
                onClick={() => void doImportRef.current()}
            />
        );
    }, [hasSelection, setFooter]);

    return (
        <Card heading={t("anki_import.choose_file")}>
            <CardSection>
                <OptionsRow
                    name="import-file"
                    description={t("anki_import.description_long")}
                    stacked
                >
                    <FileDropZone
                        accept=".apkg"
                        onChange={onChange}
                        onBrowse={onBrowse}
                        onNativeDrop={onNativeDrop}
                        onRemove={onRemove}
                        displayNames={displayNames}
                    />
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
    id: "anki",
    name: t("anki_import.name"),
    icon: "bx bx-brain",
    description: t("anki_import.description"),
    Panel: AnkiPanel
};

export default provider;
