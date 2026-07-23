import { useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n.js";
import Button from "../../react/Button.js";
import { Card, CardSection } from "../../react/Card.js";
import FileDropZone from "../../react/FileDropZone.js";
import { useTriliumOptionBool } from "../../react/hooks.js";
import OptionsRow, { OptionsRowWithToggle } from "../../type_widgets/options/components/OptionsRow.js";
import iconUrl from "./icons/onenote.svg?url";
import type { ImportProvider, ImportProviderPanelProps } from "./types.js";
import useProviderImport from "./useProviderImport.js";

/**
 * Offline import of a OneNote desktop `.one` section file — parsed directly from its binary format, no
 * Microsoft account or Graph connection (that's the separate "OneNote" provider). A proof of concept:
 * extracts page hierarchy, titles, body text and embedded images/files.
 */
function OneNoteFilePanel({ parentNoteId, closeDialog, setFooter }: ImportProviderPanelProps) {
    const [compressImages] = useTriliumOptionBool("compressImages");
    const [shrinkImages, setShrinkImages] = useState(compressImages);
    // No `format` tag: the importer is routed by the `.one` extension in the dispatcher, and an empty
    // format keeps the desktop native path reading the file into a buffer (a `.one` isn't streamed like a
    // zip) rather than handing over a path the offline parser can't open.
    const { hasSelection, displayNames, onChange, onBrowse, onNativeDrop, onRemove, doImport } = useProviderImport({ format: "", parentNoteId, shrinkImages, closeDialog });

    const doImportRef = useRef(doImport);
    doImportRef.current = doImport;

    useEffect(() => {
        setFooter(
            <Button
                text={t("onenote_file_import.import")}
                kind="primary"
                disabled={!hasSelection}
                onClick={() => void doImportRef.current()}
            />
        );
    }, [hasSelection, setFooter]);

    return (
        <Card heading={t("onenote_file_import.choose_file")}>
            <CardSection>
                <OptionsRow name="import-file" description={t("onenote_file_import.description_long")} stacked>
                    <FileDropZone onChange={onChange} onBrowse={onBrowse} onNativeDrop={onNativeDrop} onRemove={onRemove} displayNames={displayNames} accept=".one,.onetoc2" />
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
    id: "onenote-file",
    name: t("onenote_file_import.name"),
    iconUrl,
    description: t("onenote_file_import.description"),
    Panel: OneNoteFilePanel
};

export default provider;
