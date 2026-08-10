import { useEffect, useRef } from "preact/hooks";

import { t } from "../../../services/i18n.js";
import Button from "../../react/Button.js";
import { Card, CardSection } from "../../react/Card.js";
import FileDropZone from "../../react/FileDropZone.js";
import iconUrl from "./icons/logseq.svg?url";
import type { ImportProvider, ImportProviderPanelProps } from "./types.js";
import useProviderImport from "./useProviderImport.js";

function LogseqPanel({ parentNoteId, closeDialog, setFooter }: ImportProviderPanelProps) {
    // `format: "logseq"` routes the upload/native import to the Logseq importer, overriding the .zip
    // extension's default (the generic zip importer). No shrink-images toggle: the importer doesn't run a
    // graph's assets through image compression yet, so the option would have nothing to act on.
    const { hasSelection, displayNames, onChange, onBrowse, onNativeDrop, onRemove, doImport } = useProviderImport({ format: "logseq", parentNoteId, shrinkImages: false, closeDialog });

    // Keep the latest import handler in a ref so the footer effect depends only on whether a file is
    // selected, never on doImport's identity — otherwise re-pushing the footer on every change would loop
    // with the parent re-rendering us back (see the Obsidian/Keep panels for the same reasoning).
    const doImportRef = useRef(doImport);
    doImportRef.current = doImport;

    useEffect(() => {
        setFooter(
            <Button
                text={t("logseq_import.import")}
                kind="primary"
                disabled={!hasSelection}
                onClick={() => void doImportRef.current()}
            />
        );
    }, [hasSelection, setFooter]);

    return (
        <Card heading={t("logseq_import.choose_file")}>
            <CardSection>
                <p className="import-files-description">{t("logseq_import.description_long")}</p>
                <FileDropZone onChange={onChange} onBrowse={onBrowse} onNativeDrop={onNativeDrop} onRemove={onRemove} displayNames={displayNames} accept=".zip" />
            </CardSection>
        </Card>
    );
}

const provider: ImportProvider = {
    id: "logseq",
    name: t("logseq_import.name"),
    iconUrl,
    description: t("logseq_import.description"),
    Panel: LogseqPanel
};

export default provider;
