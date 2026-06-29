import { useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n.js";
import Button from "../../react/Button.js";
import { Card, CardSection } from "../../react/Card.js";
import FileDropZone from "../../react/FileDropZone.js";
import { useTriliumOptionBool } from "../../react/hooks.js";
import OptionsRow, { OptionsRowWithToggle } from "../../type_widgets/options/components/OptionsRow.js";
import iconUrl from "./icons/anytype.svg?url";
import type { ImportProvider, ImportProviderPanelProps } from "./types.js";
import useProviderImport from "./useProviderImport.js";

function AnytypePanel({ parentNoteId, closeDialog, setFooter }: ImportProviderPanelProps) {
    const [compressImages] = useTriliumOptionBool("compressImages");
    const [shrinkImages, setShrinkImages] = useState(compressImages);
    // `format: "anytype"` routes the upload/native import to the Anytype importer, overriding the .zip
    // extension's default (the generic zip importer).
    const { hasSelection, displayNames, onChange, onBrowse, onNativeDrop, doImport } = useProviderImport({ format: "anytype", parentNoteId, shrinkImages, closeDialog });

    // Keep the latest import handler in a ref so the footer effect depends only on whether a file is
    // selected, never on doImport's identity — otherwise re-pushing the footer on every change would loop
    // with the parent re-rendering us back (see the Notion/Keep panels for the same reasoning).
    const doImportRef = useRef(doImport);
    doImportRef.current = doImport;

    useEffect(() => {
        setFooter(
            <Button
                text={t("anytype_import.import")}
                kind="primary"
                disabled={!hasSelection}
                onClick={() => void doImportRef.current()}
            />
        );
    }, [hasSelection, setFooter]);

    return (
        <Card heading={t("anytype_import.choose_file")}>
            <CardSection>
                <OptionsRow name="import-file" description={t("anytype_import.description_long")} stacked>
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
    id: "anytype",
    helpPage: "83zmPBJRgfnW",
    name: t("anytype_import.name"),
    iconUrl,
    description: t("anytype_import.description"),
    Panel: AnytypePanel
};

export default provider;
