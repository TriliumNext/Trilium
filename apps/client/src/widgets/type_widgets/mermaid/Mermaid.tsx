import { useCallback } from "preact/hooks";

import { t } from "../../../services/i18n";
import { getMermaidConfig, loadElkIfNeeded, postprocessMermaidSvg } from "../../../services/mermaid";
import NoteContentSwitcher from "../../layout/NoteContentSwitcher";
import SvgSplitEditor from "../helpers/SvgSplitEditor";
import { TypeWidgetProps } from "../type_widget";
import SAMPLE_DIAGRAMS from "./sample_diagrams";

let idCounter = 1;
let registeredErrorReporter = false;

export default function Mermaid(props: TypeWidgetProps) {
    const renderSvg = useCallback(async (content: string) => {
        const mermaid = (await import("mermaid")).default;
        await loadElkIfNeeded(mermaid, content);
        if (!registeredErrorReporter) {
            // (await import("./linters/mermaid.js")).default();
            registeredErrorReporter = true;
        }

        if (!content.trim()) {
            return "";
        }

        mermaid.initialize({
            startOnLoad: false,
            ...(getMermaidConfig() as any),
        });

        idCounter++;
        const { svg } = await mermaid.render(`mermaid-graph-${idCounter}`, content);
        return postprocessMermaidSvg(svg);
    }, []);

    return (
        <SvgSplitEditor
            attachmentName="mermaid-export"
            renderSvg={renderSvg}
            noteType="mermaid"
            extraContent={(
                <NoteContentSwitcher
                    text={t("mermaid.sample_diagrams")}
                    note={props.note}
                    templates={SAMPLE_DIAGRAMS} />
            )}
            {...props}
        />
    );
}
