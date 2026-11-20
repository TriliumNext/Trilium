import "./PdfLayers.css";

import { t } from "../../../services/i18n";
import { useFilterState } from "../../react/filter";
import { useNoteProperty } from "../../react/hooks/note";
import { useActiveNoteContext, useGetContextData } from "../../react/hooks/tree";
import Icon from "../../react/Icon";
import { HighlightedText } from "../../react/RawHtml";
import { OutlineLoading, useOutlineFilter } from "../outline_filter";
import RightPanelWidget from "../RightPanelWidget";

interface LayerInfo {
    id: string;
    name: string;
    visible: boolean;
}

export default function PdfLayers() {
    const { note } = useActiveNoteContext();
    const noteType = useNoteProperty(note, "type");
    const noteMime = useNoteProperty(note, "mime");
    const layersData = useGetContextData("pdfLayers");
    const tokens = useFilterState()?.tokens;
    const ready = layersData?.status === "ready" ? layersData : undefined;
    const matches = useOutlineFilter(ready?.layers ?? null, {
        section: "pdf-layers",
        getText: (layer) => layer.name
    });

    if (noteType !== "file" || noteMime !== "application/pdf" || !layersData) {
        return null;
    }

    if (!ready) {
        return matches ? (
            <RightPanelWidget id="pdf-layers" title={t("pdf.layers_title")}>
                <OutlineLoading />
            </RightPanelWidget>
        ) : null;
    }

    if (ready.layers.length === 0) {
        return null;
    }

    const shown = matches ? matches.map(({ item }) => item) : ready.layers;
    return (
        <RightPanelWidget id="pdf-layers" title={t("pdf.layers", { count: ready.layers.length })}>
            <div className="pdf-layers-list">
                {shown.map((layer) => (
                    <PdfLayerItem
                        key={layer.id}
                        layer={layer}
                        onToggle={ready.toggleLayer}
                        tokens={tokens}
                    />
                ))}
            </div>
        </RightPanelWidget>
    );
}

function PdfLayerItem({
    layer,
    onToggle,
    tokens
}: {
    layer: LayerInfo;
    onToggle: (layerId: string, visible: boolean) => void;
    tokens?: string[];
}) {
    return (
        <div
            className={`pdf-layer-item ${layer.visible ? 'visible' : 'hidden'}`}
            onClick={() => onToggle(layer.id, !layer.visible)}
        >
            <Icon icon={layer.visible ? "bx bx-show" : "bx bx-hide"} />
            <HighlightedText
                className="pdf-layer-name"
                text={layer.name}
                highlightedTokens={tokens}
            />
        </div>
    );
}
