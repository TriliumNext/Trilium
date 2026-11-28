import { AttributeEditor, type EditorConfig, TEXT_BOX_PLUGINS } from "@triliumnext/ckeditor5";
import type { DISPLAYABLE_LOCALE_IDS } from "@triliumnext/commons";
import { useRef } from "preact/hooks";

import link from "../../../services/link";
import CKEditor, { type CKEditorApi } from "../../react/CKEditor";
import { useTriliumOption } from "../../react/hooks/options";

/** What the toolbar over a selection offers, which `TEXT_BOX_PLUGINS` provides. */
const TOOLBAR_ITEMS = [
    "bold", "italic", "underline", "strikethrough", "code",
    "|", "fontSize", "fontColor", "fontBackgroundColor",
    "|", "link",
    "|", "bulletedList", "numberedList", "todoList",
    "|", "insertTable", "blockQuote", "codeBlock"
];

interface TextBoxEditorProps {
    /** The content the editor starts with. A later value does not replace what is typed. */
    html: string;
    /** Called once the editor shows `html` and has the focus, so it can replace the rendered text. */
    onReady(): void;
    onChange(html: string): void;
}

/**
 * The text editor of a text box: an `AttributeEditor` with `TEXT_BOX_PLUGINS`, which keep the
 * formatting of an imported page, and a toolbar over the selection. `TextBoxLayer` loads this module, and the text editor with it, when a box can first
 * be edited.
 */
export default function TextBoxEditor({ html, onReady, onChange }: TextBoxEditorProps) {
    const apiRef = useRef<CKEditorApi | undefined>(undefined);
    const initialHtmlRef = useRef(html);
    const configRef = useRef<EditorConfig>(buildConfig());
    const [ uiLanguage ] = useTriliumOption("locale");

    return (
        <CKEditor
            apiRef={apiRef}
            className="handwriting-text-editor"
            editor={AttributeEditor}
            config={configRef.current}
            uiLanguage={uiLanguage as DISPLAYABLE_LOCALE_IDS}
            currentValue={initialHtmlRef.current}
            onChange={(changed) => onChange(changed ?? "")}
            onInitialized={() => {
                onReady();
                // The editor is hidden until `onReady()` shows it, and cannot take the focus before.
                requestAnimationFrame(() => apiRef.current?.focus());
            }}
        />
    );
}

function buildConfig(): EditorConfig {
    return {
        extraPlugins: TEXT_BOX_PLUGINS,
        toolbar: { items: TOOLBAR_ITEMS },
        table: { contentToolbar: [ "tableColumn", "tableRow", "mergeTableCells" ] },
        referenceLink: {
            getTitle: link.getReferenceLinkTitle,
            getTitleSync: link.getReferenceLinkTitleSync
        },
        licenseKey: "GPL"
    };
}
