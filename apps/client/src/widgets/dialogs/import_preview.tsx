import { ImportPreviewResponse } from "@triliumnext/commons";
import { useState } from "preact/hooks";

import { useTriliumEvent } from "../react/hooks";
import Modal from "../react/Modal";

export interface ImportPreviewData {
    previews: ImportPreviewResponse[];
}

export default function ImportPreviewDialog() {
    const [ data, setData ] = useState<ImportPreviewData | null>(JSON.parse(`{"isDangerous":true,"dangerousAttributes":["iconPack"],"dangerousAttributeCategories":["iconPack"],"numNotes":1,"id":"llpCPOmcBGhW5.trilium"}`));
    const [ shown, setShown ] = useState(true);

    useTriliumEvent("showImportPreviewDialog", (data) => {
        setData(data);
        setShown(true);
    });

    return (
        <Modal
            className="import-preview-dialog"
            size="lg"
            title="Import preview"
            show={shown}
            onHidden={() => {
                setShown(false);
                setData(null);
            }}
        >
            <p>Preview goes here.</p>
        </Modal>
    );
}
