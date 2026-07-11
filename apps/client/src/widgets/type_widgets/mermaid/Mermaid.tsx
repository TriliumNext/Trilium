import type CodeMirror from "@triliumnext/codemirror";
import { NOTE_TYPE_IMAGE_ATTACHMENTS } from "@triliumnext/commons";
import { useCallback } from "preact/hooks";

import { t } from "../../../services/i18n";
import { getMermaidConfig, loadElkIfNeeded, postprocessMermaidSvg } from "../../../services/mermaid";
import NoteContentSwitcher from "../../layout/NoteContentSwitcher";
import SvgSplitEditor from "../helpers/SvgSplitEditor";
import { TypeWidgetProps } from "../type_widget";
import mermaidLinter from "../linters/mermaid";
import SAMPLE_DIAGRAMS from "./sample_diagrams";

let idCounter = 1;

export default function Mermaid(props: TypeWidgetProps) {
    const renderSvg = useCallback(async (content: string) => {
        const mermaid = (await import("mermaid")).default;
        await loadElkIfNeeded(mermaid, content);

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

    // Attach the Mermaid lint extension once the underlying CodeMirror editor is ready.
    const setupEditor = useCallback((editor: CodeMirror | null) => {
        editor?.setNamedExtension("mermaid-lint", mermaidLinter());
    }, []);

    return (
        <SvgSplitEditor
            attachmentTitle={NOTE_TYPE_IMAGE_ATTACHMENTS.mermaid}
            renderSvg={renderSvg}
            editorRef={setupEditor}
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
