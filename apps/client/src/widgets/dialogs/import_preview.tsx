import { ImportPreviewResponse } from "@triliumnext/commons";
import { useState } from "preact/hooks";

import { t } from "../../services/i18n";
import Button from "../react/Button";
import { Card } from "../react/Card";
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
            {data?.previews.map(preview => <SinglePreview key={preview.id} preview={preview} />)}
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
