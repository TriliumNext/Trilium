import "./import_preview.css";

import { ImportPreviewResponse } from "@triliumnext/commons";
import { useState } from "preact/hooks";

import { t } from "../../services/i18n";
import Button from "../react/Button";
import { Card } from "../react/Card";
import FormRadioGroup from "../react/FormRadioGroup";
import { useTriliumEvent } from "../react/hooks";
import Modal from "../react/Modal";

export interface ImportPreviewData {
    previews: ImportPreviewResponse[];
}

export default function ImportPreviewDialog() {
    const [ data, setData ] = useState<ImportPreviewData | null>({
        previews: [
            JSON.parse(`{"isDangerous":true,"dangerousAttributes":["iconPack"],"dangerousAttributeCategories":["iconPack"],"numNotes":1,"id":"llpCPOmcBGhW5.trilium"}`)
        ]
    });
    const [ shown, setShown ] = useState(true);
    const [ importMethod, setImportMethod ] = useState<string>("safe");

    useTriliumEvent("showImportPreviewDialog", (data) => {
        setData(data);
        setShown(true);
    });

    return (
        <Modal
            className="import-preview-dialog"
            size="lg"
            title={t("import_preview.title")}
            footer={<>
                <Button text={t("import_preview.cancel")} onClick={() => setShown(false)}/>
                <Button text={t("import_preview.import")} primary />
            </>}
            show={shown}
            onHidden={() => {
                setShown(false);
                setData(null);
            }}
        >
            <p>{t("import_preview.intro", { count: data?.previews.length })}</p>

            {data?.previews.map(preview => <SinglePreview key={preview.id} preview={preview} />)}

            <div className="import-options">
                <FormRadioGroup
                    name="import-method"
                    currentValue={importMethod} onChange={setImportMethod}
                    values={[
                        { value: "safe", label: t("import_preview.import_safely"), inlineDescription: t("import_preview.import_safely_description") },
                        { value: "unsafe", label: t("import_preview.import_trust"), inlineDescription: t("import_preview.import_trust_description") }
                    ]}
                />
            </div>
        </Modal>
    );
}

function SinglePreview({ preview }: { preview: ImportPreviewResponse }) {
    return (
        <Card title={preview.id}>
            <span>{t("import_preview.notes_count", { count: preview.numNotes })}</span>
        </Card>
    );
}
