import type CodeMirror from "@triliumnext/codemirror";
import { NOTE_TYPE_IMAGE_ATTACHMENTS } from "@triliumnext/commons";
import { useCallback } from "preact/hooks";

import { t } from "../../../services/i18n";
import { renderMermaidSvg } from "../../../services/mermaid";
import NoteContentSwitcher from "../../layout/NoteContentSwitcher";
import SvgSplitEditor from "../helpers/SvgSplitEditor";
import { TypeWidgetProps } from "../type_widget";
import mermaidLinter from "../linters/mermaid";
import SAMPLE_DIAGRAMS from "./sample_diagrams";

export default function Mermaid(props: TypeWidgetProps) {
    // Attach the Mermaid lint extension once the underlying CodeMirror editor is ready.
    const setupEditor = useCallback((editor: CodeMirror | null) => {
        editor?.setNamedExtension("mermaid-lint", mermaidLinter());
    }, []);

    return (
        <SvgSplitEditor
            attachmentTitle={NOTE_TYPE_IMAGE_ATTACHMENTS.mermaid}
            renderSvg={renderMermaidSvg}
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
